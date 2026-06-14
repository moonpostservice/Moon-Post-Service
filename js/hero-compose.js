// Landing-hero "write first, sign up to send" hook.
//
// Lets a logged-out visitor compose a real message in the hero before signing up.
// On "Send" we stash the draft, open the signup flow, and once onboarding completes
// initAuth() calls flushPendingSend() to actually deliver it into the new user's inbox.
//
// This file loads last, so it can rely on app globals: cities (realtime.js),
// generateLunarNote (effects.js), completeSend/pendingMessage (effects.js),
// send-roulette-message via roulette.js's pattern, sb/currentAuthUser (auth.js),
// showNotificationToast, renderMessages, loadRouletteMessages.

const HERO_DRAFT_KEY = 'moonpop_pending_send';
const HERO_DRAFT_TTL_MS = 24 * 3600000;

const HERO_MODE_HINTS = {
    roulette: 'Send a message to a stranger. Only the moon knows who.',
    message: 'Write to someone you know. It unlocks when the moon rises where they are.',
    lunar: 'A short lunar note for someone you have in mind — three words become a verse.',
};

// In-memory hero state. recipientCity holds the *validated* city name (from the list).
let _heroMode = 'roulette';
let _heroRecipientCity = '';
let _heroLunar = null; // { inputs:[a,b,c], text, closing, templateIdx }
let _heroLunarRevealed = false; // lunar step 2 (verse shown, recipient asked) vs step 1

// The recipient block (#hcRecipient) lives at the top for Moon Message, but in
// Lunar Note it slides down into the verse result as "step 2". These helpers move
// the single shared node between its home slot and the lunar result slot.
function heroRecipientHome() {
    const rec = document.getElementById('hcRecipient');
    const text = document.getElementById('hcText');
    if (rec && text && rec.parentElement && rec.nextElementSibling !== text) {
        text.parentElement.insertBefore(rec, text);
    }
}
function heroRecipientToResult() {
    const rec = document.getElementById('hcRecipient');
    const slot = document.getElementById('hcRecipientSlot');
    if (rec && slot && rec.parentElement !== slot) slot.appendChild(rec);
}

function heroSetMode(mode) {
    if (!HERO_MODE_HINTS[mode]) return;
    _heroMode = mode;
    document.querySelectorAll('.hc-mode').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    const hint = document.getElementById('hcHint');
    if (hint) hint.textContent = HERO_MODE_HINTS[mode];

    const recipient = document.getElementById('hcRecipient');
    const text = document.getElementById('hcText');
    const lunar = document.getElementById('hcLunar');

    // Always bring the recipient block home first, then decide where it belongs.
    heroRecipientHome();

    // Lunar always (re)starts at step 1: words only, no recipient, no verse.
    if (mode === 'lunar') {
        _heroLunarRevealed = false;
        const steps = document.getElementById('hcLunarSteps');
        const result = document.getElementById('hcLunarResult');
        if (steps) steps.style.display = 'block';
        if (result) result.style.display = 'none';
    }

    // Roulette: text only. Message: recipient + text. Lunar: wizard (recipient comes in step 2).
    if (recipient) recipient.style.display = (mode === 'message') ? 'flex' : 'none';
    if (text) text.style.display = (mode === 'lunar') ? 'none' : 'block';
    if (lunar) lunar.style.display = (mode === 'lunar') ? 'flex' : 'none';

    heroClearError();
    heroUpdateSendState();
}

// Enable "Send to the moon" only once there's something to send:
// at least one character in the compose box, or a revealed lunar note.
function heroUpdateSendState() {
    const btn = document.getElementById('hcSendBtn');
    if (!btn) return;
    let ready;
    if (_heroMode === 'lunar') {
        // Send only exists in step 2 (after the verse is revealed and we're asking
        // who it's for). Step 1's single CTA is "Let the moon write it".
        btn.style.display = _heroLunarRevealed ? '' : 'none';
        ready = !!_heroLunar;
    } else {
        btn.style.display = '';
        ready = (document.getElementById('hcText')?.value || '').trim().length >= 1;
    }
    btn.disabled = !ready;
}

// ---- City autocomplete (reuses the global `cities` dataset) ----
function heroFilterCities(query) {
    const dropdown = document.getElementById('hcCityDropdown');
    if (!dropdown) return;
    _heroRecipientCity = ''; // invalidate until a list item is chosen
    const q = (query || '').trim().toLowerCase();
    if (q.length < 2 || typeof cities === 'undefined') {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
        return;
    }
    const matches = cities.filter(c =>
        c.name.toLowerCase().includes(q) || (c.country && c.country.toLowerCase().includes(q))
    ).slice(0, 8);
    if (!matches.length) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
        return;
    }
    dropdown.innerHTML = matches.map(c =>
        `<div class="city-option" onclick="heroSelectCity('${c.name.replace(/'/g, "\\'")}')">` +
        `<b>${c.name}</b> <span style="color:var(--muter);font-size:12px;">${c.country || ''}</span></div>`
    ).join('');
    dropdown.style.display = 'block';
}

function heroSelectCity(name) {
    const input = document.getElementById('hcRecipCity');
    const dropdown = document.getElementById('hcCityDropdown');
    _heroRecipientCity = name;
    if (input) input.value = name;
    if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
}

// ---- Lunar Note wizard (reuses generateLunarNote from effects.js) ----
function heroRevealLunar() {
    const v1 = (document.getElementById('hcLunar1')?.value || '').trim();
    const v2 = (document.getElementById('hcLunar2')?.value || '').trim();
    const v3 = (document.getElementById('hcLunar3')?.value || '').trim();
    if (!v1 || !v2 || !v3) {
        heroError('Fill in all three words to reveal your note.');
        return;
    }
    heroClearError();
    // Some templates read these moon globals via closure; set them defensively.
    try { if (typeof getMoonPhase === 'function') _lunarMoonPhase = getMoonPhase().phaseName.toLowerCase(); } catch (e) {}
    try { if (typeof getMoonZodiac === 'function') _lunarZodiac = getMoonZodiac().sign; } catch (e) {}

    if (typeof generateLunarNote !== 'function') {
        heroError('Something went wrong generating your note. Please try again.');
        return;
    }
    const result = generateLunarNote(v1, v2, v3); // random template
    _heroLunar = { inputs: [v1, v2, v3], text: result.lines, closing: result.closing, templateIdx: result.templateIdx };
    document.getElementById('hcLunarText').textContent = result.lines;
    document.getElementById('hcLunarClosing').textContent = result.closing;
    document.getElementById('hcLunarSteps').style.display = 'none';
    document.getElementById('hcLunarResult').style.display = 'block';
    // Step 2: the verse exists — now bring in the recipient block and the Send button.
    _heroLunarRevealed = true;
    heroRecipientToResult();
    const recipient = document.getElementById('hcRecipient');
    if (recipient) recipient.style.display = 'flex';
    heroUpdateSendState();
}

function heroRegenLunar() {
    if (!_heroLunar) return heroRevealLunar();
    const [v1, v2, v3] = _heroLunar.inputs;
    let idx = _heroLunar.templateIdx;
    // Pick a different template than the current one.
    const result = generateLunarNote(v1, v2, v3);
    _heroLunar = { inputs: [v1, v2, v3], text: result.lines, closing: result.closing, templateIdx: result.templateIdx };
    document.getElementById('hcLunarText').textContent = result.lines;
    document.getElementById('hcLunarClosing').textContent = result.closing;
}

function heroEditLunar() {
    // Back to step 1: hide the verse, pull the recipient block back out, hide Send.
    _heroLunarRevealed = false;
    document.getElementById('hcLunarResult').style.display = 'none';
    document.getElementById('hcLunarSteps').style.display = 'block';
    const recipient = document.getElementById('hcRecipient');
    if (recipient) recipient.style.display = 'none';
    heroRecipientHome();
    heroUpdateSendState();
}

// ---- Error helpers ----
function heroError(msg) {
    const el = document.getElementById('hcError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function heroClearError() {
    const el = document.getElementById('hcError');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
}

// ---- Send: validate, stash draft, open signup ----
function heroSend() {
    heroClearError();
    const text = (document.getElementById('hcText')?.value || '').trim();

    let recipient = null;
    if (_heroMode === 'message' || _heroMode === 'lunar') {
        const name = (document.getElementById('hcRecipName')?.value || '').trim();
        const email = (document.getElementById('hcRecipEmail')?.value || '').trim();
        const cityTyped = (document.getElementById('hcRecipCity')?.value || '').trim();
        if (!name) return heroError('Who is this for? Add their name.');
        if (!email || !email.includes('@')) return heroError('Add a valid email so the moon can deliver it.');
        const city = _heroRecipientCity || cityTyped;
        if (!city) return heroError('Pick their city so the message arrives at their moonrise.');
        recipient = { name, email, city };
    }

    let lunar = null;
    if (_heroMode === 'lunar') {
        if (!_heroLunar) return heroError('Reveal your lunar note before sending.');
        lunar = _heroLunar;
    } else {
        if (!text) {
            const ta = document.getElementById('hcText');
            if (ta) ta.focus();
            return heroError('Write a few words first.');
        }
    }

    const draft = {
        v: 1,
        mode: _heroMode,
        text: _heroMode === 'lunar' ? '' : text,
        recipient,
        lunar,
        createdAt: new Date().toISOString(),
    };
    try {
        localStorage.setItem(HERO_DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
        console.error('[hero] could not persist draft', e);
    }
    // Open the genuine signup flow (showAuthModal sets authMode='signup').
    showAuthModal('signup');
}

// Sync the send button once the DOM is ready (covers autofill / restored text).
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', heroUpdateSendState);
} else {
    heroUpdateSendState();
}

// ---- Flush: after onboarding/login completes, send the stashed message ----
async function flushPendingSend() {
    let raw;
    try { raw = localStorage.getItem(HERO_DRAFT_KEY); } catch (e) { return; }
    if (!raw) return;

    let draft;
    try { draft = JSON.parse(raw); } catch (e) { localStorage.removeItem(HERO_DRAFT_KEY); return; }

    // Stale or malformed draft → discard.
    const age = draft.createdAt ? (Date.now() - new Date(draft.createdAt).getTime()) : Infinity;
    if (!draft.mode || age > HERO_DRAFT_TTL_MS) { localStorage.removeItem(HERO_DRAFT_KEY); return; }
    if (typeof currentAuthUser === 'undefined' || !currentAuthUser) return; // wait for a real session

    // Consume the draft up front so it can't double-send; roulette failures re-stash it.
    localStorage.removeItem(HERO_DRAFT_KEY);

    try {
        if (draft.mode === 'roulette') {
            const { data, error } = await sb.functions.invoke('send-roulette-message', {
                body: { message_text: draft.text }
            });
            if (error) throw error;
            if (typeof loadRouletteMessages === 'function') await loadRouletteMessages();
            if (typeof renderMessages === 'function') renderMessages();
            if (typeof showNotificationToast === 'function') showNotificationToast('🌕 Your message is on its way to a stranger');
            console.log('[hero] roulette draft sent:', data?.message?.id);
            return;
        }

        // Moon Message / Lunar Note → drive the existing send path.
        const r = draft.recipient || {};
        let fullMessage = draft.text || '';
        let lunarText = '', lunarClosing = '';
        if (draft.lunar) {
            lunarText = draft.lunar.text || '';
            lunarClosing = draft.lunar.closing || '';
            if (lunarText) {
                if (fullMessage) fullMessage += '\n\n';
                fullMessage += '🌙 Lunar Note\n' + lunarText;
                if (lunarClosing) fullMessage += '\n' + lunarClosing;
            }
        }

        selectedRecipient = {
            name: r.name,
            email: r.email,
            location: r.city || 'Unknown',
            isNew: true,
            isOnMoonpop: false,
            linkedProfileId: null,
        };
        pendingMessage = {
            recipient: r.name,
            recipientEmail: r.email,
            recipientType: 'email',
            message: fullMessage,
            textMessage: draft.text || '',
            lunarNoteText: lunarText,
            lunarClosing: lunarClosing,
            location: r.city || 'Unknown',
            isKnown: false,
            isOnMoonpop: false,
            linkedProfileId: null,
            song: '',
            moonPhoto: null,
        };

        await completeSend(true);
        if (typeof renderMessages === 'function') renderMessages();
        if (typeof showNotificationToast === 'function') showNotificationToast('🌕 Your moon message is on its way');
        console.log('[hero] message/lunar draft sent');
    } catch (err) {
        console.error('[hero] flushPendingSend failed:', err);
        if (draft.mode === 'roulette') {
            // Preserve roulette drafts (e.g. no_eligible_recipients) so they aren't lost.
            try { localStorage.setItem(HERO_DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
        }
        if (typeof showNotificationToast === 'function') {
            const msg = (err && err.message && err.message.includes('no_eligible_recipients'))
                ? 'No new recipients right now — we kept your note. Try again after the next moon.'
                : 'We could not send your message just now. Please try again from your inbox.';
            showNotificationToast(msg);
        }
    }
}
