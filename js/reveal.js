// Moon Reveal Page

// MOON REVEAL PAGE (recipient landing page)
// ============================================
let revealCountdownInterval = null;

async function checkMessageLink() {
    const params = new URLSearchParams(window.location.search);
    // Send-by-link share links (?g=<token>) take priority over ?m=<id>.
    const shareToken = params.get('g');
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
// SEND-BY-LINK — recipient open experience (?g=<token>)
// ============================================
// A reusable share link. The opener confirms their city, taps Reveal, and the
// message locks to THEIR moonrise (a per-opener message_link_opens row). The
// opaque open_id is kept in localStorage so re-opening the same link on the
// same device resumes the same countdown instead of starting over.

const SHARE_OPEN_KEY = 'mps_share_open_'; // + token  → open_id
let _shareState = null;   // { token, openId, pickupAt, senderName, moonPhase, claimCity, releaseAt }
let _claimCity = null;    // chosen city object {name,lat,lon,tz}
let _claimCountdownInterval = null; // live "moon rises in…" ticker on the claim card
let _claimReleaseDate = null;

function _fmtHMS(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const pad = n => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// This opener's moonrise = their first moonrise on/after the sender's pickup.
function _claimReleaseFor(city) {
    try {
        const from = (_shareState && _shareState.pickupAt) ? new Date(_shareState.pickupAt) : new Date();
        if (typeof getRecipientDeliveryTime === 'function') return getRecipientDeliveryTime(city.name, from) || null;
    } catch (e) {}
    return null;
}

function _revealShow(idOn) {
    ['revealLoading', 'revealError', 'revealLoaded', 'revealClaim'].forEach(id => {
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

async function checkShareLink(token) {
    const page = document.getElementById('moonRevealPage');
    if (page) page.classList.add('active');
    _revealShow('revealLoading');

    // open_id resolves from this device's localStorage, or the ?o= param on a
    // reminder email's deep link (so it resumes that exact open on any device).
    const oParam = new URLSearchParams(window.location.search).get('o');
    let openId = null;
    try { openId = localStorage.getItem(SHARE_OPEN_KEY + token); } catch (e) {}
    if (!openId && oParam) {
        openId = oParam;
        try { localStorage.setItem(SHARE_OPEN_KEY + token, oParam); } catch (e) {}
    }

    const { data, error } = await sb.functions.invoke('reveal-message', {
        body: { token, open_id: openId || undefined }
    });

    if (error || !data || data.error || !data.shareable) {
        console.error('Share link fetch error:', error || data?.error);
        _revealShow('revealError');
        return true;
    }

    const msg = data.message;
    const sender = data.sender || {};
    _shareState = {
        token,
        openId: openId || null,
        pickupAt: msg.pickup_at || null,
        senderName: sender.username || 'Someone',
        moonPhase: msg.moon_phase || null,
    };
    _revealSetPhase(_shareState.moonPhase);

    const nameEl = document.getElementById('revealSenderName');
    if (nameEl) nameEl.textContent = _shareState.senderName;

    // Already claimed on this device?
    if (openId && msg.sealed === false && msg.message_text != null) {
        _revealShow('revealLoaded');
        showRevealedMessage(msg);
        return true;
    }
    if (openId && msg.release_at) {
        _revealShow('revealLoaded');
        const cityEl = document.getElementById('revealCity');
        if (cityEl && msg.recipient_city) cityEl.textContent = msg.recipient_city;
        showRevealCountdownShare(msg);
        return true;
    }

    // Fresh open → invite them to lock their sky.
    showShareClaim(msg);
    return true;
}

function showShareClaim(msg) {
    _revealShow('revealClaim');
    const who = document.getElementById('shareClaimSender');
    if (who) who.textContent = _shareState.senderName;
    const teaserEl = document.getElementById('shareClaimTeaser');
    if (teaserEl) teaserEl.textContent = msg.teaser ? `“${msg.teaser}”` : '';

    // Auto-detect the opener's city from their timezone (confirmable below).
    _claimCity = detectClaimCity();
    renderClaimCity();
}

function detectClaimCity() {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (tz && typeof cities !== 'undefined') {
        return cities.find(c => c.tz === tz) ||
               cities.find(c => c.tz && c.tz.split('/')[0] === tz.split('/')[0]) || null;
    }
    return null;
}

function renderClaimCity() {
    const label = document.getElementById('shareClaimCityName');
    const btn = document.getElementById('shareClaimRevealBtn');
    if (label) label.textContent = _claimCity ? _claimCity.name : 'somewhere under the moon';
    if (btn) btn.disabled = !_claimCity;
    updateClaimMoonrise();
}

// Live "your moon rises in HH:MM:SS" preview on the claim card, so the opener
// sees their wait before they commit. Recomputed whenever the city changes.
function updateClaimMoonrise() {
    if (_claimCountdownInterval) { clearInterval(_claimCountdownInterval); _claimCountdownInterval = null; }
    const el = document.getElementById('shareClaimMoonrise');
    if (!el) return;
    if (!_claimCity) { el.innerHTML = ''; return; }

    _claimReleaseDate = _claimReleaseFor(_claimCity);
    if (!_claimReleaseDate) { el.innerHTML = '🌙 We’ll reveal it at your next moonrise.'; return; }

    const tick = () => {
        const diff = _claimReleaseDate - new Date();
        if (diff <= 0) {
            el.innerHTML = '🌙 Your moon is up now — reveal it.';
            if (_claimCountdownInterval) { clearInterval(_claimCountdownInterval); _claimCountdownInterval = null; }
            return;
        }
        const at = _claimReleaseDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        el.innerHTML = `🌙 Your moon rises in <strong>${_fmtHMS(diff)}</strong>` +
            `<br><span style="color:var(--muter);font-size:12px;">around ${at} your time</span>`;
    };
    tick();
    _claimCountdownInterval = setInterval(tick, 1000);
}

// Compact city picker for the claim step (reuses the global `cities` dataset).
function filterClaimCities(query) {
    const dropdown = document.getElementById('shareClaimCityDropdown');
    if (!dropdown) return;
    _claimCity = null; renderClaimCity();
    const q = (query || '').trim().toLowerCase();
    if (q.length < 2 || typeof cities === 'undefined') { dropdown.style.display = 'none'; dropdown.innerHTML = ''; return; }
    const matches = cities.filter(c =>
        c.name.toLowerCase().includes(q) || (c.country && c.country.toLowerCase().includes(q))
    ).slice(0, 8);
    dropdown.innerHTML = matches.map(c =>
        `<div class="city-option" onclick="selectClaimCity('${c.name.replace(/'/g, "\\'")}')"><b>${c.name}</b> <span style="color:var(--muter);font-size:12px;">${c.country || ''}</span></div>`
    ).join('');
    dropdown.style.display = matches.length ? 'block' : 'none';
}
function selectClaimCity(name) {
    _claimCity = (typeof cities !== 'undefined') ? cities.find(c => c.name === name) || null : null;
    const input = document.getElementById('shareClaimCityInput');
    const dropdown = document.getElementById('shareClaimCityDropdown');
    if (input) input.value = name;
    if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
    renderClaimCity();
}

async function doRevealClaim() {
    if (!_claimCity || !_shareState) return;
    if (_claimCountdownInterval) { clearInterval(_claimCountdownInterval); _claimCountdownInterval = null; }
    const city = _claimCity;
    const btn = document.getElementById('shareClaimRevealBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Locking your moon…'; }

    // Hop 2: this opener's first moonrise on/after the sender's pickup. Stamped
    // here from SunCalc, same as the send path; the server clamps it.
    let releaseAt = new Date().toISOString();
    try {
        const from = _shareState.pickupAt ? new Date(_shareState.pickupAt) : new Date();
        const d = (typeof getRecipientDeliveryTime === 'function') ? getRecipientDeliveryTime(city.name, from) : null;
        if (d) releaseAt = d.toISOString();
    } catch (e) { /* fall back to now */ }

    // Remember for the "remind me" call (same open, no city re-pick needed).
    _shareState.claimCity = city;
    _shareState.releaseAt = releaseAt;

    const { data, error } = await sb.functions.invoke('claim-link', {
        body: {
            token: _shareState.token,
            recipient_city: city.name,
            recipient_lat: city.lat,
            recipient_lon: city.lon,
            recipient_tz: city.tz,
            release_at: releaseAt,
            open_id: _shareState.openId || undefined,
        }
    });

    if (error || !data || data.error) {
        console.error('claim-link error:', error || data?.error);
        if (btn) { btn.disabled = false; btn.textContent = 'Reveal at my moonrise 🌙'; }
        const errEl = document.getElementById('shareClaimError');
        if (errEl) { errEl.textContent = 'Something went wrong — please try again.'; errEl.style.display = 'block'; }
        return;
    }

    _shareState.openId = data.open_id;
    try { localStorage.setItem(SHARE_OPEN_KEY + _shareState.token, data.open_id); } catch (e) {}

    _revealShow('revealLoaded');
    const cityEl = document.getElementById('revealCity');
    if (cityEl) cityEl.textContent = city.name;

    const m = Object.assign({}, data.message, { release_at: data.release_at, recipient_city: city.name });
    if (data.sealed) showRevealCountdownShare(m);
    else showRevealedMessage(m);
}

function showRevealCountdownShare(msg) {
    document.getElementById('revealCountdown').style.display = 'block';
    document.getElementById('revealMessage').style.display = 'block';
    document.getElementById('revealMessage').classList.add('moon-reveal-blurred');
    document.getElementById('revealCta').style.display = 'none';
    document.getElementById('revealMessageText').textContent = 'A message is waiting for you…';

    // Offer the moonrise reminder (share-link openers only — reset to fresh state).
    const rem = document.getElementById('revealReminder');
    if (rem) {
        rem.style.display = 'block';
        const btn = document.getElementById('revealReminderBtn'); if (btn) btn.style.display = '';
        const form = document.getElementById('revealReminderForm'); if (form) form.style.display = 'none';
        const done = document.getElementById('revealReminderDone'); if (done) done.style.display = 'none';
        const err = document.getElementById('revealReminderError'); if (err) err.style.display = 'none';
    }

    const releaseDate = new Date(msg.release_at);
    if (revealCountdownInterval) clearInterval(revealCountdownInterval);

    function tick() {
        const diff = releaseDate - new Date();
        if (diff <= 0) {
            clearInterval(revealCountdownInterval);
            revealShareContent();
            return;
        }
        const pad = n => String(n).padStart(2, '0');
        document.getElementById('revealCountdownTime').textContent =
            `${pad(Math.floor(diff / 3600000))}:${pad(Math.floor((diff % 3600000) / 60000))}:${pad(Math.floor((diff % 60000) / 1000))}`;
    }
    tick();
    revealCountdownInterval = setInterval(tick, 1000);
}

// Countdown reached zero (or a revisit after moonrise): fetch the now-unsealed
// content from the server — it was never shipped while sealed.
async function revealShareContent() {
    if (!_shareState) return;
    try {
        const { data } = await sb.functions.invoke('reveal-message', {
            body: { token: _shareState.token, open_id: _shareState.openId || undefined }
        });
        if (data && data.message) {
            _revealShow('revealLoaded');
            showRevealedMessage(data.message);
        }
    } catch (e) { console.error('revealShareContent failed:', e); }
}

// ---- "Remind me when my moon rises" ------------------------------------
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
    if (!_shareState || !_shareState.openId) return fail('Please reveal first, then set a reminder.');

    const city = _shareState.claimCity;
    const { data, error } = await sb.functions.invoke('claim-link', {
        body: {
            token: _shareState.token,
            recipient_city: city ? city.name : undefined,
            recipient_lat: city ? city.lat : undefined,
            recipient_lon: city ? city.lon : undefined,
            recipient_tz: city ? city.tz : undefined,
            release_at: _shareState.releaseAt || undefined,
            open_id: _shareState.openId,
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

const PENDING_REPLY_KEY = 'mps_pending_reply';

function revealSignupToReply() {
    // Send-by-link opener wants to reply: stash the intent so that, once they've
    // signed up, flushPendingShareReply() graduates this open into a real
    // conversation with the sender and drops them into the thread.
    if (_shareState && _shareState.token) {
        let openId = _shareState.openId;
        if (!openId) { try { openId = localStorage.getItem(SHARE_OPEN_KEY + _shareState.token); } catch (e) {} }
        if (openId) {
            try {
                localStorage.setItem(PENDING_REPLY_KEY, JSON.stringify({
                    token: _shareState.token, openId, ts: Date.now()
                }));
            } catch (e) {}
        }
    }
    // Close reveal page and show the signup flow
    closeMoonRevealPage();
    history.replaceState(null, '', window.location.pathname);
    showOnboarding();
}

// After signup/login (called from initAuth): if a share-link reply is pending,
// graduate it into a 1:1 conversation with the sender and open that thread.
async function flushPendingShareReply() {
    let raw;
    try { raw = localStorage.getItem(PENDING_REPLY_KEY); } catch (e) { return; }
    if (!raw) return;
    let p;
    try { p = JSON.parse(raw); } catch (e) { try { localStorage.removeItem(PENDING_REPLY_KEY); } catch (e2) {} return; }
    try { localStorage.removeItem(PENDING_REPLY_KEY); } catch (e) {}

    if (!p || !p.token || !p.openId) return;
    if (Date.now() - (p.ts || 0) > 60 * 60 * 1000) return;          // stale > 1h
    if (typeof currentAuthUser === 'undefined' || !currentAuthUser) return;

    try {
        const { data: convId, error } = await sb.rpc('graduate_link_reply', {
            p_token: p.token, p_open_id: p.openId
        });
        if (error) { console.error('graduate_link_reply failed:', error); return; }

        if (typeof loadMessages === 'function') await loadMessages();
        if (typeof buildConversations === 'function') buildConversations();
        if (typeof renderMessages === 'function') renderMessages();

        if (convId && typeof conversations !== 'undefined' && typeof openConversation === 'function') {
            const idx = conversations.findIndex(c => c.dbConversationId === convId);
            if (idx !== -1) await openConversation(idx);
        }
    } catch (e) {
        console.error('flushPendingShareReply error:', e);
    }
}

function closeMoonRevealPage() {
    document.getElementById('moonRevealPage').classList.remove('active');
    if (revealCountdownInterval) {
        clearInterval(revealCountdownInterval);
        revealCountdownInterval = null;
    }
    if (_claimCountdownInterval) {
        clearInterval(_claimCountdownInterval);
        _claimCountdownInterval = null;
    }
}


// ============================================
