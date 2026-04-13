// Chat — Message Detail, Typing, Replies

// ORBIT DOT HIGHLIGHT
// ========================
function highlightOrbitDot(senderName, show) {
    document.querySelectorAll('.message-dot').forEach(dot => {
        if (dot.dataset.to === senderName) {
            dot.classList.toggle('highlighted', show);
        }
    });
}

// ========================
// MESSAGE DETAIL (FULL PAGE)
// ========================
let currentMessageIndex = -1;
let currentConversationIndex = -1;

// Load ALL messages for a specific conversation from DB (for full thread view)
async function loadFullConversationThread(conv) {
    if (!conv.dbConversationId || !currentAuthUser) return;
    try {
        const { data: convMessages, error } = await sb.from('messages')
            .select('*')
            .eq('conversation_id', conv.dbConversationId)
            .order('created_at', { ascending: true });

        if (error || !convMessages) {
            console.error('loadFullConversationThread error:', error);
            return;
        }

        // Fetch profiles for participants
        const profileIds = new Set();
        convMessages.forEach(m => {
            if (m.sender_id) profileIds.add(m.sender_id);
            if (m.recipient_id) profileIds.add(m.recipient_id);
        });
        const profileMap = {};
        if (profileIds.size > 0) {
            const { data: profiles } = await sb.from('profiles')
                .select('id, username, first_name, last_name, city, avatar_url')
                .in('id', Array.from(profileIds));
            if (profiles) profiles.forEach(p => { profileMap[p.id] = p; });
        }

        // Map DB rows to local message format
        const fullMessages = convMessages.map(m => {
            const isSent = m.sender_id === currentAuthUser.id;
            const sp = m.sender_id ? profileMap[m.sender_id] : null;
            const rp = m.recipient_id ? profileMap[m.recipient_id] : null;
            const otherProfile = isSent ? rp : sp;

            // Sent messages always visible; received: moon MUST be in sky AND message released
            // Defense-in-depth: also check DB status for received messages
            const stillInTransit = !isSent && ((m.release_at && new Date(m.release_at) > new Date()) || m.status === 'in_transit');
            const tooOld = m.created_at && new Date(m.created_at) < new Date(Date.now() - 24 * 3600000);
            const actuallyInTransit = stillInTransit && !tooOld;
            const contentVisible = isSent || (!!moonData.isVisible && !actuallyInTransit);

            // For sender name: use profile, then recipient_name ONLY for sent messages
            // (for received messages, recipient_name = current user, NOT the sender)
            const otherName = otherProfile?.username ||
                [otherProfile?.first_name, otherProfile?.last_name].filter(Boolean).join(' ') ||
                (isSent ? m.recipient_name : null) || 'Unknown';

            return {
                dbId: m.id,
                senderId: m.sender_id,
                recipientId: m.recipient_id || null,
                sender: otherName,
                senderAvatar: otherProfile?.avatar_url || null,
                recipientEmail: m.recipient_email,
                preview: contentVisible ? (m.message_text || '') : '',
                status: isSent ? (m.status === 'in_transit' ? 'In Transit' : 'Released') : (contentVisible ? '' : 'Arriving'),
                stillInTransit: !isSent ? actuallyInTransit : (m.status === 'in_transit'),
                type: isSent ? 'sent' : 'received',
                location: otherProfile?.city || m.recipient_city || 'Unknown',
                time: timeAgo(m.created_at),
                createdAt: m.created_at,
                conversationId: m.conversation_id || null,
                phaseName: m.moon_phase || '',
                messageText: contentVisible ? (m.message_text || '') : '',
                lunarNote: contentVisible && m.lunar_note_text ? { text: m.lunar_note_text, closing: m.lunar_note_closing || '' } : null,
                songUrl: contentVisible ? m.song_url : null,
                songTitle: contentVisible ? m.song_title : null,
                photoUrl: contentVisible ? (m.photo_url || null) : null,
                contentVisible: contentVisible,
                releaseAt: m.release_at,
                reactions: [],
                replies: []
            };
        });

        // Apply cached reactions before replacing (survives race conditions with DB save)
        if (Object.keys(_reactionCache).length > 0) {
            fullMessages.forEach(m => {
                if (m.dbId && _reactionCache[m.dbId]) {
                    const e = _reactionCache[m.dbId];
                    m.reactions = e.reactions || e;
                }
            });
        }

        // Replace conversation's messages with the full set
        // Also update the global messages array so indexOf lookups work (needed for reactions)
        const oldMsgIds = new Set(conv.messages.filter(m => m.dbId).map(m => m.dbId));
        messages = messages.filter(m => !oldMsgIds.has(m.dbId));
        messages.push(...fullMessages);
        conv.messages = fullMessages;
        conv._fullThreadLoaded = true;
        console.log('loadFullConversationThread: loaded', fullMessages.length, 'messages for conversation', conv.dbConversationId);
    } catch (err) {
        console.error('loadFullConversationThread exception:', err);
    }
}

// Open a conversation (grouped chat thread with a person)
// Close ALL right-side panels (conversation, shared sky, new message picker, compose)
function closeAllPanels() {
    // Close conversation detail
    const msgPage = document.getElementById('messagePageView');
    if (msgPage && msgPage.classList.contains('active')) {
        msgPage.classList.remove('active', 'closing');
        msgPage.style.left = '';
        msgPage.style.top = '';
        msgPage.style.bottom = '';
        msgPage.style.height = '';
    }
    // Close shared sky
    const skyPage = document.getElementById('sharedSkyPage');
    if (skyPage && skyPage.classList.contains('active')) {
        skyPage.classList.remove('active', 'closing');
        skyPage.style.left = '';
        skyPage.style.top = '';
        skyPage.style.bottom = '';
        skyPage.style.height = '';
    }
    // Close new message picker
    const newMsgPage = document.getElementById('newMessagePicker');
    if (newMsgPage && newMsgPage.classList.contains('active')) {
        newMsgPage.classList.remove('active', 'closing');
        newMsgPage.style.left = '';
        newMsgPage.style.top = '';
        newMsgPage.style.bottom = '';
        newMsgPage.style.height = '';
    }
    // Close compose page
    const composePage = document.getElementById('composePage');
    if (composePage && composePage.classList.contains('active')) {
        composePage.classList.remove('active', 'closing');
        composePage.style.left = '';
        composePage.style.top = '';
        composePage.style.bottom = '';
        composePage.style.height = '';
    }
    document.body.classList.remove('chat-open');
    document.body.style.overflow = '';
    currentConversation = null;
    currentConversationIndex = -1;
}

async function openConversation(convIndex) {
    closeAllPanels();
    const conv = conversations[convIndex];
    if (!conv) return;
    currentConversation = conv;
    currentConversationIndex = convIndex;

    // Load full thread from DB if we haven't already (pagination: initial load may be partial)
    if (!conv._fullThreadLoaded && conv.dbConversationId) {
        await loadFullConversationThread(conv);
    }
    // Set currentMessageIndex to the latest message for reply attachment
    currentMessageIndex = messages.indexOf(conv.messages[0]);

    const page = document.getElementById('messagePageView');
    document.getElementById('detailAvatarInitial').textContent = (conv.otherName || '?').charAt(0);
    const detailImg = document.getElementById('detailAvatarImg');
    const contact = contacts.find(c => {
        if (c.linkedProfileId === currentAuthUser?.id) return false;
        return c.name === conv.otherName || (c.email && c.email === conv.otherEmail);
    });
    let detailAvatarUrl = conv.otherAvatar || null;
    if (!detailAvatarUrl && contact?.avatar) detailAvatarUrl = contact.avatar;
    // Safety: never show own avatar for other person
    const _myAv = localStorage.getItem('moonpop_profilepic');
    if (detailAvatarUrl && _myAv && detailAvatarUrl === _myAv) detailAvatarUrl = null;
    if (detailAvatarUrl) {
        detailImg.src = detailAvatarUrl;
        detailImg.style.display = 'block';
        document.getElementById('detailAvatarInitial').style.display = 'none';
    } else {
        detailImg.style.display = 'none';
        document.getElementById('detailAvatarInitial').style.display = '';
    }
    // Show username as title, real name + location as subtitle
    const displayUsername = conv.otherUsername || conv.otherName;
    const realName = conv.otherUsername && conv.otherUsername !== conv.otherName
        ? conv.otherName : null;
    document.getElementById('detailSender').textContent = displayUsername;

    // Show location and online status (with real name if different from username)
    const online = (conv.otherProfileId && onlineUsers[conv.otherProfileId]) || isContactOnline(contact);
    const namePrefix = realName ? `${realName} · ` : '';
    document.getElementById('detailLocation').textContent = online
        ? `${namePrefix}${conv.location || 'Unknown'} · Online under the same sky`
        : `${namePrefix}${conv.location || 'Unknown'} · ${conv.messages.length} transmission${conv.messages.length > 1 ? 's' : ''}`;

    // Load replies for ALL messages in this conversation
    if (currentAuthUser) {
        const msgIds = conv.messages.filter(m => m.dbId).map(m => m.dbId);
        if (msgIds.length > 0) {
            const { data: allReplies, error: replErr } = await sb.from('replies')
                .select('*')
                .in('message_id', msgIds)
                .order('created_at', { ascending: true });

            if (replErr) console.error('Load replies failed:', replErr);
            if (allReplies) {
                // Group replies by message_id
                const replyMap = {};
                allReplies.forEach(r => {
                    if (!replyMap[r.message_id]) replyMap[r.message_id] = [];
                    replyMap[r.message_id].push({
                        id: r.id,
                        dbId: r.id,
                        text: r.text,
                        time: timeAgo(r.created_at),
                        createdAt: r.created_at,
                        sent: r.sender_id === currentAuthUser.id,
                        senderId: r.sender_id,
                        isLunarNote: r.is_lunar_note || false,
                        photoUrl: r.photo_url || null,
                        status: r.sender_id === currentAuthUser.id ? (r.status === 'in_transit' ? 'In Transit' : 'Released') : '',
                        releaseAt: r.release_at || null,
                        recipientCity: r.recipient_city || null,
                        reactions: []
                    });
                });
                conv.messages.forEach(msg => {
                    if (msg.dbId && replyMap[msg.dbId]) {
                        msg.replies = replyMap[msg.dbId];
                    }
                });
            }

            // Load reactions for all messages AND replies
            const allReactionIds = [...msgIds];
            conv.messages.forEach(msg => {
                if (msg.replies) msg.replies.forEach(r => { if (r.dbId) allReactionIds.push(r.dbId); });
            });
            const { data: allReactions } = await sb.from('reactions')
                .select('*')
                .in('message_id', allReactionIds);

            if (allReactions) {
                const rxnMap = {};
                allReactions.forEach(r => {
                    if (!rxnMap[r.message_id]) rxnMap[r.message_id] = {};
                    if (!rxnMap[r.message_id][r.emoji]) rxnMap[r.message_id][r.emoji] = { emoji: r.emoji, count: 0, mine: false };
                    rxnMap[r.message_id][r.emoji].count++;
                    if (r.user_id === currentAuthUser.id) rxnMap[r.message_id][r.emoji].mine = true;
                });
                conv.messages.forEach(msg => {
                    if (msg.dbId && rxnMap[msg.dbId]) {
                        msg.reactions = Object.values(rxnMap[msg.dbId]);
                    }
                    // Assign reactions to individual replies
                    if (msg.replies) {
                        msg.replies.forEach(r => {
                            if (r.dbId && rxnMap[r.dbId]) {
                                r.reactions = Object.values(rxnMap[r.dbId]);
                            }
                        });
                    }
                });
            }
        }
    }

    // Close Shared Sky if it's open
    document.getElementById('sharedSkyPage').classList.remove('active', 'closing');

    renderConversationThread();
    page.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Desktop inline chat: position overlay in the right panel
    const _isMobile = window.matchMedia('(max-width: 900px)').matches;
    if (!_isMobile) {
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
        renderMessages(); // refresh inbox to show active highlight
    }

    // Setup typing indicator channel
    setupTypingChannel(conv.dbConversationId);

    // Update URL to reflect the open conversation (deep-linkable)
    // Use replaceState if already viewing a chat, to avoid stacking history entries
    if (conv.dbConversationId) {
        const chatPath = window.location.pathname.replace(/\/chat\/.*$/, '').replace(/\/$/, '') + '/chat/' + conv.dbConversationId;
        if (window.location.pathname.match(/\/chat\//)) {
            history.replaceState({ chat: conv.dbConversationId }, '', chatPath);
        } else {
            history.pushState({ chat: conv.dbConversationId }, '', chatPath);
        }
    }

    // Mark conversation as read (always, even if unreadCount is 0 — keeps receipt fresh)
    if (conv.dbConversationId && currentAuthUser) {
        conv.unreadCount = 0;
        // Always save to localStorage (reliable fallback)
        saveLocalReadReceipt(conv.dbConversationId);
        renderMessages(); // Re-render inbox to clear badge
        // Force immediate ring update (bypass 30s cache)
        window._lastInboxRefresh = 0;

        // Save read receipt in DB — try upsert first, fallback to insert
        const now = new Date().toISOString();
        const receiptData = {
            conversation_id: conv.dbConversationId,
            user_id: currentAuthUser.id,
            last_read_at: now,
            created_at: now,
            updated_at: now
        };
        try {
            const { error: upsertErr } = await sb.from('read_receipts').upsert(
                receiptData,
                { onConflict: 'conversation_id,user_id' }
            );
            if (upsertErr) {
                console.error('read_receipt upsert failed:', upsertErr.message, upsertErr.code);
                // Fallback: try plain insert (first time) or update (already exists)
                const { error: insertErr } = await sb.from('read_receipts').insert(receiptData);
                if (insertErr) {
                    console.error('read_receipt insert fallback failed:', insertErr.message);
                    // Last resort: update existing
                    await sb.from('read_receipts')
                        .update({ last_read_at: now, updated_at: now })
                        .eq('conversation_id', conv.dbConversationId)
                        .eq('user_id', currentAuthUser.id);
                }
            }
        } catch (err) {
            console.error('read_receipt save exception:', err);
        }
    }

    // Auto-scroll to bottom
    setTimeout(() => {
        const content = document.getElementById('detailContent');
        if (content) content.scrollTop = content.scrollHeight;
    }, 50);
}

// Legacy: openMessageDetail now finds the conversation for that message
async function openMessageDetail(index) {
    const msg = messages[index];
    if (!msg) return;
    // Find which conversation this message belongs to
    const ci = conversations.findIndex(c => c.messages.includes(msg));
    if (ci >= 0) {
        await openConversation(ci);
    }
}

// Get read receipt status for a sent message
function getReadReceiptStatus(messageCreatedAt, conv) {
    if (!conv || !conv.otherReadAt) return 'delivered';
    return new Date(conv.otherReadAt) >= new Date(messageCreatedAt) ? 'read' : 'delivered';
}

// Update reply row visibility based on moon state — JS-driven (no CSS !important)
function updateReplyRowMoonGate() {
    const replyRow = document.querySelector('.reply-row');
    const lunarLink = document.querySelector('.add-lunar-link');
    const photoPreview = document.getElementById('replyPhotoPreview');
    const moonGate = document.getElementById('replyMoonGate');
    const gateTime = document.getElementById('replyMoonGateTime');
    const lunarPanel = document.getElementById('threadLunarPanel');
    const noteToggle = document.querySelector('.note-mode-toggle');
    const noteToggleBar = document.querySelector('#messagePageView .note-toggle-bar');
    const openNotePanel = document.getElementById('openNotePanel');

    if (!moonData.isVisible) {
        // Moon is DOWN — hide ALL compose elements, show gate
        if (replyRow) replyRow.style.display = 'none';
        if (lunarLink) lunarLink.style.display = 'none';
        if (photoPreview) photoPreview.style.display = 'none';
        if (lunarPanel) lunarPanel.style.display = 'none';
        if (noteToggle) noteToggle.style.display = 'none';
        if (noteToggleBar) noteToggleBar.style.display = 'none';
        if (openNotePanel) openNotePanel.style.display = 'none';
        if (moonGate) moonGate.style.display = 'block';
        if (gateTime) {
            const riseTime = moonData.moonrise !== '--:--' ? moonData.moonrise : '';
            gateTime.textContent = riseTime
                ? `Messaging opens at moonrise (${riseTime})`
                : 'Messaging opens when the moon rises';
        }
    } else {
        // Moon is UP — show compose, hide gate
        if (replyRow) replyRow.style.display = '';
        if (lunarLink) lunarLink.style.display = '';
        if (noteToggle) noteToggle.style.display = '';
        if (noteToggleBar) noteToggleBar.style.display = '';
        if (openNotePanel) openNotePanel.style.display = '';
        if (moonGate) moonGate.style.display = 'none';
    }
}

// Update inbox transmission button based on moon state
function updateInboxTransmitBtn() {
    const btn = document.getElementById('inboxTransmitBtn');
    if (!btn) return;
    if (moonData.isVisible) {
        btn.textContent = '+ NEW MOON MESSAGE';
        btn.classList.add('moon-up');
    } else {
        btn.textContent = '+ INITIATE TRANSMISSION';
        btn.classList.remove('moon-up');
    }
}

// Render the full conversation thread (all messages + replies chronologically)
// Persistent reaction cache — reactions added by the user survive re-renders/reloads
// Maps dbId → { reactions: [...], cachedAt: timestamp }
const _reactionCache = {};
function renderConversationThread() {
    if (!currentConversation) return;
    // Apply cached reactions to message objects (survives object replacement from reloads)
    // GUARD: only apply to messages that existed BEFORE the cache entry was created
    // This prevents stale reactions from being applied to brand new sent messages
    if (Object.keys(_reactionCache).length > 0) {
        currentConversation.messages.forEach(m => {
            if (m.dbId && _reactionCache[m.dbId]) {
                const entry = _reactionCache[m.dbId];
                const msgTime = m.createdAt ? new Date(m.createdAt).getTime() : 0;
                const cacheTime = entry.cachedAt || 0;
                console.log('[ReactionCache] MATCH dbId:', m.dbId, 'msgTime:', msgTime, 'cacheTime:', cacheTime, 'hasReactions:', (m.reactions||[]).length, 'cacheReactions:', JSON.stringify(entry.reactions || entry));
                if (msgTime < cacheTime || (m.reactions && m.reactions.length > 0)) {
                    m.reactions = entry.reactions || entry;
                }
            }
            if (m.replies) m.replies.forEach(r => {
                if (r.dbId && _reactionCache[r.dbId]) {
                    const entry = _reactionCache[r.dbId];
                    const rTime = r.createdAt ? new Date(r.createdAt).getTime() : 0;
                    const cacheTime = entry.cachedAt || 0;
                    if (rTime < cacheTime || (r.reactions && r.reactions.length > 0)) {
                        r.reactions = entry.reactions || entry;
                    }
                }
            });
        });
    }
    const conv = currentConversation;
    const content = document.getElementById('detailContent');

    // Build a flat timeline of all items
    const timeline = [];

    // Add all messages (oldest first)
    const sortedMsgs = [...conv.messages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    sortedMsgs.forEach((msg, mi) => {
        // Use dbId-based lookup instead of indexOf (object identity breaks after reloads)
        const msgIndex = msg.dbId
            ? messages.findIndex(m => m.dbId === msg.dbId)
            : messages.indexOf(msg);
        if (msgIndex < 0) console.warn('[Reactions] renderThread: msgIndex=-1 for msg dbId:', msg.dbId, 'type:', msg.type);

        // Received in-transit message: show "arriving" notification instead of content
        if (msg.type === 'received' && msg.status === 'Arriving') {
            timeline.push({
                type: 'arriving',
                time: msg.time,
                createdAt: msg.createdAt,
                sent: false,
                releaseAt: msg.releaseAt,
                msgIndex,
                msgDbId: msg.dbId,
                isMessage: true
            });
            return; // Skip content rendering for this message
        }

        // Add the message itself
        // Hide received lunar notes when moon is below horizon
        if (msg.lunarNote && (msg.type === 'sent' || moonData.isVisible)) {
            timeline.push({
                type: 'lunar-note',
                text: msg.lunarNote.text,
                closing: msg.lunarNote.closing,
                time: msg.time,
                createdAt: msg.createdAt,
                sent: msg.type === 'sent',
                msgIndex,
                msgDbId: msg.dbId,
                isMessage: true
            });
        }
        if (msg.messageText || msg.photoUrl) {
            timeline.push({
                type: 'text',
                text: msg.messageText,
                photoUrl: msg.photoUrl || null,
                time: msg.time,
                createdAt: msg.createdAt,
                sent: msg.type === 'sent',
                msgIndex,
                msgDbId: msg.dbId,
                isMessage: true,
                status: msg.status,
                releaseAt: msg.releaseAt,
                location: msg.location
            });
        }
        if (msg.status === 'In Transit' && !msg.messageText && !msg.lunarNote && !msg.photoUrl) {
            timeline.push({
                type: 'transit',
                time: msg.time,
                createdAt: msg.createdAt,
                sent: true,
                location: msg.location,
                releaseAt: msg.releaseAt,
                msgIndex,
                msgDbId: msg.dbId,
                isMessage: true
            });
        }

        // Add replies for this message — each reply uses its OWN dbId for reactions
        if (msg.replies) {
            msg.replies.forEach(r => {
                // Hide received lunar replies when moon is below horizon
                if (r.isLunarNote && !r.sent && !moonData.isVisible) return;
                timeline.push({
                    type: r.isLunarNote ? 'lunar-reply' : 'reply',
                    text: r.text,
                    photoUrl: r.photoUrl || null,
                    time: r.time,
                    createdAt: r.createdAt || msg.createdAt,
                    sent: r.sent,
                    status: r.status || undefined,
                    releaseAt: r.releaseAt || null,
                    location: r.recipientCity || msg.location,
                    msgIndex,
                    msgDbId: r.dbId || msg.dbId,
                    parentMsgDbId: msg.dbId,
                    isReply: !!r.dbId,
                    isMessage: true
                });
            });
        }
    });

    // Sort timeline chronologically
    timeline.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    // Debug: count messages with/without dbId
    const withDbId = timeline.filter(t => t.msgDbId).length;
    const withoutDbId = timeline.filter(t => t.isMessage && !t.msgDbId).length;
    console.log(`[Reactions] Timeline: ${timeline.length} items, ${withDbId} with dbId, ${withoutDbId} messages WITHOUT dbId`);
    if (withoutDbId > 0) {
        timeline.filter(t => t.isMessage && !t.msgDbId).forEach(t => {
            console.warn('[Reactions] Message without dbId:', t.type, t.text?.substring(0, 30));
        });
    }

    // Find the LAST sent message that was read by the other person
    let lastReadSentIndex = -1;
    if (conv.otherReadAt) {
        const otherRead = new Date(conv.otherReadAt);
        for (let i = timeline.length - 1; i >= 0; i--) {
            if (timeline[i].sent && timeline[i].isMessage && timeline[i].createdAt
                && new Date(timeline[i].createdAt) <= otherRead) {
                lastReadSentIndex = i;
                break;
            }
        }
    }

    // Render timeline
    let html = '';
    let lastDate = '';
    let transitBannerShown = false;

    // Empty state: show "new cycle begins" if no messages
    if (timeline.length === 0) {
        const illum = typeof SunCalc !== 'undefined' ? SunCalc.getMoonIllumination(new Date()) : null;
        const isNewMoon = illum && (illum.phase < 0.05 || illum.phase > 0.95);
        const emptyTitle = isNewMoon ? 'A new cycle begins' : 'No messages yet';
        const emptySubtitle = isNewMoon
            ? 'Your messages faded with the last new moon.'
            : 'Send the first moon message!';
        html = `<div class="new-cycle-empty">
            <div class="new-cycle-empty-icon">${iconSvg('new-moon', 'lg')}</div>
            <div class="new-cycle-empty-title">${emptyTitle}</div>
            <div class="new-cycle-empty-subtitle">${emptySubtitle}</div>
        </div>`;
    }

    timeline.forEach((item, itemIndex) => {
        // Date separator
        const itemDate = new Date(item.createdAt);
        const dateStr = itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (dateStr !== lastDate && item.createdAt) {
            html += `<div style="text-align:center;padding:12px 0 8px;"><span class="chat-date-sep" style="font-size:11px;color:rgba(255,255,255,0.35);background:rgba(18,35,58,0.7);padding:4px 12px;border-radius:12px;">${dateStr}</span></div>`;
            lastDate = dateStr;
        }

        // Transit banner: show once, above the first in-transit sent message
        if (!transitBannerShown && item.sent && (item.status === 'In Transit' || item.type === 'transit')) {
            transitBannerShown = true;
            let bannerText = 'Messages below are on their way';
            if (item.releaseAt) {
                const rd = new Date(item.releaseAt);
                const ts = rd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                bannerText = `Messages below will arrive at moonrise (${ts})`;
            }
            html += `
                <div style="display:flex;align-items:center;gap:8px;padding:12px 0;margin:8px 0;">
                    <div style="flex:1;height:1px;background:rgba(79,195,247,0.15);"></div>
                    <span style="font-size:15px;color:rgba(79,195,247,0.7);white-space:nowrap;font-style:italic;display:flex;align-items:center;gap:5px;">
                        ${iconSvg('lunar-note', 'sm')} ${bannerText}
                    </span>
                    <div style="flex:1;height:1px;background:rgba(79,195,247,0.15);"></div>
                </div>
                <div class="transit-zone" id="transitZone">
            `;
        }

        // Build actions row (reactions + reply) for any message with a dbId
        const actionsHtml = (dbId) => {
            if (!dbId) return '';
            return renderReactionsBar(dbId);
        };

        if (item.type === 'lunar-note') {
            const lunarReceipt = item.sent ? (() => {
                const st = getReadReceiptStatus(item.createdAt, conv);
                if (itemIndex === lastReadSentIndex && st === 'read') {
                    return `<span class="read-receipt read seen-label">Seen</span>`;
                }
                return `<span class="read-receipt ${st}">✓✓</span>`;
            })() : '';
            const lunarPreview = (item.text || '').substring(0, 40) + ((item.text || '').length > 40 ? '...' : '');
            html += `
                <div class="bubble-lunar-note ${item.sent ? 'sent-lunar' : ''}" style="${item.sent ? 'margin-left:auto;' : ''}max-width:85%;">
                    <div class="bubble-lunar-label">${iconSvg('lunar-note', 'sm')} Lunar Note</div>
                    <div class="bubble-lunar-text">${item.text}</div>
                    ${item.closing ? `<div class="bubble-lunar-closing">${item.closing}</div>` : ''}
                    <div class="message-bubble-time">${item.time || 'Recently'} ${lunarReceipt}</div>
                    <div class="msg-actions-row">
                        ${actionsHtml(item.msgDbId)}
                        <button class="msg-comments-link" onclick="event.stopPropagation(); setReplyContext('🌙 ${lunarPreview}')">↩ Reply</button>
                    </div>
                </div>
            `;
        } else if (item.type === 'text') {
            const textReceipt = item.sent ? (() => {
                const st = getReadReceiptStatus(item.createdAt, conv);
                if (itemIndex === lastReadSentIndex && st === 'read') {
                    return `<span class="read-receipt read seen-label">Seen</span>`;
                }
                return `<span class="read-receipt ${st}">✓✓</span>`;
            })() : '';
            const textPreview = (item.text || '').substring(0, 40) + ((item.text || '').length > 40 ? '...' : '');
            const textIsTransit = item.sent && (item.status === 'In Transit' || item.status === 'in_transit');
            if (textIsTransit) {
                // In-transit sent message — orbital glow design
                let etaStr = '';
                let etaLabel = '';
                if (item.releaseAt) {
                    const diff = new Date(item.releaseAt).getTime() - Date.now();
                    if (diff > 0) {
                        const h = Math.floor(diff / 3600000);
                        const m = Math.floor((diff % 3600000) / 60000);
                        etaLabel = h > 0 ? `Arrives in ${h}h ${m}m` : `Arrives in ${m}m`;
                    }
                }
                const loc = item.location || '';
                if (!etaLabel) etaLabel = loc ? `Traveling toward ${loc}` : 'Arriving at moonrise';
                html += `
                    <div class="message-bubble-transit-wrap">
                        <div class="message-bubble sent">
                            ${item.photoUrl ? `<img src="${item.photoUrl}" loading="lazy" style="max-width:100%;max-height:240px;border-radius:8px;margin-bottom:${item.text ? '6px' : '0'};object-fit:cover;display:block;">` : ''}
                            ${item.text ? `<p>${item.text}</p>` : ''}
                            <div class="message-bubble-time">${item.time || 'Recently'} ${textReceipt}</div>
                            <div class="msg-actions-row">
                                ${actionsHtml(item.msgDbId)}
                                <button class="msg-comments-link" onclick="event.stopPropagation(); setReplyContext('${textPreview.replace(/'/g, "\\'")}')">↩ Reply</button>
                            </div>
                        </div>
                        <div class="transit-eta-label">${iconSvg('lunar-note', 'sm')} ${etaLabel}</div>
                    </div>
                `;
            } else {
                html += `
                    <div class="message-bubble ${item.sent ? 'sent' : ''}">
                        ${item.photoUrl ? `<img src="${item.photoUrl}" loading="lazy" style="max-width:100%;max-height:240px;border-radius:8px;margin-bottom:${item.text ? '6px' : '0'};object-fit:cover;display:block;">` : ''}
                        ${item.text ? `<p>${item.text}</p>` : ''}
                        <div class="message-bubble-time">${item.time || 'Recently'} ${textReceipt}</div>
                        <div class="msg-actions-row">
                            ${actionsHtml(item.msgDbId)}
                            <button class="msg-comments-link" onclick="event.stopPropagation(); setReplyContext('${textPreview.replace(/'/g, "\\'")}')">↩ Reply</button>
                        </div>
                    </div>
                `;
            }
        } else if (item.type === 'transit') {
            let transitEta = '';
            if (item.releaseAt) {
                const diff = new Date(item.releaseAt).getTime() - Date.now();
                if (diff > 0) {
                    const h = Math.floor(diff / 3600000);
                    const m = Math.floor((diff % 3600000) / 60000);
                    transitEta = h > 0 ? `Arrives in ${h}h ${m}m` : `Arrives in ${m}m`;
                }
            }
            if (!transitEta) transitEta = item.location ? `Traveling toward ${item.location}` : 'Arriving at moonrise';
            html += `
                <div class="message-bubble-transit-wrap">
                    <div class="transit-orbit-track">
                        <div class="transit-orbit-dot" style="--orbit-dur:3.5s;--orbit-delay:0s;"></div>
                        <div class="transit-orbit-dot" style="--orbit-dur:3.5s;--orbit-delay:-1.75s;"></div>
                        <div class="transit-orbit-dot" style="--orbit-dur:5s;--orbit-delay:-1s;width:3px;height:3px;opacity:0.5;"></div>
                    </div>
                    <div class="message-bubble sent" style="text-align:center;">
                        <p style="color:rgba(79,195,247,0.6);font-style:italic;font-size:13px;">Message in transit</p>
                        <div class="message-bubble-time">${item.time}</div>
                    </div>
                    <div class="transit-eta-label">${iconSvg('lunar-note', 'sm')} ${transitEta}</div>
                </div>
            `;
        } else if (item.type === 'arriving') {
            // Received in-transit message: shown as notification
            let arrivalNote = 'A moon message is on its way to you...';
            if (item.releaseAt) {
                const diff = new Date(item.releaseAt).getTime() - Date.now();
                if (diff > 0) {
                    const h = Math.floor(diff / 3600000);
                    const m = Math.floor((diff % 3600000) / 60000);
                    const eta = h > 0 ? `${h}h ${m}m` : `${m}m`;
                    arrivalNote = `A moon message is on its way \u2014 arriving in ${eta}.`;
                } else {
                    arrivalNote = 'A moon message has arrived.';
                }
            }
            html += `
                <div class="chat-transit-msg chat-transit-countdown" data-release="${item.releaseAt || ''}" style="max-width:85%;padding:14px 16px;border-radius:16px;background:rgba(18,35,58,0.5);border:1px dashed rgba(79,195,247,0.25);margin-bottom:8px;">
                    <div class="chat-transit-note" style="font-size:13px;color:rgba(79,195,247,0.7);font-style:italic;">${arrivalNote}</div>
                    <div class="message-bubble-time">${item.time}</div>
                    <div class="msg-actions-row">
                        ${actionsHtml(item.msgDbId)}
                    </div>
                </div>
            `;
        } else if (item.type === 'lunar-reply') {
            const lunarReplyPreview = ((item.text || '').replace('🌙 ', '')).substring(0, 40);
            html += `
                <div class="bubble-lunar-note" style="${item.sent ? 'margin-left:auto;' : ''}max-width:85%;">
                    <div class="bubble-lunar-label">${iconSvg('lunar-note', 'sm')} Lunar Note</div>
                    <div class="bubble-lunar-text">${(item.text || '').replace('🌙 ', '')}</div>
                    <div class="message-bubble-time" style="text-align:right;">${item.time}</div>
                    <div class="msg-actions-row">
                        ${actionsHtml(item.msgDbId)}
                        <button class="msg-comments-link" onclick="event.stopPropagation(); setReplyContext('🌙 ${lunarReplyPreview}')">↩ Reply</button>
                    </div>
                </div>
            `;
        } else if (item.type === 'reply') {
            const replyPreview = (item.text || '').substring(0, 40) + ((item.text || '').length > 40 ? '...' : '');
            const replyIsTransit = item.sent && (item.status === 'In Transit' || item.status === 'in_transit');
            if (replyIsTransit) {
                // In-transit reply — orbital glow design
                let etaLabel = '';
                if (item.releaseAt) {
                    const diff = new Date(item.releaseAt).getTime() - Date.now();
                    if (diff > 0) {
                        const h = Math.floor(diff / 3600000);
                        const m = Math.floor((diff % 3600000) / 60000);
                        etaLabel = h > 0 ? `Arrives in ${h}h ${m}m` : `Arrives in ${m}m`;
                    }
                }
                if (!etaLabel) etaLabel = item.location ? `Traveling toward ${item.location}` : 'Arriving at moonrise';
                html += `
                    <div class="message-bubble-transit-wrap">
                        <div class="message-bubble sent">
                            ${item.photoUrl ? `<img src="${item.photoUrl}" loading="lazy" style="max-width:100%;max-height:240px;border-radius:8px;margin-bottom:${item.text ? '6px' : '0'};object-fit:cover;display:block;">` : ''}
                            ${item.text ? `<p>${item.text}</p>` : ''}
                            <div class="message-bubble-time">${item.time}</div>
                            <div class="msg-actions-row">
                                ${actionsHtml(item.msgDbId)}
                                <button class="msg-comments-link" onclick="event.stopPropagation(); setReplyContext('${replyPreview.replace(/'/g, "\\'")}')">↩ Reply</button>
                            </div>
                        </div>
                        <div class="transit-eta-label">${iconSvg('lunar-note', 'sm')} ${etaLabel}</div>
                    </div>
                `;
            } else {
                html += `
                    <div class="message-bubble ${item.sent ? 'sent' : ''}">
                        ${item.photoUrl ? `<img src="${item.photoUrl}" loading="lazy" style="max-width:100%;max-height:240px;border-radius:8px;margin-bottom:${item.text ? '6px' : '0'};object-fit:cover;display:block;">` : ''}
                        ${item.text ? `<p>${item.text}</p>` : ''}
                        <div class="message-bubble-time">${item.time}</div>
                        <div class="msg-actions-row">
                            ${actionsHtml(item.msgDbId)}
                            <button class="msg-comments-link" onclick="event.stopPropagation(); setReplyContext('${replyPreview.replace(/'/g, "\\'")}')">↩ Reply</button>
                        </div>
                    </div>
                `;
            }
        }
    });

    // Close transit zone if it was opened
    if (transitBannerShown) {
        html += `</div>`; // close .transit-zone
    }

    if (!html) {
        html = `
            <div style="text-align:center;padding:40px 20px;color:rgba(79,195,247,0.4);font-size:13px;font-style:italic;">
                ✦ No transmissions yet ✦
            </div>
        `;
    }

    // Add typing indicator placeholder at the bottom
    html += `<div class="typing-indicator" id="typingIndicator" style="display:none;">
        <div class="typing-indicator-bubble">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </div>
        <span class="typing-indicator-label" id="typingLabel"></span>
    </div>`;

    content.innerHTML = html;

    // Generate stars in transit zone
    const transitZone = document.getElementById('transitZone');
    if (transitZone) {
        const starsContainer = document.createElement('div');
        starsContainer.className = 'transit-zone-stars';
        const count = 60;
        for (let i = 0; i < count; i++) {
            const s = document.createElement('div');
            s.className = 'transit-zone-star';
            const r = Math.random();
            const size = r > 0.9 ? (2.5 + Math.random() * 2) : (r > 0.6 ? (1.2 + Math.random() * 1) : (0.6 + Math.random() * 0.6));
            s.style.width = size + 'px';
            s.style.height = size + 'px';
            s.style.left = (Math.random() * 100) + '%';
            s.style.top = (Math.random() * 100) + '%';
            s.style.setProperty('--dur', (3 + Math.random() * 5) + 's');
            s.style.setProperty('--delay', (Math.random() * 6) + 's');
            s.style.setProperty('--peak', (0.3 + Math.random() * 0.5).toFixed(2));
            if (r > 0.9) s.style.boxShadow = '0 0 3px rgba(255,255,255,0.4)';
            starsContainer.appendChild(s);
        }
        transitZone.appendChild(starsContainer);
    }

    // Update reply row moon gating every time thread renders
    updateReplyRowMoonGate();
    updateInboxTransmitBtn();

    // Restore typing indicator if other user was typing
    if (_otherUserTyping) showTypingIndicator(true);
}

// ========================
// TYPING INDICATOR
// ========================
let _otherUserTyping = false;
let _typingTimeout = null;
let _typingChannel = null;
let _myTypingTimeout = null;
let _lastTypingEmit = 0;

function setupTypingChannel(conversationId) {
    // Clean up previous channel
    if (_typingChannel) {
        try { sb.removeChannel(_typingChannel); } catch(e) {}
        _typingChannel = null;
    }
    if (!conversationId || !currentAuthUser) return;

    _typingChannel = sb.channel(`typing-${conversationId}`);
    _typingChannel.on('broadcast', { event: 'typing' }, (payload) => {
        const data = payload.payload;
        if (data.userId === currentAuthUser.id) return; // ignore own typing
        if (data.isTyping) {
            _otherUserTyping = true;
            showTypingIndicator(true, data.username);
            // Auto-hide after 4s if no new typing event
            clearTimeout(_typingTimeout);
            _typingTimeout = setTimeout(() => {
                _otherUserTyping = false;
                showTypingIndicator(false);
            }, 4000);
        } else {
            _otherUserTyping = false;
            showTypingIndicator(false);
        }
    });
    _typingChannel.subscribe();
}

function emitTyping() {
    if (!_typingChannel || !currentAuthUser || !currentConversation) return;
    const now = Date.now();
    // Throttle: only emit every 2 seconds
    if (now - _lastTypingEmit < 2000) return;
    _lastTypingEmit = now;

    const profile = currentAuthUser.user_metadata || {};
    _typingChannel.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
            userId: currentAuthUser.id,
            username: profile.username || profile.first_name || 'Someone',
            isTyping: true
        }
    });

    // Auto-send "stopped typing" after 3s of no input
    clearTimeout(_myTypingTimeout);
    _myTypingTimeout = setTimeout(() => {
        if (_typingChannel) {
            _typingChannel.send({
                type: 'broadcast',
                event: 'typing',
                payload: { userId: currentAuthUser.id, isTyping: false }
            });
        }
    }, 3000);
}

function showTypingIndicator(show, username) {
    const el = document.getElementById('typingIndicator');
    const label = document.getElementById('typingLabel');
    if (!el) return;
    el.style.display = show ? 'flex' : 'none';
    if (label && username) {
        label.textContent = `${username} is composing...`;
    }
    // Scroll to bottom when typing appears
    if (show) {
        const content = document.getElementById('detailContent');
        if (content) content.scrollTop = content.scrollHeight;
    }
}

// ========================
// REPLY TO SPECIFIC MESSAGE
// ========================
let _replyContext = null;

function setReplyContext(preview) {
    _replyContext = preview;
    const bar = document.getElementById('replyContextBar');
    const text = document.getElementById('replyContextText');
    if (bar && text) {
        text.textContent = preview;
        bar.style.display = 'block';
    }
    // Focus reply input
    const input = document.getElementById('replyInput');
    if (input) input.focus();
}

function clearReplyContext() {
    _replyContext = null;
    const bar = document.getElementById('replyContextBar');
    if (bar) bar.style.display = 'none';
}

// Keep renderDetailContent as alias for compatibility with lunar note sending
function renderDetailContent(index) {
    if (currentConversation) {
        renderConversationThread();
    }
}

function closeMessageDetail() {
    // If URL has /chat/, use history.back() so browser history stays clean
    // The popstate handler will do the actual UI teardown
    if (window.location.pathname.match(/\/chat\//)) {
        history.back();
        return;
    }
    // Fallback: close directly (e.g. called without URL routing active)
    _closeMessageDetailUI();
}

function _closeMessageDetailUI() {
    const page = document.getElementById('messagePageView');
    function doClose() {
        page.classList.remove('active');
        page.classList.remove('closing');
        page.style.left = '';
        page.style.top = '';
        page.style.bottom = '';
        page.style.height = '';
        document.body.style.overflow = '';
        document.body.classList.remove('chat-open');
        currentMessageIndex = -1;
        currentConversationIndex = -1;
        currentConversation = null;
        if (_typingChannel) {
            try { sb.removeChannel(_typingChannel); } catch(e) {}
            _typingChannel = null;
        }
        _otherUserTyping = false;
        // Reset note toggle to open note mode
        if (typeof setNoteMode === 'function') setNoteMode('open');
        // Hide attachment menu
        const attachMenu = document.getElementById('attachMenu');
        if (attachMenu) attachMenu.style.display = 'none';
        renderMessages();
        renderMessageDots(); // Re-render dots now that ring is visible again
    }

    // Animate out (slide down), then close
    if (page.classList.contains('active')) {
        page.classList.add('closing');
        setTimeout(doClose, 250);
    } else {
        doClose();
    }
}


let threadLunarStep = 1;
let threadLunarGenerated = null;

let _threadLunarTemplateIdx = -1; // track current template for "try another version"

function openThreadLunar() {
    const panel = document.getElementById('threadLunarPanel');
    panel.style.display = 'block';
    threadLunarStep = 1;
    threadLunarGenerated = null;
    _threadLunarTemplateIdx = -1;

    // Pick unique prompts from combinatorial pools (different every compose)
    const userId = currentAuthUser?.id || 'anonymous';
    const seed = hashCode(userId + Date.now().toString());
    const p1 = Math.abs(seed) % LUNAR_POOL_1.length;
    const p2 = Math.abs(seed * 31 + 7) % LUNAR_POOL_2.length;
    const p3 = Math.abs(seed * 37 + 13) % LUNAR_POOL_3.length;
    const threadPrompts = [LUNAR_POOL_1[p1], LUNAR_POOL_2[p2], LUNAR_POOL_3[p3]];

    // Set moon data for moon-aware templates
    const moonPhase = getMoonPhase();
    const moonZodiac = getMoonZodiac();
    _lunarMoonPhase = moonPhase.phaseName.toLowerCase();
    _lunarZodiac = moonZodiac.sign;
    currentPromptSet = Math.abs(seed) % 10000;

    for (let i = 0; i < 3; i++) {
        document.getElementById('threadLabel' + (i+1)).textContent = threadPrompts[i].label;
        document.getElementById('threadLunarInput' + (i+1)).placeholder = threadPrompts[i].placeholder;
        document.getElementById('threadLunarInput' + (i+1)).value = '';
        document.getElementById('threadStep' + (i+1)).style.display = i === 0 ? 'block' : 'none';
        const nextBtn = document.getElementById('threadNext' + (i+1));
        if (nextBtn) nextBtn.disabled = true;
    }
    // Show steps, hide result card and send row
    document.getElementById('threadLunarSteps').style.display = 'block';
    document.getElementById('threadLunarResultCard').style.display = 'none';
    document.getElementById('threadLunarSendRow').style.display = 'none';
    document.getElementById('threadLunarInput1').focus();
}

function closeThreadLunar() {
    document.getElementById('threadLunarPanel').style.display = 'none';
    const addLink = document.getElementById('addLunarLink');
    if (addLink) addLink.style.display = '';
    threadLunarGenerated = null;
}

// Note mode toggle (Open Note / Lunar Note) with smooth transitions
let _currentNoteMode = 'open';
function toggleNoteMode() {
    setNoteMode(_currentNoteMode === 'open' ? 'lunar' : 'open');
}
function setNoteMode(mode) {
    _currentNoteMode = mode;
    const openBtn = document.getElementById('openNoteToggle');
    const lunarBtn = document.getElementById('lunarNoteToggle');
    const openPanel = document.getElementById('openNotePanel');
    const lunarPanel = document.getElementById('threadLunarPanel');

    if (mode === 'lunar') {
        openThreadLunar();
        if (lunarBtn) lunarBtn.classList.add('active');
        if (openBtn) openBtn.classList.remove('active');
        // Smooth crossfade: fade out open, fade in lunar
        if (openPanel) {
            openPanel.style.opacity = '0';
            openPanel.style.transition = 'opacity 0.2s ease, max-height 0.3s ease';
            openPanel.style.maxHeight = '0';
            openPanel.style.overflow = 'hidden';
            setTimeout(() => { openPanel.style.display = 'none'; }, 200);
        }
        if (lunarPanel) {
            lunarPanel.style.display = 'block';
            lunarPanel.style.opacity = '0';
            lunarPanel.style.maxHeight = '0';
            lunarPanel.style.overflow = 'hidden';
            lunarPanel.style.transition = 'opacity 0.25s ease 0.1s, max-height 0.35s ease';
            requestAnimationFrame(() => {
                lunarPanel.style.maxHeight = '500px';
                lunarPanel.style.opacity = '1';
                setTimeout(() => { lunarPanel.style.overflow = ''; lunarPanel.style.maxHeight = ''; }, 350);
            });
        }
    } else {
        closeThreadLunar();
        if (openBtn) openBtn.classList.add('active');
        if (lunarBtn) lunarBtn.classList.remove('active');
        // Smooth crossfade: fade out lunar, fade in open
        if (lunarPanel) {
            lunarPanel.style.opacity = '0';
            lunarPanel.style.transition = 'opacity 0.2s ease, max-height 0.3s ease';
            lunarPanel.style.maxHeight = '0';
            lunarPanel.style.overflow = 'hidden';
            setTimeout(() => { lunarPanel.style.display = 'none'; }, 200);
        }
        if (openPanel) {
            openPanel.style.display = 'block';
            openPanel.style.opacity = '0';
            openPanel.style.maxHeight = '0';
            openPanel.style.overflow = 'hidden';
            openPanel.style.transition = 'opacity 0.25s ease 0.1s, max-height 0.3s ease';
            requestAnimationFrame(() => {
                openPanel.style.maxHeight = '200px';
                openPanel.style.opacity = '1';
                setTimeout(() => { openPanel.style.overflow = ''; openPanel.style.maxHeight = ''; }, 300);
            });
        }
    }
}

// Attachment menu toggle
function toggleAttachMenu() {
    const menu = document.getElementById('attachMenu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

function triggerPhotoAttach() {
    document.getElementById('replyPhotoInput').click();
    document.getElementById('attachMenu').style.display = 'none';
}

function triggerYoutubeAttach() {
    const url = prompt('Paste YouTube link:');
    if (url && url.includes('youtu')) {
        const input = document.getElementById('replyInput');
        input.value = (input.value ? input.value + ' ' : '') + url;
        input.focus();
    }
    document.getElementById('attachMenu').style.display = 'none';
}

function updateThreadLunarNextBtn(step) {
    const val = document.getElementById('threadLunarInput' + step).value.trim();
    const nextBtn = document.getElementById('threadNext' + step);
    if (nextBtn) nextBtn.disabled = !val;
}

// Enter key advances steps in thread lunar wizard
(function() {
    document.addEventListener('DOMContentLoaded', () => {
        for (let i = 1; i <= 3; i++) {
            const input = document.getElementById('threadLunarInput' + i);
            if (input) {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && input.value.trim()) {
                        e.preventDefault();
                        if (i < 3) advanceThreadStep(i + 1);
                        else generateThreadLunarResult();
                    }
                });
            }
        }
    });
})();

function advanceThreadStep(toStep) {
    // Show ONLY the target step (hide all others, like compose page does)
    for (let i = 1; i <= 3; i++) {
        document.getElementById('threadStep' + i).style.display = (i === toStep) ? 'block' : 'none';
    }
    threadLunarStep = toStep;
    setTimeout(() => {
        const input = document.getElementById('threadLunarInput' + toStep);
        if (input) input.focus();
    }, 50);
}

function goBackThreadStep(toStep) {
    // Show ONLY the target step (hide all others)
    for (let i = 1; i <= 3; i++) {
        document.getElementById('threadStep' + i).style.display = (i === toStep) ? 'block' : 'none';
    }
    threadLunarStep = toStep;
    setTimeout(() => {
        const input = document.getElementById('threadLunarInput' + toStep);
        if (input) input.focus();
    }, 50);
}

function generateThreadLunarResult() {
    const v1 = document.getElementById('threadLunarInput1').value.trim();
    const v2 = document.getElementById('threadLunarInput2').value.trim();
    const v3 = document.getElementById('threadLunarInput3').value.trim();
    if (!v1 || !v2 || !v3) return;

    // Pick template (random first time, tracked for "try another version")
    if (_threadLunarTemplateIdx < 0) {
        _threadLunarTemplateIdx = Math.floor(Math.random() * lunarTemplates.length);
    }
    const result = generateLunarNote(v1, v2, v3, _threadLunarTemplateIdx);
    threadLunarGenerated = result;
    _threadLunarTemplateIdx = result.templateIdx;

    // Hide steps, show result card + send button
    document.getElementById('threadLunarSteps').style.display = 'none';
    document.getElementById('threadLunarResultText').textContent = result.lines;
    document.getElementById('threadLunarResultClosing').textContent = result.closing;
    const card = document.getElementById('threadLunarResultCard');
    card.style.display = 'block';
    card.style.animation = 'none';
    card.offsetHeight;
    card.style.animation = 'threadLunarCardIn 0.35s ease';
    document.getElementById('threadLunarSendRow').style.display = 'block';
}

function editThreadInputs() {
    // Go back to step 1 to edit (preserve input values)
    document.getElementById('threadLunarResultCard').style.display = 'none';
    document.getElementById('threadLunarSendRow').style.display = 'none';
    document.getElementById('threadLunarSteps').style.display = 'block';
    // Show step 1
    for (let i = 1; i <= 3; i++) {
        document.getElementById('threadStep' + i).style.display = i === 1 ? 'block' : 'none';
    }
    threadLunarStep = 1;
    threadLunarGenerated = null;
    setTimeout(() => {
        const input = document.getElementById('threadLunarInput1');
        if (input) input.focus();
    }, 50);
}

function regenerateThreadLunar() {
    const v1 = document.getElementById('threadLunarInput1').value.trim();
    const v2 = document.getElementById('threadLunarInput2').value.trim();
    const v3 = document.getElementById('threadLunarInput3').value.trim();
    if (!v1 || !v2 || !v3) return;

    // Pick a DIFFERENT template
    let newIdx;
    do {
        newIdx = Math.floor(Math.random() * lunarTemplates.length);
    } while (newIdx === _threadLunarTemplateIdx && lunarTemplates.length > 1);

    _threadLunarTemplateIdx = newIdx;
    const result = generateLunarNote(v1, v2, v3, newIdx);
    threadLunarGenerated = result;

    document.getElementById('threadLunarResultText').textContent = result.lines;
    document.getElementById('threadLunarResultClosing').textContent = result.closing;

    // Replay animation
    const card = document.getElementById('threadLunarResultCard');
    card.style.animation = 'none';
    card.offsetHeight;
    card.style.animation = 'threadLunarCardIn 0.35s ease';
}

async function sendThreadLunarNote() {
    if (!threadLunarGenerated) return;
    // Find the target message (latest in conversation or current)
    let msg = null;
    if (currentConversation) {
        msg = currentConversation.messages[0];
    } else if (currentMessageIndex >= 0) {
        msg = messages[currentMessageIndex];
    }
    if (!msg) return;

    // Add as a reply-type lunar note
    if (!msg.replies) msg.replies = [];
    const now = new Date().toISOString();
    const lunarReply = {
        id: null, dbId: null,
        text: '🌙 ' + threadLunarGenerated.lines + '\n' + threadLunarGenerated.closing,
        time: 'Just now',
        createdAt: now,
        sent: true,
        isLunarNote: true,
        reactions: []
    };
    msg.replies.push(lunarReply);

    // Save to Supabase — with moon-based transit logic
    if (currentAuthUser && msg.dbId) {
        // Check recipient's moon: use rise/set times as definitive source
        const recipientCity = currentConversation?.location || msg.location || 'Unknown';
        // Determine if recipient's moon is up using direct altitude check
        const lunarMoonStatus = getContactMoonStatus(recipientCity);
        let lunarMoonUp = false;
        if (lunarMoonStatus) {
            lunarMoonUp = lunarMoonStatus.isUp;
        } else {
            lunarMoonUp = !!moonData.isVisible;
        }
        const recipientMoonrise = getRecipientMoonrise(recipientCity);
        let lunarReleaseAt = recipientMoonrise ? recipientMoonrise.date.toISOString() : null;
        console.log('[lunarReply] city:', recipientCity, 'moonStatus.isUp:', lunarMoonStatus?.isUp, 'moonUp:', lunarMoonUp, 'status:', lunarMoonUp ? 'released' : 'in_transit');

        if (!lunarReleaseAt && !lunarMoonUp) {
            lunarReleaseAt = new Date(Date.now() + 12 * 3600000).toISOString();
        }
        const lunarInstant = lunarMoonUp === true;
        const lunarStatus = lunarInstant ? 'released' : 'in_transit';
        const lunarFinalRelease = lunarInstant ? new Date().toISOString() : lunarReleaseAt;
        console.log('[lunarReply] city:', recipientCity, 'moonUp:', lunarMoonUp, 'status:', lunarStatus);

        const { data: lunarData, error } = await sb.from('replies').insert({
            message_id: msg.dbId,
            sender_id: currentAuthUser.id,
            text: '🌙 ' + threadLunarGenerated.lines + '\n' + threadLunarGenerated.closing,
            is_lunar_note: true,
            lunar_note_text: threadLunarGenerated.lines,
            lunar_note_closing: threadLunarGenerated.closing,
            status: lunarStatus,
            release_at: lunarFinalRelease,
            recipient_city: recipientCity
        }).select().single();
        if (error) console.error('Lunar note reply save failed:', error);
        if (lunarData) { lunarReply.id = lunarData.id; lunarReply.dbId = lunarData.id; }

        // If in_transit, add synthetic dot on the ring
        if (lunarStatus === 'in_transit' && lunarFinalRelease) {
            const otherName = currentConversation?.otherName || 'Unknown';
            messages.push({
                dbId: lunarData?.id || 'lunar-reply-' + Date.now(),
                senderId: currentAuthUser.id,
                sender: otherName,
                type: 'sent',
                location: recipientCity,
                status: 'In Transit',
                releaseAt: lunarFinalRelease,
                createdAt: new Date().toISOString(),
                time: 'Just now',
                isReplyDot: true,
                preview: '',
                replies: []
            });
            renderMessageDots();
        }
    }

    closeThreadLunar();
    renderConversationThread();
    document.getElementById('detailContent').scrollTop = document.getElementById('detailContent').scrollHeight;
}

let pendingSharedSkyPhoto = null;

function handleSharedSkyPhoto(input) {
    handlePhotoAttachment(input, 'sharedSkyPhotoImg', 'sharedSkyPhotoPreview', null, 'sharedsky');
    // Also keep data URL for optimistic display
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => { pendingSharedSkyPhoto = e.target.result; };
        reader.readAsDataURL(input.files[0]);
    }
}

function clearSharedSkyPhoto() {
    pendingSharedSkyPhoto = null;
    window['_pendingPhotoFile_sharedsky'] = null;
    document.getElementById('sharedSkyPhotoPreview').style.display = 'none';
    document.getElementById('sharedSkyPhotoInput').value = '';
}

let ssLunarNoteActive = false;

async function sendSharedSkyMessage() {
    const input = document.getElementById('sharedSkyInput');
    const text = input.value.trim();
    const hasPhoto = !!window['_pendingPhotoFile_sharedsky'];

    // Get lunar note data if active
    const ssLunarText = ssLunarNoteActive ? (document.getElementById('ssLunarResultText')?.textContent || '') : '';
    const ssLunarClosing = ssLunarNoteActive ? (document.getElementById('ssLunarResultClosing')?.textContent || '') : '';
    const hasLunar = ssLunarNoteActive && ssLunarText;

    if (!text && !hasPhoto && !hasLunar) return;

    const userName = localStorage.getItem('moonpop_username') || 'Anonymous';
    const userLoc = localStorage.getItem('moonpop_location');
    let locName = 'Unknown';
    if (userLoc) {
        try { locName = JSON.parse(userLoc).name || 'Unknown'; } catch(e) {}
    }

    // Optimistic local entry
    const transmission = {
        userId: currentAuthUser?.id || null,
        senderName: userName,
        location: locName,
        time: 'Just now',
        createdAt: new Date().toISOString(),
        message: text ? '"' + text + '"' : '',
        photo: pendingSharedSkyPhoto || null,
        lunarNoteText: hasLunar ? ssLunarText : null,
        lunarNoteClosing: hasLunar ? ssLunarClosing : null
    };
    globalTransmissions.unshift(transmission);

    // Compress & upload photo
    let photoUrl = null;
    if (hasPhoto) {
        photoUrl = await compressAndUpload('sharedsky', 'shared-sky');
        if (photoUrl) transmission.photo = photoUrl;
    }

    // Save to Supabase
    if (currentAuthUser) {
        const insertData = {
            user_id: currentAuthUser.id,
            city: locName,
            message: text || (hasLunar ? '' : '🌕')
        };
        if (photoUrl) insertData.photo_url = photoUrl;
        if (hasLunar) {
            insertData.lunar_note_text = ssLunarText;
            insertData.lunar_note_closing = ssLunarClosing || null;
        }
        const { error } = await sb.from('shared_sky').insert(insertData);
        if (error) console.error('Shared sky save failed:', error);
    }

    input.value = '';
    clearSharedSkyPhoto();
    if (ssLunarNoteActive) resetSharedSkyLunarNote();
    renderSharedSkySignals();

    // Update inbox preview
    const previewEl = document.getElementById('sharedSkyPreview');
    const previewName = userName || locName;
    if (previewEl) previewEl.textContent = previewName + ': ' + (hasLunar ? '🌙 Lunar Note' : text ? '"' + text + '"' : '🌕 Photo');
    localStorage.setItem('moonpop_shared_sky_seen', new Date().toISOString());
    updateSharedSkyBadge();
}

// Shared Sky note mode toggle (matches chat pattern)
let _ssNoteMode = 'open';
function toggleSSNoteMode() {
    setSSNoteMode(_ssNoteMode === 'open' ? 'lunar' : 'open');
}
function setSSNoteMode(mode) {
    _ssNoteMode = mode;
    const openBtn = document.getElementById('ssOpenToggle');
    const lunarBtn = document.getElementById('ssLunarToggle');
    const openPanel = document.getElementById('ssOpenNotePanel');
    const lunarPanel = document.getElementById('ssLunarPanel');
    if (mode === 'lunar') {
        toggleSharedSkyLunarNote_activate();
        if (lunarBtn) lunarBtn.classList.add('active');
        if (openBtn) openBtn.classList.remove('active');
        if (openPanel) openPanel.style.display = 'none';
        if (lunarPanel) lunarPanel.style.display = 'block';
    } else {
        resetSharedSkyLunarNote();
        if (openBtn) openBtn.classList.add('active');
        if (lunarBtn) lunarBtn.classList.remove('active');
        if (lunarPanel) lunarPanel.style.display = 'none';
        if (openPanel) openPanel.style.display = 'block';
    }
}

// Shared Sky Lunar Note functions
function toggleSharedSkyLunarNote() {
    if (ssLunarNoteActive) {
        setSSNoteMode('open');
    } else {
        setSSNoteMode('lunar');
    }
}
function toggleSharedSkyLunarNote_activate() {
    ssLunarNoteActive = true;
    const seed = hashCode((currentAuthUser?.id || 'anon') + Date.now().toString());
    const p1 = Math.abs(seed) % LUNAR_POOL_1.length;
    const p2 = Math.abs(seed * 31 + 7) % LUNAR_POOL_2.length;
    const p3 = Math.abs(seed * 37 + 13) % LUNAR_POOL_3.length;
    document.getElementById('ssLunarLabel1').textContent = LUNAR_POOL_1[p1].label;
    document.getElementById('ssLunarInput1').placeholder = LUNAR_POOL_1[p1].placeholder;
    document.getElementById('ssLunarLabel2').textContent = LUNAR_POOL_2[p2].label;
    document.getElementById('ssLunarInput2').placeholder = LUNAR_POOL_2[p2].placeholder;
    document.getElementById('ssLunarLabel3').textContent = LUNAR_POOL_3[p3].label;
    document.getElementById('ssLunarInput3').placeholder = LUNAR_POOL_3[p3].placeholder;
    goSSLunarStep(1);
    document.getElementById('ssLunarResultCard').style.display = 'none';
    document.getElementById('ssLunarSendRow').style.display = 'none';
    setTimeout(() => document.getElementById('ssLunarInput1').focus(), 100);
}

function resetSharedSkyLunarNote() {
    ssLunarNoteActive = false;
    _ssNoteMode = 'open';
    const panel = document.getElementById('ssLunarPanel');
    if (panel) panel.style.display = 'none';
    const resultCard = document.getElementById('ssLunarResultCard');
    if (resultCard) resultCard.style.display = 'none';
    const sendRow = document.getElementById('ssLunarSendRow');
    if (sendRow) sendRow.style.display = 'none';
    for (let i = 1; i <= 3; i++) {
        const inp = document.getElementById('ssLunarInput' + i);
        if (inp) inp.value = '';
    }
}

function goSSLunarStep(step) {
    for (let i = 1; i <= 3; i++) {
        const card = document.getElementById('ssLunarStep' + i);
        if (card) card.classList.toggle('active', i === step);
    }
    setTimeout(() => {
        const input = document.getElementById('ssLunarInput' + step);
        if (input) input.focus();
    }, 100);
}

function revealSSLunarNote() {
    const v1 = document.getElementById('ssLunarInput1').value.trim();
    const v2 = document.getElementById('ssLunarInput2').value.trim();
    const v3 = document.getElementById('ssLunarInput3').value.trim();
    if (!v1 || !v2 || !v3) return;
    for (let i = 1; i <= 3; i++) document.getElementById('ssLunarStep' + i).classList.remove('active');
    const templateIdx = Math.floor(Math.random() * lunarTemplates.length);
    const result = generateLunarNote(v1, v2, v3, templateIdx);
    document.getElementById('ssLunarResultText').textContent = result.lines;
    document.getElementById('ssLunarResultClosing').textContent = result.closing;
    document.getElementById('ssLunarResultCard').style.display = 'block';
    document.getElementById('ssLunarSendRow').style.display = 'block';
    window._ssLunarTemplateIdx = templateIdx;
}

function regenerateSSLunarNote() {
    const v1 = document.getElementById('ssLunarInput1').value.trim();
    const v2 = document.getElementById('ssLunarInput2').value.trim();
    const v3 = document.getElementById('ssLunarInput3').value.trim();
    if (!v1 || !v2 || !v3) return;
    const newIdx = ((window._ssLunarTemplateIdx || 0) + 1) % lunarTemplates.length;
    const result = generateLunarNote(v1, v2, v3, newIdx);
    document.getElementById('ssLunarResultText').textContent = result.lines;
    document.getElementById('ssLunarResultClosing').textContent = result.closing;
    window._ssLunarTemplateIdx = newIdx;
}
// Reply photo attachment
let pendingReplyPhoto = null;

function handleReplyPhoto(input) {
    handlePhotoAttachment(input, 'replyPhotoImg', 'replyPhotoPreview', null, 'reply');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => { pendingReplyPhoto = e.target.result; };
        reader.readAsDataURL(input.files[0]);
    }
}

function clearReplyPhoto() {
    pendingReplyPhoto = null;
    window['_pendingPhotoFile_reply'] = null;
    document.getElementById('replyPhotoPreview').style.display = 'none';
    document.getElementById('replyPhotoInput').value = '';
}

async function sendReply() {
    // Bug fix #1: Gate replies behind moonrise
    if (!moonData.isVisible) {
        openMoonDownModal();
        return;
    }

    const input = document.getElementById('replyInput');
    const hasPhoto = !!window['_pendingPhotoFile_reply'];
    if (!input.value.trim() && !hasPhoto) return;

    // Save conversation key BEFORE any mutations
    const prevKey = currentConversation?.otherKey;

    // Find the target message by dbId (stable reference)
    // IMPORTANT: search currentConversation.messages FIRST, because
    // loadFullConversationThread() replaces them with different objects
    // than the global messages array. The reply must go on the object
    // that renderConversationThread() actually renders.
    let targetDbId = null;
    if (currentConversation) {
        targetDbId = currentConversation.messages[0]?.dbId;
    } else if (currentMessageIndex >= 0) {
        targetDbId = messages[currentMessageIndex]?.dbId;
    }
    let targetMsg = null;
    if (targetDbId) {
        if (currentConversation) {
            targetMsg = currentConversation.messages.find(m => m.dbId === targetDbId);
        }
        if (!targetMsg) {
            targetMsg = messages.find(m => m.dbId === targetDbId);
        }
    }
    if (!targetMsg) {
        if (currentConversation) targetMsg = currentConversation.messages[0];
        else if (currentMessageIndex >= 0) targetMsg = messages[currentMessageIndex];
    }
    if (!targetMsg) return;

    if (!targetMsg.replies) targetMsg.replies = [];

    let replyText = input.value.trim();
    const now = new Date().toISOString();

    // If replying to a specific message, prepend context
    if (_replyContext) {
        replyText = `↩ ${_replyContext}\n${replyText}`;
        clearReplyContext();
    }

    // Pre-compute transit status for optimistic rendering
    const _optCity = currentConversation?.location || targetMsg.location || 'Unknown';
    const _optMoonStatus = getContactMoonStatus(_optCity);
    const _optMoonUp = _optMoonStatus ? _optMoonStatus.isUp : !!moonData.isVisible;
    const _optMoonrise = getRecipientMoonrise(_optCity);
    let _optReleaseAt = _optMoonrise ? _optMoonrise.date.toISOString() : null;
    if (!_optReleaseAt && !_optMoonUp) _optReleaseAt = new Date(Date.now() + 12 * 3600000).toISOString();
    const _optInstant = _optMoonUp === true;

    // Optimistic reply (id/dbId will be set after DB insert confirms)
    const optimisticReply = { id: null, dbId: null, text: replyText, time: 'Just now', createdAt: now, sent: true, senderId: currentAuthUser?.id, photoUrl: pendingReplyPhoto || null, reactions: [],
        status: _optInstant ? 'Released' : 'In Transit',
        releaseAt: _optInstant ? now : _optReleaseAt,
        recipientCity: _optCity
    };
    targetMsg.replies.push(optimisticReply);

    // Clear input immediately for snappy feel
    input.value = '';

    // Stop typing emission
    if (_typingChannel && currentAuthUser) {
        _typingChannel.send({ type: 'broadcast', event: 'typing', payload: { userId: currentAuthUser.id, isTyping: false } });
    }
    const hadPhoto = hasPhoto;

    // Render immediately with optimistic data
    renderConversationThread();
    document.getElementById('detailContent').scrollTop = document.getElementById('detailContent').scrollHeight;

    // Block realtime reloads during send to prevent the view from flashing
    isReloadingMessages = true;

    try {
        // Compress & upload photo
        let replyPhotoUrl = null;
        if (hadPhoto) {
            replyPhotoUrl = await compressAndUpload('reply', 'replies');
            if (replyPhotoUrl) optimisticReply.photoUrl = replyPhotoUrl;
        }
        clearReplyPhoto();

        // Save to Supabase — with moon-based release_at for dot rendering
        if (currentAuthUser && targetMsg.dbId) {
            // Get recipient city and compute next moonrise
            // Use raw SunCalc altitude (simpler & more reliable than isMoonVisible)
            const recipientCity = currentConversation?.location || targetMsg.location || 'Unknown';
            // Determine if recipient's moon is up using direct altitude check
            const replyMoonStatus = getContactMoonStatus(recipientCity);
            let replyMoonUp = false;
            if (replyMoonStatus) {
                replyMoonUp = replyMoonStatus.isUp;
            } else {
                replyMoonUp = !!moonData.isVisible;
            }
            const recipientMoonrise = getRecipientMoonrise(recipientCity);
            let replyReleaseAt = recipientMoonrise ? recipientMoonrise.date.toISOString() : null;
            console.log('[sendReply] city:', recipientCity, 'moonStatus.isUp:', replyMoonStatus?.isUp, 'moonUp:', replyMoonUp);

            // If moon is down and no moonrise data, use 12h fallback
            if (!replyReleaseAt && !replyMoonUp) {
                replyReleaseAt = new Date(Date.now() + 12 * 3600000).toISOString();
                console.warn('[sendReply] No moonrise data for', recipientCity, '— using 12h fallback');
            }
            const replyInstantDeliver = replyMoonUp === true;
            const replyStatus = replyInstantDeliver ? 'released' : 'in_transit';
            const finalReleaseAt = replyInstantDeliver ? new Date().toISOString() : replyReleaseAt;
            console.log('[sendReply] city:', recipientCity, 'moonUp:', replyMoonUp, 'instant:', replyInstantDeliver);

            const insertData = {
                message_id: targetMsg.dbId,
                sender_id: currentAuthUser.id,
                text: replyText || '🌕',
                status: replyStatus,
                release_at: finalReleaseAt,
                recipient_city: recipientCity
            };
            if (replyPhotoUrl) insertData.photo_url = replyPhotoUrl;
            const { data: replyData, error } = await sb.from('replies').insert(insertData).select().single();
            if (error) {
                console.error('Reply save failed:', error);
                const idx = targetMsg.replies.findIndex(r => r.createdAt === now && r.text === replyText);
                if (idx >= 0) targetMsg.replies.splice(idx, 1);
                renderConversationThread();
                return;
            }
            // Update optimistic reply with real timestamp and DB id
            const lastReply = targetMsg.replies.find(r => r.createdAt === now && r.text === replyText);
            if (lastReply && replyData) {
                lastReply.createdAt = replyData.created_at;
                lastReply.id = replyData.id;
                lastReply.dbId = replyData.id;
            }

            // If reply is in_transit (recipient moon is down), add a synthetic
            // entry to the messages array so renderMessageDots() shows a dot on the ring
            if (replyStatus === 'in_transit' && finalReleaseAt) {
                const otherName = currentConversation?.otherName || targetMsg.sender || 'Unknown';
                messages.push({
                    dbId: replyData?.id || 'reply-' + Date.now(),
                    senderId: currentAuthUser.id,
                    recipientProfileId: currentConversation?.otherProfileId || null,
                    sender: otherName,
                    type: 'sent',
                    location: recipientCity,
                    status: 'In Transit',
                    releaseAt: finalReleaseAt,
                    createdAt: now,
                    time: 'Just now',
                    isReplyDot: true,
                    preview: '',
                    replies: []
                });
                console.log('[sendReply] Added synthetic dot entry for', otherName, '@', recipientCity, 'releaseAt:', finalReleaseAt);
                // Store send diagnostics
                window._lastSendDiag = {
                    location: recipientCity,
                    recipientMoonUp: replyMoonUp,
                    hoursUntilRise: replyHoursUntilRise?.toFixed(2) || 'N/A',
                    instantDeliver: replyInstantDeliver,
                    releaseAt: finalReleaseAt,
                    messageStatus: replyStatus,
                    dbReleaseAt: replyData?.release_at || finalReleaseAt,
                    sentAt: new Date().toISOString(),
                    source: 'sendReply'
                };
                renderMessageDots();
            }
        }
    } finally {
        // Unblock realtime reloads after a cooldown
        setTimeout(() => { isReloadingMessages = false; }, 1500);
    }

    // Update inbox preview inline (DON'T rebuild conversations — that would
    // wipe the full thread loaded by loadFullConversationThread and lose messages)
    if (currentConversation) {
        currentConversation.latestCreatedAt = now;
        currentConversation.latestTime = 'Just now';
        currentConversation.latestPreview = 'You: ' + (replyText || '🌙');
        if (currentConversation.latestPreview.length > 50) {
            currentConversation.latestPreview = currentConversation.latestPreview.substring(0, 50) + '...';
        }
        currentConversation.unreadCount = 0;
        conversations.sort((a, b) => new Date(b.latestCreatedAt) - new Date(a.latestCreatedAt));
        currentConversationIndex = conversations.indexOf(currentConversation);
    }
    renderMessages();
    renderConversationThread();
    document.getElementById('detailContent').scrollTop = document.getElementById('detailContent').scrollHeight;
}

// ========================
