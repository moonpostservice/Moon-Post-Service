// Landing-hero "write first, confirm to send" ritual.
//
// A logged-out visitor composes and sends a real Moon Message from the hero as one
// calm, unbroken flow — no separate-feeling signup. The steps are:
//   0) Write the message
//   1) Who is it for?     — recipient name + email + city
//   2) And who's it from? — sender name + email (their city is auto-detected silently
//                            from the browser timezone; a fallback field appears only
//                            if we can't detect it)
// On "Confirm it's you" we seed the message draft + the verify-last signup draft, then
// jump STRAIGHT to the 6-digit code step (skipping the modal's email + location screens
// entirely). After the code is verified, initAuth writes the complete profile and
// flushPendingSend() delivers the message — then we show the "Sent!" screen, which drops
// the user into their inbox.
//
// This file loads last, so it can rely on app globals: cities (realtime.js),
// completeSend/pendingMessage (effects.js), sb/currentAuthUser (auth.js), and the
// auth machinery we reuse: authMode, _signupDraft, pendingAuthEmail, persistSignupDraft,
// warmCaptcha, enterVerifyStep, openModal, showNotificationToast, renderMessages.

const HERO_DRAFT_KEY = 'moonpop_pending_send';
const HERO_DRAFT_TTL_MS = 24 * 3600000;

// In-memory hero state.
let _heroStep = 0;             // 0 = write, 1 = recipient, 2 = sender identity
let _heroRecipientCity = '';   // validated recipient city name (from the list)
let _heroSenderCity = null;    // validated sender city object {name,lat,lon,tz} (detected or picked)

const HERO_LAST_STEP = 2;

// ---- Step navigation ----------------------------------------------------
// Steps are plain show/hide panels. The single primary button advances ("Continue")
// until the last step, where it becomes "Confirm it's you" and kicks off verification.
function heroGoStep(n) {
    _heroStep = Math.max(0, Math.min(HERO_LAST_STEP, n));
    heroClearError();

    for (let i = 0; i <= HERO_LAST_STEP; i++) {
        const panel = document.getElementById('hcStep' + i);
        if (panel) panel.style.display = (i === _heroStep) ? 'block' : 'none';
    }

    // The "Your message" preview rides along on every step after the first.
    const preview = document.getElementById('hcPreview');
    if (preview) preview.style.display = _heroStep >= 1 ? 'block' : 'none';
    if (_heroStep >= 1) heroRenderPreview();

    // Entering the sender step: detect their city silently so it's ready by the time
    // they hit "Confirm" (reveals the manual fallback only if detection misses).
    if (_heroStep === 2) heroDetectSenderCity();

    const back = document.getElementById('hcBackBtn');
    if (back) back.style.display = _heroStep > 0 ? '' : 'none';

    const btn = document.getElementById('hcSendBtn');
    if (btn) btn.textContent = _heroStep === HERO_LAST_STEP ? "Confirm it's you 🌙" : 'Continue';

    const firstField = { 0: 'hcText', 1: 'hcRecipName', 2: 'hcSenderName' }[_heroStep];
    setTimeout(() => document.getElementById(firstField)?.focus(), 60);
}

function heroBack() {
    if (_heroStep > 0) heroGoStep(_heroStep - 1);
}

// Primary button: validate the current step, then advance — or confirm on the last step.
function heroNext() {
    heroClearError();
    if (_heroStep === 0) {
        const text = (document.getElementById('hcText')?.value || '').trim();
        if (!text) {
            document.getElementById('hcText')?.focus();
            return heroError('Write a few words first.');
        }
        return heroGoStep(1);
    }
    if (_heroStep === 1) {
        const name = (document.getElementById('hcRecipName')?.value || '').trim();
        const email = (document.getElementById('hcRecipEmail')?.value || '').trim();
        const cityTyped = (document.getElementById('hcRecipCity')?.value || '').trim();
        if (!name) return heroError('Who is this for? Add their name.');
        if (!email || !email.includes('@')) return heroError('Add their email so the moon can deliver it.');
        if (!(_heroRecipientCity || cityTyped)) return heroError('Pick their city so it arrives at their moonrise.');
        return heroGoStep(2);
    }
    // Last step → confirm identity and start verification.
    const sName = (document.getElementById('hcSenderName')?.value || '').trim();
    const sEmail = (document.getElementById('hcSenderEmail')?.value || '').trim();
    if (!sName) return heroError('Add your name so they know who it’s from.');
    if (!sEmail || !sEmail.includes('@')) return heroError('Add your email so their reply can reach you.');
    if (!_heroSenderCity) return heroError('Pick your city so we can set your moon times.');
    heroConfirmIdentity();
}

// Keep the preview text in sync (live as the message is typed, and on each step change).
function heroRenderPreview() {
    const el = document.getElementById('hcPreviewText');
    if (!el) return;
    const t = (document.getElementById('hcText')?.value || '').trim();
    el.textContent = t.length > 140 ? t.slice(0, 140).trimEnd() + '…' : t;
}

// Kept for the textarea's oninput + the DOM-ready sync. The primary button is always
// active (never reads as disabled); we just keep the live preview fresh.
function heroUpdateSendState() {
    if (_heroStep >= 1) heroRenderPreview();
}

// ---- Sender city: silent timezone detection (mirrors the auth onboarding logic) ----
function heroDetectSenderCity() {
    const wrap = document.getElementById('hcSenderCityWrap');
    if (_heroSenderCity) { if (wrap) wrap.style.display = 'none'; return; }
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    let detected = null;
    if (tz && typeof cities !== 'undefined') {
        detected = cities.find(c => c.tz === tz) ||
                   cities.find(c => c.tz && c.tz.split('/')[0] === tz.split('/')[0]);
    }
    if (detected) {
        _heroSenderCity = detected;
        if (wrap) wrap.style.display = 'none';
    } else if (wrap) {
        // Couldn't detect — reveal the manual picker as a graceful fallback.
        wrap.style.display = 'block';
    }
}

// ---- City autocomplete (reuses the global `cities` dataset) ----
function heroCityOptions(query, onPick) {
    const q = (query || '').trim().toLowerCase();
    if (q.length < 2 || typeof cities === 'undefined') return '';
    const matches = cities.filter(c =>
        c.name.toLowerCase().includes(q) || (c.country && c.country.toLowerCase().includes(q))
    ).slice(0, 8);
    return matches.map(c =>
        `<div class="city-option" onclick="${onPick}('${c.name.replace(/'/g, "\\'")}')">` +
        `<b>${c.name}</b> <span style="color:var(--muter);font-size:12px;">${c.country || ''}</span></div>`
    ).join('');
}

function heroFilterCities(query) {
    const dropdown = document.getElementById('hcCityDropdown');
    if (!dropdown) return;
    _heroRecipientCity = ''; // invalidate until a list item is chosen
    const html = heroCityOptions(query, 'heroSelectCity');
    dropdown.innerHTML = html;
    dropdown.style.display = html ? 'block' : 'none';
}
function heroSelectCity(name) {
    _heroRecipientCity = name;
    const input = document.getElementById('hcRecipCity');
    const dropdown = document.getElementById('hcCityDropdown');
    if (input) input.value = name;
    if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
}

function heroFilterSenderCities(query) {
    const dropdown = document.getElementById('hcSenderCityDropdown');
    if (!dropdown) return;
    _heroSenderCity = null; // invalidate until a list item is chosen
    const html = heroCityOptions(query, 'heroSelectSenderCity');
    dropdown.innerHTML = html;
    dropdown.style.display = html ? 'block' : 'none';
}
function heroSelectSenderCity(name) {
    const city = (typeof cities !== 'undefined') ? cities.find(c => c.name === name) : null;
    _heroSenderCity = city || null;
    const input = document.getElementById('hcSenderCity');
    const dropdown = document.getElementById('hcSenderCityDropdown');
    if (input) input.value = name;
    if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
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

// ---- Confirm: seed the drafts, then jump straight to the code step ----
function heroConfirmIdentity() {
    heroClearError();
    const msg = (document.getElementById('hcText')?.value || '').trim();
    const rName = (document.getElementById('hcRecipName')?.value || '').trim();
    const rEmail = (document.getElementById('hcRecipEmail')?.value || '').trim();
    const rCity = _heroRecipientCity || (document.getElementById('hcRecipCity')?.value || '').trim();
    const sName = (document.getElementById('hcSenderName')?.value || '').trim();
    const sEmail = (document.getElementById('hcSenderEmail')?.value || '').trim();
    const sCity = _heroSenderCity;
    if (!msg || !rName || !rEmail || !rCity || !sName || !sEmail || !sCity) return; // guarded in heroNext

    // 1) Message draft — flushPendingSend() delivers this once the account exists.
    const draft = {
        v: 1,
        mode: 'message',
        fromHero: true,
        text: msg,
        recipient: { name: rName, email: rEmail, city: rCity },
        lunar: null,
        createdAt: new Date().toISOString(),
    };
    try { localStorage.setItem(HERO_DRAFT_KEY, JSON.stringify(draft)); }
    catch (e) { console.error('[hero] could not persist message draft', e); }

    // 2) Verify-last signup draft — verifyMoonKey() promotes this to _pendingSignupProfile
    //    and initAuth writes the complete profile in one shot (name + auto-detected city).
    authMode = 'signup';
    _signupDraft = {
        email: sEmail,
        firstName: sName,
        lastName: '',
        city: { name: sCity.name, lat: sCity.lat, lon: sCity.lon, tz: sCity.tz },
    };
    pendingAuthEmail = sEmail;
    if (typeof persistSignupDraft === 'function') persistSignupDraft();

    // 3) Jump to the code step. Show the auth modal but only its code screen ever
    //    appears — enterVerifyStep() warms nothing of the email/location screens, it
    //    just sends the OTP (with the visible captcha) and reveals the 6 boxes.
    const overlay = document.getElementById('authModalOverlay');
    if (overlay) overlay.style.display = 'flex';
    const title = document.getElementById('authModalTitle');
    if (title) { title.textContent = ''; title.style.display = 'none'; }
    if (typeof warmCaptcha === 'function') warmCaptcha();
    if (typeof enterVerifyStep === 'function') {
        enterVerifyStep();
    } else {
        heroError('Something went wrong — please try again.');
    }
}

// ---- "Sent!" success screen actions ----
function heroGoToInbox() {
    const overlay = document.getElementById('heroSentOverlay');
    if (overlay) overlay.style.display = 'none';
}
function heroWriteAnother() {
    const overlay = document.getElementById('heroSentOverlay');
    if (overlay) overlay.style.display = 'none';
    if (typeof openModal === 'function') openModal(); // in-app "New Moon Message" compose
}

// Initialise the hero UI once the DOM is ready (button label, hide Back/preview).
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => heroGoStep(0));
} else {
    heroGoStep(0);
}

// ---- Flush: after the code is verified, send the stashed message ----
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

    // Consume the draft up front so it can't double-send.
    localStorage.removeItem(HERO_DRAFT_KEY);

    try {
        // Back-compat: a roulette draft could still be sitting in an old visitor's
        // localStorage from a previous build. Keep flushing it so nothing is lost.
        if (draft.mode === 'roulette') {
            const { data, error } = await sb.functions.invoke('send-roulette-message', {
                body: { message_text: draft.text }
            });
            if (error) throw error;
            if (typeof loadRouletteMessages === 'function') await loadRouletteMessages();
            if (typeof renderMessages === 'function') renderMessages();
            if (typeof showNotificationToast === 'function') showNotificationToast('🌕 Your message is on its way to a stranger');
            return;
        }

        // Moon Message → drive the existing send path.
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
            name: r.name, email: r.email, location: r.city || 'Unknown',
            isNew: true, isOnMoonpop: false, linkedProfileId: null,
        };
        pendingMessage = {
            recipient: r.name, recipientEmail: r.email, recipientType: 'email',
            message: fullMessage, textMessage: draft.text || '',
            lunarNoteText: lunarText, lunarClosing: lunarClosing,
            location: r.city || 'Unknown', isKnown: false, isOnMoonpop: false,
            linkedProfileId: null, song: '', moonPhoto: null,
        };

        await completeSend(true);
        if (typeof renderMessages === 'function') renderMessages();

        // Show the "Sent!" screen over the now-loaded inbox (hero sends only); fall back
        // to a toast for any legacy/non-hero draft.
        const overlay = document.getElementById('heroSentOverlay');
        if (draft.fromHero && overlay) {
            const am = document.getElementById('authModalOverlay');
            if (am) am.style.display = 'none';
            const sentText = document.getElementById('heroSentText');
            if (sentText && r.name) {
                sentText.textContent = `Your message is on its way to ${r.name}. It’ll arrive when the moon rises for them — and we’ll tell you if they reply.`;
            }
            overlay.style.display = 'flex';
        } else if (typeof showNotificationToast === 'function') {
            showNotificationToast('🌕 Your moon message is on its way');
        }
    } catch (err) {
        console.error('[hero] flushPendingSend failed:', err);
        if (draft.mode === 'roulette') {
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
