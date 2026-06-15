// Landing-hero "write first, sign up to send" hook.
//
// Lets a logged-out visitor compose a real message in the hero before signing up.
// It's a single calm delivery ritual (one Moon Message), staged across three steps:
//   0) Write the message
//   1) Who is it for?  (name + city — the city is the clock: it sets the moonrise)
//   2) Where should the moon deliver it?  (their email + your email for replies)
// On the final step we stash the draft, open the email/verify flow prefilled with the
// sender's email, and once onboarding completes initAuth() calls flushPendingSend()
// to actually deliver it into the new user's inbox.
//
// This file loads last, so it can rely on app globals: cities (realtime.js),
// completeSend/pendingMessage (effects.js), sb/currentAuthUser/showAuthModal (auth.js),
// showNotificationToast, renderMessages, loadRouletteMessages.

const HERO_DRAFT_KEY = 'moonpop_pending_send';
const HERO_DRAFT_TTL_MS = 24 * 3600000;

// In-memory hero state. recipientCity holds the *validated* city name (from the list).
let _heroStep = 0;          // 0 = write, 1 = recipient, 2 = delivery/send
let _heroRecipientCity = '';

const HERO_LAST_STEP = 2;

// ---- Step navigation ----------------------------------------------------
// Steps are plain show/hide panels. The single primary button advances ("Continue")
// until the last step, where it becomes the one and only "Send with the moon".
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

    const back = document.getElementById('hcBackBtn');
    if (back) back.style.display = _heroStep > 0 ? '' : 'none';

    const btn = document.getElementById('hcSendBtn');
    if (btn) btn.textContent = _heroStep === HERO_LAST_STEP ? 'Send with the moon 🌙' : 'Continue';

    // Move focus to the first field of the new step (skip on the very first paint).
    const firstField = {
        0: 'hcText', 1: 'hcRecipName', 2: 'hcRecipEmail',
    }[_heroStep];
    setTimeout(() => document.getElementById(firstField)?.focus(), 60);
}

function heroBack() {
    if (_heroStep > 0) heroGoStep(_heroStep - 1);
}

// Primary button: validate the current step, then advance — or send on the last step.
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
        const cityTyped = (document.getElementById('hcRecipCity')?.value || '').trim();
        if (!name) return heroError('Who is this for? Add their name.');
        const city = _heroRecipientCity || cityTyped;
        if (!city) return heroError('Pick their city so it arrives at their moonrise.');
        return heroGoStep(2);
    }
    // Last step → actually send.
    heroSend();
}

// Keep the preview text in sync (called live as the message is typed, and on each
// step change). Truncates to a calm one-glance reminder.
function heroRenderPreview() {
    const el = document.getElementById('hcPreviewText');
    if (!el) return;
    const text = (document.getElementById('hcText')?.value || '').trim();
    el.textContent = text.length > 140 ? text.slice(0, 140).trimEnd() + '…' : text;
}

// Kept for the textarea's oninput + the DOM-ready sync below. The primary button is
// always active (it never reads as disabled); we just keep the live preview fresh.
function heroUpdateSendState() {
    if (_heroStep >= 1) heroRenderPreview();
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

// ---- Error helpers ----
function heroError(msg) {
    const el = document.getElementById('hcError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function heroClearError() {
    const el = document.getElementById('hcError');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
}

// ---- Send: validate everything, stash draft, open the email/verify flow ----
function heroSend() {
    heroClearError();
    const text = (document.getElementById('hcText')?.value || '').trim();
    const name = (document.getElementById('hcRecipName')?.value || '').trim();
    const cityTyped = (document.getElementById('hcRecipCity')?.value || '').trim();
    const recipEmail = (document.getElementById('hcRecipEmail')?.value || '').trim();
    const senderEmail = (document.getElementById('hcSenderEmail')?.value || '').trim();

    // Defensive re-validation (the step gates should already have caught these).
    if (!text) { heroGoStep(0); return heroError('Write a few words first.'); }
    const city = _heroRecipientCity || cityTyped;
    if (!name || !city) { heroGoStep(1); return heroError('Add their name and city first.'); }
    if (!recipEmail || !recipEmail.includes('@')) return heroError('Add their email so the moon can deliver it.');
    if (!senderEmail || !senderEmail.includes('@')) return heroError('Add your email so you can receive their reply.');

    const draft = {
        v: 1,
        mode: 'message',
        text,
        recipient: { name, email: recipEmail, city },
        lunar: null,
        createdAt: new Date().toISOString(),
    };
    try {
        localStorage.setItem(HERO_DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
        console.error('[hero] could not persist draft', e);
    }

    // Open the email/verify flow. It's framed as "your email so replies reach you",
    // not "sign up" — but mechanically it still creates the account that delivers the
    // message. Prefill the sender's email so they don't retype it (showAuthModal
    // clears the field on open, so set the value *after* the call).
    showAuthModal('signup');
    const emailInput = document.getElementById('authEmail');
    if (emailInput) emailInput.value = senderEmail;
}

// Initialise the hero UI once the DOM is ready (sets button label, hides Back/preview).
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => heroGoStep(0));
} else {
    heroGoStep(0);
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
            console.log('[hero] roulette draft sent:', data?.message?.id);
            return;
        }

        // Moon Message → drive the existing send path. (Old builds also produced a
        // 'lunar' mode; fold any lunar verse into the message body for safety.)
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
        console.log('[hero] message draft sent');
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
