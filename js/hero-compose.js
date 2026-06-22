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

// ---- "Let the moon write it" — Lunar Note mode --------------------------
// A blank box is the hardest part of writing. This mode swaps the textarea for a
// three-word ritual: the visitor gives the moon three words and generateLunarNote()
// (effects.js) spins them into a little verse, which becomes the message body.
let _heroLunarMode = false;
let _heroLunar = null; // { text, closing } once a verse is revealed

function heroUseLunar() {
    heroClearError();
    _heroLunarMode = true;
    _heroLunar = null;
    const write = document.getElementById('hcWriteMode');
    const lunar = document.getElementById('hcLunar');
    const steps = document.getElementById('hcLunarSteps');
    const result = document.getElementById('hcLunarResult');
    const sendBtn = document.getElementById('hcSendBtn');
    if (write) write.style.display = 'none';
    if (lunar) lunar.style.display = 'flex';
    if (steps) steps.style.display = 'block';
    if (result) result.style.display = 'none';
    if (sendBtn) sendBtn.style.display = 'none'; // returns once the verse is revealed
    const sign = document.getElementById('hcSenderName');
    if (sign) sign.style.display = 'none'; // "Sign it?" belongs with the revealed verse, not the wizard
    heroRandomizeLunarPrompts();
    for (let i = 1; i <= 3; i++) {
        const el = document.getElementById('hcLunar' + i);
        if (el) el.value = '';
        const nb = document.getElementById('hcLunarNext' + i);
        if (nb) nb.disabled = true; // re-locked until each stage is answered
    }
    heroLunarStep(1); // rewind the wizard to the first stage (also focuses it)
}

// Reveal one wizard stage at a time. Each stage is a single big question; the
// visitor answers, presses Next, and only the third answer unlocks the reveal.
function heroLunarStep(step) {
    heroClearError();
    for (let i = 1; i <= 3; i++) {
        const card = document.getElementById('hcLunarCard' + i);
        if (card) card.classList.toggle('active', i === step);
    }
    // Focus immediately (no artificial delay) and don't let it scroll the page.
    document.getElementById('hcLunar' + step)?.focus({ preventScroll: true });
}

// A stage's Next/Reveal button stays disabled until that stage has a word.
function heroLunarValidate(step) {
    const val = (document.getElementById('hcLunar' + step)?.value || '').trim();
    const btn = document.getElementById('hcLunarNext' + step);
    if (btn) btn.disabled = !val;
}

// Enter advances a filled stage (and triggers the reveal on the last one), so the
// ritual flows from the keyboard without reaching for the mouse.
function heroLunarKey(e, step) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if ((document.getElementById('hcLunar' + step)?.value || '').trim() === '') return;
    if (step < 3) heroLunarStep(step + 1);
    else heroRevealLunar();
}

function heroUseWrite() {
    heroClearError();
    _heroLunarMode = false;
    _heroLunar = null;
    const write = document.getElementById('hcWriteMode');
    const lunar = document.getElementById('hcLunar');
    const sendBtn = document.getElementById('hcSendBtn');
    if (write) write.style.display = 'block';
    if (lunar) lunar.style.display = 'none';
    if (sendBtn) sendBtn.style.display = '';
    const sign = document.getElementById('hcSenderName');
    if (sign) sign.style.display = ''; // always offered alongside the free-write box
    heroUpdateSendState(); // restore the in-box chip if the message is still empty
    setTimeout(() => document.getElementById('hcText')?.focus(), 60);
}

// Freshen the three word-prompts from the global pools (effects.js) so the ritual
// feels alive each time; falls back to the static placeholders if pools are absent.
function heroRandomizeLunarPrompts() {
    try {
        if (typeof LUNAR_POOL_1 === 'undefined') return;
        const pick = (pool) => pool[Math.floor(Math.random() * pool.length)];
        // The label is the stage's big question; the placeholder is the quiet hint.
        const set = (n, p) => {
            if (!p) return;
            const label = document.getElementById('hcLunarLabel' + n);
            const input = document.getElementById('hcLunar' + n);
            if (label) label.textContent = p.label;
            if (input) input.placeholder = p.placeholder;
        };
        set(1, pick(LUNAR_POOL_1));
        set(2, pick(LUNAR_POOL_2));
        set(3, pick(LUNAR_POOL_3));
    } catch (e) { /* keep static label + placeholder */ }
}

function heroRevealLunar() {
    const v1 = (document.getElementById('hcLunar1')?.value || '').trim();
    const v2 = (document.getElementById('hcLunar2')?.value || '').trim();
    const v3 = (document.getElementById('hcLunar3')?.value || '').trim();
    if (!v1 || !v2 || !v3) return heroError('Give the moon all three words to reveal your note.');
    heroClearError();
    // Some templates read these moon globals via closure; set them defensively.
    try { if (typeof getMoonPhase === 'function') _lunarMoonPhase = getMoonPhase().phaseName.toLowerCase(); } catch (e) {}
    try { if (typeof getMoonZodiac === 'function') _lunarZodiac = getMoonZodiac().sign; } catch (e) {}
    if (typeof generateLunarNote !== 'function') return heroError('Couldn’t reach the moon just now. Please try again.');

    const result = generateLunarNote(v1, v2, v3); // random template
    _heroLunar = { text: result.lines, closing: result.closing };
    document.getElementById('hcLunarText').textContent = result.lines;
    document.getElementById('hcLunarClosing').textContent = result.closing;
    document.getElementById('hcLunarSteps').style.display = 'none';
    document.getElementById('hcLunarResult').style.display = 'block';
    const sendBtn = document.getElementById('hcSendBtn');
    if (sendBtn) sendBtn.style.display = '';
    const sign = document.getElementById('hcSenderName');
    if (sign) sign.style.display = ''; // now sign the verse, just before sending
}

function heroRegenLunar() {
    const v1 = (document.getElementById('hcLunar1')?.value || '').trim();
    const v2 = (document.getElementById('hcLunar2')?.value || '').trim();
    const v3 = (document.getElementById('hcLunar3')?.value || '').trim();
    if (!v1 || !v2 || !v3) return;
    const result = generateLunarNote(v1, v2, v3); // a fresh random template
    _heroLunar = { text: result.lines, closing: result.closing };
    document.getElementById('hcLunarText').textContent = result.lines;
    document.getElementById('hcLunarClosing').textContent = result.closing;
}

function heroEditLunar() {
    _heroLunar = null;
    document.getElementById('hcLunarResult').style.display = 'none';
    document.getElementById('hcLunarSteps').style.display = 'block';
    const sendBtn = document.getElementById('hcSendBtn');
    if (sendBtn) sendBtn.style.display = 'none';
    const sign = document.getElementById('hcSenderName');
    if (sign) sign.style.display = 'none'; // hidden again while editing the words
    // Answers are kept — re-enable each stage's button and rewind to the first.
    for (let i = 1; i <= 3; i++) heroLunarValidate(i);
    heroLunarStep(1);
}

// ---- Primary button: validate, then mint the link anonymously -----------
// No steps, no signup, no OTP. A visitor writes (or lets the moon write), optionally
// signs it, and gets a shareable link straight away. createShareableMessage()
// (share-sheet.js) posts to the send-message edge function in anonymous shareable mode.
async function heroNext() {
    heroClearError();
    const fromName = (document.getElementById('hcSenderName')?.value || '').trim();

    // The message body is either the free-written text or the moon-written verse.
    let text;
    if (_heroLunarMode) {
        if (!_heroLunar) return heroError('Let the moon write your note first.');
        text = _heroLunar.text + (_heroLunar.closing ? '\n\n' + _heroLunar.closing : '');
    } else {
        text = (document.getElementById('hcText')?.value || '').trim();
        if (!text) {
            document.getElementById('hcText')?.focus();
            return heroError('Write a few words first.');
        }
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
        if (btn) { btn.disabled = false; btn.textContent = prevLabel || 'Cast a link to the moon'; }
    }
}

// The textarea's oninput hook: the in-box "Let the moon write it" chip is only an
// offer for the blank page, so it shows while the box is empty and fades the moment
// there's anything to send.
function heroUpdateSendState() {
    const ta = document.getElementById('hcText');
    const chip = document.getElementById('hcMoonHelpBtn');
    if (ta && chip) chip.style.display = ta.value.trim() ? 'none' : '';
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
    heroUpdateSendState(); // show the in-box chip for the empty box
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
            if (typeof showNotificationToast === 'function') showNotificationToast('Your message is on its way to a stranger');
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
            showNotificationToast('Your moon message is on its way');
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
