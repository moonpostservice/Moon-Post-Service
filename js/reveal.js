// Moon Reveal Page

// MOON REVEAL PAGE (recipient landing page)
// ============================================
let revealCountdownInterval = null;

async function checkMessageLink() {
    const params = new URLSearchParams(window.location.search);
    // Send-by-link share links take priority over ?m=<id>. Canonical form is the
    // path /m/<token> (Vercel injects OG tags there); ?g=<token> stays supported.
    const pathMatch = window.location.pathname.match(/^\/m\/([A-Za-z0-9_-]{16,64})$/);
    const shareToken = (pathMatch && pathMatch[1]) || params.get('g');
    if (shareToken) return await checkShareLink(shareToken);
    const messageId = params.get('m');
    if (!messageId) return false;

    // Show the reveal page immediately
    const page = document.getElementById('moonRevealPage');
    page.classList.add('active');
    document.getElementById('revealLoading').style.display = 'block';
    document.getElementById('revealError').style.display = 'none';
    document.getElementById('revealLoaded').style.display = 'none';

    // Fetch the message via secure edge function (no anon DB access)
    const { data: revealData, error } = await sb.functions.invoke('reveal-message', {
        body: { id: messageId }
    });

    document.getElementById('revealLoading').style.display = 'none';

    if (error || !revealData || revealData.error) {
        console.error('Message fetch error:', error || revealData?.error);
        document.getElementById('revealError').style.display = 'block';
        return true;
    }

    const msg = revealData.message;
    const senderProfile = revealData.sender;

    // Populate the reveal page
    const senderName = senderProfile?.username || 'Someone';
    document.getElementById('revealSenderName').textContent = senderName;
    const revealPhase = msg.moon_phase || 'waxing gibbous';
    document.getElementById('revealPhaseName').textContent = revealPhase;
    document.getElementById('revealPhaseIcon').innerHTML = phaseIconSvg(revealPhase, 'md');
    document.getElementById('revealCity').textContent = msg.recipient_city || 'your city';

    const isReleased = msg.status === 'released' ||
        (msg.release_at && new Date(msg.release_at) <= new Date());

    if (isReleased) {
        // Message is released — show it!
        showRevealedMessage(msg);
    } else if (msg.release_at) {
        // Not yet released — show countdown
        showRevealCountdown(msg);
    } else {
        // No release time set — show message anyway
        showRevealedMessage(msg);
    }

    document.getElementById('revealLoaded').style.display = 'block';

    return true;
}

function showRevealedMessage(msg) {
    document.getElementById('revealCountdown').style.display = 'none';
    document.getElementById('revealMessage').style.display = 'block';
    document.getElementById('revealMessage').classList.remove('moon-reveal-blurred');
    document.getElementById('revealCta').style.display = 'block';

    // Set message text
    document.getElementById('revealMessageText').textContent = msg.message_text || '';

    // Show lunar note if present
    if (msg.lunar_note_text) {
        document.getElementById('revealLunarNote').style.display = 'block';
        document.getElementById('revealLunarText').textContent = msg.lunar_note_text;
        document.getElementById('revealLunarClosing').textContent = msg.lunar_note_closing || '';
    }
}

function showRevealCountdown(msg) {
    document.getElementById('revealCountdown').style.display = 'block';
    document.getElementById('revealMessage').style.display = 'block';
    document.getElementById('revealMessage').classList.add('moon-reveal-blurred');
    document.getElementById('revealCta').style.display = 'none';

    // Set blurred message text (it's blurred via CSS so it's not readable)
    document.getElementById('revealMessageText').textContent = msg.message_text || 'A message is waiting for you...';
    if (msg.lunar_note_text) {
        document.getElementById('revealLunarNote').style.display = 'block';
        document.getElementById('revealLunarText').textContent = msg.lunar_note_text;
        document.getElementById('revealLunarClosing').textContent = msg.lunar_note_closing || '';
    }

    const releaseDate = new Date(msg.release_at);

    function updateCountdown() {
        const now = new Date();
        const diff = releaseDate - now;

        if (diff <= 0) {
            // Time's up! Reveal the message
            clearInterval(revealCountdownInterval);
            showRevealedMessage(msg);
            return;
        }

        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        const pad = n => String(n).padStart(2, '0');
        document.getElementById('revealCountdownTime').textContent =
            `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    updateCountdown();
    revealCountdownInterval = setInterval(updateCountdown, 1000);
}

// ============================================
// SEND-BY-LINK — anonymous one-way moon message (/m/<token>)
// ============================================
// Anyone can mint a link (no account). Anyone can open it. We detect the
// opener's location silently in the background — no "is this your city?",
// no claim button, no waiting line. The moon being up in their sky is the
// unlock for the first read; once unlocked on this device it stays readable.
// There are no replies. The whole link vanishes at the next new moon.

const SHARE_UNLOCK_KEY = 'mps_share_unlocked_'; // + token  → '1' once read on this device
let _shareState = null;   // { token, coords:{name,lat,lon,tz}, releaseDate, content }

function _fmtHMS(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const pad = n => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function _revealShow(idOn) {
    ['revealLoading', 'revealError', 'revealLoaded'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === idOn) ? 'block' : 'none';
    });
}

function _revealSetPhase(phase) {
    const p = phase || 'waxing gibbous';
    const nameEl = document.getElementById('revealPhaseName');
    const iconEl = document.getElementById('revealPhaseIcon');
    if (nameEl) nameEl.textContent = p;
    if (iconEl && typeof phaseIconSvg === 'function') iconEl.innerHTML = phaseIconSvg(p, 'md');
}

function showRevealError(title, sub) {
    const t = document.getElementById('revealErrorTitle');
    const s = document.getElementById('revealErrorSub');
    if (t && title) t.textContent = title;
    if (s && sub) s.textContent = sub;
    _revealShow('revealError');
}

// Moonrise (first rise on/after `from`) for explicit coordinates — works for an
// IP-detected city that isn't in the curated `cities` list. Returns a Date in
// the past/now if the moon is currently up (→ unlocked), else the next rise.
function deliveryTimeForCoords(lat, lon, tz, from) {
    try {
        const f = from instanceof Date ? from : new Date(from);
        if (typeof isMoonVisible === 'function' && isMoonVisible(f, lat, lon)) return new Date(f);
        const dayStart0 = (typeof getCityDayStart === 'function') ? getCityDayStart(f, tz || 'UTC') : f;
        for (let d = 0; d <= 3; d++) {
            const ds = new Date(dayStart0.getTime() + d * 86400000);
            const r = (typeof findMoonRiseSet === 'function') ? findMoonRiseSet(ds, lat, lon) : null;
            if (r && r.rise && r.rise >= f) return r.rise;
        }
    } catch (e) {}
    return null;
}

// Silent location detection: precise Vercel edge geolocation first, timezone →
// curated city as a fallback. No UI, no confirmation. Returns {name,lat,lon,tz}
// or null (and "we miss it, whatever" — we just show the message ungated).
async function detectShareCoords() {
    try {
        const r = await fetch('/api/geo', { cache: 'no-store' });
        if (r.ok) {
            const g = await r.json();
            if (g && typeof g.lat === 'number' && typeof g.lon === 'number') {
                let tz = g.tz;
                if (!tz) { try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {} }
                return { name: g.city || 'your area', lat: g.lat, lon: g.lon, tz: tz || 'UTC' };
            }
        }
    } catch (e) {}
    // Fallback: timezone → nearest curated city.
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        if (tz && typeof cities !== 'undefined') {
            const c = cities.find(c => c.tz === tz) ||
                      cities.find(c => c.tz && c.tz.split('/')[0] === tz.split('/')[0]);
            if (c) return c;
        }
    } catch (e) {}
    return null;
}

async function checkShareLink(token) {
    const page = document.getElementById('moonRevealPage');
    if (page) page.classList.add('active');
    _revealShow('revealLoading');

    // Fetch the message (server gates only on expiry — the moon ritual is client-side).
    const { data, error } = await sb.functions.invoke('reveal-message', {
        body: { token }
    });

    if (error || !data || data.error || !data.shareable) {
        console.error('Share link fetch error:', error || data?.error);
        showRevealError('This link didn’t open', 'We couldn’t find a moon message here. It may have been mistyped.');
        return true;
    }

    if (data.expired) {
        showRevealError('This moon message has set', 'It returned to the dark with the new moon.');
        return true;
    }

    const msg = data.message;
    const sender = data.sender || {};
    _shareState = { token, coords: null, releaseDate: null, content: msg };

    const nameEl = document.getElementById('revealSenderName');
    if (nameEl) nameEl.textContent = sender.username || 'Someone';
    _revealSetPhase(msg.moon_phase);

    _revealShow('revealLoaded');

    // Already read on this device → stays open (the moon-up gate is for the
    // first read only).
    let alreadyUnlocked = false;
    try { alreadyUnlocked = localStorage.getItem(SHARE_UNLOCK_KEY + token) === '1'; } catch (e) {}
    if (alreadyUnlocked) { unlockShareMessage(); return true; }

    // Detect where they are, silently, and compute their moonrise.
    const coords = await detectShareCoords();
    _shareState.coords = coords;

    // No location → we can't gate; just show it (per product: "we miss it, whatever").
    if (!coords || coords.lat == null || coords.lon == null) { unlockShareMessage(); return true; }

    const cityEl = document.getElementById('revealCity');
    if (cityEl) cityEl.textContent = coords.name || 'you';

    const releaseDate = deliveryTimeForCoords(coords.lat, coords.lon, coords.tz, new Date());
    _shareState.releaseDate = releaseDate;

    // Moon already up (release time is now/past) → read now. Else count down to it.
    if (!releaseDate || releaseDate <= new Date()) unlockShareMessage();
    else showShareCountdown(releaseDate);

    return true;
}

// The moon is up (or already was): reveal the content and remember it on this
// device so re-visits after moonset stay open.
function unlockShareMessage() {
    if (revealCountdownInterval) { clearInterval(revealCountdownInterval); revealCountdownInterval = null; }
    if (_shareState && _shareState.token) {
        try { localStorage.setItem(SHARE_UNLOCK_KEY + _shareState.token, '1'); } catch (e) {}
    }
    const content = (_shareState && _shareState.content) || {};
    _revealSetPhase(content.moon_phase);
    showRevealedMessage(content);
}

function showShareCountdown(releaseDate) {
    document.getElementById('revealCountdown').style.display = 'block';
    document.getElementById('revealMessage').style.display = 'none';
    document.getElementById('revealCta').style.display = 'none';

    // Offer the (optional, account-free) moonrise reminder — reset to fresh state.
    const rem = document.getElementById('revealReminder');
    if (rem) {
        rem.style.display = 'block';
        const btn = document.getElementById('revealReminderBtn'); if (btn) btn.style.display = '';
        const form = document.getElementById('revealReminderForm'); if (form) form.style.display = 'none';
        const done = document.getElementById('revealReminderDone'); if (done) done.style.display = 'none';
        const err = document.getElementById('revealReminderError'); if (err) err.style.display = 'none';
    }

    if (revealCountdownInterval) clearInterval(revealCountdownInterval);
    function tick() {
        const diff = releaseDate - new Date();
        if (diff <= 0) { clearInterval(revealCountdownInterval); unlockShareMessage(); return; }
        document.getElementById('revealCountdownTime').textContent = _fmtHMS(diff);
    }
    tick();
    revealCountdownInterval = setInterval(tick, 1000);
}

// ---- "Remind me when my moon rises" ------------------------------------
// Optional, no account. We write a message_link_opens row carrying the email +
// this opener's moonrise; the send-link-reminders cron emails them once at rise.
function openReminderForm() {
    const btn = document.getElementById('revealReminderBtn');
    const form = document.getElementById('revealReminderForm');
    if (btn) btn.style.display = 'none';
    if (form) form.style.display = 'block';
    setTimeout(() => document.getElementById('revealReminderEmail')?.focus(), 50);
}

async function submitReminder() {
    const emailEl = document.getElementById('revealReminderEmail');
    const errEl = document.getElementById('revealReminderError');
    const email = (emailEl?.value || '').trim();
    const fail = (m) => { if (errEl) { errEl.textContent = m; errEl.style.display = 'block'; } };

    if (!email || !email.includes('@')) return fail('Enter a valid email so we can reach you.');
    if (errEl) errEl.style.display = 'none';
    if (!_shareState || !_shareState.token) return fail('Something went wrong — please reopen the link.');

    const city = _shareState.coords;
    const releaseAt = _shareState.releaseDate ? _shareState.releaseDate.toISOString() : undefined;
    const { data, error } = await sb.functions.invoke('claim-link', {
        body: {
            token: _shareState.token,
            recipient_city: city ? city.name : undefined,
            recipient_lat: city ? city.lat : undefined,
            recipient_lon: city ? city.lon : undefined,
            recipient_tz: city ? city.tz : undefined,
            release_at: releaseAt,
            reminder_email: email,
        }
    });

    if (error || !data || data.error) {
        console.error('reminder save error:', error || data?.error);
        return fail('Something went wrong — please try again.');
    }

    const form = document.getElementById('revealReminderForm');
    const done = document.getElementById('revealReminderDone');
    if (form) form.style.display = 'none';
    if (done) done.style.display = 'block';
}

// The only "next step": write your own. Closes the reveal page and drops the
// visitor onto the hero composer.
function revealStartOwn() {
    closeMoonRevealPage();
    try { history.replaceState(null, '', '/'); } catch (e) {}
    const ta = document.getElementById('hcText');
    if (ta) { ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => ta.focus(), 350); }
}

function closeMoonRevealPage() {
    const page = document.getElementById('moonRevealPage');
    if (page) page.classList.remove('active');
    if (revealCountdownInterval) {
        clearInterval(revealCountdownInterval);
        revealCountdownInterval = null;
    }
}
