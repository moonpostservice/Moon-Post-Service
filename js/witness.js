// "Witness the arrival" — the sender's view of their cast moon notes.
//
// A logged-out visitor casts a shareable moon note and taps "Save it to your sky"
// (share-sheet.js), which stashes the note's token and opens signup. Once a
// session exists, flushPendingClaim() binds that orphan note to the new account
// via the claim-sent-message edge function. From then on the sender can watch it
// land: openWitnessPanel() lists every note they've cast and, per note, how many
// people have opened it, how many have read it (revealed at their own moonrise),
// and the places it reached.
//
// Loaded as a plain script (non-module): relies on app globals — sb,
// currentAuthUser, showNotificationToast.

const WITNESS_PENDING_CLAIM_KEY = 'moonpop_pending_claim';
const WITNESS_CLAIM_TTL_MS = 24 * 3600000;

function witnessEsc(val) {
    return String(val == null ? '' : val)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Claim-on-signup ----------------------------------------------------
// Called from initAuth once a real session exists. Reads the stashed token,
// binds the note to the new account, and shows the arrival card. No-ops when
// there's nothing pending. Safe to call on every login — the key is consumed.
async function flushPendingClaim() {
    let raw;
    try { raw = localStorage.getItem(WITNESS_PENDING_CLAIM_KEY); } catch (e) { return; }
    if (!raw) return;
    if (typeof currentAuthUser === 'undefined' || !currentAuthUser) return; // wait for a session

    let pending;
    try { pending = JSON.parse(raw); } catch (e) { try { localStorage.removeItem(WITNESS_PENDING_CLAIM_KEY); } catch (e2) {} return; }

    const age = pending.savedAt ? (Date.now() - pending.savedAt) : Infinity;
    if (!pending.token || age > WITNESS_CLAIM_TTL_MS) {
        try { localStorage.removeItem(WITNESS_PENDING_CLAIM_KEY); } catch (e) {}
        return;
    }

    // Consume up front so a retry/double-init can't double-claim.
    try { localStorage.removeItem(WITNESS_PENDING_CLAIM_KEY); } catch (e) {}

    try {
        const { data, error } = await sb.functions.invoke('claim-sent-message', { body: { token: pending.token } });
        if (error || !data || !data.ok) {
            // The note may have expired at the new moon, or the token was lost — the
            // account still exists, so just fall through quietly.
            console.warn('[witness] claim failed:', error || (data && data.error));
            return;
        }
        openWitnessPanel({ celebrate: true, focusMessageId: data.message_id });
    } catch (e) {
        console.error('[witness] flushPendingClaim error:', e);
    }
}

// ---- The panel ----------------------------------------------------------

function closeWitnessOverlay() {
    const o = document.getElementById('witnessOverlay');
    if (o) o.style.display = 'none';
}

// Render N opener "stars" scattered in a small night sky — a quiet flourish that
// makes the count feel like a constellation rather than a metric. Positions are
// derived from the index so they're stable across refreshes (no jitter).
function witnessConstellation(count) {
    if (!count) return '';
    const w = 260, h = 70, n = Math.min(count, 40);
    let dots = '';
    for (let i = 0; i < n; i++) {
        // Deterministic pseudo-scatter from the index.
        const fx = ((i * 97 + 13) % 100) / 100;
        const fy = ((i * 53 + 29) % 100) / 100;
        const x = 10 + fx * (w - 20);
        const y = 8 + fy * (h - 16);
        const r = 1.4 + ((i * 7) % 3) * 0.5;
        const op = 0.55 + ((i * 11) % 4) * 0.11;
        dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#D4B58A" opacity="${op.toFixed(2)}"/>`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="64" style="display:block;margin:10px 0 2px;" aria-hidden="true">${dots}</svg>`;
}

// Build one note's card: preview, opened/read counts, the places it reached.
function witnessNoteCard(note, opens) {
    const preview = (note.message_text || note.lunar_note_text || '').trim();
    const teaser = preview ? (preview.length > 70 ? preview.slice(0, 70).trimEnd() + '…' : preview) : 'Your moon note';

    const opened = opens.length;
    const read = opens.filter(o => o.revealed_at).length;

    // Unique places, "somewhere" for openers we couldn't locate. Cap the visible
    // list so a popular link stays readable.
    const cities = [];
    const seen = new Set();
    let unknown = 0;
    for (const o of opens) {
        const c = (o.recipient_city || '').trim();
        if (!c) { unknown++; continue; }
        if (seen.has(c.toLowerCase())) continue;
        seen.add(c.toLowerCase());
        cities.push(c);
    }
    let placeLine = '';
    if (cities.length) {
        const shown = cities.slice(0, 5).map(witnessEsc).join(' · ');
        const extra = cities.length > 5 ? ` +${cities.length - 5} more` : '';
        placeLine = `from ${shown}${extra}` + (unknown ? ' · and somewhere' : '');
    } else if (unknown) {
        placeLine = 'from somewhere under the moon';
    }

    let status;
    if (opened === 0) {
        status = `<p style="color:var(--muter);font-size:12.5px;font-style:italic;margin:6px 0 0;">No one's opened it yet — we'll tell you when the moon delivers it.</p>`;
    } else {
        const openedTxt = `${opened} ${opened === 1 ? 'person has' : 'people have'} opened it`;
        const readTxt = read > 0
            ? ` · <span style="color:var(--accent);">${read} read</span> it under the moon`
            : ` · waiting for ${opened === 1 ? 'their' : 'their'} moonrise to read`;
        status = `${witnessConstellation(opened)}
            <p style="color:var(--text-bright);font-size:13.5px;margin:4px 0 2px;">${openedTxt}${readTxt}</p>
            ${placeLine ? `<p style="color:var(--muted);font-size:12.5px;margin:0;">${witnessEsc(placeLine)}</p>` : ''}`;
    }

    return `<div style="padding:14px 0;border-top:1px solid var(--line-soft);">
        <p style="color:var(--muted);font-size:13px;font-style:italic;margin:0 0 2px;">“${witnessEsc(teaser)}”</p>
        ${status}
    </div>`;
}

// Load and render every note the signed-in user has cast. `celebrate` shows the
// post-signup header; `focusMessageId` (optional) floats that note to the top.
async function openWitnessPanel(opts) {
    opts = opts || {};
    const overlay = document.getElementById('witnessOverlay');
    const list = document.getElementById('witnessList');
    const title = document.getElementById('witnessTitle');
    const subtitle = document.getElementById('witnessSubtitle');
    if (!overlay || !list) return;

    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);

    if (opts.celebrate) {
        if (title) title.textContent = 'Saved to your sky.';
        if (subtitle) subtitle.textContent = "We'll tell you at moonrise when someone opens it — and when they read it.";
    } else {
        if (title) title.textContent = 'Your sky-bound notes';
        if (subtitle) subtitle.textContent = 'The moon notes you’ve cast — and where they’ve landed.';
    }

    list.innerHTML = `<p style="color:var(--muter);font-size:13px;text-align:center;padding:18px 0;">Looking up your sky…</p>`;
    overlay.style.display = 'flex';

    if (typeof sb === 'undefined' || typeof currentAuthUser === 'undefined' || !currentAuthUser) {
        list.innerHTML = `<p style="color:var(--muter);font-size:13px;text-align:center;padding:18px 0;">Sign in to watch your notes land.</p>`;
        return;
    }

    try {
        // messages_v restricts rows to the signed-in sender and unseals their own
        // content; shareable + a non-null share_token marks a cast link.
        const { data: notes, error: notesErr } = await sb
            .from('messages_v')
            .select('id, message_text, lunar_note_text, created_at, share_token, shareable')
            .eq('shareable', true)
            .not('share_token', 'is', null)
            .order('created_at', { ascending: false });
        if (notesErr) throw notesErr;

        if (!notes || notes.length === 0) {
            list.innerHTML = `<p style="color:var(--muter);font-size:13px;text-align:center;padding:18px 0;line-height:1.6;">You haven’t cast any moon links yet.<br>Write one from your inbox and share it — then watch it land here.</p>`;
            return;
        }

        const ids = notes.map(n => n.id);
        const { data: opens } = await sb
            .from('message_link_opens')
            .select('message_id, recipient_city, revealed_at, created_at')
            .in('message_id', ids);

        const byMsg = {};
        (opens || []).forEach(o => { (byMsg[o.message_id] = byMsg[o.message_id] || []).push(o); });

        let ordered = notes;
        if (opts.focusMessageId) {
            ordered = notes.slice().sort((a, b) =>
                (a.id === opts.focusMessageId ? -1 : 0) - (b.id === opts.focusMessageId ? -1 : 0));
        }

        list.innerHTML = ordered.map(n => witnessNoteCard(n, byMsg[n.id] || [])).join('');
    } catch (e) {
        console.error('[witness] openWitnessPanel load failed:', e);
        list.innerHTML = `<p style="color:var(--muter);font-size:13px;text-align:center;padding:18px 0;">Couldn’t reach your sky just now — try again in a moment.</p>`;
    }
}
