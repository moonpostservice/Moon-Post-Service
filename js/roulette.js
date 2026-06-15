// Moon Roulette — Anonymous random message feature
// Send a message to a system-picked stranger. Only your city is visible to them.
// They can reveal themselves, decline, or block. If declined, the message returns to you.

// ============================================
// STATE
// ============================================
let rouletteMessages = { sent: [], received: [] };
let rouletteActiveTab = 'sent'; // 'sent' | 'received'
let _rouletteRealtimeChannels = [];
// Track messages where the current user has tapped reveal (persists until mutual or page reload)
const _myRevealedMessages = new Set();

// ---- Client-side read receipt cache (localStorage) ----
// Used as source of truth for the unread badge because the DB update
// can be silently blocked by RLS in certain Supabase client configurations.
function _getLocallyReadIds() {
    try { return new Set(JSON.parse(localStorage.getItem('moonpop_roulette_read') || '[]')); }
    catch { return new Set(); }
}
function _addLocallyReadIds(ids) {
    try {
        const s = _getLocallyReadIds();
        ids.forEach(id => s.add(id));
        const arr = [...s];
        // Keep only the last 500 to prevent unbounded growth
        localStorage.setItem('moonpop_roulette_read', JSON.stringify(arr.slice(-500)));
    } catch {}
}
// Track the message currently open in the detail panel (for menu actions)
let _currentRouletteMsg  = null;
let _currentRouletteRole = null;

// ============================================
// DB HELPERS
// ============================================

async function loadRouletteMessages() {
    if (!currentAuthUser) return;
    try {
        const [sentRes, receivedRes, revealsRes] = await Promise.all([
            // Sent: query the raw table — sender_id RLS policy applies.
            // Exclude graduated threads: once a thread is mutually revealed it is
            // mirrored into the normal messages system and must no longer appear as
            // a separate roulette inbox row (the conversation lives in one chatbox).
            sb.from('moon_roulette_messages')
                .select('id, sender_city, recipient_id, recipient_city, status, release_at, released_at, moon_phase, moon_illumination, message_text, photo_url, song_url, song_title, parent_id, send_attempt, recipient_read_at, created_at, updated_at')
                .eq('sender_id', currentAuthUser.id)
                .is('sender_deleted_at', null)
                .is('graduated_at', null)
                .order('created_at', { ascending: false }),

            // Received: use the anonymity view — hides sender_id pre-reveal
            sb.from('roulette_recipient_view')
                .select('*')
                .order('created_at', { ascending: false }),

            // My reveal intents — so the button shows "Waiting for them…" after a page refresh
            sb.from('moon_roulette_reveals')
                .select('roulette_message_id')
                .eq('user_id', currentAuthUser.id),
        ]);

        if (sentRes.error) console.error('[roulette] sent fetch error:', sentRes.error);
        if (receivedRes.error) console.error('[roulette] received fetch error:', receivedRes.error);

        rouletteMessages.sent     = sentRes.data     ?? [];
        rouletteMessages.received = receivedRes.data ?? [];

        // Re-hydrate the reveal Set so the button state survives page refresh
        if (revealsRes.data) {
            revealsRes.data.forEach(r => _myRevealedMessages.add(r.roulette_message_id));
        }
    } catch (err) {
        console.error('[roulette] loadRouletteMessages exception:', err);
    }
    _updateRouletteTabBadge();
    // Re-render the inbox so roulette rows appear (load is not awaited in debouncedReloadMessages)
    if (typeof renderMessages === 'function') renderMessages();
    if (typeof renderMessageDots === 'function') renderMessageDots();
}

function _updateRouletteTabBadge() {
    // Roulette messages are integrated into the main inbox — no separate tab badge needed.
}

// ============================================
// OPEN / CLOSE PAGE
// ============================================

async function openRoulettePage(fromPopstate = false) {
    // Roulette is now integrated into the main inbox — redirect to home.
    if (!fromPopstate) {
        history.replaceState({}, '', '/');
    } else if (window.location.pathname === '/roulette') {
        history.replaceState({}, '', '/');
    }
    await loadRouletteMessages();
    if (typeof renderMessages === 'function') renderMessages();
}

function closeRoulettePage() {
    // No-op — roulette page no longer exists as a separate overlay.
}

// ============================================
// REALTIME SUBSCRIPTIONS
// ============================================

function subscribeRouletteRealtime() {
    _cleanupRouletteRealtime();
    if (!currentAuthUser) return;

    const uid = currentAuthUser.id;

    // Two channels: one for sent (sender_id), one for received (recipient_id)
    const sentChannel = sb.channel('roulette-sent-' + uid)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'moon_roulette_messages',
            filter: `sender_id=eq.${uid}`,
        }, _onRouletteChange)
        .subscribe();

    const receivedChannel = sb.channel('roulette-received-' + uid)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'moon_roulette_messages',
            filter: `recipient_id=eq.${uid}`,
        }, _onRouletteChange)
        .subscribe();

    _rouletteRealtimeChannels.push(sentChannel, receivedChannel);
}

function _cleanupRouletteRealtime() {
    _rouletteRealtimeChannels.forEach(ch => {
        try { sb.removeChannel(ch); } catch (e) { /* ignore */ }
    });
    _rouletteRealtimeChannels = [];
}

async function _onRouletteChange(payload) {
    console.log('[roulette] realtime event:', payload.eventType, payload.new?.status);
    await loadRouletteMessages();
    if (typeof renderMessageDots === 'function') renderMessageDots();

    // If this was a mutual reveal completing, play a soft sound
    if (payload.new?.status === 'revealed' && payload.old?.status !== 'revealed') {
        playMessageSound();
        showNotificationToast('✨ A moon roulette connection revealed themselves');
        // If the detail panel is open for this message, refresh it so the real name appears
        if (_currentRouletteMsg?.id === payload.new?.id && _currentRouletteRole) {
            const msgs = _currentRouletteRole === 'sender' ? rouletteMessages.sent : rouletteMessages.received;
            const updated = msgs.find(m => m.id === payload.new.id);
            if (updated) openRouletteDetail(updated.id, _currentRouletteRole);
        }
    }

    // If a sent message just came back as declined
    if (payload.new?.status === 'declined' && payload.new?.sender_id === currentAuthUser?.id) {
        showNotificationToast('🌙 Your Moon Roulette message found its way back to you');
    }

    // If we received a new roulette message (delivered)
    if (payload.new?.status === 'delivered' && payload.new?.recipient_id === currentAuthUser?.id) {
        playMessageSound();
        showNotificationToast('🌕 A mystery moon message has arrived');
    }

    // Re-render the unified inbox so roulette rows update inline.
    if (typeof renderMessages === 'function') renderMessages();
}

// ============================================
// RENDER — INBOX
// ============================================

function renderRouletteInbox() {
    const page = document.getElementById('roulettePage');
    if (!page) return;

    const sent     = rouletteMessages.sent;
    const received = rouletteMessages.received;

    page.innerHTML = `
        <div class="roulette-page-inner">
            <div class="roulette-header">
                <button class="roulette-close-btn" onclick="closeRoulettePage()" aria-label="Close">
                    ${iconSvg('close', 'sm')}
                </button>
                <div class="roulette-title-wrap">
                    <h2 class="roulette-title">Moon Roulette</h2>
                    <p class="roulette-subtitle">Send a message to a stranger. Only the moon knows who.</p>
                </div>
                <button class="roulette-compose-btn btn-primary" onclick="openRouletteCompose()">
                    ${iconSvg('compose', 'sm')} Send a Roulette
                </button>
            </div>

            <div class="roulette-tabs" role="tablist">
                <button
                    class="roulette-tab ${rouletteActiveTab === 'sent' ? 'active' : ''}"
                    role="tab"
                    aria-selected="${rouletteActiveTab === 'sent'}"
                    onclick="setRouletteTab('sent')">
                    Sent <span class="roulette-tab-count">${sent.length}</span>
                </button>
                <button
                    class="roulette-tab ${rouletteActiveTab === 'received' ? 'active' : ''}"
                    role="tab"
                    aria-selected="${rouletteActiveTab === 'received'}"
                    onclick="setRouletteTab('received')">
                    Received <span class="roulette-tab-count">${received.length}</span>
                </button>
            </div>

            <div class="roulette-list" id="rouletteList">
                ${_renderRouletteList()}
            </div>
        </div>
    `;
}

function setRouletteTab(tab) {
    rouletteActiveTab = tab;
    // Only re-render the list, not the full page (preserves header/tabs)
    const list = document.getElementById('rouletteList');
    if (list) list.innerHTML = _renderRouletteList();
    // Update tab active state
    document.querySelectorAll('.roulette-tab').forEach(btn => {
        const isActive = btn.textContent.trim().startsWith(tab === 'sent' ? 'Sent' : 'Received');
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive);
    });
}

function _renderRouletteList() {
    const items = rouletteActiveTab === 'sent'
        ? rouletteMessages.sent
        : rouletteMessages.received;

    if (items.length === 0) {
        return `<div class="roulette-empty">
            <p>${rouletteActiveTab === 'sent'
                ? 'You haven\'t sent any moon roulette messages yet.'
                : 'No mystery messages have arrived yet.'}</p>
        </div>`;
    }

    return items.map(msg =>
        renderRouletteCard(msg, rouletteActiveTab === 'sent' ? 'sender' : 'recipient')
    ).join('');
}

// ============================================
// RENDER — CARD
// ============================================

function renderRouletteCard(msg, role) {
    const statusLabel = _rouletteStatusLabel(msg.status, role);
    const statusClass = _rouletteStatusClass(msg.status);

    const moonIcon = phaseIconSvg(msg.moon_phase || 'full moon', 'lg');

    const preview = msg.message_text
        ? msg.message_text.slice(0, 120) + (msg.message_text.length > 120 ? '…' : '')
        : msg.photo_url ? '📷 Photo' : '';

    const releaseInfo = msg.release_at && msg.status === 'queued'
        ? `<span class="roulette-release-time">Arriving ${_relativeTime(msg.release_at)}</span>`
        : '';

    if (role === 'sender') {
        return _renderSenderCard(msg, { statusLabel, statusClass, moonIcon, preview, releaseInfo });
    } else {
        return _renderRecipientCard(msg, { statusLabel, statusClass, moonIcon, preview, releaseInfo });
    }
}

function _renderSenderCard(msg, { statusLabel, statusClass, moonIcon, preview, releaseInfo }) {
    const isReturned   = msg.status === 'declined';
    const isRevealed   = msg.status === 'revealed';
    const isRelaunched = msg.status === 're-launched';

    const actions = isReturned ? `
        <div class="roulette-card-actions">
            <button class="roulette-btn roulette-btn-primary" onclick="handleRelaunch('${msg.id}')">
                Re-launch
            </button>
            <button class="roulette-btn roulette-btn-ghost" onclick="handleSenderDelete('${msg.id}')">
                Delete
            </button>
        </div>
    ` : '';

    // Reveal button for sender once message is delivered
    const revealBtn = (msg.status === 'delivered' || msg.status === 'revealed') ? `
        <button class="roulette-reveal-btn ${isRevealed ? 'revealed' : ''}"
                onclick="handleReveal('${msg.id}')"
                ${isRevealed ? 'disabled' : ''}>
            ${isRevealed ? '✨ Revealed' : 'Reveal yourself?'}
        </button>
    ` : '';

    return `
        <div class="roulette-card roulette-card--sender roulette-card--${msg.status}" data-id="${msg.id}">
            <div class="roulette-card-moon">${moonIcon}</div>
            <div class="roulette-card-body">
                <div class="roulette-card-meta">
                    <span class="roulette-tag">Moon Roulette</span>
                    <span class="roulette-status ${statusClass}">${statusLabel}</span>
                    ${releaseInfo}
                </div>
                ${msg.status === 'delivered' || msg.status === 'revealed' || msg.status === 'declined'
                    ? `<p class="roulette-destination">To someone in <strong>${msg.recipient_city ?? 'the world'}</strong></p>`
                    : ''}
                ${preview ? `<p class="roulette-preview">${_escHtml(preview)}</p>` : ''}
                ${isRelaunched ? `<p class="roulette-attempt">Attempt ${msg.send_attempt}</p>` : ''}
                ${revealBtn}
                ${actions}
            </div>
            <div class="roulette-card-time">${_relativeTime(msg.created_at)}</div>
        </div>
    `;
}

function _renderRecipientCard(msg, { statusLabel, statusClass, moonIcon, preview, releaseInfo }) {
    const isRevealed = msg.status === 'revealed';

    // Pre-reveal: show moon icon + city only
    // Post-reveal: sender_id is exposed via the view — we'd fetch their profile
    const senderDisplay = isRevealed && msg.sender_id
        ? `<span class="roulette-revealed-sender" data-sender-id="${msg.sender_id}">Loading…</span>`
        : `<span class="roulette-anon-sender">From somewhere in <strong>${_escHtml(msg.sender_city ?? 'the world')}</strong></span>`;

    const revealBtn = !isRevealed ? `
        <button class="roulette-reveal-btn" onclick="handleReveal('${msg.id}')">
            Reveal yourself?
        </button>
    ` : `
        <span class="roulette-reveal-complete">✨ You're connected</span>
    `;

    const actions = !isRevealed ? `
        <div class="roulette-card-actions">
            <button class="roulette-btn roulette-btn-ghost" onclick="handleDecline('${msg.id}')">
                Decline
            </button>
            <button class="roulette-btn roulette-btn-danger" onclick="handleBlock('${msg.id}')">
                Block
            </button>
        </div>
    ` : '';

    return `
        <div class="roulette-card roulette-card--recipient roulette-card--${msg.status}" data-id="${msg.id}">
            <div class="roulette-card-moon">${moonIcon}</div>
            <div class="roulette-card-body">
                <div class="roulette-card-meta">
                    <span class="roulette-tag">Moon Roulette</span>
                    <span class="roulette-status ${statusClass}">${statusLabel}</span>
                </div>
                ${senderDisplay}
                ${preview ? `<p class="roulette-preview">${_escHtml(preview)}</p>` : ''}
                ${msg.photo_url ? `<img class="roulette-photo" data-photo-path="${msg.photo_url}" alt="Photo" loading="lazy" />` : ''}
                <div class="roulette-card-footer">
                    ${revealBtn}
                    ${actions}
                    <button class="roulette-optout-link" onclick="handleRouletteOptOut()">
                        Stop receiving these
                    </button>
                </div>
            </div>
            <div class="roulette-card-time">${_relativeTime(msg.created_at)}</div>
        </div>
    `;
}

// After render, resolve any revealed sender names from profiles
async function _resolveRevealedSenders() {
    const pending = document.querySelectorAll('.roulette-revealed-sender[data-sender-id]');
    if (!pending.length) return;

    const ids = Array.from(pending).map(el => el.dataset.senderId);
    const { data: profiles } = await sb.from('public_profiles')
        .select('id, username, first_name, last_name, city, avatar_url')
        .in('id', ids);

    if (!profiles) return;
    const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));

    pending.forEach(el => {
        const p = profileMap[el.dataset.senderId];
        if (!p) return;
        const name = p.username || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Someone';
        el.innerHTML = `
            ${p.avatar_url ? `<img class="roulette-revealed-avatar" src="${p.avatar_url}" alt="${_escHtml(name)}" />` : iconSvg('contacts', 'sm')}
            <span>${_escHtml(name)}</span>
            <span class="roulette-revealed-city">${_escHtml(p.city ?? '')}</span>
        `;
    });
}

// Fetch one profile and update the detail panel header with the real name + avatar
async function _resolveRevealedHeader(otherId) {
    if (!otherId) return;
    const { data: p } = await sb.from('public_profiles')
        .select('id, username, first_name, last_name, avatar_url')
        .eq('id', otherId)
        .single();
    if (!p) return;

    const name = p.username || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Someone';

    // Avatar — swap moon icon for real photo or initial
    const avatarEl = document.getElementById('rouletteDetailAvatar');
    if (avatarEl) {
        if (p.avatar_url) {
            avatarEl.innerHTML = `<img src="${_escHtml(p.avatar_url)}" alt="${_escHtml(name)}"
                style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />`;
        } else {
            avatarEl.textContent = name.charAt(0).toUpperCase();
            avatarEl.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;color:var(--accent);';
        }
    }

    // Title — real name instead of "…"
    const titleEl = document.getElementById('rouletteDetailTitle');
    if (titleEl) titleEl.textContent = name;
}

// ============================================
// COMPOSE
// ============================================

let _rouletteIntroPending = null;

function openRouletteCompose(parentId = null, prefill = {}) {
    if (parentId || localStorage.getItem('moonpop_roulette_intro_seen')) {
        _doOpenRouletteCompose(parentId, prefill);
        return;
    }
    // First-time use — show intro modal, then open compose on accept
    _rouletteIntroPending = { parentId, prefill };
    const modal = document.getElementById('rouletteIntroModal');
    modal.style.display = 'flex';
}

// Inbox-nav entry point: gate on Terms once, then open the FAMILIAR composer
// (the same UI as a regular moon message), not the standalone roulette modal.
function openRouletteFromInbox() {
    if (localStorage.getItem('moonpop_roulette_intro_seen')) {
        openComposeForRoulette();
        return;
    }
    _rouletteIntroPending = { familiar: true };
    document.getElementById('rouletteIntroModal').style.display = 'flex';
}

function acceptRouletteIntro() {
    localStorage.setItem('moonpop_roulette_intro_seen', 'true');
    document.getElementById('rouletteIntroModal').style.display = 'none';
    if (_rouletteIntroPending) {
        const pending = _rouletteIntroPending;
        _rouletteIntroPending = null;
        if (pending.familiar) {
            // Familiar composer (regular moon-message UI in roulette mode)
            openComposeForRoulette();
        } else {
            _doOpenRouletteCompose(pending.parentId, pending.prefill);
        }
    }
}

function _doOpenRouletteCompose(parentId = null, prefill = {}) {
    const existing = document.getElementById('rouletteComposeModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'rouletteComposeModal';
    modal.className = 'roulette-compose-modal';
    modal.innerHTML = `
        <div class="roulette-compose-inner">
            <div class="roulette-compose-header">
                <h3>${parentId ? 'Re-launch your message' : 'Send a Moon Roulette'}</h3>
                <button class="roulette-close-btn" onclick="closeRouletteCompose()" aria-label="Close">
                    ${iconSvg('close', 'sm')}
                </button>
            </div>
            <p class="roulette-compose-hint">
                ${parentId
                    ? 'Edit your message (optional) and send it to a new stranger.'
                    : 'Write a message. The moon will carry it to a stranger.'}
            </p>
            <textarea
                id="rouletteComposeText"
                class="roulette-compose-textarea"
                placeholder="Write something to a stranger…"
                maxlength="1000"
                rows="6"
            >${_escHtml(prefill.message_text ?? '')}</textarea>
            <div class="roulette-compose-footer">
                <span class="roulette-char-count" id="rouletteCharCount">0 / 1000</span>
                <button class="btn-primary roulette-send-btn" id="rouletteSendBtn"
                        onclick="handleSendRoulette('${parentId ?? ''}')">
                    ${parentId ? 'Re-launch' : 'Send into the moon'}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));

    const textarea = document.getElementById('rouletteComposeText');
    const counter  = document.getElementById('rouletteCharCount');
    if (textarea && counter) {
        const update = () => { counter.textContent = `${textarea.value.length} / 1000`; };
        textarea.addEventListener('input', update);
        update();
        textarea.focus();
    }
}

function closeRouletteCompose() {
    const modal = document.getElementById('rouletteComposeModal');
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 300);
}

// ============================================
// ACTIONS
// ============================================

async function handleSendRoulette(parentId = '') {
    const textarea = document.getElementById('rouletteComposeText');
    const sendBtn  = document.getElementById('rouletteSendBtn');
    if (!textarea || !sendBtn) return;

    const messageText = textarea.value.trim();
    if (!messageText) {
        showNotificationToast('Write something before sending.');
        textarea.focus();
        return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';

    try {
        const body = { message_text: messageText };
        if (parentId) body.parent_id = parentId;

        const { data, error } = await sb.functions.invoke('send-roulette-message', { body });

        if (error) throw error;

        closeRouletteCompose();
        await loadRouletteMessages();
        if (typeof renderMessages === 'function') renderMessages();
        showNotificationToast('🌕 Your message is on its way to a stranger');
        console.log('[roulette] sent:', data?.message?.id, '| release_at:', data?.message?.release_at);
    } catch (err) {
        console.error('[roulette] send error:', err);
        const msg = err?.message?.includes('no_eligible_recipients')
            ? 'No new recipients available right now. Try again after the next moon.'
            : 'Something went wrong. Please try again.';
        showNotificationToast(msg);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send into the moon';
    }
}

async function handleSendRouletteFromCompose() {
    const sendBtn = document.getElementById('composeMainBtn');

    // Open note (the plain textarea)
    const textMessage = document.getElementById('messageText')?.value.trim() || '';

    // Lunar note — mirrors handleComposeSend(): fold it into the message body
    // so a roulette message behaves exactly like a normal moon message,
    // just anonymous. The recipient never knows which mode the sender chose.
    let lunarNoteText = '';
    let lunarClosing = '';
    if (lunarNoteActive) {
        const v1 = document.getElementById('lunarInput1')?.value.trim() || '';
        const v2 = document.getElementById('lunarInput2')?.value.trim() || '';
        const v3 = document.getElementById('lunarInput3')?.value.trim() || '';
        const card = document.getElementById('lunarResultCard');
        const revealed = card && card.style.display !== 'none';

        // The "Go Lunar" wizard only generates the note when the user taps
        // "Reveal 🌙". If they filled all three answers but went straight to
        // Send, reveal it for them so hitting Send just works.
        if (!revealed && v1 && v2 && v3) {
            revealLunarNote();
        } else if (!revealed && (v1 || v2 || v3)) {
            // Half-finished Lunar Note — guide them instead of failing with
            // the confusing "write a message to a stranger first".
            showNotificationToast('Finish your Lunar Note before sending.');
            return;
        }

        if (card && card.style.display !== 'none') {
            lunarNoteText = document.getElementById('lunarResultText')?.textContent || '';
            lunarClosing = document.getElementById('lunarResultClosing')?.textContent || '';
        }
    }

    let messageText = '';
    if (textMessage) messageText += textMessage;
    if (lunarNoteText) {
        if (messageText) messageText += '\n\n';
        messageText += '🌙 Lunar Note\n' + lunarNoteText;
        if (lunarClosing) messageText += '\n' + lunarClosing;
    }

    if (!messageText) {
        showNotificationToast('Write a message to a stranger first.');
        return;
    }
    const origHTML = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
        const { data, error } = await sb.functions.invoke('send-roulette-message', { body: { message_text: messageText } });
        if (error) throw error;
        closeModal();
        await loadRouletteMessages();
        if (typeof renderMessageDots === 'function') renderMessageDots();
        if (typeof renderMessages === 'function') renderMessages();
        showNotificationToast('🌕 Your message is on its way to a stranger');
        console.log('[roulette] sent from compose:', data?.message?.id);
    } catch (err) {
        console.error('[roulette] send error:', err);
        let errorCode = '';
        try { const body = await err.context?.json(); errorCode = body?.error ?? ''; } catch {}
        const msg = errorCode === 'no_eligible_recipients'
            ? 'No new recipients available right now. Try again after the next moon.'
            : 'Something went wrong. Please try again.';
        showNotificationToast(msg);
        sendBtn.disabled = false;
        sendBtn.innerHTML = origHTML;
    }
}

function switchInboxTab(_tab) {
    // Roulette is now integrated into the main inbox — no tab switching needed.
}

function renderRouletteTab() {
    const container = document.getElementById('rouletteTabContent');
    if (!container) return;
    const sent = rouletteMessages.sent;
    const received = rouletteMessages.received;
    container.innerHTML = `
        <div class="roulette-tabs" role="tablist" style="border-bottom:1px solid rgba(212,181,138,0.12);padding:0 16px;">
            <button class="roulette-tab ${rouletteActiveTab === 'sent' ? 'active' : ''}" role="tab"
                onclick="setRouletteTab('sent')">
                SENT <span class="roulette-tab-count">${sent.length}</span>
            </button>
            <button class="roulette-tab ${rouletteActiveTab === 'received' ? 'active' : ''}" role="tab"
                onclick="setRouletteTab('received')">
                RECEIVED <span class="roulette-tab-count">${received.length}</span>
            </button>
        </div>
        <div class="roulette-list" id="rouletteList">
            ${_renderRouletteList()}
        </div>
    `;
}

async function handleDecline(messageId) {
    await _returnMessage(messageId, 'decline');
}

async function handleBlock(messageId) {
    const confirmed = confirm('Block this sender? You will not receive any more Moon Roulette messages from them.');
    if (!confirmed) return;
    await _returnMessage(messageId, 'block');
}

async function _returnMessage(messageId, action) {
    const card = document.querySelector(`.roulette-card[data-id="${messageId}"]`);
    if (card) card.style.opacity = '0.5';

    try {
        const { error } = await sb.functions.invoke('return-roulette-message', {
            body: { message_id: messageId, action }
        });

        if (error) throw error;

        closeRouletteDetail();
        await loadRouletteMessages();
        if (typeof renderMessages === 'function') renderMessages();
    } catch (err) {
        console.error('[roulette] return error:', err);
        if (card) card.style.opacity = '1';
        showNotificationToast('Something went wrong. Please try again.');
    }
}

async function handleReveal(messageId) {
    // Disable reveal button immediately to prevent double-tap
    const revealBtns = document.querySelectorAll(`[data-reveal-id="${messageId}"]`);
    revealBtns.forEach(b => { b.disabled = true; b.textContent = 'Revealing…'; });

    try {
        const { data, error } = await sb.functions.invoke('reveal-roulette-identity', {
            body: { message_id: messageId }
        });

        if (error) throw error;

        if (data.mutual_reveal_complete) {
            playMessageSound();
            showNotificationToast('✨ You\'re connected — identities revealed!');
            _myRevealedMessages.delete(messageId);
            await loadRouletteMessages();
            if (typeof renderMessages === 'function') renderMessages();
            // Refresh the open detail panel so the real name/avatar appears immediately
            const role = _currentRouletteRole;
            const msgs = role === 'sender' ? rouletteMessages.sent : rouletteMessages.received;
            const updated = msgs.find(m => m.id === messageId);
            if (updated && _currentRouletteMsg?.id === messageId) {
                openRouletteDetail(messageId, role);
            }
        } else {
            // Mark that I've revealed — footer will render "Waiting for them…" state
            _myRevealedMessages.add(messageId);
            showNotificationToast('🌙 Your reveal is registered. Waiting for the other person…');
            // Refresh just the detail footer to reflect the new state
            const msg = rouletteMessages.received.find(m => m.id === messageId)
                     || rouletteMessages.sent.find(m => m.id === messageId);
            const role = rouletteMessages.received.find(m => m.id === messageId) ? 'recipient' : 'sender';
            const footer = document.getElementById('rouletteDetailFooter');
            if (footer && msg) footer.innerHTML = _renderRouletteDetailFooter(msg, role);
        }
    } catch (err) {
        console.error('[roulette] reveal error:', err);
        _myRevealedMessages.delete(messageId);
        revealBtns.forEach(b => { b.disabled = false; b.textContent = 'Reveal yourself?'; });
        showNotificationToast('Something went wrong. Please try again.');
    }
}

async function handleRelaunch(messageId) {
    // Find the returned message to pre-fill the compose
    const msg = rouletteMessages.sent.find(m => m.id === messageId);
    if (!msg) return;
    openRouletteCompose(messageId, { message_text: msg.message_text ?? '' });
}

async function handleSenderDelete(messageId) {
    if (!confirm('Delete this message from your Moon Roulette?')) return;

    try {
        const { error } = await sb.from('moon_roulette_messages')
            .update({ sender_deleted_at: new Date().toISOString() })
            .eq('id', messageId)
            .eq('sender_id', currentAuthUser.id);

        if (error) throw error;

        rouletteMessages.sent = rouletteMessages.sent.filter(m => m.id !== messageId);
        closeRouletteDetail();
        if (typeof renderMessages === 'function') renderMessages();
    } catch (err) {
        console.error('[roulette] delete error:', err);
        showNotificationToast('Something went wrong. Please try again.');
    }
}

async function handleSenderPass(messageId) {
    if (!confirm('Pass on this conversation? The message stays delivered to the other person, but it will be removed from your sent roulette.')) return;
    await handleSenderDelete(messageId);
}

// ============================================
// OPT-OUT
// ============================================

async function handleRouletteOptOut() {
    const confirmed = confirm('Turn off Moon Roulette messages? You can re-enable this in Settings at any time.');
    if (!confirmed) return;

    try {
        const { error } = await sb.from('profiles')
            .update({ receive_moon_roulette: false })
            .eq('id', currentAuthUser.id);

        if (error) throw error;
        showNotificationToast('Moon Roulette messages turned off. Change this anytime in Settings.');
    } catch (err) {
        console.error('[roulette] opt-out error:', err);
        showNotificationToast('Something went wrong. Please try again.');
    }
}

async function handleRouletteOptIn() {
    try {
        const { error } = await sb.from('profiles')
            .update({ receive_moon_roulette: true })
            .eq('id', currentAuthUser.id);

        if (error) throw error;
        showNotificationToast('Moon Roulette messages turned on. Strangers can now reach you.');
    } catch (err) {
        console.error('[roulette] opt-in error:', err);
        showNotificationToast('Something went wrong. Please try again.');
    }
}

// ============================================
// UTILITIES
// ============================================

function _rouletteStatusLabel(status, role) {
    const labels = {
        queued:       'On its way…',
        delivered:    role === 'sender' ? 'Awaiting response' : 'New',
        declined:     role === 'sender' ? 'Returned'         : 'Declined',
        blocked:      role === 'sender' ? 'Returned'         : 'Blocked',
        're-launched':'Re-launched',
        revealed:     'Revealed ✨',
    };
    return labels[status] ?? status;
}

function _rouletteStatusClass(status) {
    const classes = {
        queued:       'status-transit',
        delivered:    'status-delivered',
        declined:     'status-returned',
        blocked:      'status-returned',
        're-launched':'status-relaunched',
        revealed:     'status-revealed',
    };
    return classes[status] ?? '';
}

function _relativeTime(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7)   return `${days}d ago`;
    return new Date(isoStr).toLocaleDateString();
}

function _escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// INBOX INTEGRATION — rows for the unified inbox
// ============================================

function getRouletteInboxItems() {
    const items = [];

    // Build a combined map of every loaded message, tagged with the viewer's role.
    const all = new Map(); // id -> { m, role }
    rouletteMessages.sent.forEach(m => all.set(m.id, { m, role: 'sender' }));
    rouletteMessages.received.forEach(m => { if (!all.has(m.id)) all.set(m.id, { m, role: 'recipient' }); });

    const byId = (id) => all.get(id)?.m;
    const rootIdOf = (m) => {
        let r = m;
        const guard = new Set();
        while (r.parent_id && byId(r.parent_id) && !guard.has(r.id)) { guard.add(r.id); r = byId(r.parent_id); }
        return r.id;
    };

    // Group all messages into threads keyed by their root message id.
    const threads = new Map(); // rootId -> [{ m, role }]
    for (const entry of all.values()) {
        const rid = rootIdOf(entry.m);
        if (!threads.has(rid)) threads.set(rid, []);
        threads.get(rid).push(entry);
    }

    for (const [rootId, entries] of threads) {
        entries.sort((a, b) => new Date(a.m.created_at) - new Date(b.m.created_at));
        const rootEntry = all.get(rootId) || entries[0];
        const root = rootEntry.m;
        const latest = entries[entries.length - 1];
        const lm = latest.m;

        const moonIcon = phaseIconSvg(lm.moon_phase || root.moon_phase || 'full moon', 'sm');

        // Who the conversation is with — anchored to whoever started the thread.
        const revealedRecv = entries.find(e => e.role === 'recipient' && e.m.status === 'revealed' && e.m.sender_id);
        let nameDisplay;
        if (revealedRecv) {
            nameDisplay = `<span class="roulette-revealed-sender" data-sender-id="${revealedRecv.m.sender_id}">Someone</span>`;
        } else if (rootEntry.role === 'recipient') {
            nameDisplay = `From ${_escHtml(root.sender_city ?? 'somewhere')}`;
        } else {
            nameDisplay = root.status === 'queued'
                ? 'Awaiting the moon…'
                : `To someone in ${_escHtml(root.recipient_city ?? 'the world')}`;
        }

        const preview = lm.message_text
            ? _escHtml(lm.message_text.slice(0, 80) + (lm.message_text.length > 80 ? '…' : ''))
            : lm.photo_url ? '📷 Photo' : '';

        // Unread if any received message in the thread is delivered and not yet read.
        // Check localStorage first — it's the reliable source of truth for read state.
        const locallyRead = _getLocallyReadIds();
        const isUnread = entries.some(e =>
            e.role === 'recipient' &&
            e.m.status === 'delivered' &&
            !e.m.recipient_read_at &&
            !locallyRead.has(e.m.id));
        const unreadBadge = isUnread ? `<span class="unread-badge pulse">!</span>` : '';

        let statusBadge = '';
        if (rootEntry.role === 'sender' && root.status === 'queued') {
            statusBadge = `<span class="message-status-badge orbiting">${iconSvg('orbiting', 'sm')} Orbiting</span>`;
        } else if (rootEntry.role === 'sender' && (root.status === 'declined' || root.status === 'blocked')) {
            statusBadge = `<span class="message-status-badge" style="color:#E89B73;">Returned</span>`;
        } else if (isUnread) {
            statusBadge = `<span class="message-status-badge arriving">${iconSvg('on-its-way', 'sm')} New</span>`;
        }

        const sortTime = new Date(lm.released_at || lm.created_at).getTime();

        items.push({
            sortTime,
            isUnread,
            isRoulette: true,
            html: `
                <li class="message-item msg-row message-item--roulette${isUnread ? ' unread' : ''}"
                    onclick="openRouletteDetail('${lm.id}', '${latest.role}')">
                    <div class="msg-avatar msg-avatar--roulette">
                        ${moonIcon}
                    </div>
                    <div class="message-content">
                        <div class="message-sender">
                            ${nameDisplay}<span class="roulette-inbox-tag">ROULETTE</span>
                        </div>
                        ${statusBadge}
                        <div class="message-preview">${preview}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                        <span class="message-time">${_relativeTime(lm.released_at || lm.created_at)}</span>
                        ${unreadBadge}
                    </div>
                </li>
            `
        });
    }

    return items;
}

// ============================================
// DETAIL PANEL — open a single roulette message (same panel system as regular chats)
// ============================================

function openRouletteDetail(msgId, role) {
    const msgs = role === 'sender' ? rouletteMessages.sent : rouletteMessages.received;
    const msg = msgs.find(m => m.id === msgId);
    if (!msg) return;

    _currentRouletteMsg  = msg;
    _currentRouletteRole = role;
    closeRouletteMenu();

    if (typeof closeAllPanels === 'function') closeAllPanels();

    const page = document.getElementById('rouletteMessagePage');
    if (!page) return;

    // Header — revealed state shows real name/avatar; everything else shows moon + city
    const isRevealed = msg.status === 'revealed';
    const otherId = isRevealed
        ? (role === 'recipient' ? msg.sender_id : msg.recipient_id)
        : null;

    document.getElementById('rouletteDetailAvatar').innerHTML = phaseIconSvg(msg.moon_phase || 'full moon', 'md');

    // Clear unread state for every received message in this thread (the inbox row
    // opens the latest message, which may be one you sent).
    _markRouletteThreadRead(msg);

    if (role === 'recipient') {
        document.getElementById('rouletteDetailTitle').textContent =
            isRevealed ? '…' : `From a stranger in ${_escHtml(msg.sender_city ?? 'the world')}`;
    } else {
        const city = _escHtml(msg.recipient_city ?? 'the world');
        let senderTitle;
        if (isRevealed) {
            senderTitle = '…';
        } else if (msg.status === 'queued' || msg.status === 're-launched') {
            senderTitle = 'Adrift toward an unknown sky';
        } else if (msg.status === 'delivered' || msg.status === 'revealed') {
            senderTitle = msg.recipient_read_at ? `Read in ${city}` : `Landed in ${city}`;
        } else if (msg.status === 'declined' || msg.status === 'blocked') {
            senderTitle = `Returned from ${city}`;
        } else {
            senderTitle = `To someone in ${city}`;
        }
        document.getElementById('rouletteDetailTitle').textContent = senderTitle;
    }
    const timeStr = _relativeTime(msg.released_at || msg.created_at);
    document.getElementById('rouletteDetailSubtitle').textContent =
        'Moon Roulette · ' + _rouletteStatusLabel(msg.status, role) + ' · ' + timeStr;

    // Body
    document.getElementById('rouletteDetailBody').innerHTML = _renderRouletteDetailBody(msg, role);

    // Footer actions
    document.getElementById('rouletteDetailFooter').innerHTML = _renderRouletteDetailFooter(msg, role);

    // Position + open (mirrors openConversation logic)
    page.classList.add('active');
    document.body.style.overflow = 'hidden';

    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    if (!isMobile) {
        document.body.classList.add('chat-open');
        const leftPanel = document.querySelector('.split-left');
        const splitLayout = document.querySelector('.split-layout');
        if (leftPanel && splitLayout) {
            const slRect = splitLayout.getBoundingClientRect();
            page.style.left = (leftPanel.getBoundingClientRect().right + 24) + 'px';
            page.style.top = slRect.top + 'px';
            page.style.bottom = (window.innerHeight - slRect.bottom) + 'px';
            page.style.height = 'auto';
        }
        if (typeof renderMessages === 'function') renderMessages();
    }

    if (isRevealed) {
        requestAnimationFrame(() => {
            _resolveRevealedSenders();          // body name
            if (otherId) _resolveRevealedHeader(otherId); // header avatar + title
        });
    }
}

function closeRouletteDetail() {
    const page = document.getElementById('rouletteMessagePage');
    if (!page) return;
    closeRouletteMenu();
    _currentRouletteMsg  = null;
    _currentRouletteRole = null;
    page.classList.remove('active', 'closing');
    page.style.left = '';
    page.style.top = '';
    page.style.bottom = '';
    page.style.height = '';
    document.body.style.overflow = '';
    document.body.classList.remove('chat-open');
}

function toggleRouletteMenu() {
    const dd = document.getElementById('rouletteDropdown');
    if (!dd) return;
    dd.classList.toggle('open');
}

function closeRouletteMenu() {
    const dd = document.getElementById('rouletteDropdown');
    if (dd) dd.classList.remove('open');
}

async function _rouletteMenuDelete() {
    closeRouletteMenu();
    if (!_currentRouletteMsg) return;
    const msgId = _currentRouletteMsg.id;
    const role  = _currentRouletteRole;
    if (!confirm('Delete this roulette message?')) return;
    if (role === 'sender') {
        await handleSenderDelete(msgId);
    } else {
        // recipient delete — mark declined then remove locally
        await handleDecline(msgId);
    }
}

async function _rouletteMenuBlock() {
    closeRouletteMenu();
    if (!_currentRouletteMsg) return;
    const msgId = _currentRouletteMsg.id;
    const role  = _currentRouletteRole;
    if (role === 'recipient') {
        await handleBlock(msgId);
    } else {
        // sender blocking a recipient is unusual — treat as delete
        await handleSenderDelete(msgId);
    }
}

async function _rouletteMenuOptOut() {
    closeRouletteMenu();
    await handleRouletteOptOut();
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const wrap = document.querySelector('.roulette-menu-wrap');
    const dd   = document.getElementById('rouletteDropdown');
    if (dd && dd.classList.contains('open') && wrap && !wrap.contains(e.target)) {
        dd.classList.remove('open');
    }
});

// Collect the full conversation thread that `msg` belongs to, in chronological
// order, from the loaded sent + received messages. A thread is the chain linked
// by parent_id: walk up to the root (parent_id = null), then gather every
// descendant. Each entry is tagged with the viewer's role for that message
// (sender = outgoing bubble, recipient = incoming bubble).
function _collectRouletteThread(msg) {
    const all = new Map(); // id -> { m, role }
    rouletteMessages.sent.forEach(m => all.set(m.id, { m, role: 'sender' }));
    rouletteMessages.received.forEach(m => { if (!all.has(m.id)) all.set(m.id, { m, role: 'recipient' }); });

    // Make sure the opened message is in the set even if arrays are mid-refresh.
    if (!all.has(msg.id)) all.set(msg.id, { m: msg, role: _currentRouletteRole || 'recipient' });

    const byId = (id) => all.get(id)?.m;

    // Walk up to the thread root.
    let root = msg;
    const guard = new Set();
    while (root.parent_id && byId(root.parent_id) && !guard.has(root.id)) {
        guard.add(root.id);
        root = byId(root.parent_id);
    }

    // Gather the root + all transitive descendants.
    const collected = new Map();
    const stack = [root.id];
    while (stack.length) {
        const id = stack.pop();
        if (collected.has(id)) continue;
        const entry = all.get(id);
        if (entry) collected.set(id, entry);
        for (const { m } of all.values()) {
            if (m.parent_id === id && !collected.has(m.id)) stack.push(m.id);
        }
    }

    return [...collected.values()].sort(
        (a, b) => new Date(a.m.created_at) - new Date(b.m.created_at)
    );
}

// Mark every received, delivered-but-unread message in msg's thread as read.
// Uses localStorage as primary read-state (survives refresh regardless of DB outcome).
// Also attempts a DB update so the sender can see "Read in [city]".
function _markRouletteThreadRead(msg) {
    const thread = _collectRouletteThread(msg);
    const locallyRead = _getLocallyReadIds();
    const unread = thread.filter(({ m, role: r }) =>
        r === 'recipient' &&
        (m.status === 'delivered' || m.status === 'revealed') &&
        !m.recipient_read_at &&
        !locallyRead.has(m.id));
    if (!unread.length) return;

    const ids = unread.map(({ m }) => m.id);

    // Persist to localStorage immediately — this is what the badge checks on refresh.
    _addLocallyReadIds(ids);

    // Update in-memory objects and re-render the inbox badge away now.
    const readAt = new Date().toISOString();
    unread.forEach(({ m }) => { m.recipient_read_at = readAt; });
    if (typeof renderMessages === 'function') renderMessages();

    // Best-effort DB update so the sender sees "Read in [city]".
    sb.from('moon_roulette_messages')
        .update({ recipient_read_at: readAt })
        .in('id', ids)
        .then(({ error }) => {
            if (error) console.warn('[roulette] markRead DB update failed:', error);
        });
}

function _renderRouletteDetailBody(msg, role) {
    const isReceived = role === 'recipient';
    let revealedLine = '';
    if (isReceived && msg.status === 'revealed' && msg.sender_id) {
        revealedLine = `<div class="roulette-anon-sender"><span class="roulette-revealed-sender" data-sender-id="${msg.sender_id}">Loading…</span></div>`;
    }

    const thread = _collectRouletteThread(msg);

    const bubbles = thread.map(({ m, role: r }) => {
        const incoming = r === 'recipient';
        const bubbleClass = `message-bubble roulette-bubble${incoming ? '' : ' sent'}`;
        return (m.message_text
                    ? `<div class="${bubbleClass}"><p>${_escHtml(m.message_text)}</p></div>`
                    : '')
             + (m.photo_url
                    ? `<img class="roulette-photo" data-photo-path="${_escHtml(m.photo_url)}" alt="Photo" loading="lazy" />`
                    : '');
    }).join('');

    return `
        <div class="roulette-detail-content">
            ${revealedLine}
            ${bubbles}
        </div>
    `;
}

function _renderRouletteDetailFooter(msg, role) {
    const isReceived  = role === 'recipient';
    const iRevealed   = _myRevealedMessages.has(msg.id);
    // Compose anytime: the reply box is available on any active thread; the moon
    // governs delivery (server-side), not whether you can write.
    const canChat     = (msg.status === 'delivered' || msg.status === 'revealed');

    // Inline anonymous reply input — shown whenever the conversation is active
    const replyInput = canChat ? `
        <div class="roulette-inline-reply">
            <textarea id="rouletteInlineText_${msg.id}"
                      class="roulette-inline-textarea"
                      placeholder="Reply anonymously…"
                      rows="2"
                      maxlength="1000"
                      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();handleInlineRouletteReply('${msg.id}');}"></textarea>
            <button class="roulette-inline-send" onclick="handleInlineRouletteReply('${msg.id}')">↩</button>
        </div>
    ` : '';

    if (isReceived && msg.status === 'delivered') {
        const revealLabel = iRevealed ? 'Waiting for them…' : 'Reveal yourself?';
        return `
            <div class="roulette-detail-actions">
                ${replyInput}
                <div class="roulette-action-row">
                    <button class="btn btn--primary roulette-action-btn" data-reveal-id="${msg.id}"
                            onclick="handleReveal('${msg.id}')" ${iRevealed ? 'disabled' : ''}>
                        ${revealLabel}
                    </button>
                </div>
            </div>
        `;
    }

    if (isReceived && msg.status === 'revealed') {
        return `
            <div class="roulette-detail-actions">
                ${replyInput}
                <p class="roulette-reveal-complete">✨ You're connected</p>
            </div>
        `;
    }

    if (!isReceived && (msg.status === 'declined' || msg.status === 'blocked')) {
        return `
            <div class="roulette-detail-actions">
                <button class="btn btn--primary btn--block" onclick="handleRelaunch('${msg.id}')">
                    Re-launch to a new stranger
                </button>
                <button class="btn btn--ghost btn--block" style="color:#E89B73;border-color:rgba(232,155,115,0.4);" onclick="handleSenderDelete('${msg.id}')">
                    Delete
                </button>
            </div>
        `;
    }

    if (!isReceived && msg.status === 'delivered') {
        const revealLabel = iRevealed ? 'Waiting for them…' : 'Reveal yourself?';
        return `
            <div class="roulette-detail-actions">
                ${replyInput}
                <div class="roulette-action-row">
                    <button class="btn btn--ghost roulette-action-btn" data-reveal-id="${msg.id}"
                            onclick="handleReveal('${msg.id}')" ${iRevealed ? 'disabled' : ''}>
                        ${revealLabel}
                    </button>
                </div>
            </div>
        `;
    }

    return replyInput ? `<div class="roulette-detail-actions">${replyInput}</div>` : '';
}

async function handleInlineRouletteReply(messageId) {
    // Compose anytime — roulette delivery is moon-timed server-side, not gated here.

    const textarea = document.getElementById(`rouletteInlineText_${messageId}`);
    if (!textarea) return;
    const sendBtn = textarea.closest('.roulette-inline-reply')?.querySelector('.roulette-inline-send') || null;

    const text = textarea.value.trim();
    if (!text) { textarea.focus(); return; }

    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }
    textarea.disabled = true;

    try {
        const { error } = await sb.functions.invoke('send-roulette-message', {
            body: { message_text: text, reply_to_id: messageId }
        });
        if (error) throw error;

        textarea.value = '';
        showNotificationToast('🌙 Anonymous reply sent');
        await loadRouletteMessages();
    } catch (err) {
        console.error('[roulette] inline reply error:', err);
        showNotificationToast('Something went wrong. Please try again.');
    } finally {
        textarea.disabled = false;
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '↩'; }
        textarea.focus();
    }
}
