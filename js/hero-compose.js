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

// ---- Primary button: validate, then mint the link anonymously -----------
// No steps, no signup, no OTP. A visitor writes, optionally signs it, and gets
// a shareable link straight away. createShareableMessage() (share-sheet.js)
// posts to the send-message edge function in anonymous shareable mode.
async function heroNext() {
    heroClearError();
    const text = (document.getElementById('hcText')?.value || '').trim();
    const fromName = (document.getElementById('hcSenderName')?.value || '').trim();
    if (!text) {
        document.getElementById('hcText')?.focus();
        return heroError('Write a few words first.');
    }

    const btn = document.getElementById('hcSendBtn');
    const prevLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Casting it to the moon…'; }

    try {
        const { link } = await createShareableMessage({ text, senderName: fromName });
        openShareSheet({ link, senderName: fromName || 'You', previewText: text });
    } catch (err) {
        console.error('[hero] createShareableMessage failed:', err);
        const msg = (err && err.message === 'rate_limited')
            ? 'You’ve created a lot of links just now — give it a moment and try again.'
            : 'We couldn’t create your link just now. Please try again.';
        heroError(msg);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = prevLabel || 'Create the link 🌙'; }
    }
}

// Kept for the textarea's oninput (no live preview anymore — the button is the
// whole ritual). Left as a no-op hook so the markup never throws.
function heroUpdateSendState() {}

// ---- Error helpers ----
function heroError(msg) {
    const el = document.getElementById('hcError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function heroClearError() {
    const el = document.getElementById('hcError');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
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

// ---- Rotating hero prompt ----------------------------------------------
// The empty message box shouldn't ask the visitor to "write a message" — it should
// already have them picturing a particular person. Each visit we drop in a different
// poetic prompt so the box feels alive and the question lands fresh every time.
const HERO_PROMPTS = [
    'Who do you miss tonight? Write to them as if they were listening…',
    'Someone has been on your mind. Tell them the thing you keep meaning to say…',
    'Picture the person you wish were closer. Now write to them…',
    'Who do you carry with you? Send them a few words across the dark…',
    'There is something you have never quite said. Say it here…',
    'Write to the one you think of when the sky goes quiet…',
    'Name the person you miss — then tell them why…',
    'What would you say to them, if the distance were nothing? Write it here…',
    'Who would you reach for, if it were not too far or too late? Write to them instead…',
    'Think of someone you love and rarely tell. Begin with them…',
];

function heroRotatePrompt() {
    const ta = document.getElementById('hcText');
    if (!ta) return;
    // Math.random() is fine here — purely cosmetic, no need for crypto.
    const prompt = HERO_PROMPTS[Math.floor(Math.random() * HERO_PROMPTS.length)];
    ta.setAttribute('placeholder', prompt);
}

// Initialise the hero UI once the DOM is ready (button label, hide Back/preview,
// and a fresh prompt in the message box).
function heroInit() {
    heroClearError();
    heroRotatePrompt();
    setTimeout(() => document.getElementById('hcText')?.focus(), 60);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', heroInit);
} else {
    heroInit();
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

        // Send-by-link → mint a recipient-less shareable message, then show the
        // share sheet so the sender can hand the link to whoever they like.
        if (draft.mode === 'share') {
            const { link } = await createShareableMessage({ text: draft.text, lunar: draft.lunar });
            if (typeof renderMessages === 'function') renderMessages();
            const am = document.getElementById('authModalOverlay');
            if (am) am.style.display = 'none';
            openShareSheet({ link, senderName: draft.senderName, previewText: draft.text });
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
            // This screen lives inside #onboardingOverlay, which is display:none once
            // the user is in the app — that hides every descendant regardless of its own
            // display/z-index. We show "Sent!" AFTER the inbox loads (onboarding hidden),
            // so it'd render to nothing. Promote it to a direct child of <body> so it's a
            // true top-level overlay in both the landing AND the in-app flow.
            if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
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
