// Notification Sound, Visuals & Lunar Note Generator

// MESSAGE NOTIFICATION SOUND & VISUALS
// ========================
let _audioCtx = null;
let _lastKnownReceivedCount = 0;
let _notificationToastTimer = null;

function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
}

function playMessageSound() {
    if (localStorage.getItem('moonpop_mute_sounds') === 'true') return;
    try {
        const ctx = getAudioCtx();
        if (ctx.state === 'suspended') ctx.resume();

        // Soft two-tone chime
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(523.25, now); // C5
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, now + 0.15); // E5

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.20, now + 0.15);
        gain.gain.linearRampToValueAtTime(0.25, now + 0.2);
        gain.gain.linearRampToValueAtTime(0, now + 0.6);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.15);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.6);
    } catch (e) {
        console.warn('Could not play notification sound:', e);
    }
}

function showNotificationToast(text) {
    const toast = document.getElementById('notificationToast');
    if (!toast) return;
    toast.classList.remove('visible');
    toast.textContent = text;
    // Force reflow so transition plays from initial state
    void toast.offsetHeight;
    toast.classList.add('visible');
    if (_notificationToastTimer) clearTimeout(_notificationToastTimer);
    _notificationToastTimer = setTimeout(() => {
        toast.classList.remove('visible');
    }, 4000);
}

// Email notification preference (stored in profiles table)
let _notifyEmail = true;
let _notifyPush = true;

function toggleEmailNotifications() {
    _notifyEmail = !_notifyEmail;
    updateEmailNotifBtn();
    // Save to DB
    if (currentAuthUser) {
        sb.from('profiles').update({ notify_email: _notifyEmail }).eq('id', currentAuthUser.id)
            .then(({ error }) => { if (error) console.error('Failed to save email pref:', error); });
    }
}

function updateEmailNotifBtn() {
    const btn = document.getElementById('emailNotifToggleBtn');
    if (!btn) return;
    btn.textContent = _notifyEmail ? 'On' : 'Off';
    btn.style.opacity = _notifyEmail ? '1' : '0.5';
}

function toggleMessageSounds() {
    const muted = localStorage.getItem('moonpop_mute_sounds') === 'true';
    localStorage.setItem('moonpop_mute_sounds', muted ? 'false' : 'true');
    updateSoundToggleBtn();
}

// Moon Roulette opt-in preference (stored in profiles table)
let _rouletteOptIn = true;

function toggleRouletteOptIn() {
    _rouletteOptIn = !_rouletteOptIn;
    updateRouletteOptInBtn();
    if (currentAuthUser) {
        sb.from('profiles').update({ receive_moon_roulette: _rouletteOptIn }).eq('id', currentAuthUser.id)
            .then(({ error }) => { if (error) console.error('Failed to save roulette opt-in pref:', error); });
    }
}

function updateRouletteOptInBtn() {
    const btn = document.getElementById('rouletteOptInToggleBtn');
    if (!btn) return;
    btn.textContent = _rouletteOptIn ? 'On' : 'Off';
    btn.style.opacity = _rouletteOptIn ? '1' : '0.5';
}

function updateSoundToggleBtn() {
    const btn = document.getElementById('soundToggleBtn');
    if (!btn) return;
    const muted = localStorage.getItem('moonpop_mute_sounds') === 'true';
    btn.textContent = muted ? 'Off' : 'On';
    btn.style.opacity = muted ? '0.5' : '1';
}

// Called after messages reload to detect new arrivals and trigger notifications
function checkForNewMessageNotifications() {
    const receivedCount = messages.filter(m => m.type === 'received').length;
    if (_lastKnownReceivedCount > 0 && receivedCount > _lastKnownReceivedCount) {
        const newCount = receivedCount - _lastKnownReceivedCount;
        playMessageSound();

        // Find the newest received message for the toast
        const newestReceived = [...messages].filter(m => m.type === 'received')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        const senderName = newestReceived?.sender || 'Someone';

        showNotificationToast(newCount === 1
            ? `New message from ${senderName}`
            : `${newCount} new messages received`);

        // Flash the specific conversation row(s) with new messages
        requestAnimationFrame(() => {
            if (newestReceived) {
                const senderKey = newestReceived.senderId || newestReceived.sender;
                const convIdx = conversations.findIndex(c => c.otherKey === senderKey);
                if (convIdx >= 0) {
                    const rows = document.querySelectorAll('.message-item');
                    if (rows[convIdx]) {
                        rows[convIdx].classList.add('new-message-flash');
                        setTimeout(() => rows[convIdx].classList.remove('new-message-flash'), 1200);
                    }
                }
            }
        });

        // Also trigger browser notification if permission granted
        if (Notification.permission === 'granted' && document.hidden) {
            try {
                new Notification('MoonPop', {
                    body: newCount === 1 ? `New message from ${senderName}` : `${newCount} new messages`,
                    icon: '🌙',
                    tag: 'moonpop-new-msg'
                });
            } catch(e) { /* notification API may not be available */ }
        }
    }
    // First message ever received — show push prompt after a short delay
    if (_lastKnownReceivedCount === 0 && receivedCount > 0) {
        setTimeout(() => showPushPrompt(), 2000);
    }

    _lastKnownReceivedCount = receivedCount;
}

async function showNotifyModal() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        alert('Push notifications are not supported in this browser.');
        return;
    }

    if (Notification.permission === 'granted') {
        await subscribeToPush();
        alert('Notifications are enabled! You\'ll get notified when moon messages arrive.');
        return;
    }

    if (Notification.permission === 'denied') {
        alert('Notifications are blocked. Please enable them in your browser settings.');
        return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        await subscribeToPush();
        alert('Notifications enabled! You\'ll be notified when moon messages arrive.');
    } else {
        alert('Notification permission was not granted.');
    }
}

async function subscribeToPush() {
    if (!currentAuthUser) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        let subscription = await reg.pushManager.getSubscription();

        if (!subscription) {
            subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }

        const key = subscription.getKey('p256dh');
        const auth = subscription.getKey('auth');

        const { error } = await sb.from('push_subscriptions').upsert({
            user_id: currentAuthUser.id,
            endpoint: subscription.endpoint,
            p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
            auth: btoa(String.fromCharCode(...new Uint8Array(auth)))
        }, { onConflict: 'user_id,endpoint' });

        if (error) console.error('Push subscription save failed:', error);
        else console.log('Push subscription saved successfully');
    } catch (err) {
        console.error('Push subscribe error:', err);
    }
}

// --- Push notification soft prompt (after first message) ---
function showPushPrompt() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem('moonpop_push_prompted')) return;
    const modal = document.getElementById('pushPromptModal');
    if (modal) modal.style.display = 'flex';
}

async function acceptPushPrompt() {
    localStorage.setItem('moonpop_push_prompted', '1');
    const modal = document.getElementById('pushPromptModal');
    if (modal) modal.style.display = 'none';
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        await subscribeToPush();
        updateNotifButton();
    }
}

function dismissPushPrompt() {
    localStorage.setItem('moonpop_push_prompted', '1');
    const modal = document.getElementById('pushPromptModal');
    if (modal) modal.style.display = 'none';
}

function closeModal() {
    _closeComposePanel();
    resetForm();
}

// Go back from compose to contact picker (WhatsApp-style)
function backToRecipientPicker() {
    _closeComposePanel();
    resetForm();
    // Re-open the contact picker
    setTimeout(() => openNewMessagePicker(), 250);
}

function openPublicModal() {
    if (!moonData.isVisible) {
        openMoonDownModal();
        return;
    }
    document.getElementById('publicModal').classList.add('active');
}

function closePublicModal() {
    document.getElementById('publicModal').classList.remove('active');
    document.getElementById('publicMessage').value = '';
}

// Switch between default compose and new contact views
function showDefaultCompose() {
    document.getElementById('composeStep1').style.display = 'block';
    document.getElementById('composeStep2').style.display = 'none';
    document.getElementById('composeNewContact').style.display = 'none';
}

function showNewContactForm() {
    document.getElementById('composeStep1').style.display = 'none';
    document.getElementById('composeStep2').style.display = 'none';
    document.getElementById('composeNewContact').style.display = 'block';
    // Clear new contact fields
    document.getElementById('newContactName').value = '';
    document.getElementById('newContactEmail').value = '';
    document.getElementById('newContactCity').value = '';
    document.getElementById('newContactCityDropdown').classList.remove('active');
    const firstNameEl = document.getElementById('newContactFirstName');
    const lastNameEl = document.getElementById('newContactLastName');
    if (firstNameEl) firstNameEl.value = '';
    if (lastNameEl) lastNameEl.value = '';
    // Reset email lookup
    emailLookupResult = null;
    const lookupDiv = document.getElementById('emailLookupResult');
    if (lookupDiv) lookupDiv.style.display = 'none';

    // Update header (dark theme) — back goes to recipient picker
    const header = document.getElementById('composeHeader');
    header.innerHTML = `
        <button class="compose-header-btn" onclick="backFromNewContact()">
            <svg width="18" height="18" style="color:white"><use href="#icon-back"/></svg>
        </button>
        <span style="font-weight:700;color:white;font-size:15px;">New Contact</span>
        <span style="width:36px;"></span>
    `;
}

function backFromNewContact() {
    // Go back to recipient picker (WhatsApp-style)
    _closeComposePanel();
    resetForm();
    setTimeout(() => openNewMessagePicker(), 250);
}

// Compose action: recipient is always pre-selected (WhatsApp-style), send directly
function composeMainAction() {
    console.log('[SEND] composeMainAction called');
    try {
        handleComposeSend();
    } catch(e) {
        console.error('composeMainAction error:', e);
        alert('Error sending: ' + e.message);
    }
}

function goToRecipientStep() {
    const textMessage = document.getElementById('messageText').value.trim();
    const songVal = document.getElementById('songInput')?.value.trim() || '';
    
    // Check if lunar note is ready
    let hasLunarNote = false;
    if (lunarNoteActive) {
        const v1 = document.getElementById('lunarInput1').value.trim();
        const v2 = document.getElementById('lunarInput2').value.trim();
        const v3 = document.getElementById('lunarInput3').value.trim();
        if (v1 && v2 && v3 && document.getElementById('lunarResultCard').style.display !== 'none') {
            hasLunarNote = true;
        } else if (v1 || v2 || v3) {
            alert('Finish your Lunar Note or remove it to continue.');
            return;
        }
    }
    
    const hasPhotoAttached = !!window['_pendingPhotoFile_compose'];
    if (!textMessage && !hasLunarNote && !hasPhotoAttached) {
        alert('Write a message, add a Lunar Note, or both!');
        return;
    }
    
    document.getElementById('composeStep1').style.display = 'none';
    document.getElementById('composeStep2').style.display = 'block';

    // Switch header (dark theme)
    const header = document.getElementById('composeHeader');
    header.innerHTML = `
        <button class="compose-header-btn" onclick="backToStep1()">
            <svg width="18" height="18" style="color:white"><use href="#icon-back"/></svg>
        </button>
        <span style="font-weight:700;color:white;font-size:15px;">Send to</span>
        <span style="width:36px;"></span>
    `;
}

function goToComposeStep2() {
    // Legacy alias — now this goes to recipient step
    goToRecipientStep();
}

function backToStep1() {
    // Legacy: now goes back to recipient picker
    backToRecipientPicker();
}

// Confirm new contact and go to compose
// Enable/disable save button for new contact
function checkNewContactForm() {
    const firstName = document.getElementById('newContactFirstName')?.value.trim() || '';
    const lastName = document.getElementById('newContactLastName')?.value.trim() || '';
    const email = document.getElementById('newContactEmail').value.trim();
    const city = document.getElementById('newContactCity').value.trim();
    const displayName = (firstName + ' ' + lastName).trim();
    document.getElementById('newContactName').value = displayName;
    const btn = document.getElementById('saveContactBtn');
    if (btn) btn.disabled = !(firstName && email && city);
}

// Real-time email lookup with debounce
let emailLookupTimer = null;
let emailLookupResult = null;

function debouncedEmailLookup() {
    clearTimeout(emailLookupTimer);
    const email = document.getElementById('newContactEmail').value.trim();
    const resultDiv = document.getElementById('emailLookupResult');
    
    if (!email || !email.includes('@') || !email.includes('.')) {
        resultDiv.style.display = 'none';
        emailLookupResult = null;
        return;
    }
    
    emailLookupTimer = setTimeout(() => lookupEmailNow(email), 500);
}

async function lookupEmailNow(email) {
    const resultDiv = document.getElementById('emailLookupResult');
    if (!currentAuthUser) return;
    
    resultDiv.style.display = 'block';
    resultDiv.style.background = 'rgba(212,181,138,0.06)';
    resultDiv.style.color = 'var(--text-muted)';
    resultDiv.innerHTML = 'Checking...';
    
    try {
        const { data, error } = await sb.from('profiles')
            .select('id, username, first_name, last_name, city, avatar_url, email')
            .eq('email', email)
            .limit(1);

        if (error) {
            console.error('Email lookup error:', error);
            resultDiv.style.display = 'none';
            emailLookupResult = null;
            return;
        }

        if (data && data.length > 0) {
            const user = data[0];
            emailLookupResult = user;
            resultDiv.style.background = 'rgba(76,175,80,0.1)';
            resultDiv.style.color = '#2e7d32';
            const displayName = user.username || user.first_name || 'This person';
            resultDiv.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span>✓ <strong>${displayName}</strong> is on Moon Post Service!</span>
                    <button onclick="useExistingUser()" style="background:var(--blue);color:white;border:none;border-radius:16px;padding:4px 14px;font-size:12px;cursor:pointer;font-weight:600;">Add</button>
                </div>
            `;
            
            // Auto-fill name fields if empty
            const fnEl = document.getElementById('newContactFirstName');
            const lnEl = document.getElementById('newContactLastName');
            if (user.first_name && fnEl && !fnEl.value) fnEl.value = user.first_name;
            if (user.last_name && lnEl && !lnEl.value) lnEl.value = user.last_name;
            if (user.username && fnEl && !fnEl.value) fnEl.value = user.username;
            if (user.city) {
                const cityEl = document.getElementById('newContactCity');
                if (cityEl && !cityEl.value) cityEl.value = user.city;
            }
            checkNewContactForm();
        } else {
            emailLookupResult = null;
            resultDiv.style.background = 'rgba(212,181,138,0.06)';
            resultDiv.style.color = 'var(--text-muted)';
            resultDiv.innerHTML = 'Not on Moon Post Service yet — they\'ll get an invite email';
        }
    } catch(e) {
        console.error('Email lookup exception:', e);
        resultDiv.style.display = 'none';
        emailLookupResult = null;
    }
}

function useExistingUser() {
    if (!emailLookupResult) return;
    const user = emailLookupResult;
    const email = document.getElementById('newContactEmail').value.trim();
    const fnEl = document.getElementById('newContactFirstName');
    const lnEl = document.getElementById('newContactLastName');
    const cityEl = document.getElementById('newContactCity');
    
    const name = user.username || ((user.first_name || '') + ' ' + (user.last_name || '')).trim() || email;
    if (fnEl && !fnEl.value) fnEl.value = user.first_name || user.username || '';
    if (lnEl && !lnEl.value) lnEl.value = user.last_name || '';
    if (cityEl && !cityEl.value) cityEl.value = user.city || '';
    document.getElementById('newContactName').value = name;
    
    checkNewContactForm();
}

async function confirmNewContact() {
    const firstName = document.getElementById('newContactFirstName')?.value.trim() || '';
    const lastName = document.getElementById('newContactLastName')?.value.trim() || '';
    const name = (firstName + ' ' + lastName).trim();
    const email = document.getElementById('newContactEmail').value.trim();
    const city = document.getElementById('newContactCity').value.trim();
    
    if (!firstName) { alert('Please enter their first name'); return; }
    if (!email) { alert('Please enter their email'); return; }
    if (!email.includes('@') || !email.includes('.')) { alert('Please enter a valid email'); return; }
    if (!city) { alert('Please enter their location'); return; }

    // Use cached lookup result or do fresh lookup via RPC
    let isOnMps = false;
    let linkedProfileId = null;
    
    if (emailLookupResult) {
        isOnMps = true;
        linkedProfileId = emailLookupResult.id;
    } else if (currentAuthUser) {
        try {
            const { data } = await sb.from('profiles')
                .select('id')
                .eq('email', email)
                .limit(1);
            if (data && data.length > 0) {
                isOnMps = true;
                linkedProfileId = data[0].id;
            }
        } catch(e) {
            console.error('Lookup failed:', e);
        }
    }
    
    // Store as selected recipient
    selectedRecipient = { name, email, location: city, isNew: true, isOnMoonpop: isOnMps, linkedProfileId };

    // Save to contacts array
    const newContact = {
        name, email, location: city,
        isOnMoonpop: isOnMps,
        linkedProfileId
    };
    if (!contacts.find(c => c.email === email)) {
        contacts.push(newContact);
        if (currentAuthUser) {
            sb.from('contacts').insert({
                owner_id: currentAuthUser.id,
                name: name,
                email: email,
                city: city,
                is_on_moonpop: isOnMps,
                linked_profile_id: linkedProfileId
            });
        }
    }

    // WhatsApp-style: go to compose step with recipient shown in header
    document.getElementById('composeNewContact').style.display = 'none';
    document.getElementById('composeStep1').style.display = 'block';

    // Refresh song suggestions
    refreshSongSuggestions();

    // Auto-activate lunar note
    if (!lunarNoteActive) {
        lunarNoteActive = true;
        currentPromptSet = getNextPromptSet();
        currentLunarTemplate = -1;
        const ps = PROMPT_SETS[currentPromptSet];
        for (let i = 0; i < 3; i++) {
            document.getElementById('lunarLabel' + (i+1)).textContent = ps.prompts[i].label;
            document.getElementById('lunarInput' + (i+1)).placeholder = ps.prompts[i].placeholder;
        }
        goLunarStep(1);
    }

    // Update header to show recipient name
    const header = document.getElementById('composeHeader');
    header.innerHTML = `
        <button class="message-page-back" onclick="backToRecipientPicker()" style="font-size:20px;">←</button>
        <span style="font-weight:700;color:var(--blue);font-size:15px;">${selectedRecipient.name}</span>
        <span style="width:34px;"></span>
    `;
    const mainBtn = document.getElementById('composeMainBtn');
    if (mainBtn) mainBtn.textContent = 'Release to the Moon 🌙';
}

// Lunar Note state
let lunarNoteActive = false;
let currentLunarTemplate = -1;
let currentPromptSet = 0;
let lunarPromptHistory = []; // tracks recently used prompt indices to avoid repeats
let _lunarMoonPhase = 'waxing crescent';
let _lunarZodiac = 'Pisces';

// Combinatorial prompt pools — each step draws independently
// ~38 options per step = 38x38x38 = 54,872 unique prompt combinations
const LUNAR_POOL_1 = [
    // Step 1 labels and placeholders (feelings, sensory, abstract)
    { label: 'an emotion', placeholder: 'anything that comes to mind' },
    { label: 'a color', placeholder: 'the first one you see' },
    { label: 'something small you like', placeholder: 'really small' },
    { label: 'an object near you right now', placeholder: 'look around' },
    { label: 'a body part', placeholder: 'elbow? ribcage?' },
    { label: 'a season', placeholder: 'your favorite or least' },
    { label: 'a drink', placeholder: 'hot or cold' },
    { label: 'a smell', placeholder: 'good or weird' },
    { label: 'something warm', placeholder: 'literal or not' },
    { label: 'something you almost said today', placeholder: 'the one that got away' },
    { label: 'a flavor', placeholder: 'sweet, sour, burnt?' },
    { label: 'something you\'re carrying', placeholder: 'literally or not' },
    { label: 'an old photograph', placeholder: 'describe it in 3 words' },
    { label: 'a childhood memory', placeholder: 'the first one that comes' },
    { label: 'a type of silence', placeholder: 'comfortable? heavy?' },
    { label: 'a room you remember', placeholder: 'whose was it?' },
    { label: 'something round', placeholder: 'besides the moon' },
    { label: 'something you built', placeholder: 'real or imaginary' },
    { label: 'a thing you do every morning', placeholder: 'the very first thing' },
    { label: 'something unfinished', placeholder: 'a book? a sentence?' },
    { label: 'a shadow', placeholder: 'yours or someone else\'s' },
    { label: 'a fruit', placeholder: 'ripe or not' },
    { label: 'a plant', placeholder: 'real or remembered' },
    { label: 'a bridge', placeholder: 'real or metaphorical' },
    { label: 'a coin', placeholder: 'heads or tails?' },
    { label: 'a stain', placeholder: 'on what?' },
    { label: 'a tree you remember', placeholder: 'where was it?' },
    { label: 'a type of rain', placeholder: 'drizzle? storm? mist?' },
    { label: 'a key', placeholder: 'to what?' },
    { label: 'a stone', placeholder: 'smooth or rough?' },
    { label: 'a thread', placeholder: 'real or metaphorical' },
    { label: 'a spark', placeholder: 'from what?' },
    { label: 'a scar', placeholder: 'visible or not' },
    { label: 'a flicker', placeholder: 'of what?' },
    { label: 'a seed', placeholder: 'planted or not yet' },
    // Moon-aware prompts for step 1
    { label: 'a feeling the moon gives you tonight', placeholder: 'look up if you can' },
    { label: 'something the night sky reminds you of', placeholder: 'every time' },
    { label: 'a word for how the moonlight feels', placeholder: 'invent one if needed' },
];

const LUNAR_POOL_2 = [
    // Step 2 labels and placeholders (relational, spatial, temporal)
    { label: 'a different emotion', placeholder: 'something else entirely' },
    { label: 'a sound you heard today', placeholder: 'big or small' },
    { label: 'a place', placeholder: 'real or imaginary' },
    { label: 'something soft', placeholder: 'a texture, a word, anything' },
    { label: 'something you noticed this week', placeholder: 'just a small thing' },
    { label: 'something you keep forgetting', placeholder: 'keys, dreams, names...' },
    { label: 'a type of light', placeholder: 'candle? screen? sunrise?' },
    { label: 'an animal', placeholder: 'any creature' },
    { label: 'a number', placeholder: 'just pick one' },
    { label: 'a song you hum', placeholder: 'or a sound you make' },
    { label: 'a texture', placeholder: 'rough? soft? warm?' },
    { label: 'a person who doesn\'t know you\'re thinking of them', placeholder: 'just a first name' },
    { label: 'a question with no answer', placeholder: 'the kind you like' },
    { label: 'a distance', placeholder: 'in steps, miles, or feelings' },
    { label: 'a sound from far away', placeholder: 'how far?' },
    { label: 'something that glows', placeholder: 'anything at all' },
    { label: 'something blue', placeholder: 'or feeling blue' },
    { label: 'something that moves slowly', placeholder: 'clouds? time?' },
    { label: 'a kind of morning', placeholder: 'which kind?' },
    { label: 'a feeling you can\'t name', placeholder: 'try anyway' },
    { label: 'a voice you miss', placeholder: 'whose?' },
    { label: 'something invisible', placeholder: 'but you know it\'s there' },
    { label: 'something heavy', placeholder: 'weight or feeling' },
    { label: 'something that floats', placeholder: 'in water or in thought' },
    { label: 'a small victory', placeholder: 'today or recently' },
    { label: 'a word that calms you down', placeholder: 'just one' },
    { label: 'something sweet', placeholder: 'literally or not' },
    { label: 'something forgotten on purpose', placeholder: 'you remember anyway' },
    { label: 'a secret place', placeholder: 'only you know' },
    { label: 'something you collect', placeholder: 'rocks? moments?' },
    { label: 'something bitter', placeholder: 'taste or feeling' },
    { label: 'something tangled', placeholder: 'headphones? thoughts?' },
    { label: 'something dusty', placeholder: 'shelves? memories?' },
    { label: 'something you lost and found', placeholder: 'the same or different?' },
    { label: 'something silver', placeholder: 'shiny or worn' },
    // Moon-aware prompts for step 2
    { label: 'something the moon might be carrying tonight', placeholder: 'use your imagination' },
    { label: 'a sound that belongs to this time of night', placeholder: 'listen carefully' },
    { label: 'something you\'d tell the moon if it could hear', placeholder: 'it can' },
];

const LUNAR_POOL_3 = [
    // Step 3 labels and placeholders (deeper, more personal)
    { label: 'something you pretend not to care about', placeholder: 'you know the one' },
    { label: 'a time of day', placeholder: 'morning? 3am?' },
    { label: 'a kind of weather', placeholder: 'any season' },
    { label: 'a thing you do when nobody\'s watching', placeholder: 'your secret move' },
    { label: 'a word that sounds funny', placeholder: 'say it out loud' },
    { label: 'a texture', placeholder: 'smooth? crinkly?' },
    { label: 'something gentle', placeholder: 'could be anything' },
    { label: 'something you\'re looking forward to', placeholder: 'even small things count' },
    { label: 'something quiet', placeholder: 'sounds or feelings' },
    { label: 'a word you want to say more often', placeholder: 'let it out' },
    { label: 'what your hands were doing an hour ago', placeholder: 'be specific' },
    { label: 'the last thing that made you laugh', placeholder: 'even a little' },
    { label: 'a window you looked through today', placeholder: 'what was outside?' },
    { label: 'a secret that isn\'t really a secret', placeholder: 'everyone knows' },
    { label: 'something you\'d put in a time capsule', placeholder: 'open in 20 years' },
    { label: 'a word from another language', placeholder: 'you don\'t need to speak it' },
    { label: 'the last thing you touched', placeholder: 'before this' },
    { label: 'a promise you made to yourself', placeholder: 'kept or not' },
    { label: 'something you\'d whisper', placeholder: 'to who?' },
    { label: 'the last dream you remember', placeholder: 'fragments count' },
    { label: 'something that tastes like home', placeholder: 'close your eyes' },
    { label: 'the last thing that surprised you', placeholder: 'good or bad' },
    { label: 'a conversation you replay', placeholder: 'what would you change?' },
    { label: 'a place you go when you close your eyes', placeholder: 'take me there' },
    { label: 'the sound your door makes', placeholder: 'creak? click? slam?' },
    { label: 'the moon right now', placeholder: 'what does it look like to you?' },
    { label: 'a thing that always works', placeholder: 'your go-to' },
    { label: 'the best part of today', placeholder: 'even if small' },
    { label: 'the space between two breaths', placeholder: 'what lives there?' },
    { label: 'a corner of a room', placeholder: 'which room?' },
    { label: 'a goodbye you didn\'t say', placeholder: 'to whom?' },
    { label: 'a sound that comforts you', placeholder: 'rain? humming?' },
    { label: 'a lie you tell yourself kindly', placeholder: 'the gentle kind' },
    { label: 'the first star you see', placeholder: 'what do you wish?' },
    { label: 'a lullaby', placeholder: 'who sang it?' },
    // Moon-aware prompts for step 3
    { label: 'a wish you\'d send to the moon', placeholder: 'it\'s listening' },
    { label: 'something that only makes sense at night', placeholder: 'and that\'s fine' },
    { label: 'what the dark sounds like right now', placeholder: 'be still' },
];

// Keep backward compatibility: build PROMPT_SETS from pools for existing code
// Each "set" is now dynamically constructed per user per compose
const PROMPT_SETS = LUNAR_POOL_1.map((_, i) => ({
    prompts: [
        LUNAR_POOL_1[i % LUNAR_POOL_1.length],
        LUNAR_POOL_2[i % LUNAR_POOL_2.length],
        LUNAR_POOL_3[i % LUNAR_POOL_3.length]
    ]
}));

// 100 poem templates — (a, b, c) → { lines, closing }
const lunarTemplates = [
    (a, b, c) => ({ lines: `Under the moon, I feel ${a},\nthen ${b}—no harm.\n${capitalize(c)} is just part of the charm.`, closing: '— the moon is smiling' }),
    (a, b, c) => ({ lines: `A little ${a}, a lot of ${b},\nand somewhere in the middle:\n${c}.`, closing: '— not bad for tonight' }),
    (a, b, c) => ({ lines: `Started with ${a}.\nEnded up at ${b}.\n${capitalize(c)} was there the whole time.`, closing: '— sounds about right' }),
    (a, b, c) => ({ lines: `${capitalize(a)} walked in.\n${capitalize(b)} sat down.\n${capitalize(c)} waved from across the room.`, closing: '— classic' }),
    (a, b, c) => ({ lines: `If ${a} were weather, it would be warm.\nIf ${b} were a season, late spring.\nAnd ${c}? That one's just Tuesday.`, closing: '— the moon says hi' }),
    (a, b, c) => ({ lines: `There's ${a} in the air tonight,\na dash of ${b} on the side.\n${capitalize(c)}? We don't talk about that.\nBut we're smiling anyway.`, closing: '— good night, really' }),
    (a, b, c) => ({ lines: `Somewhere between ${a}\nand ${b},\nthere's a place called ${c}.\nI think I've been there.`, closing: '— stay a while' }),
    (a, b, c) => ({ lines: `${capitalize(a)}: present.\n${capitalize(b)}: noted.\n${capitalize(c)}: surprisingly fine.`, closing: '— roll call complete' }),
    (a, b, c) => ({ lines: `The moon held ${a} in one hand\nand ${b} in the other.\n${capitalize(c)} just floated up on its own.`, closing: '— it does that sometimes' }),
    (a, b, c) => ({ lines: `${capitalize(a)} showed up first,\nthen ${b} knocked twice,\nand ${c}?\n${capitalize(c)} was already inside.`, closing: '— full house tonight' }),
    (a, b, c) => ({ lines: `I packed ${a} for the trip.\nBorrowed ${b} from someone I used to know.\n${capitalize(c)} just showed up at the door.`, closing: '— carry-on only' }),
    (a, b, c) => ({ lines: `${capitalize(a)}: the part I said out loud.\n${capitalize(b)}: the part I almost did.\n${capitalize(c)}: the part that stayed.`, closing: '— three-act night' }),
    (a, b, c) => ({ lines: `One hand full of ${a},\nthe other holding ${b}.\nAnd ${c}?\nBalanced on the roof of my mouth\nlike a word I haven't said yet.`, closing: '— almost there' }),
    (a, b, c) => ({ lines: `The moon asked for ${a}.\nI gave it ${b} instead.\nIt didn't mind.\nIt just whispered: ${c}.`, closing: '— fair trade' }),
    (a, b, c) => ({ lines: `${capitalize(a)} fell asleep on the couch.\n${capitalize(b)} left the window open.\nAnd ${c} tiptoed in with the breeze.`, closing: '— uninvited but welcome' }),
    (a, b, c) => ({ lines: `I wrote ${a} on a napkin,\nfolded ${b} into a paper crane,\nand left ${c} under a rock\nwhere only the moon could find it.`, closing: '— hidden in plain sight' }),
    (a, b, c) => ({ lines: `Three things the moon knows:\n${a},\n${b},\nand the quiet shape of ${c}\nwhen no one's looking.`, closing: '— lunar inventory' }),
    (a, b, c) => ({ lines: `${capitalize(a)} tastes different at night.\n${capitalize(b)} sounds louder.\nAnd ${c}?\n${capitalize(c)} finally makes sense.`, closing: '— the after-hours version' }),
    (a, b, c) => ({ lines: `Dear ${a},\nI hope this finds you well.\n${capitalize(b)} sends regards.\nAnd ${c}? ${capitalize(c)} never left.`, closing: '— yours, the moon' }),
    (a, b, c) => ({ lines: `If I could mail ${a} to the moon,\nI'd wrap it in ${b}\nand address it to ${c}.`, closing: '— postage: one wish' }),
    (a, b, c) => ({ lines: `Tonight's forecast:\n${a} with a chance of ${b}.\nLate-night ${c} expected.\nNo umbrella needed.`, closing: '— lunar weather report' }),
    (a, b, c) => ({ lines: `The recipe calls for:\na pinch of ${a},\na handful of ${b},\nand ${c} to taste.\nBake under moonlight.`, closing: '— serves two' }),
    (a, b, c) => ({ lines: `${capitalize(a)} is what I meant.\n${capitalize(b)} is what I said.\n${capitalize(c)} is what you heard.\nSomehow it all worked out.`, closing: '— lost in translation' }),
    (a, b, c) => ({ lines: `In the dictionary of tonight,\n${a} means almost.\n${capitalize(b)} means not yet.\nAnd ${c}? See: everything.`, closing: '— look it up' }),
    (a, b, c) => ({ lines: `${capitalize(a)} sat on the left.\n${capitalize(b)} sat on the right.\n${capitalize(c)} stood in the doorway,\nnot sure which side to choose.`, closing: '— there\'s room for all three' }),
    (a, b, c) => ({ lines: `Note to self:\nremember ${a}.\nforget ${b} (just for tonight).\nand whatever you do,\ndon't let go of ${c}.`, closing: '— pinned to the fridge' }),
    (a, b, c) => ({ lines: `The moon collects things:\n${a} from Monday,\n${b} from a dream,\n${c} from the space\nbetween a thought and a sigh.`, closing: '— growing collection' }),
    (a, b, c) => ({ lines: `I found ${a} in my pocket.\n${capitalize(b)} was under the pillow.\n${capitalize(c)} was exactly where I left it:\nright here.`, closing: '— nothing\'s lost' }),
    (a, b, c) => ({ lines: `${capitalize(a)} before coffee.\n${capitalize(b)} after dark.\n${capitalize(c)} in that gap\nwhere the day holds its breath.`, closing: '— daily rhythm' }),
    (a, b, c) => ({ lines: `Two truths and a moon:\n${a} is real.\n${capitalize(b)} is real.\n${capitalize(c)}? That one depends\non how the light hits it.`, closing: '— take your pick' }),
    // 31–100: new templates
    (a, b, c) => ({ lines: `${capitalize(a)} opened the window.\n${capitalize(b)} climbed through.\n${capitalize(c)} was waiting\non the other side.`, closing: '— come on in' }),
    (a, b, c) => ({ lines: `The moon whispered ${a}\nto the dark side of ${b}.\n${capitalize(c)} overheard\nand smiled.`, closing: '— walls have ears' }),
    (a, b, c) => ({ lines: `First: ${a}.\nThen: ${b}.\nAlways: ${c}.`, closing: '— in that order' }),
    (a, b, c) => ({ lines: `I left ${a} at the door,\ncarried ${b} up the stairs,\nand found ${c}\nalready asleep in my bed.`, closing: '— make yourself at home' }),
    (a, b, c) => ({ lines: `${capitalize(a)} rang the doorbell.\n${capitalize(b)} answered.\nNeither expected ${c},\nbut there it was.`, closing: '— surprise guest' }),
    (a, b, c) => ({ lines: `Ingredients for tonight:\n${a}, slightly bruised.\n${capitalize(b)}, room temperature.\n${capitalize(c)}, straight from the garden.`, closing: '— no recipe needed' }),
    (a, b, c) => ({ lines: `The tide brought in ${a},\ntook away ${b},\nand left ${c}\nshining on the shore.`, closing: '— the moon keeps what it wants' }),
    (a, b, c) => ({ lines: `${capitalize(a)} fits in a teaspoon.\n${capitalize(b)} fills a room.\n${capitalize(c)} is the size\nof whatever you need it to be.`, closing: '— flexible like that' }),
    (a, b, c) => ({ lines: `Someone painted ${a}\non the ceiling.\nSomeone else hung ${b}\nfrom the rafters.\n${capitalize(c)} just grew there\non its own.`, closing: '— gallery opening tonight' }),
    (a, b, c) => ({ lines: `The alarm clock says ${a}.\nThe mirror says ${b}.\nThe moon says ${c},\nand the moon is usually right.`, closing: '— trust the moon' }),
    (a, b, c) => ({ lines: `I traded ${a} for ${b}\nat the corner of midnight.\nKept ${c}\nin my back pocket\njust in case.`, closing: '— smart move' }),
    (a, b, c) => ({ lines: `${capitalize(a)} hums a little.\n${capitalize(b)} creaks.\nAnd ${c}?\n${capitalize(c)} doesn't make a sound,\nwhich is how you know it's there.`, closing: '— the quiet ones' }),
    (a, b, c) => ({ lines: `The postman brought ${a}.\nThe wind brought ${b}.\n${capitalize(c)} just walked in\nwithout knocking.`, closing: '— delivery complete' }),
    (a, b, c) => ({ lines: `${capitalize(a)}, underlined.\n${capitalize(b)}, circled twice.\n${capitalize(c)}, written in the margin\nwhere no one looks.`, closing: '— annotated night' }),
    (a, b, c) => ({ lines: `Plant ${a} in April.\nWater with ${b}.\nBy moonrise,\n${c} will have bloomed.`, closing: '— lunar gardening' }),
    (a, b, c) => ({ lines: `The elevator stopped at ${a}.\nThe doors opened to ${b}.\nI pressed the button for ${c}\nand held my breath.`, closing: '— going up' }),
    (a, b, c) => ({ lines: `${capitalize(a)} has a shadow\nthat looks like ${b}.\nAnd ${c}?\n${capitalize(c)}'s shadow looks like tomorrow.`, closing: '— look down' }),
    (a, b, c) => ({ lines: `If ${a} had a key,\nit would unlock ${b}.\nBehind that door:\n${c}, wearing pajamas.`, closing: '— wasn\'t expecting company' }),
    (a, b, c) => ({ lines: `Tonight I am:\n60% ${a},\n30% ${b},\n10% ${c}.\nThe math doesn't matter.`, closing: '— approximately me' }),
    (a, b, c) => ({ lines: `${capitalize(a)} knows the shortcut.\n${capitalize(b)} takes the long way.\n${capitalize(c)} never arrives\nbut somehow is always there.`, closing: '— different routes' }),
    (a, b, c) => ({ lines: `A museum of tonight\nwould display:\n${a} under glass,\n${b} on the wall,\nand ${c} in the gift shop.`, closing: '— admission free' }),
    (a, b, c) => ({ lines: `The fortune cookie said:\n${a} will lead to ${b}.\n${capitalize(c)} was the lucky number\nall along.`, closing: '— in bed' }),
    (a, b, c) => ({ lines: `${capitalize(a)} turned off the lights.\n${capitalize(b)} lit a candle.\n${capitalize(c)} sat down\nand the room felt full.`, closing: '— that\'s enough' }),
    (a, b, c) => ({ lines: `Dear Moon,\nplease file ${a} under "important."\nFile ${b} under "later."\n${capitalize(c)} goes in the drawer\nthat doesn't have a label.`, closing: '— your filing system' }),
    (a, b, c) => ({ lines: `${capitalize(a)} before the comma.\n${capitalize(b)} after the semicolon.\n${capitalize(c)} in the space\nwhere punctuation gives up.`, closing: '— grammar of the heart' }),
    (a, b, c) => ({ lines: `The suitcase held ${a}.\nThe carry-on held ${b}.\n${capitalize(c)} rode in my chest\nthe whole flight.`, closing: '— no baggage fee' }),
    (a, b, c) => ({ lines: `${capitalize(a)} is a Tuesday word.\n${capitalize(b)} is a Saturday word.\n${capitalize(c)} belongs to whatever day\nyou're reading this.`, closing: '— today\'s word' }),
    (a, b, c) => ({ lines: `The map shows ${a}\nnear the coast of ${b}.\n${capitalize(c)} isn't on any map.\nThat's what makes it real.`, closing: '— off the grid' }),
    (a, b, c) => ({ lines: `Some nights taste like ${a}.\nOther nights hum like ${b}.\nTonight just whispers\n${c}.\nAnd that's plenty.`, closing: '— enough said' }),
    (a, b, c) => ({ lines: `I left ${a} on the bus.\n${capitalize(b)} on the bench.\n${capitalize(c)} followed me home\nlike a stray thought.`, closing: '— lost and found' }),
    (a, b, c) => ({ lines: `${capitalize(a)} is the inhale.\n${capitalize(b)} is the exhale.\n${capitalize(c)} is the pause\nwhere everything rests.`, closing: '— breathe' }),
    (a, b, c) => ({ lines: `A haiku, almost:\n${a}.\n${capitalize(b)}.\n${capitalize(c)}.\n…close enough.`, closing: '— five-seven-whatever' }),
    (a, b, c) => ({ lines: `The bottom of the ocean\nhas ${a}.\nThe top of the sky\nhas ${b}.\nRight here, right now,\nI have ${c}.`, closing: '— depth chart' }),
    (a, b, c) => ({ lines: `Knock knock.\nWho's there?\n${capitalize(a)}.\n${capitalize(a)} who?\n${capitalize(a)} that somehow became ${b}\nwhen ${c} wasn't looking.`, closing: '— the punchline is tenderness' }),
    (a, b, c) => ({ lines: `${capitalize(a)} pressed record.\n${capitalize(b)} pressed pause.\n${capitalize(c)} pressed play\nat exactly the right moment.`, closing: '— perfect timing' }),
    (a, b, c) => ({ lines: `The bath water was ${a}.\nThe soap smelled like ${b}.\nAnd ${c} floated\nthe way good things do.`, closing: '— soak it in' }),
    (a, b, c) => ({ lines: `The first chapter is ${a}.\nThe plot twist is ${b}.\nThe ending?\n${capitalize(c)}, probably.\nI haven't finished yet.`, closing: '— no spoilers' }),
    (a, b, c) => ({ lines: `${capitalize(a)} wears boots.\n${capitalize(b)} wears slippers.\n${capitalize(c)} goes barefoot\nand never complains.`, closing: '— dressed for the occasion' }),
    (a, b, c) => ({ lines: `The fridge light illuminated ${a}.\nThe streetlight caught ${b}.\nBut only the moon\ncould see ${c}.`, closing: '— different kinds of light' }),
    (a, b, c) => ({ lines: `Fold ${a} in half.\nTuck ${b} underneath.\nLeave ${c} on top\nwhere the morning can find it.`, closing: '— origami evening' }),
    (a, b, c) => ({ lines: `The radio played ${a}.\nI changed the station to ${b}.\n${capitalize(c)} was on every channel.`, closing: '— no escaping it' }),
    (a, b, c) => ({ lines: `${capitalize(a)} takes the stairs.\n${capitalize(b)} takes the fire escape.\n${capitalize(c)} was already\non the roof.`, closing: '— always one step ahead' }),
    (a, b, c) => ({ lines: `Three knocks:\n${a}.\n${b}.\n${c}.\nThe door opens\nfrom the inside.`, closing: '— who\'s there?' }),
    (a, b, c) => ({ lines: `${capitalize(a)} is the headline.\n${capitalize(b)} is the fine print.\n${capitalize(c)} is the part\nthey forgot to publish.`, closing: '— read between the lines' }),
    (a, b, c) => ({ lines: `I keep ${a}\nin the junk drawer.\n${capitalize(b)}\nin the medicine cabinet.\n${capitalize(c)}\nnext to my heart.`, closing: '— organized chaos' }),
    (a, b, c) => ({ lines: `${capitalize(a)} fell like snow.\n${capitalize(b)} melted like morning.\n${capitalize(c)} stayed\nthe way good frost does\non the inside of windows.`, closing: '— winter tonight' }),
    (a, b, c) => ({ lines: `The voicemail said:\n"Hey, it's ${a}.\nJust calling about ${b}.\nAlso—\n${c}.\nOkay, bye."`, closing: '— *beep*' }),
    (a, b, c) => ({ lines: `Page one: ${a}.\nChapter two: ${b}.\nThe epilogue\nis just ${c},\nrepeated softly.`, closing: '— a short story' }),
    (a, b, c) => ({ lines: `The bus to ${a}\nstops at ${b}\nevery other Tuesday.\n${capitalize(c)} gets on\nwithout a ticket.`, closing: '— free ride' }),
    (a, b, c) => ({ lines: `If the moon kept a diary:\nMonday—saw ${a}.\nTuesday—thought about ${b}.\nWednesday—finally understood ${c}.`, closing: '— dear diary' }),
    (a, b, c) => ({ lines: `${capitalize(a)} rhymes with nothing.\n${capitalize(b)} rhymes with everything.\n${capitalize(c)} doesn't need to rhyme.\nIt just is.`, closing: '— free verse' }),
    (a, b, c) => ({ lines: `In the garden of tonight:\n${a} is the soil.\n${capitalize(b)} is the rain.\n${capitalize(c)} is whatever grows\nwhen nobody's tending.`, closing: '— wild things' }),
    (a, b, c) => ({ lines: `${capitalize(a)}, served cold.\n${capitalize(b)}, served warm.\n${capitalize(c)}, served\nat exactly the right temperature\nwithout trying.`, closing: '— bon appétit' }),
    (a, b, c) => ({ lines: `The password is ${a}.\nThe secret handshake is ${b}.\nThe thing you actually need\nto get in\nis just ${c}.`, closing: '— open sesame' }),
    (a, b, c) => ({ lines: `${capitalize(a)} borrowed the car.\n${capitalize(b)} called shotgun.\n${capitalize(c)} sat in the back\nwith the windows down,\nsinging.`, closing: '— road trip' }),
    (a, b, c) => ({ lines: `They bottled ${a} in 2004.\nAged ${b} in oak.\n${capitalize(c)} they served straight,\nno glass needed.`, closing: '— vintage night' }),
    (a, b, c) => ({ lines: `${capitalize(a)} cast a long shadow.\n${capitalize(b)} cast a short one.\n${capitalize(c)} cast no shadow at all,\nwhich meant the light\nwas coming from inside.`, closing: '— illuminated' }),
    (a, b, c) => ({ lines: `The clock struck ${a}.\nThe cat knocked over ${b}.\n${capitalize(c)} landed softly,\nlike it knew\nthis would happen.`, closing: '— right on time' }),
    (a, b, c) => ({ lines: `${capitalize(a)} is the lock.\n${capitalize(b)} is the key.\n${capitalize(c)} is the sound the door makes\nwhen it finally\nswings open.`, closing: '— click' }),
    (a, b, c) => ({ lines: `A telegram from tonight:\n${a} STOP\n${b} STOP\n${c} NEVER STOP`, closing: '— urgent delivery' }),
    (a, b, c) => ({ lines: `${capitalize(a)} packed light.\n${capitalize(b)} packed heavy.\n${capitalize(c)} didn't pack at all—\njust showed up\nand fit right in.`, closing: '— travel light' }),
    (a, b, c) => ({ lines: `The aquarium of tonight holds:\n${a}, swimming slow.\n${capitalize(b)}, near the surface.\n${capitalize(c)}, glowing\nin the deep end.`, closing: '— don\'t tap the glass' }),
    (a, b, c) => ({ lines: `I put ${a} on the left speaker.\n${capitalize(b)} on the right.\n${capitalize(c)} came through\nin surround sound.`, closing: '— full stereo' }),
    (a, b, c) => ({ lines: `${capitalize(a)} left a note.\n${capitalize(b)} left a voicemail.\n${capitalize(c)} left\na feeling in the room\nthat stayed warm for hours.`, closing: '— message received' }),
    (a, b, c) => ({ lines: `The vending machine offered:\nA1: ${a}\nB2: ${b}\nC3: ${c}\nI pressed all three.`, closing: '— hungry tonight' }),
    (a, b, c) => ({ lines: `${capitalize(a)} wore its Sunday best.\n${capitalize(b)} came in sweatpants.\n${capitalize(c)} came as itself,\nwhich was enough.`, closing: '— dress code: optional' }),
    (a, b, c) => ({ lines: `The subtitles read:\n[${a} intensifies]\n[${b} softens]\n[${c} remains]`, closing: '— foreign film night' }),
    (a, b, c) => ({ lines: `I planted ${a} by the window.\nWatered it with ${b}.\nBy morning,\n${c} had bloomed\nwhere nothing was.`, closing: '— moonlight fertilizer' }),
    (a, b, c) => ({ lines: `${capitalize(a)} drew first.\n${capitalize(b)} colored inside the lines.\n${capitalize(c)} scribbled outside them\nand it was perfect.`, closing: '— art class tonight' }),
    (a, b, c) => ({ lines: `Last call:\n${a} for the road.\n${capitalize(b)} for the morning.\n${capitalize(c)} for keeps.`, closing: '— closing time' }),
    // --- 50 Moon-aware templates (reference _lunarMoonPhase and _lunarZodiac) ---
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} holds ${a} in one hand,\n${b} in the other.\n${capitalize(c)} watches from below.`, closing: `— ${_lunarZodiac} season` }),
    (a, b, c) => ({ lines: `Tonight the moon is ${_lunarMoonPhase}.\nIt asked for ${a}.\nI gave it ${b} instead.\n${capitalize(c)} was the compromise.`, closing: `— signed, ${_lunarZodiac}` }),
    (a, b, c) => ({ lines: `In ${_lunarZodiac}, the sky tastes like ${a}.\nThe shadows hum ${b}.\nAnd ${c} curls up\nat the edge of the light.`, closing: `— ${_lunarMoonPhase} lullaby` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} left a note:\n"Bring ${a}.\nForget ${b}.\nKeep ${c} close."`, closing: `— instructions from ${_lunarZodiac}` }),
    (a, b, c) => ({ lines: `Under a ${_lunarMoonPhase} moon,\n${a} softens.\n${capitalize(b)} glows.\n${capitalize(c)} finally makes sense.`, closing: '— lunar clarity' }),
    (a, b, c) => ({ lines: `${_lunarZodiac} says: be honest.\nSo here—\n${a}, ${b},\nand the quiet truth of ${c}.`, closing: `— ${_lunarMoonPhase} confession` }),
    (a, b, c) => ({ lines: `The moon is ${_lunarMoonPhase} tonight,\nwhich means ${a} hits different.\n${capitalize(b)} arrives late.\n${capitalize(c)} stays.`, closing: '— celestial timing' }),
    (a, b, c) => ({ lines: `Dear ${_lunarZodiac} moon,\nI brought you ${a}.\nIt smells like ${b}.\nIt sounds like ${c}\nwhen you hold it up to the dark.`, closing: '— an offering' }),
    (a, b, c) => ({ lines: `Phase: ${_lunarMoonPhase}.\nMood: ${a}.\nWeather: ${b}.\nForecast: ${c},\nwith a chance of wonder.`, closing: `— ${_lunarZodiac} weather report` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} casts ${a}\nacross the floor.\n${capitalize(b)} catches in the curtain.\n${capitalize(c)} hides behind the door.`, closing: '— moonlit still life' }),
    (a, b, c) => ({ lines: `When the moon enters ${_lunarZodiac},\neverything tastes like ${a}.\nEven ${b}.\nEspecially ${c}.`, closing: `— ${_lunarMoonPhase} flavors` }),
    (a, b, c) => ({ lines: `${capitalize(a)} rises with the ${_lunarMoonPhase}.\n${capitalize(b)} sets with the tide.\n${capitalize(c)} floats somewhere between,\nunclaimed and luminous.`, closing: `— ${_lunarZodiac} tides` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} whispers:\n${a} is temporary.\n${capitalize(b)} is necessary.\n${capitalize(c)} is yours to keep.`, closing: '— lunar advice' }),
    (a, b, c) => ({ lines: `${_lunarZodiac} moon inventory:\none part ${a},\ntwo parts ${b},\nand all of ${c}\ndissolved in starlight.`, closing: `— ${_lunarMoonPhase} recipe` }),
    (a, b, c) => ({ lines: `I told the ${_lunarMoonPhase} about ${a}.\nIt already knew about ${b}.\nWe sat with ${c}\nin comfortable silence.`, closing: `— ${_lunarZodiac} listening hour` }),
    (a, b, c) => ({ lines: `Tonight's ${_lunarMoonPhase}:\na bowl of ${a},\na thread of ${b},\na whole sky of ${c}.`, closing: '— served cold and bright' }),
    (a, b, c) => ({ lines: `The ${_lunarZodiac} moon collects things—\n${a} from Tuesday,\n${b} from a dream,\n${c} from right now,\nstill warm.`, closing: `— ${_lunarMoonPhase} archive` }),
    (a, b, c) => ({ lines: `${capitalize(a)} looks different\nunder a ${_lunarMoonPhase} moon.\nSo does ${b}.\n${capitalize(c)} looks exactly the same,\nwhich is the miracle.`, closing: `— ${_lunarZodiac} perspective` }),
    (a, b, c) => ({ lines: `The moon is doing its ${_lunarMoonPhase} thing.\nI am doing my ${a} thing.\n${capitalize(b)} is doing its own thing.\nOnly ${c} is doing nothing,\nand doing it perfectly.`, closing: '— parallel orbits' }),
    (a, b, c) => ({ lines: `In the church of ${_lunarZodiac},\nthe hymn goes:\n${a}, ${a}, ${b},\nand then a long pause\nfull of ${c}.`, closing: `— ${_lunarMoonPhase} vespers` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} threw a party.\n${capitalize(a)} brought the music.\n${capitalize(b)} brought the mood.\n${capitalize(c)} showed up barefoot\nand stole the night.`, closing: `— ${_lunarZodiac} gathering` }),
    (a, b, c) => ({ lines: `Moonrise: ${a}.\nMidnight: ${b}.\nMoonset: ${c}.\nAll of it\nheld gently.`, closing: `— ${_lunarMoonPhase} in ${_lunarZodiac}` }),
    (a, b, c) => ({ lines: `The ${_lunarZodiac} moon asked\nwhat I was made of.\nI said: ${a},\nsome ${b},\nand an unreasonable amount of ${c}.`, closing: `— ${_lunarMoonPhase} self-portrait` }),
    (a, b, c) => ({ lines: `Between one ${_lunarMoonPhase}\nand the next,\n${a} happened.\nThen ${b}.\nThen ${c}\nchanged everything quietly.`, closing: `— ${_lunarZodiac} interval` }),
    (a, b, c) => ({ lines: `The moon wears ${_lunarZodiac} tonight\nlike a coat of ${a}.\n${capitalize(b)} is the lining.\n${capitalize(c)} is the pocket\nwhere it keeps its secrets.`, closing: `— ${_lunarMoonPhase} fashion` }),
    (a, b, c) => ({ lines: `A ${_lunarMoonPhase} prayer:\nlet ${a} be enough.\nLet ${b} arrive softly.\nLet ${c} stay\nlong after the light shifts.`, closing: `— amen, says ${_lunarZodiac}` }),
    (a, b, c) => ({ lines: `The tides remember ${a}\nbecause the ${_lunarMoonPhase} told them to.\n${capitalize(b)} washes in.\n${capitalize(c)} washes out.\nBoth leave marks on the shore.`, closing: '— lunar memory' }),
    (a, b, c) => ({ lines: `${_lunarZodiac} nights are made of ${a}.\nI know because ${b} told me.\nAnd ${c}?\n${capitalize(c)} confirmed it\nwith a nod.`, closing: `— ${_lunarMoonPhase} testimony` }),
    (a, b, c) => ({ lines: `When the ${_lunarMoonPhase} is this bright,\n${a} casts shadows.\n${capitalize(b)} catches fire.\n${capitalize(c)} just sits there,\nglowing from within.`, closing: `— ${_lunarZodiac} luminescence` }),
    (a, b, c) => ({ lines: `The moon's ${_lunarMoonPhase} edge\ncuts the night in two:\non one side, ${a}.\nOn the other, ${b}.\n${capitalize(c)} lives on the line.`, closing: `— ${_lunarZodiac} geometry` }),
    (a, b, c) => ({ lines: `If the ${_lunarMoonPhase} could sing,\nit would sound like ${a}\nmixed with ${b},\nfading into ${c}\njust before dawn.`, closing: `— ${_lunarZodiac} serenade` }),
    (a, b, c) => ({ lines: `The ${_lunarZodiac} moon is a mirror.\nTonight it reflects:\n${a}, slightly distorted.\n${capitalize(b)}, upside down.\n${capitalize(c)}, exactly right.`, closing: `— ${_lunarMoonPhase} reflections` }),
    (a, b, c) => ({ lines: `Three things the ${_lunarMoonPhase} knows:\n${a} is braver than it looks.\n${capitalize(b)} is softer than it sounds.\n${capitalize(c)} is older than it seems.`, closing: `— ${_lunarZodiac} wisdom` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} is a doorway.\n${capitalize(a)} is the threshold.\n${capitalize(b)} is the hallway.\n${capitalize(c)} is the room\nyou didn't know you needed.`, closing: `— ${_lunarZodiac} architecture` }),
    (a, b, c) => ({ lines: `${_lunarZodiac} pulled the tide toward ${a}.\nThe waves hummed ${b}.\nThe sand kept ${c}\nlike a promise\nwritten in foam.`, closing: `— ${_lunarMoonPhase} shoreline` }),
    (a, b, c) => ({ lines: `Tonight's lunar prescription:\n${a} before bed.\n${capitalize(b)} upon waking.\n${capitalize(c)} as needed\nthroughout the darkness.`, closing: `— Dr. ${_lunarZodiac}, ${_lunarMoonPhase} clinic` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} peeled back the sky\nand underneath was ${a}.\nLayered over ${b}.\nAll resting on ${c},\nwhich held everything.`, closing: `— ${_lunarZodiac} geology` }),
    (a, b, c) => ({ lines: `A letter from ${_lunarZodiac}:\n\nDear tonight,\n${a} arrived safely.\n${capitalize(b)} sends regards.\n${capitalize(c)} misses you already.`, closing: `— postmarked: ${_lunarMoonPhase}` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} is a question mark\nhung in ${_lunarZodiac}.\n${capitalize(a)}?\n${capitalize(b)}?\n${capitalize(c)}?\nNo answers needed.`, closing: '— just asking' }),
    (a, b, c) => ({ lines: `${capitalize(a)} orbits ${b}\nthe way the ${_lunarMoonPhase} orbits us—\nfaithfully, silently,\nwith ${c} trailing behind\nlike a silver wake.`, closing: `— ${_lunarZodiac} gravity` }),
    (a, b, c) => ({ lines: `The almanac says: ${_lunarMoonPhase} in ${_lunarZodiac}.\nThe heart says: ${a}.\nThe hands say: ${b}.\nThe night says: ${c},\nand means it.`, closing: '— tonight\'s forecast' }),
    (a, b, c) => ({ lines: `By ${_lunarMoonPhase} light I found ${a}\nhiding in the garden.\n${capitalize(b)} was there too,\npretending to be a flower.\n${capitalize(c)} actually was one.`, closing: `— ${_lunarZodiac} garden walk` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} keeps a journal.\nTonight's entry:\n"${capitalize(a)} was tender.\n${capitalize(b)} was unexpected.\n${capitalize(c)} was the whole point."`, closing: `— ${_lunarZodiac} diary` }),
    (a, b, c) => ({ lines: `Somewhere a wolf howls ${a}\nat the ${_lunarMoonPhase}.\nThe echo sounds like ${b}.\nThe silence after\ntastes like ${c}.`, closing: `— ${_lunarZodiac} wilderness` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} is a coin\nflipped by ${_lunarZodiac}.\nHeads: ${a}.\nTails: ${b}.\nEdge: ${c}—\nthe rarest outcome.`, closing: '— cosmic coin toss' }),
    (a, b, c) => ({ lines: `Ingredients for a ${_lunarMoonPhase} night:\na handful of ${a},\na whisper of ${b},\nand ${c}\nstirred counterclockwise\nunder ${_lunarZodiac}.`, closing: '— lunar potion' }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} hung low.\n${capitalize(a)} reached up to touch it.\n${capitalize(b)} said don't.\n${capitalize(c)} said do.`, closing: `— ${_lunarZodiac} says do` }),
    (a, b, c) => ({ lines: `In the museum of ${_lunarZodiac} nights:\nRoom 1: ${a}, framed in silver.\nRoom 2: ${b}, suspended from the ceiling.\nRoom 3: ${c}, behind glass\nthat fogs when you breathe on it.`, closing: `— ${_lunarMoonPhase} exhibition` }),
    (a, b, c) => ({ lines: `The ${_lunarMoonPhase} is a lantern\ncarried by ${_lunarZodiac}\nthrough a field of ${a}.\n${capitalize(b)} catches the light.\n${capitalize(c)} catches the feeling.`, closing: '— night walk' }),
    (a, b, c) => ({ lines: `Tidal report for ${_lunarZodiac}:\n${a} — rising.\n${capitalize(b)} — cresting.\n${capitalize(c)} — settling,\nlike something finally\ncoming home.`, closing: `— ${_lunarMoonPhase} high water` }),
];

function capitalize(s) {
    if (!s) return '';
    s = s.trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash;
}

// Pick next prompt set — combinatorial selection from pools
function getNextPromptSet() {
    const userId = currentAuthUser?.id || 'anonymous';
    const seed = hashCode(userId + Date.now().toString());
    const p1 = Math.abs(seed) % LUNAR_POOL_1.length;
    const p2 = Math.abs(seed * 31 + 7) % LUNAR_POOL_2.length;
    const p3 = Math.abs(seed * 37 + 13) % LUNAR_POOL_3.length;
    // Return a virtual prompt set index (for backward compat with template selection)
    currentPromptSet = Math.abs(seed) % 10000;
    return currentPromptSet;
}

function toggleLunarNote() {
    lunarNoteActive = !lunarNoteActive;
    const panel = document.getElementById('lunarNotePanel');
    const pill = document.getElementById('lunarNotePill');
    const pillText = document.getElementById('lunarPillText');
    const toggleArea = document.getElementById('lunarToggleArea');

    if (lunarNoteActive) {
        // Pick unique prompts from combinatorial pools
        const userId = currentAuthUser?.id || 'anonymous';
        const seed = hashCode(userId + Date.now().toString());
        const p1 = Math.abs(seed) % LUNAR_POOL_1.length;
        const p2 = Math.abs(seed * 31 + 7) % LUNAR_POOL_2.length;
        const p3 = Math.abs(seed * 37 + 13) % LUNAR_POOL_3.length;

        // Set moon data for moon-aware templates
        const moonPhase = getMoonPhase();
        const moonZodiac = getMoonZodiac();
        _lunarMoonPhase = moonPhase.phaseName.toLowerCase();
        _lunarZodiac = moonZodiac.sign;

        currentLunarTemplate = -1; // reset template so it picks a fresh one
        currentPromptSet = Math.abs(seed) % 10000;

        // Apply prompts from independent pools
        document.getElementById('lunarLabel1').textContent = LUNAR_POOL_1[p1].label;
        document.getElementById('lunarInput1').placeholder = LUNAR_POOL_1[p1].placeholder;
        document.getElementById('lunarLabel2').textContent = LUNAR_POOL_2[p2].label;
        document.getElementById('lunarInput2').placeholder = LUNAR_POOL_2[p2].placeholder;
        document.getElementById('lunarLabel3').textContent = LUNAR_POOL_3[p3].label;
        document.getElementById('lunarInput3').placeholder = LUNAR_POOL_3[p3].placeholder;
        
        panel.style.display = 'block';
        if (toggleArea) toggleArea.style.display = 'none';
        pill.classList.add('active');
        pillText.textContent = 'Lunar Note added';
        
        // Reset to step 1
        goLunarStep(1);
        document.getElementById('lunarResultCard').style.display = 'none';
        
        setTimeout(() => document.getElementById('lunarInput1').focus(), 100);
    } else {
        panel.style.display = 'none';
        if (toggleArea) toggleArea.style.display = '';
        pill.classList.remove('active');
        pillText.textContent = 'Add a Lunar Note';
        document.getElementById('lunarResultCard').style.display = 'none';
        // Clear inputs
        for (let i = 1; i <= 3; i++) document.getElementById('lunarInput' + i).value = '';
    }
}

// Step-through navigation
function goLunarStep(step) {
    for (let i = 1; i <= 3; i++) {
        document.getElementById('lunarStep' + i).classList.toggle('active', i === step);
    }
    // Focus the input
    setTimeout(() => {
        const input = document.getElementById('lunarInput' + step);
        if (input) input.focus();
    }, 100);
}

function revealLunarNote() {
    const v1 = document.getElementById('lunarInput1').value.trim();
    const v2 = document.getElementById('lunarInput2').value.trim();
    const v3 = document.getElementById('lunarInput3').value.trim();
    if (!v1 || !v2 || !v3) return;

    // Set moon data for moon-aware templates
    const moonPhase = getMoonPhase();
    const moonZodiac = getMoonZodiac();
    _lunarMoonPhase = moonPhase.phaseName.toLowerCase();
    _lunarZodiac = moonZodiac.sign;

    // Hide step cards, show result
    for (let i = 1; i <= 3; i++) document.getElementById('lunarStep' + i).classList.remove('active');

    // Generate
    if (currentLunarTemplate < 0) currentLunarTemplate = Math.floor(Math.random() * lunarTemplates.length);
    const result = generateLunarNote(v1, v2, v3, currentLunarTemplate);
    document.getElementById('lunarResultText').textContent = result.lines;
    document.getElementById('lunarResultClosing').textContent = result.closing;
    document.getElementById('lunarResultCard').style.display = 'block';
}

function editLunarInputs() {
    // Go back to step 1 to edit
    document.getElementById('lunarResultCard').style.display = 'none';
    goLunarStep(1);
}

function generateLunarNote(a, b, c, templateIdx) {
    const cleanA = a.trim().toLowerCase();
    const cleanB = b.trim().toLowerCase();
    const cleanC = c.trim().toLowerCase();
    const idx = (templateIdx != null && templateIdx >= 0) ? templateIdx % lunarTemplates.length : Math.floor(Math.random() * lunarTemplates.length);
    return { ...lunarTemplates[idx](cleanA, cleanB, cleanC), templateIdx: idx };
}

function onLunarInput() {
    // Not used in step-through mode but kept for compatibility
}

function regenerateLunarNote() {
    const v1 = document.getElementById('lunarInput1').value.trim();
    const v2 = document.getElementById('lunarInput2').value.trim();
    const v3 = document.getElementById('lunarInput3').value.trim();
    if (!v1 || !v2 || !v3) return;

    // Set moon data for moon-aware templates
    const moonPhase = getMoonPhase();
    const moonZodiac = getMoonZodiac();
    _lunarMoonPhase = moonPhase.phaseName.toLowerCase();
    _lunarZodiac = moonZodiac.sign;

    let newIdx;
    do {
        newIdx = Math.floor(Math.random() * lunarTemplates.length);
    } while (newIdx === currentLunarTemplate && lunarTemplates.length > 1);
    
    currentLunarTemplate = newIdx;
    const result = generateLunarNote(v1, v2, v3, newIdx);
    document.getElementById('lunarResultText').textContent = result.lines;
    document.getElementById('lunarResultClosing').textContent = result.closing;
    
    const card = document.getElementById('lunarResultCard');
    card.style.animation = 'none';
    card.offsetHeight;
    card.style.animation = 'lunarCardIn 0.35s ease';
}

// Enable/disable Next buttons based on input
document.addEventListener('DOMContentLoaded', () => {
    for (let i = 1; i <= 3; i++) {
        const input = document.getElementById('lunarInput' + i);
        const btn = document.getElementById('lunarNext' + i);
        if (input && btn) {
            input.addEventListener('input', () => {
                btn.disabled = !input.value.trim();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && input.value.trim()) {
                    e.preventDefault();
                    if (i < 3) goLunarStep(i + 1);
                    else revealLunarNote();
                }
            });
        }
    }
});

// Song picker
function toggleSongPicker() {
    // Song input is now always visible, no toggle needed
    document.getElementById('songInput')?.focus();
}

function selectSong(urlOrName, title) {
    selectedSongTitle = title || '';
    document.getElementById('songInput').value = urlOrName;
    onSongInput();
}

// Handle final send
function handleComposeSend() {
    console.log('[SEND] handleComposeSend called. moonData.isVisible:', moonData.isVisible, 'selectedRecipient:', selectedRecipient);
    // Bug fix #1: Gate message sending behind moonrise
    if (!moonData.isVisible) {
        console.log('[SEND] Moon not visible, showing modal');
        openMoonDownModal();
        return;
    }

    // Validate recipient (WhatsApp-style: selectedRecipient always set)
    if (!selectedRecipient) {
        alert('Please select a recipient first');
        return;
    }
    const recipientVal = selectedRecipient.name;
    
    const textMessage = document.getElementById('messageText').value.trim();
    const songVal = document.getElementById('songInput')?.value.trim() || '';
    
    // Get lunar note if active
    let lunarNoteText = '';
    let lunarClosing = '';
    if (lunarNoteActive && document.getElementById('lunarResultCard').style.display !== 'none') {
        lunarNoteText = document.getElementById('lunarResultText').textContent;
        lunarClosing = document.getElementById('lunarResultClosing').textContent;
    }
    
    // Build message
    let fullMessage = '';
    if (textMessage) fullMessage += textMessage;
    if (lunarNoteText) {
        if (fullMessage) fullMessage += '\n\n';
        fullMessage += '🌙 Lunar Note\n' + lunarNoteText;
        if (lunarClosing) fullMessage += '\n' + lunarClosing;
    }
    
    const hasPhoto = !!window['_pendingPhotoFile_compose'];
    if (!fullMessage && !hasPhoto) {
        // Focus the message input instead of showing an alert
        const msgInput = document.getElementById('messageText');
        if (msgInput) { msgInput.focus(); msgInput.setAttribute('placeholder', 'Write your moon message here...'); }
        return;
    }
    
    // Build pending message
    const location = selectedRecipient?.location || 
        contacts.find(c => c.name.toLowerCase() === recipientVal.toLowerCase())?.location || 
        'Unknown';
    
    pendingMessage = {
        recipient: selectedRecipient?.name || recipientVal,
        recipientEmail: selectedRecipient?.email || null,
        recipientType: selectedRecipient?.email ? 'email' : 'contact',
        message: fullMessage,
        textMessage: textMessage,
        lunarNoteText: lunarNoteText,
        lunarClosing: lunarClosing,
        location: location,
        isKnown: !selectedRecipient?.isNew,
        isOnMoonpop: selectedRecipient?.isOnMoonpop || false,
        linkedProfileId: selectedRecipient?.linkedProfileId || null,
        song: songVal,
        moonPhoto: pendingMoonPhoto || null
    };
    
    if (selectedRecipient?.isNew) {
        completeSend(true);
    } else {
        completeSend(false);
    }
}

function resetForm() {
    // Reset recipient
    document.getElementById('recipient').value = '';
    selectedRecipient = null;
    isNewContact = false;

    // Reset message
    document.getElementById('messageText').value = '';

    // Reset toggle to Open Note mode
    composeToggleMode('open-note');

    // Reset lunar note
    for (let i = 1; i <= 3; i++) document.getElementById('lunarInput' + i).value = '';
    document.getElementById('lunarResultCard').style.display = 'none';
    lunarNoteActive = false;
    currentLunarTemplate = -1;
    document.getElementById('lunarNotePanel').style.display = 'block';

    // Reset song
    if (document.getElementById('songInput')) document.getElementById('songInput').value = '';
    selectedSongTitle = '';
    const ytEmbed = document.getElementById('ytEmbed');
    if (ytEmbed) ytEmbed.remove();

    // Reset moon photo
    clearMoonPhoto();

    // Reset next buttons
    for (let i = 1; i <= 3; i++) {
        const btn = document.getElementById('lunarNext' + i);
        if (btn) btn.disabled = true;
    }

    // Reset expansion panels
    const musicPanel = document.getElementById('composeMusicPanel');
    const photoPanel = document.getElementById('composePhotoPanel');
    const musicBtn = document.getElementById('composeMusicBtn');
    const photoBtn = document.getElementById('composePhotoBtn');
    if (musicPanel) musicPanel.style.display = 'none';
    if (photoPanel) photoPanel.style.display = 'none';
    if (musicBtn) musicBtn.classList.remove('active');
    if (photoBtn) photoBtn.classList.remove('active');

    // Reset new contact view
    document.getElementById('newContactName').value = '';
    document.getElementById('newContactEmail').value = '';
    document.getElementById('newContactCity').value = '';
    document.getElementById('newContactCityDropdown').classList.remove('active');

    // Restore header (dark theme — will be overridden when openModalForRecipient sets it)
    const header = document.getElementById('composeHeader');
    if (header) {
        header.innerHTML = `
            <button class="compose-header-btn" onclick="closeModal()">
                <svg width="18" height="18" style="color:white"><use href="#icon-back"/></svg>
            </button>
            <span style="font-weight:700;color:white;font-size:15px;">New Moon Message</span>
            <span style="width:36px;"></span>
        `;
    }

    // Switch back to step 1
    showDefaultCompose();
}

// City autocomplete for new contact form
function filterNewContactCities(query) {
    const dropdown = document.getElementById('newContactCityDropdown');
    if (query.length < 2) {
        dropdown.classList.remove('active');
        return;
    }
    
    const matches = cities.filter(c => 
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.country.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 8);
    
    if (matches.length === 0) {
        dropdown.classList.remove('active');
        return;
    }
    
    dropdown.innerHTML = matches.map(c => `
        <div class="city-option" onclick="selectNewContactCity('${c.name}')">
            ${c.name}, ${c.country}
        </div>
    `).join('');
    dropdown.classList.add('active');
}

function selectNewContactCity(cityName) {
    document.getElementById('newContactCity').value = cityName;
    document.getElementById('newContactCityDropdown').classList.remove('active');
}

// Pending message data for gentle reveal flow
let pendingMessage = null;

// Check if recipient is an existing contact or Moonpop user
function isKnownRecipient(recipientInput) {
    // Check if it's a known contact
    const isContact = contacts.some(c => 
        c.name.toLowerCase() === recipientInput.toLowerCase() ||
        c.email === recipientInput ||
        c.phone === recipientInput
    );
    return isContact;
}

// Check if input looks like email or phone
function getRecipientType(input) {
    if (input.includes('@')) return 'email';
    // Reject phone numbers - MVP only supports email
    if (/^\+?[\d\s\-()]{7,}$/.test(input.replace(/\s/g, ''))) return 'phone';
    return 'name';
}

// Main send handler
function handleSend() {
    // Legacy - now handled by handleComposeSend
    handleComposeSend();
}

// Legacy stubs (gentle reveal removed)
function showGentleReveal() { }
function closeGentleReveal() { }
function confirmSendToNewRecipient() { completeSend(true); }

// Complete the send process
async function completeSend(isNewRecipient) {
    if (!pendingMessage) return;

    const phase = moonData.phase || getMoonPhase();
    const phaseName = phase.phaseName.toLowerCase();

    // Resolve recipient by profile lookup (avoids auth.users table)
    let recipientId = pendingMessage.linkedProfileId || null;
    let recipientEmail = pendingMessage.recipientEmail || null;

    // If we have an email but no profile ID, try to resolve via profiles table
    if (recipientEmail && !recipientId) {
        try {
            const { data: foundProfiles } = await sb.from('profiles')
                .select('id')
                .eq('email', recipientEmail)
                .limit(1);
            if (foundProfiles && foundProfiles.length > 0) {
                recipientId = foundProfiles[0].id;
                pendingMessage.isOnMoonpop = true;
                pendingMessage.linkedProfileId = recipientId;
            }
        } catch(e) { console.error('Recipient resolve failed:', e); }
    }
    
    // Also check contacts as fallback for email
    if (!recipientEmail) {
        const contact = contacts.find(c => c.name === pendingMessage.recipient);
        if (contact) {
            recipientEmail = contact.email || null;
            if (!recipientId) recipientId = contact.linkedProfileId || null;
            if (contact.isOnMoonpop) pendingMessage.isOnMoonpop = true;
        }
    }

    // Determine if recipient's moon is up using multiple methods
    console.log('[send] location:', pendingMessage.location);
    let recipientMoonUp = false;

    // Method 1: Direct altitude check (most reliable)
    const recipientMoonStatus = getContactMoonStatus(pendingMessage.location);

    if (recipientMoonStatus) {
        recipientMoonUp = recipientMoonStatus.isUp;
        console.log('[send] getContactMoonStatus:', recipientMoonUp);
    } else {
        // Method 2: No city data — if sender's moon is up, assume same sky
        recipientMoonUp = !!moonData.isVisible;
        console.log('[send] no city data for', pendingMessage.location, '— using sender moon:', recipientMoonUp);
    }

    // Get release time (next moonrise) for in_transit messages
    const recipientMoonrise = getRecipientMoonrise(pendingMessage.location);
    let releaseAt = recipientMoonrise ? recipientMoonrise.date.toISOString() : null;

    // If moon is down and no moonrise data, use 12h fallback
    if (!releaseAt && !recipientMoonUp) {
        releaseAt = new Date(Date.now() + 12 * 3600000).toISOString();
        console.warn('[send] No moonrise data for', pendingMessage.location, '— using 12h fallback releaseAt');
    }
    const instantDeliver = recipientMoonUp === true;
    const messageStatus = instantDeliver ? 'released' : 'in_transit';

    // If instant delivery, set releaseAt to now (not future moonrise)
    // so orbit dots don't show for already-delivered messages
    if (instantDeliver) {
        releaseAt = new Date().toISOString();
    }
    console.log('[send] instantDeliver:', instantDeliver, 'status:', messageStatus, 'releaseAt:', releaseAt);

    // Store send diagnostics for visible panel
    const hoursUntilRise = releaseAt ? ((new Date(releaseAt).getTime() - Date.now()) / 3600000) : null;
    window._lastSendDiag = {
        location: pendingMessage.location,
        recipientMoonUp,
        hoursUntilRise: hoursUntilRise?.toFixed(2) || 'N/A',
        instantDeliver,
        releaseAt,
        messageStatus,
        dbReleaseAt: '(pending)',
        sentAt: new Date().toISOString()
    };

    // Safety: if somehow still in_transit but no release_at, set a 24h fallback
    if (messageStatus === 'in_transit' && !releaseAt) {
        releaseAt = new Date(Date.now() + 24 * 3600000).toISOString();
    }

    // Upload moon photo if attached
    let messagePhotoUrl = null;
    if (window['_pendingPhotoFile_compose']) {
        messagePhotoUrl = await compressAndUpload('compose', 'messages');
    }

    // Save to Supabase via Edge Function (server-side validation + rate limiting)
    let dbMessage = null;
    if (currentAuthUser) {
        const insertData = {
            sender_id: currentAuthUser.id,
            recipient_name: pendingMessage.recipient,
            recipient_email: recipientEmail,
            recipient_id: recipientId,
            recipient_city: pendingMessage.location,
            message_text: pendingMessage.textMessage || null,
            lunar_note_text: pendingMessage.lunarNoteText || null,
            lunar_note_closing: pendingMessage.lunarClosing || null,
            song_url: pendingMessage.song || null,
            song_title: pendingMessage.song ? pendingMessage.song : null,
            moon_phase: phaseName,
            moon_illumination: moonData.illumination || null,
            status: messageStatus,
            release_at: instantDeliver ? new Date().toISOString() : releaseAt,
            released_at: instantDeliver ? new Date().toISOString() : null,
            photo_url: messagePhotoUrl || null
        };

        console.log('Sending message via Edge Function:', { recipientId, recipientEmail, status: messageStatus, instantDeliver });

        try {
            const { data: fnData, error: fnError } = await sb.functions.invoke('send-message', {
                body: insertData
            });

            if (fnError) {
                console.error('Edge Function error:', fnError);
                alert('Message could not be sent. Please try again.\n\nError: ' + (fnError.message || 'Server error'));
                pendingMessage = null;
                return;
            } else if (fnData && fnData.message) {
                console.log('Message saved via Edge Function, id:', fnData.message.id,
                    '| DB release_at:', fnData.message.release_at,
                    '| DB status:', fnData.message.status,
                    '| client sent release_at:', insertData.release_at);
                dbMessage = fnData.message;
                if (window._lastSendDiag) window._lastSendDiag.dbReleaseAt = fnData.message.release_at || 'NULL';
            } else if (fnData && fnData.error) {
                // Server-side validation error
                console.error('Validation error:', fnData.error, fnData.details);
                alert('Message could not be sent: ' + (fnData.details ? fnData.details.join(', ') : fnData.error));
                pendingMessage = null;
                return;
            } else {
                console.warn('Edge Function returned unexpected format:', fnData);
                alert('Message could not be sent. Please try again.');
                pendingMessage = null;
                return;
            }
        } catch (err) {
            console.error('Send message exception:', err);
            alert('Message could not be sent. Please try again.');
            pendingMessage = null;
            return;
        }
    }

    // Only add to local array if we have a confirmed DB record
    if (!dbMessage) {
        console.error('completeSend: dbMessage is null after all attempts. currentAuthUser:', !!currentAuthUser);
        alert('Message could not be sent. Please sign in and try again.');
        pendingMessage = null;
        return;
    }

    // Add to local messages array
    messages.unshift({
        dbId: dbMessage.id,
        senderId: currentAuthUser?.id || null,
        recipientId: recipientId || null,
        recipientEmail: recipientEmail || null,
        sender: pendingMessage.recipient,
        senderAvatar: null,
        preview: '',
        status: instantDeliver ? 'Released' : 'In Transit',
        type: 'sent',
        location: pendingMessage.location,
        isNewRecipient: isNewRecipient,
        phaseName: phaseName,
        time: 'Just now',
        createdAt: new Date().toISOString(),
        conversationId: dbMessage.conversation_id || null,
        messageText: pendingMessage.textMessage || '',
        lunarNote: pendingMessage.lunarNoteText ? { text: pendingMessage.lunarNoteText, closing: pendingMessage.lunarClosing || '' } : null,
        songUrl: pendingMessage.song || null,
        photoUrl: messagePhotoUrl || null,
        releaseAt: releaseAt || null,
        contentVisible: true,
        reactions: [],
        replies: []
    });

    // Save current conversation's full thread before rebuild (loadFullConversationThread
    // loads extra messages/replies that aren't in the global messages array)
    const _savedThread = currentConversation?._fullThreadLoaded ? currentConversation.messages : null;
    const _savedKey = currentConversation?.otherKey;

    // Rebuild conversations to include the new message
    buildConversations();

    // Restore full thread if it was loaded, and append the new message
    if (_savedThread && _savedKey) {
        const restoredConv = conversations.find(c => c.otherKey === _savedKey);
        if (restoredConv) {
            // Append new message to saved thread so it appears immediately
            const newMsg = messages[0]; // we just unshifted it
            const alreadyInThread = _savedThread.some(m => m.dbId === newMsg.dbId);
            if (!alreadyInThread) {
                _savedThread.push(newMsg);
            }
            restoredConv.messages = _savedThread;
            restoredConv._fullThreadLoaded = false; // force re-fetch on next open for full data
        }
    }

    // Update stats — only increment if actually in transit
    if (!instantDeliver) moonData.messagesInTransit++;


    // Add contact if new (with duplicate check)
    if (isNewRecipient) {
        const recipientIsOnMps = pendingMessage.isOnMoonpop || !!recipientId;

        // Check if contact already exists locally
        const alreadyExists = contacts.some(c =>
            (recipientId && c.linkedProfileId === recipientId) ||
            (recipientEmail && c.email && c.email.toLowerCase() === recipientEmail.toLowerCase())
        );

        if (!alreadyExists) {
            const newContact = {
                name: pendingMessage.recipient,
                location: pendingMessage.location,
                email: recipientEmail,
                isOnMoonpop: recipientIsOnMps,
                linkedProfileId: recipientId
            };
            contacts.push(newContact);
            renderContactsList();

            // Save to Supabase
            if (currentAuthUser) {
                const { error: contactError } = await sb.from('contacts').insert({
                    owner_id: currentAuthUser.id,
                    name: pendingMessage.recipient,
                    city: pendingMessage.location,
                    email: recipientEmail,
                    is_on_moonpop: recipientIsOnMps,
                    linked_profile_id: recipientId
                });
                if (contactError) console.error('Contact save failed:', contactError);
                else console.log('Contact saved successfully');
            }
        }
        
        // Only send invite email to NON-MPS users
        if (recipientEmail && !recipientIsOnMps) {
            const senderName = localStorage.getItem('moonpop_username') || 'Someone';
            sendMoonPostEmail(
                recipientEmail,
                pendingMessage.location,
                pendingMessage.message,
                senderName,
                dbMessage?.id
            );
        }
    }

    renderMessages();

    // Re-render conversation thread if the recipient's chat is open
    if (currentConversation) {
        const rKey = recipientId || recipientEmail;
        if (rKey && (currentConversation.otherKey === rKey || currentConversation.otherProfileId === recipientId)) {
            renderConversationThread();
        }
    }

    // Populate shared sky preview
    if (globalTransmissions.length > 0) {
        const latest = globalTransmissions[0];
        const previewEl = document.getElementById('sharedSkyPreview');
        if (previewEl) previewEl.textContent = latest.location + ': ' + latest.message;
        const badgeEl = document.getElementById('sharedSkyBadge');
        updateSharedSkyBadge();
    }

    renderMessageDots(); // Update orbit dots

    closeModal();
    
    // Store location for toast
    const sentLocation = pendingMessage.location;
    
    // Clear pending
    pendingMessage = null;

    // Show poetic confirmation toast
    showSentConfirmation(isNewRecipient, sentLocation);
}

// Show confirmation toast
function showSentConfirmation(isNewRecipient, location) {
    const toast = document.createElement('div');
    toast.className = 'send-toast';
    
    const message = isNewRecipient 
        ? `Your message will wait for them.<br>It will arrive when the moon rises over ${location}.`
        : `Your moon message is traveling.<br>It will arrive at moonrise over ${location}.`;
    
    toast.innerHTML = `
        <div class="toast-text">
            <strong>Moon Message Sent</strong>
            <p>${message}</p>
        </div>
    `;
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: white;
        padding: 20px 28px;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        z-index: 9999;
        max-width: 400px;
        animation: slideUp 0.3s ease;
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function sendMessage() {
    // Legacy function - now uses handleSend
    handleSend();
}

function sendPublicMessage() {
    const messageText = document.getElementById('publicMessage').value.trim();
    
    if (!messageText) {
        alert('Please write a message');
        return;
    }

    // Add to global transmissions (no photo in MVP)
    globalTransmissions.unshift({
        location: document.getElementById('userLocation')?.textContent || 'Your location',
        time: 'Just now',
        message: `"${messageText}"`
    });

    // Clear draft
    document.getElementById('publicMessage').value = '';

    // renderGlobalTransmissions removed (signals section removed)
    closePublicModal();
    
    // Show soft confirmation
    const toast = document.createElement('div');
    toast.className = 'send-toast';
    toast.innerHTML = `
        <div class="toast-text">
            <strong>Added to the shared sky</strong>
            <p>Others looking up can now see your whisper.</p>
        </div>
    `;
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: white;
        padding: 20px 28px;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        z-index: 9999;
        max-width: 400px;
        animation: slideUp 0.3s ease;
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.remove('active');
            resetForm();
        }
    });
});

// Update dot positions based on time-to-release
// 270° = 12h away, 0° = 6h away, 90° = imminent
// ============================================

// ============================================
// HORIZON GLOW — tracks moon azimuth
// ============================================
function updateHorizonGlow() {
    const grad = document.getElementById('appHorizonLight');
    if (!grad) return;

    const az = moonData.azimuth;   // radians; 0=south, -π/2=east, +π/2=west
    const alt = moonData.altitude; // radians

    // Map azimuth east→west arc to 10%–90% screen width
    const cx = az == null ? 50 : Math.min(90, Math.max(10,
        ((az / Math.PI) + 0.5) * 80 + 10
    ));

    // Fade glow when moon is high (> ~45°); peak near horizon
    const altDeg = alt == null ? 0 : alt * (180 / Math.PI);
    const intensity = alt == null ? 0.6 : Math.max(0.15, 1 - Math.max(0, altDeg) / 55);

    grad.setAttribute('cx', cx + '%');

    // Adjust stop opacities by intensity
    const stops = grad.querySelectorAll('stop');
    const baseOpacities = [0.78, 0.62, 0.42, 0.24, 0.12, 0.05, 0.015, 0];
    stops.forEach((s, i) => {
        const base = baseOpacities[i] || 0;
        s.style.stopOpacity = base * intensity;
    });
}
