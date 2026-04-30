// Moon Roulette — Anonymous random message feature
// Send a message to a system-picked stranger. Only your city is visible to them.
// They can reveal themselves, decline, or block. If declined, the message returns to you.

// ============================================
// STATE
// ============================================
let rouletteMessages = { sent: [], received: [] };
let rouletteActiveTab = 'sent'; // 'sent' | 'received'
let _rouletteRealtimeChannels = [];

// ============================================
// DB HELPERS
// ============================================

async function loadRouletteMessages() {
    if (!currentAuthUser) return;
    try {
        const [sentRes, receivedRes] = await Promise.all([
            // Sent: query the raw table — sender_id RLS policy applies
            sb.from('moon_roulette_messages')
                .select('id, sender_city, status, release_at, released_at, moon_phase, moon_illumination, message_text, photo_url, song_url, song_title, parent_id, send_attempt, created_at, updated_at')
                .eq('sender_id', currentAuthUser.id)
                .is('sender_deleted_at', null)
                .order('created_at', { ascending: false }),

            // Received: use the anonymity view — hides sender_id pre-reveal
            sb.from('roulette_recipient_view')
                .select('*')
                .order('created_at', { ascending: false }),
        ]);

        if (sentRes.error) console.error('[roulette] sent fetch error:', sentRes.error);
        if (receivedRes.error) console.error('[roulette] received fetch error:', receivedRes.error);

        rouletteMessages.sent     = sentRes.data     ?? [];
        rouletteMessages.received = receivedRes.data ?? [];
    } catch (err) {
        console.error('[roulette] loadRouletteMessages exception:', err);
    }
    _updateRouletteTabBadge();
}

function _updateRouletteTabBadge() {
    const badge = document.getElementById('rouletteTabBadge');
    if (!badge) return;
    const count = rouletteMessages.received.filter(m => m.status === 'delivered').length;
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

// ============================================
// OPEN / CLOSE PAGE
// ============================================

async function openRoulettePage(fromPopstate = false) {
    if (!fromPopstate) {
        history.pushState({ page: 'roulette' }, '', '/roulette');
    }
    const page = document.getElementById('roulettePage');
    if (!page) return;

    // Close other overlays
    document.getElementById('philosophyPage').style.display = 'none';
    document.getElementById('contactsPage').style.display  = 'none';

    page.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    await loadRouletteMessages();
    renderRouletteInbox();
    subscribeRouletteRealtime();
}

function closeRoulettePage() {
    const page = document.getElementById('roulettePage');
    if (page) page.style.display = 'none';
    document.body.style.overflow = '';
    _cleanupRouletteRealtime();
    if (window.location.pathname === '/roulette') {
        history.pushState({}, '', '/');
    }
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

    // If this was a mutual reveal completing, play a soft sound
    if (payload.new?.status === 'revealed' && payload.old?.status !== 'revealed') {
        playMessageSound();
        showNotificationToast('✨ A moon roulette connection revealed themselves');
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

    const page = document.getElementById('roulettePage');
    if (page && page.style.display !== 'none') {
        renderRouletteInbox();
    }
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
                ${msg.photo_url ? `<img class="roulette-photo" src="${msg.photo_url}" alt="Photo" loading="lazy" />` : ''}
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

// ============================================
// COMPOSE
// ============================================

function openRouletteCompose(parentId = null, prefill = {}) {
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
        renderRouletteInbox();
        showNotificationToast('🌕 Your message is on its way to a stranger');
        console.log('[roulette] sent:', data.message.id, '| release_at:', data.message.release_at);
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
    const messageText = document.getElementById('messageText')?.value.trim();
    const sendBtn = document.getElementById('composeMainBtn');
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
        // If roulette tab is active, refresh it; otherwise switch to it
        const rouletteTabContent = document.getElementById('rouletteTabContent');
        if (rouletteTabContent && rouletteTabContent.style.display !== 'none') {
            renderRouletteTab();
        } else {
            switchInboxTab('roulette');
        }
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

function switchInboxTab(tab) {
    const inboxContent = document.getElementById('inboxTabContent');
    const rouletteContent = document.getElementById('rouletteTabContent');
    const inboxBtn = document.getElementById('inboxTabBtn');
    const rouletteBtn = document.getElementById('rouletteTabBtn');
    if (!inboxContent || !rouletteContent) return;

    const inboxCta = document.getElementById('inboxNewMsgCta');
    if (tab === 'roulette') {
        inboxContent.style.display = 'none';
        rouletteContent.style.display = 'block';
        inboxBtn?.classList.remove('active');
        rouletteBtn?.classList.add('active');
        if (inboxCta) inboxCta.style.display = 'none';
        loadRouletteMessages().then(() => renderRouletteTab());
    } else {
        inboxContent.style.display = 'block';
        rouletteContent.style.display = 'none';
        inboxBtn?.classList.add('active');
        rouletteBtn?.classList.remove('active');
        // CTA visibility is controlled by realtime.js based on moon state — let it restore naturally
    }
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

        await loadRouletteMessages();
        renderRouletteInbox();
    } catch (err) {
        console.error('[roulette] return error:', err);
        if (card) card.style.opacity = '1';
        showNotificationToast('Something went wrong. Please try again.');
    }
}

async function handleReveal(messageId) {
    const btn = document.querySelector(`.roulette-card[data-id="${messageId}"] .roulette-reveal-btn`);
    if (btn) { btn.disabled = true; btn.textContent = 'Revealing…'; }

    try {
        const { data, error } = await sb.functions.invoke('reveal-roulette-identity', {
            body: { message_id: messageId }
        });

        if (error) throw error;

        if (data.mutual_reveal_complete) {
            playMessageSound();
            showNotificationToast('✨ You\'re connected — identities revealed!');
            await loadRouletteMessages();
            renderRouletteInbox();
            await _resolveRevealedSenders();
        } else {
            showNotificationToast('🌙 Waiting for the other person to reveal…');
            if (btn) { btn.disabled = true; btn.textContent = 'Waiting for them…'; }
        }
    } catch (err) {
        console.error('[roulette] reveal error:', err);
        if (btn) { btn.disabled = false; btn.textContent = 'Reveal yourself?'; }
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
        renderRouletteInbox();
    } catch (err) {
        console.error('[roulette] delete error:', err);
        showNotificationToast('Something went wrong. Please try again.');
    }
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
