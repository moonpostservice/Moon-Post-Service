// Send-by-link share sheet.
//
// After the sender confirms their identity (and an account exists), a moon
// message is created WITHOUT a recipient — it carries a secret share_token and
// each person who opens the link locks their own location + moonrise later
// (see migration 049 + the message_link_opens table). This module:
//   1) createShareableMessage(draft) — mints the message via the send-message
//      edge function in shareable mode and returns the public link.
//   2) openShareSheet({ link, senderName, previewText }) — shows the share UI
//      (native share sheet on mobile + WhatsApp / Email / Copy) so it feels like
//      handing the message to someone, not filling in a form.
//
// Loaded as a plain script (non-module): relies on app globals — sb,
// currentAuthUser, moonData, getSenderPickupTime/getMoonPhase (moon-calc.js),
// showNotificationToast.

// Build the canonical public link for a share token. Path form (/m/<token>) so
// Vercel can inject per-link Open Graph tags for a beautiful unfurl; reveal.js
// also still accepts the legacy ?g=<token> form. Uses the current origin so it
// works on prod (www) and any preview deploy without hardcoding the domain.
function shareLinkFor(token) {
    return `${window.location.origin}/m/${encodeURIComponent(token)}`;
}

// Create a recipient-less, shareable moon message and return { link, message }.
// `draft` carries the composed content: { text, lunar:{text,closing} }.
async function createShareableMessage(draft) {
    if (typeof currentAuthUser === 'undefined' || !currentAuthUser) {
        throw new Error('not_authenticated');
    }

    // Hop 1 (pickup): when the SENDER's moon collects the note — now if their
    // moon is up, else their next moonrise. Same deterministic SunCalc timing as
    // the normal send path; there is no hop-2 release_at yet (each opener stamps
    // their own at claim time).
    const now = new Date();
    let pickupAt = now;
    try {
        if (typeof getSenderPickupTime === 'function') pickupAt = getSenderPickupTime() || now;
    } catch (e) { /* fall back to now */ }
    const pickupIso = (pickupAt > now ? pickupAt : now).toISOString();

    let phaseName = null;
    try {
        const phase = (moonData && moonData.phase) || (typeof getMoonPhase === 'function' ? getMoonPhase() : null);
        phaseName = phase && phase.phaseName ? phase.phaseName.toLowerCase() : null;
    } catch (e) { /* phase is optional */ }

    const lunarText = draft && draft.lunar ? (draft.lunar.text || '') : '';
    const lunarClosing = draft && draft.lunar ? (draft.lunar.closing || '') : '';

    const body = {
        sender_id: currentAuthUser.id,
        message_text: (draft && draft.text) || null,
        lunar_note_text: lunarText || null,
        lunar_note_closing: lunarClosing || null,
        moon_phase: phaseName,
        moon_illumination: (moonData && moonData.illumination) || null,
        status: 'in_transit',
        pickup_at: pickupIso,
        shareable: true,
    };

    const { data: fnData, error: fnError } = await sb.functions.invoke('send-message', { body });
    if (fnError) throw fnError;
    if (!fnData || !fnData.message || !fnData.message.share_token) {
        throw new Error((fnData && fnData.error) || 'no_share_token');
    }

    return { link: shareLinkFor(fnData.message.share_token), message: fnData.message };
}

// ---- Share sheet UI ----------------------------------------------------

let _shareSheetLink = '';
let _shareSheetSender = '';

// The line the SENDER hands to their friend (first person — they're the author).
// The recipient-facing "Jacky wrote you a moon message…" framing lives on the
// open page + the link's social preview, not here.
function shareMessageText() {
    return '🌙 I wrote you a moon message. Open it and it’ll reveal when the moon rises over you:';
}

function openShareSheet({ link, senderName, previewText }) {
    _shareSheetLink = link || '';
    _shareSheetSender = senderName || '';

    // Reset the email sub-form each open.
    const ef = document.getElementById('shareSheetEmailForm');
    if (ef) ef.style.display = 'none';
    const em = document.getElementById('shareSheetEmailMsg');
    if (em) em.style.display = 'none';

    const linkField = document.getElementById('shareSheetLink');
    if (linkField) linkField.value = _shareSheetLink;

    const preview = document.getElementById('shareSheetPreview');
    if (preview) {
        const who = (senderName || 'You').trim();
        const teaser = (previewText || '').trim();
        preview.textContent = teaser
            ? `${who} wrote a moon message: “${teaser.length > 90 ? teaser.slice(0, 90).trimEnd() + '…' : teaser}”`
            : `${who} wrote a moon message.`;
    }

    // Native share sheet (mobile) is the headline action when available; on
    // desktop it's hidden and the explicit buttons carry the flow.
    const nativeBtn = document.getElementById('shareSheetNativeBtn');
    if (nativeBtn) nativeBtn.style.display = (navigator && typeof navigator.share === 'function') ? '' : 'none';

    const overlay = document.getElementById('shareSheetOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function closeShareSheet() {
    const overlay = document.getElementById('shareSheetOverlay');
    if (overlay) overlay.style.display = 'none';
}

// Native OS share sheet — opens WhatsApp, Messenger, Messages, Instagram, etc.
async function shareSheetNative() {
    if (!navigator || typeof navigator.share !== 'function') return;
    try {
        await navigator.share({
            title: 'A moon message for you',
            text: shareMessageText(),
            url: _shareSheetLink,
        });
    } catch (e) {
        // User dismissed the sheet or share was cancelled — nothing to do.
    }
}

function shareSheetWhatsApp() {
    const text = `${shareMessageText()} ${_shareSheetLink}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

// Email opens an inline form → we send a branded moon email (Resend) carrying
// the share link, rather than dumping the user into a raw mailto draft.
function shareSheetEmail() {
    const form = document.getElementById('shareSheetEmailForm');
    if (form) form.style.display = form.style.display === 'block' ? 'none' : 'block';
    if (form && form.style.display === 'block') {
        setTimeout(() => document.getElementById('shareSheetEmailInput')?.focus(), 50);
    }
}

async function shareSheetEmailSend() {
    const inp = document.getElementById('shareSheetEmailInput');
    const msg = document.getElementById('shareSheetEmailMsg');
    const btn = document.getElementById('shareSheetEmailSendBtn');
    const email = (inp?.value || '').trim();
    const show = (text, ok) => { if (msg) { msg.textContent = text; msg.style.color = ok ? 'var(--accent)' : '#E89B73'; msg.style.display = 'block'; } };

    if (!email || !email.includes('@')) return show('Enter a valid email.', false);
    if (typeof sb === 'undefined' || typeof currentAuthUser === 'undefined' || !currentAuthUser) {
        return show('Please finish signing in first.', false);
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

    try {
        const { data, error } = await sb.functions.invoke('send-email', {
            body: { type: 'share_link', recipientEmail: email, senderName: _shareSheetSender || 'Someone', revealLink: _shareSheetLink }
        });
        if (error || (data && data.error)) throw (error || new Error(data.error));
        show('Sent ✓ — the moon will carry it to them.', true);
        if (inp) inp.value = '';
        if (btn) btn.style.display = 'none';
    } catch (e) {
        console.error('share email failed:', e);
        show('Could not send — try copying the link instead.', false);
        if (btn) { btn.disabled = false; btn.textContent = 'Send moon email 🌙'; }
    }
}

async function shareSheetCopy() {
    const btn = document.getElementById('shareSheetCopyBtn');
    try {
        await navigator.clipboard.writeText(_shareSheetLink);
    } catch (e) {
        // Fallback for browsers without the async clipboard API.
        const field = document.getElementById('shareSheetLink');
        if (field) { field.select(); try { document.execCommand('copy'); } catch (e2) {} }
    }
    if (btn) {
        const prev = btn.textContent;
        btn.textContent = 'Copied! ✓';
        setTimeout(() => { btn.textContent = prev; }, 1800);
    }
}

function shareSheetDone() {
    closeShareSheet();
    if (typeof showNotificationToast === 'function') {
        showNotificationToast('🌕 Your moon message is ready to share');
    }
}

// ---- In-app composer "Create a shareable link" -------------------------
// Logged-in equivalent of the landing's share-first flow: mint a shareable
// message from the composer's text and open the share sheet. Keeps the
// existing "send to a specific person" path intact alongside it.
async function composeShareLink() {
    if (window.composeIsRoulette) return; // roulette has its own send

    const textMessage = (document.getElementById('messageText')?.value || '').trim();

    // Share links carry a written message for now. A Lunar Note or photo routes
    // through the recipient flow instead (kept simple, avoids half-features).
    if (typeof lunarNoteActive !== 'undefined' && lunarNoteActive) {
        const v1 = (document.getElementById('lunarInput1')?.value || '').trim();
        const v2 = (document.getElementById('lunarInput2')?.value || '').trim();
        const v3 = (document.getElementById('lunarInput3')?.value || '').trim();
        if (v1 || v2 || v3) {
            alert('Share links carry a written message for now — remove the Lunar Note, or use “send to a specific person”.');
            return;
        }
    }
    if (window['_pendingPhotoFile_compose']) {
        alert('Photos can’t go on a share link yet — use “send to a specific person” to include the photo.');
        return;
    }
    if (!textMessage) { alert('Write a message first.'); return; }

    const btn = document.getElementById('composeShareBtn');
    if (btn) btn.disabled = true;

    // Best-effort sender name for the share card + email "from" (recipients
    // always get the real name from the DB regardless).
    let senderName = 'Someone';
    try {
        if (typeof currentAuthUser !== 'undefined' && currentAuthUser) {
            const { data } = await sb.from('profiles').select('username').eq('id', currentAuthUser.id).maybeSingle();
            if (data && data.username) senderName = data.username;
        }
    } catch (e) {}

    try {
        const { link } = await createShareableMessage({ text: textMessage, lunar: null });
        if (typeof closeModal === 'function') closeModal();
        openShareSheet({ link, senderName, previewText: textMessage });
    } catch (e) {
        console.error('composeShareLink failed:', e);
        alert('Could not create a link. Please try again.');
    } finally {
        if (btn) btn.disabled = false;
    }
}
