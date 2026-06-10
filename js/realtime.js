// Realtime, Polling & Presence

// REALTIME + POLLING ENGINE
// ========================
let realtimeChannels = [];      // Track all channels for cleanup
let pollInterval = null;        // Fallback polling timer
// releaseInterval removed — message release now handled by server-side pg_cron job
let realtimeWorking = false;    // Track if realtime events actually fire
let isReloadingMessages = false; // Debounce guard

// Inbox sort state — 'recent' | 'oldest' | 'unread'
let inboxSortMode = 'recent';

// Load in-transit replies from DB and add as synthetic dot entries
async function loadInTransitReplies() {
    if (!currentAuthUser) return;
    try {
        const { data: transitReplies } = await sb.from('replies')
            .select('id, sender_id, recipient_city, release_at, created_at, message_id')
            .eq('status', 'in_transit')
            .eq('sender_id', currentAuthUser.id);
        if (transitReplies && transitReplies.length > 0) {
            for (const r of transitReplies) {
                // Don't add duplicates
                if (messages.find(m => m.dbId === r.id)) continue;
                // Find the conversation this reply belongs to
                const parentMsg = messages.find(m => m.dbId === r.message_id);
                const otherName = parentMsg?.sender || 'Unknown';
                messages.push({
                    dbId: r.id,
                    senderId: r.sender_id,
                    sender: otherName,
                    type: 'sent',
                    location: r.recipient_city || 'Unknown',
                    status: 'In Transit',
                    releaseAt: r.release_at,
                    createdAt: r.created_at,
                    time: '',
                    isReplyDot: true,
                    preview: '',
                    replies: []
                });
            }
            if (window.__DEBUG_DOTS) console.log('[dots] Added', transitReplies.length, 'in-transit reply dot(s)');
        }
    } catch (e) {
        console.error('loadInTransitReplies error:', e);
    }
}

// Debounced message reload — prevents rapid concurrent reloads
let _pendingReload = false;
async function debouncedReloadMessages() {
    if (isReloadingMessages) {
        _pendingReload = true;
        return;
    }
    isReloadingMessages = true;
    console.log('[reload] debouncedReloadMessages triggered');
    try {
        const prevKey = currentConversation?.otherKey;

        // CRITICAL: Save existing replies, reactions, AND releaseAt before reload
        // loadMessages() creates new message objects WITHOUT replies/reactions.
        // Without preserving them, inbox previews show stale text and
        // open conversations lose their thread history.
        // releaseAt may be set client-side but missing in DB (Edge Function may not preserve it)
        const prevReplies = {};
        const prevReactions = {};
        const prevReleaseAt = {};
        messages.forEach(m => {
            if (m.dbId) {
                if (m.replies && m.replies.length > 0) prevReplies[m.dbId] = m.replies;
                if (m.reactions && m.reactions.length > 0) prevReactions[m.dbId] = m.reactions;
                if (m.releaseAt) prevReleaseAt[m.dbId] = m.releaseAt;
            }
        });

        await loadMessages();
        // Load roulette messages in parallel so ring dots stay in sync
        loadRouletteMessages().catch(() => {});

        // Restore replies, reactions, and releaseAt to the new message objects
        messages.forEach(m => {
            if (m.dbId) {
                if (prevReplies[m.dbId] && (!m.replies || m.replies.length === 0)) {
                    m.replies = prevReplies[m.dbId];
                }
                if (prevReactions[m.dbId] && (!m.reactions || m.reactions.length === 0)) {
                    m.reactions = prevReactions[m.dbId];
                }
                // Restore releaseAt if DB lost it or returned a past value
                // while our client had a future value (Edge Function may alter release_at)
                if (prevReleaseAt[m.dbId]) {
                    const dbRelease = m.releaseAt ? new Date(m.releaseAt) : null;
                    const prevRelease = new Date(prevReleaseAt[m.dbId]);
                    const nowR = new Date();
                    if (!dbRelease || (prevRelease > dbRelease && prevRelease > nowR)) {
                        console.log('[reload] Restored releaseAt for', m.dbId, '| DB had:', m.releaseAt, '→ using:', prevReleaseAt[m.dbId]);
                        m.releaseAt = prevReleaseAt[m.dbId];
                    }
                }
            }
        });

        // Rebuild conversations WITH replies restored (for accurate previews)
        buildConversations();
        await loadConversationMetadata();

        // Load in-transit replies and add as synthetic dot entries
        await loadInTransitReplies();

        if (prevKey) {
            const newConv = conversations.find(c => c.otherKey === prevKey);
            if (newConv) {
                currentConversation = newConv;
                currentConversationIndex = conversations.indexOf(newConv);
                // We're viewing this conversation — always zero unread and refresh read receipt
                newConv.unreadCount = 0;
                if (newConv.dbConversationId) {
                    saveLocalReadReceipt(newConv.dbConversationId);
                    const now = new Date().toISOString();
                    sb.from('read_receipts').upsert({
                        conversation_id: newConv.dbConversationId,
                        user_id: currentAuthUser.id,
                        last_read_at: now,
                        created_at: now,
                        updated_at: now
                    }, { onConflict: 'conversation_id,user_id' }).then(() => {});
                }
            }
        }
        renderMessages();
        renderMessageDots();
        updateOrbitCenter(); // Update hero title + carrying count
        checkForNewMessageNotifications();

        // If conversation is open, reload the FULL thread from DB
        // buildConversations() only keeps a subset of messages from the global array.
        // We need to re-fetch ALL messages for this conversation so replies aren't lost.
        if (currentConversation && currentConversation.dbConversationId) {
            await loadFullConversationThread(currentConversation);

            // Now load replies + reactions for ALL messages in the full thread
            const msgIds = currentConversation.messages.filter(m => m.dbId).map(m => m.dbId);
            if (msgIds.length > 0 && currentAuthUser) {
                // replies_v (not replies): server-side seal — content columns are
                // NULL while a reply is in transit for me (migration 043).
                const { data: freshReplies } = await sb.from('replies_v')
                    .select('*')
                    .in('message_id', msgIds)
                    .order('created_at', { ascending: true });
                if (freshReplies) {
                    const replyMap = {};
                    freshReplies.forEach(r => {
                        if (!replyMap[r.message_id]) replyMap[r.message_id] = [];
                        // Incoming replies stay SEALED until release — same gate as openConversation.
                        const sealed = replyStillSealed(r, currentAuthUser.id);
                        replyMap[r.message_id].push({
                            id: r.id,
                            dbId: r.id,
                            text: sealed ? '' : r.text,
                            time: timeAgo(r.created_at),
                            createdAt: r.created_at,
                            sent: r.sender_id === currentAuthUser.id,
                            senderId: r.sender_id,
                            isLunarNote: r.is_lunar_note || false,
                            photoUrl: sealed ? null : (r.photo_url || null),
                            status: r.sender_id === currentAuthUser.id ? (r.status === 'in_transit' ? 'In Transit' : 'Released') : (sealed ? 'Arriving' : ''),
                            stillInTransit: sealed,
                            releaseAt: r.release_at || null,
                            recipientCity: r.recipient_city || null,
                            reactions: []
                        });
                    });
                    currentConversation.messages.forEach(msg => {
                        if (msg.dbId && replyMap[msg.dbId]) {
                            msg.replies = replyMap[msg.dbId];
                        }
                    });
                }

                // Apply cached reactions to freshly loaded replies
                if (Object.keys(_reactionCache).length > 0) {
                    currentConversation.messages.forEach(msg => {
                        if (msg.dbId && _reactionCache[msg.dbId]) {
                            const e = _reactionCache[msg.dbId];
                            msg.reactions = e.reactions || e;
                        }
                        if (msg.replies) msg.replies.forEach(r => {
                            if (r.dbId && _reactionCache[r.dbId]) {
                                const e = _reactionCache[r.dbId];
                                r.reactions = e.reactions || e;
                            }
                        });
                    });
                }

                // Also load reactions for all messages AND replies
                // Skip if a reaction was just added (cooldown prevents overwriting fresh data)
                if (!_reactionCooldown) {
                    const allReactionIds = [...msgIds];
                    currentConversation.messages.forEach(msg => {
                        if (msg.replies) msg.replies.forEach(r => { if (r.dbId) allReactionIds.push(r.dbId); });
                    });
                    const { data: freshReactions } = await sb.from('reactions')
                        .select('*')
                        .in('message_id', allReactionIds);
                    if (freshReactions) {
                        const rxnMap = {};
                        freshReactions.forEach(r => {
                            if (!rxnMap[r.message_id]) rxnMap[r.message_id] = {};
                            if (!rxnMap[r.message_id][r.emoji]) rxnMap[r.message_id][r.emoji] = { emoji: r.emoji, count: 0, mine: false };
                            rxnMap[r.message_id][r.emoji].count++;
                            if (r.user_id === currentAuthUser.id) rxnMap[r.message_id][r.emoji].mine = true;
                        });
                        // Assign reactions to top-level messages
                        currentConversation.messages.forEach(msg => {
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
                } else { console.log('[reload] Skipping reaction reload — cooldown active'); }
            renderConversationThread();
        }
        }
    } finally {
        setTimeout(() => {
            isReloadingMessages = false;
            if (_pendingReload) {
                _pendingReload = false;
                debouncedReloadMessages();
            }
        }, 1000);
    }
}

// Message release is now handled server-side by pg_cron (runs every minute)
// checkAndReleaseMessages() and checkAndReleaseReceivedMessages() removed

// Fallback polling: reload messages periodically to catch anything missed
// This is the CRITICAL fallback when Supabase Realtime isn't working
let lastKnownMessageCount = 0;

async function pollForNewMessages() {
    if (!currentAuthUser || isReloadingMessages) return;

    try {
        // Count messages for this user
        const { count: sentCount } = await sb.from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('sender_id', currentAuthUser.id);

        const { count: recvCount } = await sb.from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('recipient_id', currentAuthUser.id);

        let emailCount = 0;
        if (currentAuthUser.email) {
            const { count: ec } = await sb.from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('recipient_email', currentAuthUser.email);
            emailCount = ec || 0;
        }

        // Also count replies sent by me and replies on my messages
        const { count: repliesSentCount } = await sb.from('replies')
            .select('id', { count: 'exact', head: true })
            .eq('sender_id', currentAuthUser.id);

        // Get IDs of messages I'm part of (sent or received)
        let repliesRecvCount = 0;
        const myMsgIds = messages.filter(m => m.dbId).map(m => m.dbId);
        if (myMsgIds.length > 0) {
            const { count: rc } = await sb.from('replies')
                .select('id', { count: 'exact', head: true })
                .in('message_id', myMsgIds);
            repliesRecvCount = rc || 0;
        }

        const totalCount = (sentCount || 0) + (recvCount || 0) + (emailCount || 0) + (repliesSentCount || 0) + repliesRecvCount;

        if (lastKnownMessageCount > 0 && totalCount !== lastKnownMessageCount) {
            console.log('Poll: count changed', lastKnownMessageCount, '→', totalCount, '— reloading');
            lastKnownMessageCount = totalCount;
            await debouncedReloadMessages();
        } else {
            lastKnownMessageCount = totalCount;
        }
    } catch(e) {
        console.error('Poll error:', e);
    }
}

// Clean up all realtime channels and polling
function cleanupRealtime() {
    // Unsubscribe all channels
    realtimeChannels.forEach(ch => {
        try { sb.removeChannel(ch); } catch(e) { /* ignore */ }
    });
    realtimeChannels = [];

    // Clear polling intervals
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    // releaseInterval removed — handled by server-side pg_cron

    // Stop presence heartbeat & polling
    if (presenceHeartbeatInterval) { clearInterval(presenceHeartbeatInterval); presenceHeartbeatInterval = null; }
    if (presencePollInterval) { clearInterval(presencePollInterval); presencePollInterval = null; }
    // Clear last_active on sign out
    if (currentAuthUser) {
        try { sb.from('profiles').update({ last_active: null }).eq('id', currentAuthUser.id); } catch(e) {}
    }

    realtimeWorking = false;
    lastKnownMessageCount = 0;
    onlineUsers = {};
    console.log('Realtime: all channels cleaned up');
}

// On tab close: the heartbeat simply stops. Other clients will see
// last_active go stale (>90s) and mark the user offline automatically.
// No need for explicit cleanup — the 90s threshold handles it.

// Pause heartbeat when tab is hidden, resume when visible
document.addEventListener('visibilitychange', () => {
    if (!currentAuthUser) return;
    if (!document.hidden) {
        // Tab became visible — send immediate heartbeat + poll
        heartbeatPresence();
        pollOnlineUsers();
    }
});

function setupRealtimeMessages() {
    if (!currentAuthUser) return;

    // Clean up any existing channels first (prevents duplicates)
    cleanupRealtime();

    // ---- MESSAGES: INSERT + UPDATE ----
    const msgChannel = sb.channel('inbox-messages')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages'
        }, async (payload) => {
            const m = payload.new;
            const isForMe = m.recipient_id === currentAuthUser.id ||
                            (m.recipient_email && m.recipient_email.toLowerCase() === (currentAuthUser.email || '').toLowerCase());
            const isFromMe = m.sender_id === currentAuthUser.id;

            if (isForMe || isFromMe) {
                // Skip messages from blocked users
                if (isForMe && isBlocked(m.sender_id, null)) {
                    console.log('Realtime: ignoring message from blocked user', m.sender_id);
                    return;
                }
                realtimeWorking = true;
                console.log('Realtime: new message', isForMe ? 'received' : 'sent', m.id);
                await debouncedReloadMessages();
            }
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'messages'
        }, async (payload) => {
            const m = payload.new;
            const isRelevant = m.sender_id === currentAuthUser.id ||
                               m.recipient_id === currentAuthUser.id ||
                               (m.recipient_email && m.recipient_email.toLowerCase() === (currentAuthUser.email || '').toLowerCase());
            if (isRelevant) {
                realtimeWorking = true;
                await debouncedReloadMessages();
            }
        })
        .subscribe((status) => {
            console.log('Realtime messages channel:', status);
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('Realtime messages channel failed, relying on polling fallback');
            }
        });
    realtimeChannels.push(msgChannel);

    // ---- REPLIES: live chat via postgres_changes on replies table ----
    const replyChannel = sb.channel('live-replies')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'replies'
        }, async (payload) => {
            realtimeWorking = true;
            const reply = payload.new;
            // Skip replies from ourselves (we already added them optimistically)
            if (reply.sender_id === currentAuthUser.id) return;

            console.log('Realtime: new reply on message', reply.message_id, 'status:', reply.status);

            // If reply is in-transit, add synthetic entry to messages array for carrying count
            if (reply.status === 'in_transit') {
                const parentMsg = messages.find(m => m.dbId === reply.message_id);
                const syntheticId = 'incoming-reply-' + reply.id;
                if (!messages.some(m => m.dbId === syntheticId)) {
                    messages.push({
                        dbId: syntheticId,
                        senderId: reply.sender_id,
                        sender: parentMsg?.sender || 'Someone',
                        type: 'received',
                        status: 'Arriving',
                        stillInTransit: true,
                        releaseAt: reply.release_at,
                        createdAt: reply.created_at,
                        time: 'Just now',
                        messageText: '',
                        contentVisible: false,
                        isIncomingReplyTransit: true,
                        preview: '',
                        replies: []
                    });
                }
                console.log('[Realtime] In-transit reply added as synthetic entry');
                // Update everything immediately
                buildConversations();
                await loadConversationMetadata();
                renderMessages();
                renderMessageDots();
                updateOrbitCenter();
            }

            // Find the message this reply belongs to
            const targetMsg = messages.find(m => m.dbId === reply.message_id);
            if (!targetMsg) {
                // Message not in our local array — full reload needed
                await debouncedReloadMessages();
                return;
            }

            // Add the reply to the message's replies array
            targetMsg.replies = targetMsg.replies || [];
            // Avoid duplicate if we somehow already have this reply
            const alreadyExists = targetMsg.replies.some(r =>
                r.dbId === reply.id ||
                (r.createdAt === reply.created_at && r.text === (reply.text || reply.reply_text)));
            if (alreadyExists) return;

            // SEALED until release: an in-transit reply must never carry its content
            // into the live thread — only an "arriving" placeholder with the ETA.
            const sealed = replyStillSealed(reply, currentAuthUser.id);
            // Realtime payloads no longer include content columns at all (column
            // grants, migration 043) — for a reply that is already released, fetch
            // the viewer-masked row from replies_v to get its text/photo/song.
            let full = reply;
            if (!sealed) {
                const { data: fullRow } = await sb.from('replies_v')
                    .select('*').eq('id', reply.id).maybeSingle();
                if (fullRow) full = fullRow;
            }
            targetMsg.replies.push({
                id: reply.id,
                dbId: reply.id,
                text: sealed ? '' : (full.text || ''),
                time: 'Just now',
                createdAt: reply.created_at || new Date().toISOString(),
                sent: false,
                senderId: reply.sender_id,
                isLunarNote: reply.is_lunar_note || false,
                photoUrl: sealed ? null : (full.photo_url || null),
                status: sealed ? 'Arriving' : '',
                stillInTransit: sealed,
                releaseAt: reply.release_at || null,
                reactions: []
            });

            // If we're viewing the conversation that contains this message, re-render live
            if (currentConversation && currentConversation.messages.some(m => m.dbId === reply.message_id)) {
                renderConversationThread();
                // Auto-scroll to bottom
                const content = document.getElementById('detailContent');
                if (content) content.scrollTop = content.scrollHeight;
            }

            // Update inbox preview inline (DON'T rebuild — preserves full thread)
            let replyConv = currentConversation || conversations.find(c =>
                c.messages.some(m => m.dbId === reply.message_id)
            );
            // Fallback: find conversation by sender's profile ID
            if (!replyConv) {
                replyConv = conversations.find(c => c.otherProfileId === reply.sender_id);
                if (replyConv) console.log('[Realtime] Found conv by sender fallback:', replyConv.otherName);
            }
            if (!replyConv) {
                console.warn('[Realtime] Could not find conversation for reply', reply.id, 'message_id:', reply.message_id, 'sender:', reply.sender_id);
                // Force full reload to pick up the new data
                await debouncedReloadMessages();
            }
            if (replyConv) {
                const replyTime = reply.created_at || new Date().toISOString();
                replyConv.latestCreatedAt = replyTime;
                replyConv.latestTime = 'Just now';
                const isMyReply = reply.sender_id === currentAuthUser?.id;
                const isInTransit = reply.status === 'in_transit';

                if (isInTransit && !isMyReply) {
                    // In-transit reply from someone else — don't reveal content
                    replyConv.latestPreview = '🌙 Orbiting · arrives at moonrise';
                    replyConv.hasIncomingTransit = true;
                    replyConv.incomingTransitCreatedAt = reply.created_at;
                    replyConv.incomingTransitReleaseAt = reply.release_at;
                } else {
                    // `full` (fetched from replies_v above) carries the content —
                    // the realtime payload itself no longer does (migration 043).
                    const prefix = isMyReply ? 'You: ' : '';
                    if (full.is_lunar_note && full.lunar_note_text) {
                        const snippet = full.lunar_note_text.replace(/\n/g, ' ').substring(0, 40);
                        replyConv.latestPreview = prefix + '🌙 ' + snippet;
                    } else {
                        replyConv.latestPreview = prefix + (full.text || '🌕');
                    }
                    if (replyConv.latestPreview.length > 50) {
                        replyConv.latestPreview = replyConv.latestPreview.substring(0, 50) + '...';
                    }
                }
                if (isMyReply) {
                    replyConv.unreadCount = 0;
                } else {
                    // New reply from someone else — increment unread count
                    // (unless we're currently viewing this conversation)
                    const isViewingThis = currentConversation && currentConversation === replyConv;
                    if (!isViewingThis) {
                        replyConv.unreadCount = (replyConv.unreadCount || 0) + 1;
                    }
                }
                conversations.sort((a, b) => new Date(b.latestCreatedAt) - new Date(a.latestCreatedAt));
            }
            renderMessages();
        })
        .subscribe((status) => {
            console.log('Realtime replies channel:', status);
        });
    realtimeChannels.push(replyChannel);

    // ---- READ RECEIPTS: live updates ----
    const readReceiptChannel = sb.channel('live-read-receipts')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'read_receipts'
        }, async (payload) => {
            const receipt = payload.new;
            // Only care about other users' receipts (not our own)
            if (!currentAuthUser || !receipt || receipt.user_id === currentAuthUser.id) return;

            console.log('Realtime: read receipt update from', receipt.user_id);

            // Find the conversation this receipt belongs to
            const conv = conversations.find(c => c.dbConversationId === receipt.conversation_id);
            if (!conv) return;

            // Update otherReadAt
            conv.otherReadAt = receipt.last_read_at;

            // If we're viewing this conversation, re-render to show blue checkmarks
            if (currentConversation && currentConversation.dbConversationId === receipt.conversation_id) {
                renderConversationThread();
            }

            // Update inbox (in case preview styling changes)
            renderMessages();
        })
        .subscribe((status) => {
            console.log('Realtime read_receipts channel:', status);
        });
    realtimeChannels.push(readReceiptChannel);

    // ---- PROFILES: live username/avatar updates ----
    const profileChannel = sb.channel('live-profiles')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles'
        }, async (payload) => {
            const profile = payload.new;
            if (!profile || profile.id === currentAuthUser?.id) return;

            console.log('Realtime: profile updated', profile.id, profile.username);

            // Update matching contacts in memory
            let changed = false;
            contacts.forEach(c => {
                if (c.linkedProfileId === profile.id) {
                    c.username = profile.username || c.username;
                    c.avatar = profile.avatar_url || c.avatar;
                    c.city = profile.city || c.city;
                    if (profile.first_name || profile.last_name) {
                        c.name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || c.name;
                    }
                    changed = true;
                }
            });

            if (changed) {
                // Update conversations with new username/avatar
                conversations.forEach(conv => {
                    if (conv.otherProfileId === profile.id) {
                        conv.otherUsername = profile.username || conv.otherUsername;
                        conv.otherAvatar = profile.avatar_url || conv.otherAvatar;
                        if (profile.first_name || profile.last_name) {
                            conv.otherName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || conv.otherName;
                        }
                    }
                });

                // Re-render inbox list
                renderMessages();

                // If viewing this person's conversation, update the chat header
                if (currentConversation && currentConversation.otherProfileId === profile.id) {
                    const displayUsername = currentConversation.otherUsername || currentConversation.otherName;
                    document.getElementById('detailSender').textContent = displayUsername;
                    // Update avatar
                    if (profile.avatar_url) {
                        const detailImg = document.getElementById('detailAvatarImg');
                        detailImg.src = profile.avatar_url;
                        detailImg.style.display = 'block';
                        document.getElementById('detailAvatarInitial').style.display = 'none';
                    }
                }
            }
        })
        .subscribe((status) => {
            console.log('Realtime profiles channel:', status);
        });
    realtimeChannels.push(profileChannel);

    // ---- SHARED SKY: live feed ----
    const skyChannel = sb.channel('shared-sky-live')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'shared_sky'
        }, async (payload) => {
            realtimeWorking = true;
            const s = payload.new;
            if (s.user_id !== currentAuthUser.id) {
                // Fetch sender profile for name
                let senderName = null;
                if (s.user_id) {
                    const { data: sp } = await sb.from('profiles')
                        .select('username, first_name, last_name')
                        .eq('id', s.user_id)
                        .maybeSingle();
                    if (sp) senderName = sp.username || [sp.first_name, sp.last_name].filter(Boolean).join(' ') || null;
                }
                globalTransmissions.unshift({
                    dbId: s.id,
                    userId: s.user_id,
                    senderName: senderName,
                    location: s.city || 'Unknown',
                    time: 'Just now',
                    createdAt: s.created_at,
                    message: s.message ? '"' + s.message + '"' : '',
                    photo: s.photo_url || null,
                    lunarNoteText: s.lunar_note_text || null,
                    lunarNoteClosing: s.lunar_note_closing || null,
                    reactions: []
                });
                renderSharedSkySignals();
                updateSharedSkyBadge();
                const previewEl = document.getElementById('sharedSkyPreview');
                const previewName = senderName || s.city || 'Unknown';
                if (previewEl) previewEl.textContent = previewName + ': ' + (s.lunar_note_text ? '🌙 Lunar Note' : '"' + s.message + '"');
            }
        })
        .subscribe((status) => {
            console.log('Realtime shared_sky channel:', status);
        });
    realtimeChannels.push(skyChannel);

    // ---- Start polling as FALLBACK (always active, lightweight) ----
    lastKnownMessageCount = 0; // Reset so first poll sets baseline

    // Poll for new messages every 5 seconds (critical for delivery)
    pollInterval = setInterval(async () => {
        await pollForNewMessages();
    }, 5000);

    // Message release is now server-side (pg_cron every minute)
    // No client-side release polling needed

    // Presence: track online users
    setupPresence();

    console.log('Realtime: all channels + polling initialized');
}

// ========================
// PRESENCE (online users)
// ========================
// DB-based approach: each client writes last_active to profiles every 30s.
// All clients read from the same DB — single source of truth, no sync issues.
// A user is "online" if their last_active is within the last 90 seconds.
let onlineUsers = {};  // { profileId: true }
let presenceHeartbeatInterval = null;
let presencePollInterval = null;

const ONLINE_THRESHOLD_MS = 150000; // 150s — online if last_active within this window (allows for browser throttling in background tabs)

async function heartbeatPresence() {
    if (!currentAuthUser || document.hidden) return;
    try {
        await sb.from('profiles').update({ last_active: new Date().toISOString() }).eq('id', currentAuthUser.id);
    } catch(e) {}
}

async function pollOnlineUsers() {
    if (!currentAuthUser) return;
    // Fetch last_active for all linked contacts + conversation partners
    const profileIds = new Set();
    contacts.forEach(c => { if (c.linkedProfileId) profileIds.add(c.linkedProfileId); });
    conversations.forEach(c => { if (c.otherProfileId) profileIds.add(c.otherProfileId); });
    profileIds.delete(currentAuthUser.id); // Don't check self

    if (profileIds.size === 0) { onlineUsers = {}; updateOnlineIndicators(); return; }

    try {
        const { data } = await sb.from('profiles')
            .select('id, last_active')
            .in('id', Array.from(profileIds));
        const now = Date.now();
        const newOnline = {};
        if (data) {
            data.forEach(p => {
                if (p.last_active && (now - new Date(p.last_active).getTime()) < ONLINE_THRESHOLD_MS) {
                    newOnline[p.id] = true;
                }
            });
        }
        onlineUsers = newOnline;
        updateOnlineIndicators();
    } catch(e) {
        console.error('pollOnlineUsers failed:', e);
    }
}

function setupPresence() {
    if (!currentAuthUser) return;

    // Immediate heartbeat
    heartbeatPresence();

    // Heartbeat every 30s (even in background — browsers throttle to ~1-2min)
    // This keeps the user "online" even when the tab isn't focused
    if (presenceHeartbeatInterval) clearInterval(presenceHeartbeatInterval);
    presenceHeartbeatInterval = setInterval(() => {
        heartbeatPresence();
    }, 30000);

    // Poll online status every 20s
    pollOnlineUsers();
    if (presencePollInterval) clearInterval(presencePollInterval);
    presencePollInterval = setInterval(pollOnlineUsers, 20000);
}

function updateOnlineIndicators() {
    // Update contact online flags
    contacts.forEach(c => {
        if (c.linkedProfileId && onlineUsers[c.linkedProfileId]) {
            c._isOnline = true;
        } else {
            c._isOnline = false;
        }
    });

    // Re-render contacts page if open
    if (document.getElementById('contactsPage')?.classList.contains('active')) {
        renderContactsList();
    }

    // Update inbox online dots IN-PLACE (no full re-render to avoid badge flicker)
    document.querySelectorAll('.msg-row').forEach(row => {
        const profileId = row.dataset.profileId;
        const dot = row.querySelector('.online-dot-indicator');
        if (!profileId) return;
        if (onlineUsers[profileId]) {
            if (!dot) {
                const avatar = row.querySelector('.msg-avatar');
                if (avatar) {
                    const d = document.createElement('span');
                    d.className = 'online-dot-indicator';
                    d.style.cssText = 'position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:#4caf50;border:2px solid var(--bg);z-index:1;';
                    avatar.appendChild(d);
                }
            }
        } else {
            if (dot) dot.remove();
        }
    });
}

function isContactOnline(contact) {
    return contact?.linkedProfileId && onlineUsers[contact.linkedProfileId];
}

// Handle auth state changes (sign in, sign out, initial session, token refresh)
sb.auth.onAuthStateChange(async (event, session) => {
    console.log('[AUTH EVENT]', event, session ? 'session=' + session.user.email : 'no session',
                '_isInitializing=' + _isInitializing, '_appDataLoaded=' + _appDataLoaded);

    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && session) {
        // Always keep currentAuthUser fresh
        currentAuthUser = session.user;

        // Load the app if data hasn't been loaded yet and we're not already loading
        if (!_appDataLoaded && !_isInitializing && _domReady) {
            console.log('[AUTH EVENT] Triggering initAuth from', event);
            await initAuth(session);
        }
    }

    if (event === 'SIGNED_OUT') {
        // If the app was never loaded, this SIGNED_OUT is spurious (Firefox fires it
        // during page refresh before INITIAL_SESSION). Let initAuth handle initial state.
        if (!_appDataLoaded) {
            console.log('[AUTH EVENT] SIGNED_OUT before app loaded — ignoring, initAuth will handle it');
            return;
        }
        // CRITICAL: Verify the session is TRULY gone before wiping data
        // (token refresh can briefly trigger SIGNED_OUT even when session is valid)
        console.log('[AUTH EVENT] SIGNED_OUT received, verifying session...');
        try {
            const { data } = await sb.auth.getSession();
            if (data?.session) {
                console.warn('[AUTH EVENT] SIGNED_OUT fired but session still valid — IGNORING (token refresh race)');
                currentAuthUser = data.session.user;
                return;
            }
        } catch (e) {
            console.warn('[AUTH EVENT] getSession check failed:', e);
        }

        // Session truly gone — clean up
        console.log('[AUTH EVENT] Session confirmed gone, cleaning up');
        cleanupRealtime();
        currentAuthUser = null;
        _appDataLoaded = false;
        messages = [];
        conversations = [];
        currentConversation = null;
        currentConversationIndex = -1;
        globalTransmissions = [];
        showOnboarding();
    }
});

// Register service worker for PWA + offline support
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('Service Worker registered:', reg.scope))
        .catch(err => console.warn('Service Worker registration failed:', err));
}

// ============================================
// INBOX SORT
// ============================================

function setInboxSort(mode) {
    inboxSortMode = mode;
    const labels = { recent: 'Recent', oldest: 'Oldest', unread: 'Unread', roulette: 'Roulette' };
    const label = document.getElementById('inboxSortLabel');
    if (label) label.textContent = labels[mode] || 'Recent';
    document.querySelectorAll('.inbox-sort-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === mode);
    });
    document.getElementById('inboxSortMenu')?.classList.remove('open');
    renderMessages();
}

function toggleInboxSortMenu() {
    const menu = document.getElementById('inboxSortMenu');
    if (!menu) return;
    const isOpen = menu.classList.toggle('open');
    if (isOpen) {
        setTimeout(() => {
            document.addEventListener('click', function _close(e) {
                if (!e.target.closest('.inbox-sort-wrap')) {
                    document.getElementById('inboxSortMenu')?.classList.remove('open');
                }
                document.removeEventListener('click', _close);
            });
        }, 0);
    }
}

// ============================================
// DEMO MODE — ?demo=1 skips auth and shows sample data
// ============================================

function initDemoMode() {
    _appDataLoaded = true;
    currentAuthUser = { id: 'demo-user-000', email: 'demo@moonpost.io' };

    const now = Date.now();
    conversations = [
        {
            otherName: 'Sofia Martinez', otherUsername: 'sofiam', otherAvatar: null,
            otherProfileId: 'demo-p-001',
            latestPreview: 'That message you sent really stayed with me.',
            latestTime: '2h ago', latestCreatedAt: new Date(now - 2 * 3600000).toISOString(),
            unreadCount: 2, hasInTransit: false, hasIncomingTransit: false,
            location: 'Lisbon', messages: []
        },
        {
            otherName: 'James Park', otherUsername: 'jpark', otherAvatar: null,
            otherProfileId: 'demo-p-002',
            latestPreview: 'You: The moon was so clear last night.',
            latestTime: '1d ago', latestCreatedAt: new Date(now - 24 * 3600000).toISOString(),
            unreadCount: 0, hasInTransit: true,
            transitReleaseAt: new Date(now + 3 * 3600000).toISOString(),
            transitCreatedAt: new Date(now - 1 * 3600000).toISOString(),
            hasIncomingTransit: false, location: 'Tokyo', messages: []
        },
        {
            otherName: 'Amara Osei', otherUsername: 'amara_o', otherAvatar: null,
            otherProfileId: 'demo-p-003',
            latestPreview: 'Write to me when the moon rises again.',
            latestTime: '3d ago', latestCreatedAt: new Date(now - 3 * 86400000).toISOString(),
            unreadCount: 0, hasInTransit: false, hasIncomingTransit: false,
            location: 'Accra', messages: []
        }
    ];

    if (typeof rouletteMessages !== 'undefined') {
        rouletteMessages.received = [{
            id: 'demo-r-recv-001', sender_city: 'Barcelona', status: 'delivered',
            moon_phase: 'waxing gibbous',
            message_text: 'I hope this finds you on a clear night. I wrote this watching the moon from my rooftop.',
            created_at: new Date(now - 5 * 3600000).toISOString(),
            released_at: new Date(now - 5 * 3600000).toISOString()
        }];
        rouletteMessages.sent = [{
            id: 'demo-r-sent-001', sender_city: 'New York', recipient_city: 'Kyoto',
            status: 'delivered', moon_phase: 'full moon',
            message_text: 'Stranger, I wonder what your sky looks like tonight.',
            created_at: new Date(now - 2 * 86400000).toISOString(),
            released_at: new Date(now - 2 * 86400000).toISOString()
        }];
    }

    hideOnboarding();
    renderMessages();
    if (typeof renderMessageDots === 'function') renderMessageDots();
    const cta = document.getElementById('inboxNewMsgCta');
    if (cta) cta.style.display = '';
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    _domReady = true;

    // Warm up AudioContext on first user interaction (browser autoplay policy)
    document.addEventListener('click', function _warmAudio() {
        try { const ctx = getAudioCtx(); if (ctx.state === 'suspended') ctx.resume(); } catch(e) {}
        document.removeEventListener('click', _warmAudio);
    }, { once: true });

    // Generate twinkling stars with color variety
    (function() {
        const container = document.getElementById('starfieldTwinkle');
        if (!container) return;
        const count = 160;
        for (let i = 0; i < count; i++) {
            const star = document.createElement('div');
            const r = Math.random();
            const isBright = r > 0.94;
            // Bright stars get a cross/shimmer shape
            star.className = isBright ? 'star cross' : 'star';
            star.style.left = (Math.random() * 100) + '%';
            star.style.top = (Math.random() * 100) + '%';
            // Fast twinkle: 1-3.5s
            star.style.setProperty('--dur', (3 + Math.random() * 5) + 's');
            star.style.setProperty('--delay', (Math.random() * 8) + 's');
            // Some bright stars use the flash animation (quick double-pulse)
            if (isBright && Math.random() > 0.4) {
                star.style.animation = `twinkleFlash var(--dur) ease-in-out infinite`;
            }
            if (isBright) {
                const sz = 4 + Math.random() * 3;
                star.style.width = star.style.height = sz + 'px';
                star.style.setProperty('--peak', (0.7 + Math.random() * 0.3).toFixed(2));
                star.style.boxShadow = '0 0 8px rgba(255,255,255,0.6)';
            } else if (r > 0.88) {
                star.style.width = star.style.height = '2.5px';
                star.style.setProperty('--peak', (0.5 + Math.random() * 0.4).toFixed(2));
                star.style.boxShadow = '0 0 4px rgba(255,255,255,0.3)';
            } else if (r > 0.7) {
                star.style.width = star.style.height = '1.8px';
                star.style.setProperty('--peak', (0.4 + Math.random() * 0.45).toFixed(2));
            } else if (r > 0.45) {
                star.style.width = star.style.height = '1.2px';
                star.style.setProperty('--peak', (0.35 + Math.random() * 0.45).toFixed(2));
            } else {
                star.style.width = star.style.height = '0.8px';
                star.style.setProperty('--peak', (0.25 + Math.random() * 0.45).toFixed(2));
            }
            // Color variety: yellow, pink, blue, or white
            const colorRoll = Math.random();
            if (colorRoll > 0.88) {
                star.style.setProperty('--star-color', '#ffd54f');
                if (!isBright) star.style.background = '#ffd54f';
                star.style.boxShadow = (star.style.boxShadow ? star.style.boxShadow + ',' : '') + '0 0 5px rgba(255,213,79,0.6)';
            } else if (colorRoll > 0.78) {
                star.style.setProperty('--star-color', '#ff8a80');
                if (!isBright) star.style.background = '#ff8a80';
                star.style.boxShadow = (star.style.boxShadow ? star.style.boxShadow + ',' : '') + '0 0 5px rgba(255,138,128,0.6)';
            } else if (colorRoll > 0.73) {
                star.style.setProperty('--star-color', '#80d8ff');
                if (!isBright) star.style.background = '#80d8ff';
                star.style.boxShadow = (star.style.boxShadow ? star.style.boxShadow + ',' : '') + '0 0 5px rgba(128,216,255,0.6)';
            }
            container.appendChild(star);
        }
    })();

    // Check for saved location first
    const loc = getSavedLocation();
    if (loc) {
        const city = cities.find(c => c.name === loc.name);
        if (city) {
            updateLocationDisplay(city.name, city.country);
            onLocationObtained(city.lat, city.lon, city.tz);
        }
    } else {
        autoDetectFromTimezone();
    }

    // Demo mode: ?demo=1 bypasses auth and shows sample inbox data
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
        initDemoMode();
    } else if (!_appDataLoaded && !_isInitializing) {
        // Initialize auth (loads data and renders everything)
        // If onAuthStateChange already fired INITIAL_SESSION before DOM was ready,
        // initAuth would not have been called yet — call it now
        console.log('[DOMContentLoaded] Calling initAuth');
        await initAuth();
    } else {
        console.log('[DOMContentLoaded] initAuth already ran or running, skipping');
    }

    updateMoonDisplay();
    initCountdown();
    updateMoonPosition();
    updateOrbitCenter();
    checkNewMoonWarning();
    // Re-render after moon display is calculated (moon cycle data now available)
    renderMessageDots();
    initMoonPhasePopup();

    setInterval(() => {
        updateOrbitCenter();
    }, 1000);
});

// Match browser timezone to a city and use it immediately
function autoDetectFromTimezone() {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserTz) return;
    
    // Exact timezone match
    const match = cities.find(c => c.tz === browserTz);
    if (match) {
        updateLocationDisplay(match.name, match.country);
        const input = document.getElementById('onboardingLocation');
        if (input) input.value = match.name;
        onLocationObtained(match.lat, match.lon, match.tz);
        localStorage.setItem('moonpop_location', JSON.stringify({ name: match.name, country: match.country }));
        return;
    }
    
    // Partial match: same region (e.g. "America/New_York" → find any city with that tz)
    // Or match by region prefix (e.g. "Europe/Berlin" → any European city in that tz group)
    const region = browserTz.split('/')[0];
    const regionMatch = cities.find(c => c.tz && c.tz.split('/')[0] === region);
    if (regionMatch) {
        updateLocationDisplay(regionMatch.name, regionMatch.country);
        const input = document.getElementById('onboardingLocation');
        if (input) input.value = regionMatch.name;
        onLocationObtained(regionMatch.lat, regionMatch.lon, browserTz);
        localStorage.setItem('moonpop_location', JSON.stringify({ name: regionMatch.name, country: regionMatch.country }));
    }
}


// Sticky header shrink on scroll + draw moon phase
let headerMoonDrawn = false;
window.addEventListener('scroll', () => {
    const header = document.querySelector('.header');
    if (!header) return;
    const scrolled = window.scrollY > 80;
    header.classList.toggle('scrolled', scrolled);

    if (scrolled && !headerMoonDrawn && moonData.phase) {
        const svg = document.getElementById('headerMoonSvg');
        if (svg) {
            drawMoonPhase(svg, moonData.phase, '#ffffff');
            headerMoonDrawn = true;
        }
    }
});
// Split-layout: add class to header on desktop, listen to left-panel scroll
// Split-layout: toggle header class and body overflow based on viewport
(function initSplitLayout() {
    const header = document.querySelector('.header');
    if (!header) return;
    const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

    function applySplit() {
        if (!isMobile()) {
            header.classList.add('split-active');
            document.body.style.overflow = 'hidden';
        } else {
            header.classList.remove('split-active');
            document.body.style.overflow = '';
        }
    }

    applySplit();
    window.addEventListener('resize', applySplit);
})();

// Onboarding functions
function generateLandingStars() {
    const container = document.getElementById('onboardingStars');
    if (!container || container.children.length > 0) return;
    const count = 160;
    const stars = [];
    for (let i = 0; i < count; i++) {
        const star = document.createElement('div');
        const r = Math.random();
        const isBright = r > 0.92;
        star.className = isBright ? 'star cross' : 'star';
        star.style.left = (Math.random() * 100) + '%';
        star.style.top = (Math.random() * 100) + '%';
        // Each star gets a unique random duration and delay
        const dur = (3 + Math.random() * 5);
        const delay = (Math.random() * 6);
        star.style.setProperty('--dur', dur + 's');
        star.style.setProperty('--delay', delay + 's');
        if (isBright && Math.random() > 0.3) {
            star.style.animation = 'twinkleFlash var(--dur) ease-in-out infinite';
        }
        if (isBright) {
            const sz = 3.5 + Math.random() * 3;
            star.style.width = star.style.height = sz + 'px';
            star.style.setProperty('--peak', (0.8 + Math.random() * 0.2).toFixed(2));
            star.style.boxShadow = '0 0 6px rgba(255,255,255,0.7)';
        } else if (r > 0.82) {
            star.style.width = star.style.height = '2.5px';
            star.style.setProperty('--peak', (0.6 + Math.random() * 0.35).toFixed(2));
            star.style.boxShadow = '0 0 3px rgba(255,255,255,0.4)';
        } else if (r > 0.6) {
            star.style.width = star.style.height = '1.8px';
            star.style.setProperty('--peak', (0.5 + Math.random() * 0.4).toFixed(2));
        } else if (r > 0.35) {
            star.style.width = star.style.height = '1.2px';
            star.style.setProperty('--peak', (0.4 + Math.random() * 0.4).toFixed(2));
        } else {
            star.style.width = star.style.height = '0.8px';
            star.style.setProperty('--peak', (0.3 + Math.random() * 0.4).toFixed(2));
        }
        // Color variety
        const colorRoll = Math.random();
        if (colorRoll > 0.9) {
            if (!isBright) star.style.background = '#ffd54f';
            star.style.boxShadow = (star.style.boxShadow || '') + ',0 0 4px rgba(255,213,79,0.5)';
        } else if (colorRoll > 0.82) {
            if (!isBright) star.style.background = '#80d8ff';
            star.style.boxShadow = (star.style.boxShadow || '') + ',0 0 4px rgba(128,216,255,0.5)';
        }
        container.appendChild(star);
        stars.push(star);
    }
    // Randomize: periodically re-shuffle star delays so twinkling feels organic
    // Uses requestIdleCallback to avoid jank during scroll
    function reshuffleStars() {
        const subset = Math.floor(stars.length * 0.1); // reshuffle 10% of stars
        for (let i = 0; i < subset; i++) {
            const idx = Math.floor(Math.random() * stars.length);
            const s = stars[idx];
            // Update CSS custom properties — animation picks up new values naturally
            s.style.setProperty('--dur', (3 + Math.random() * 5) + 's');
            s.style.setProperty('--delay', (Math.random() * 0.3) + 's');
        }
        setTimeout(reshuffleStars, 3000);
    }
    setTimeout(reshuffleStars, 3000);
}

function initMoonriseParallax() {
    // Scroll-based fade-in animations for editorial landing page
    const scrollContainer = document.getElementById('moonriseScroll');
    if (!scrollContainer) return;

    // IntersectionObserver for fade-in-up elements (uses viewport)
    const fadeObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                fadeObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

    document.querySelectorAll('.fade-in-up').forEach(el => {
        fadeObserver.observe(el);
    });

    // Glassmorphism header scroll state
    const nav = document.querySelector('.landing-nav');
    if (nav) {
        window.addEventListener('scroll', () => {
            nav.classList.toggle('scrolled', window.scrollY > 40);
        }, { passive: true });
    }
}

function showOnboarding() {
    const overlay = document.getElementById('onboardingOverlay');
    if (!overlay) return;
    // Make sure no leftover auth/OTP modal sits on top of the landing page
    // (e.g. after sign-out, where the "Welcome back" code screen could still be open).
    if (typeof closeAuthModal === 'function') closeAuthModal();
    overlay.classList.remove('hidden');
    // The onboarding overlay is opaque (background: var(--bg)) and sits above the
    // global starfield, so #starfieldTwinkle is fully occluded here — pause it so we
    // aren't animating ~160 invisible stars behind the overlay.
    const globalStars = document.getElementById('starfieldTwinkle');
    if (globalStars) globalStars.style.display = 'none';
    // Initialize scroll animations + landing starfield + orbital dots
    initMoonriseParallax();
    generateLandingStars();
    setupRingCanvas('landing-ring-canvas');
    initTransitIllustration();

    // Dynamic CTA based on moon state
    const heroCta = document.getElementById('heroCta');
    const bottomCta = document.getElementById('bottomCta');
    if (heroCta) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        const tzCoords = {
            'Asia/Jerusalem': [32.08, 34.78], 'Asia/Tel_Aviv': [32.08, 34.78],
            'America/New_York': [40.71, -74.01], 'America/Chicago': [41.88, -87.63],
            'America/Los_Angeles': [34.05, -118.24], 'America/Halifax': [44.65, -63.57],
            'Europe/London': [51.51, -0.13], 'Europe/Paris': [48.86, 2.35],
            'Europe/Berlin': [52.52, 13.41], 'Australia/Sydney': [-33.87, 151.21],
            'Asia/Tokyo': [35.68, 139.69], 'Asia/Dubai': [25.20, 55.27],
        };
        const coords = tzCoords[tz] || [32.08, 34.78];

        function buildBrassCounter(h, m, s) {
            const pad = (n) => String(n).padStart(2, '0');
            const hh = pad(h), mm = pad(m), ss = pad(s);
            return '<div class="ed-counter">' +
                '<div class="ed-counter-unit"><div class="ed-counter-digits"><span class="ed-digit">' + hh[0] + '</span><span class="ed-digit">' + hh[1] + '</span></div><span class="ed-digit-label">hrs</span></div>' +
                '<span class="ed-counter-sep">:</span>' +
                '<div class="ed-counter-unit"><div class="ed-counter-digits"><span class="ed-digit">' + mm[0] + '</span><span class="ed-digit">' + mm[1] + '</span></div><span class="ed-digit-label">min</span></div>' +
                '<span class="ed-counter-sep">:</span>' +
                '<div class="ed-counter-unit"><div class="ed-counter-digits"><span class="ed-digit">' + ss[0] + '</span><span class="ed-digit">' + ss[1] + '</span></div><span class="ed-digit-label">sec</span></div>' +
            '</div>';
        }

        function renderMoonCta(container, isMoonUp, h, m, s, isBottom) {
            // The hero (top) now carries its own compose box as the primary CTA, so we
            // omit the redundant signup button there and keep only the ambient moon status.
            // The bottom CTA keeps its button.
            if (isMoonUp) {
                const subline = isBottom ? 'The moon is above you now' : 'The moon is above you now';
                container.innerHTML =
                    (isBottom ? '<button class="ed-cta-link" onclick="showAuthModal(\'signup\')">Send a moon message</button>' : '') +
                    '<p class="ed-cta-subline">' + subline + '</p>';
            } else {
                const counter = '<div class="ed-countdown-row"><span class="ed-countdown-label">Your moon rises in</span>' + buildBrassCounter(h, m, s) + '</div>';
                container.innerHTML = counter +
                    (isBottom ? '<button class="ed-cta-link" onclick="showAuthModal(\'signup\')">Add someone you love</button>' : '');
            }
        }

        function updateLandingCta() {
            try {
                const now = new Date();
                const moonPos = SunCalc.getMoonPosition(now, coords[0], coords[1]);
                const altDeg = moonPos.altitude * (180 / Math.PI);
                const isMoonUp = altDeg > -0.5;

                let ch = 0, cm = 0, cs = 0;
                if (!isMoonUp) {
                    const moonTimes = SunCalc.getMoonTimes(now, coords[0], coords[1]);
                    let target = moonTimes.rise;
                    if (!target || target < now) {
                        const tomorrow = new Date(now.getTime() + 86400000);
                        const mt2 = SunCalc.getMoonTimes(tomorrow, coords[0], coords[1]);
                        target = mt2.rise;
                    }
                    if (target && target > now) {
                        const diff = target - now;
                        ch = Math.floor(diff / 3600000);
                        cm = Math.floor((diff % 3600000) / 60000);
                        cs = Math.floor((diff % 60000) / 1000);
                    }
                }

                renderMoonCta(heroCta, isMoonUp, ch, cm, cs, false);
                if (bottomCta) renderMoonCta(bottomCta, isMoonUp, ch, cm, cs, true);
            } catch(e) {
                heroCta.innerHTML = '<button class="ed-cta-link" onclick="showAuthModal(\'signup\')">Join free</button>';
                if (bottomCta) bottomCta.innerHTML = '<button class="ed-cta-link" onclick="showAuthModal(\'signup\')">Add someone you love</button>';
            }
        }
        updateLandingCta();
        setInterval(updateLandingCta, 1000);
    }

    // Add Enter key handler for email input
    const emailInput = document.getElementById('authEmail');
    if (emailInput) {
        emailInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendMoonKey();
        });

        // Pre-fill email from invite link (?invite_email=...)
        const params = new URLSearchParams(window.location.search);
        const inviteEmail = params.get('invite_email');
        if (inviteEmail) {
            emailInput.value = inviteEmail;
            // Clean the URL
            history.replaceState(null, '', window.location.pathname);
            // Auto-send the code after a short delay so user sees what happened
            setTimeout(() => sendMoonKey(), 400);
        }
    }
}

function hideOnboarding() {
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) overlay.classList.add('hidden');
    // Overlay gone — restore the global starfield that was paused in showOnboarding().
    const globalStars = document.getElementById('starfieldTwinkle');
    if (globalStars) globalStars.style.display = '';
    hideCityDropdown();
}

// City list for autocomplete
const cities = [
    { name: 'New York', country: 'USA', lat: 40.71, lon: -74.01, tz: 'America/New_York' },
    { name: 'Los Angeles', country: 'USA', lat: 34.05, lon: -118.24, tz: 'America/Los_Angeles' },
    { name: 'Chicago', country: 'USA', lat: 41.88, lon: -87.63, tz: 'America/Chicago' },
    { name: 'San Francisco', country: 'USA', lat: 37.77, lon: -122.42, tz: 'America/Los_Angeles' },
    { name: 'Miami', country: 'USA', lat: 25.76, lon: -80.19, tz: 'America/New_York' },
    { name: 'Seattle', country: 'USA', lat: 47.61, lon: -122.33, tz: 'America/Los_Angeles' },
    { name: 'Boston', country: 'USA', lat: 42.36, lon: -71.06, tz: 'America/New_York' },
    { name: 'Austin', country: 'USA', lat: 30.27, lon: -97.74, tz: 'America/Chicago' },
    { name: 'Denver', country: 'USA', lat: 39.74, lon: -104.99, tz: 'America/Denver' },
    { name: 'Portland', country: 'USA', lat: 45.52, lon: -122.68, tz: 'America/Los_Angeles' },
    { name: 'London', country: 'UK', lat: 51.51, lon: -0.13, tz: 'Europe/London' },
    { name: 'Manchester', country: 'UK', lat: 53.48, lon: -2.24, tz: 'Europe/London' },
    { name: 'Edinburgh', country: 'UK', lat: 55.95, lon: -3.19, tz: 'Europe/London' },
    { name: 'Paris', country: 'France', lat: 48.86, lon: 2.35, tz: 'Europe/Paris' },
    { name: 'Lyon', country: 'France', lat: 45.76, lon: 4.84, tz: 'Europe/Paris' },
    { name: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.41, tz: 'Europe/Berlin' },
    { name: 'Munich', country: 'Germany', lat: 48.14, lon: 11.58, tz: 'Europe/Berlin' },
    { name: 'Amsterdam', country: 'Netherlands', lat: 52.37, lon: 4.90, tz: 'Europe/Amsterdam' },
    { name: 'Barcelona', country: 'Spain', lat: 41.39, lon: 2.17, tz: 'Europe/Madrid' },
    { name: 'Madrid', country: 'Spain', lat: 40.42, lon: -3.70, tz: 'Europe/Madrid' },
    { name: 'Rome', country: 'Italy', lat: 41.90, lon: 12.50, tz: 'Europe/Rome' },
    { name: 'Milan', country: 'Italy', lat: 45.46, lon: 9.19, tz: 'Europe/Rome' },
    { name: 'Lisbon', country: 'Portugal', lat: 38.72, lon: -9.14, tz: 'Europe/Lisbon' },
    { name: 'Dublin', country: 'Ireland', lat: 53.35, lon: -6.26, tz: 'Europe/Dublin' },
    { name: 'Tokyo', country: 'Japan', lat: 35.68, lon: 139.69, tz: 'Asia/Tokyo' },
    { name: 'Osaka', country: 'Japan', lat: 34.69, lon: 135.50, tz: 'Asia/Tokyo' },
    { name: 'Seoul', country: 'South Korea', lat: 37.57, lon: 126.98, tz: 'Asia/Seoul' },
    { name: 'Singapore', country: 'Singapore', lat: 1.35, lon: 103.82, tz: 'Asia/Singapore' },
    { name: 'Hong Kong', country: 'China', lat: 22.32, lon: 114.17, tz: 'Asia/Hong_Kong' },
    { name: 'Shanghai', country: 'China', lat: 31.23, lon: 121.47, tz: 'Asia/Shanghai' },
    { name: 'Beijing', country: 'China', lat: 39.90, lon: 116.41, tz: 'Asia/Shanghai' },
    { name: 'Sydney', country: 'Australia', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' },
    { name: 'Melbourne', country: 'Australia', lat: -37.81, lon: 144.96, tz: 'Australia/Melbourne' },
    { name: 'Auckland', country: 'New Zealand', lat: -36.85, lon: 174.76, tz: 'Pacific/Auckland' },
    { name: 'Toronto', country: 'Canada', lat: 43.65, lon: -79.38, tz: 'America/Toronto' },
    { name: 'Vancouver', country: 'Canada', lat: 49.28, lon: -123.12, tz: 'America/Vancouver' },
    { name: 'Montreal', country: 'Canada', lat: 45.50, lon: -73.57, tz: 'America/Toronto' },
    { name: 'Halifax', country: 'Canada', lat: 44.65, lon: -63.57, tz: 'America/Halifax' },
    { name: 'Dartmouth', country: 'Canada', lat: 44.67, lon: -63.57, tz: 'America/Halifax' },
    { name: 'São Paulo', country: 'Brazil', lat: -23.55, lon: -46.63, tz: 'America/Sao_Paulo' },
    { name: 'Rio de Janeiro', country: 'Brazil', lat: -22.91, lon: -43.17, tz: 'America/Sao_Paulo' },
    { name: 'Buenos Aires', country: 'Argentina', lat: -34.60, lon: -58.38, tz: 'America/Argentina/Buenos_Aires' },
    { name: 'Mexico City', country: 'Mexico', lat: 19.43, lon: -99.13, tz: 'America/Mexico_City' },
    { name: 'Mumbai', country: 'India', lat: 19.08, lon: 72.88, tz: 'Asia/Kolkata' },
    { name: 'Delhi', country: 'India', lat: 28.61, lon: 77.21, tz: 'Asia/Kolkata' },
    { name: 'Bangalore', country: 'India', lat: 12.97, lon: 77.59, tz: 'Asia/Kolkata' },
    { name: 'Dubai', country: 'UAE', lat: 25.20, lon: 55.27, tz: 'Asia/Dubai' },
    { name: 'Cape Town', country: 'South Africa', lat: -33.93, lon: 18.42, tz: 'Africa/Johannesburg' },
    { name: 'Lagos', country: 'Nigeria', lat: 6.52, lon: 3.38, tz: 'Africa/Lagos' },
    { name: 'Cairo', country: 'Egypt', lat: 30.04, lon: 31.24, tz: 'Africa/Cairo' },
    { name: 'Stockholm', country: 'Sweden', lat: 59.33, lon: 18.07, tz: 'Europe/Stockholm' },
    { name: 'Copenhagen', country: 'Denmark', lat: 55.68, lon: 12.57, tz: 'Europe/Copenhagen' },
    { name: 'Oslo', country: 'Norway', lat: 59.91, lon: 10.75, tz: 'Europe/Oslo' },
    { name: 'Helsinki', country: 'Finland', lat: 60.17, lon: 24.94, tz: 'Europe/Helsinki' },
    { name: 'Vienna', country: 'Austria', lat: 48.21, lon: 16.37, tz: 'Europe/Vienna' },
    { name: 'Zurich', country: 'Switzerland', lat: 47.38, lon: 8.54, tz: 'Europe/Zurich' },
    { name: 'Brussels', country: 'Belgium', lat: 50.85, lon: 4.35, tz: 'Europe/Brussels' },
    { name: 'Prague', country: 'Czech Republic', lat: 50.08, lon: 14.44, tz: 'Europe/Prague' },
    { name: 'Warsaw', country: 'Poland', lat: 52.23, lon: 21.01, tz: 'Europe/Warsaw' },
    { name: 'Athens', country: 'Greece', lat: 37.98, lon: 23.73, tz: 'Europe/Athens' },
    { name: 'Istanbul', country: 'Turkey', lat: 41.01, lon: 28.98, tz: 'Europe/Istanbul' },
    { name: 'Tel Aviv', country: 'Israel', lat: 32.09, lon: 34.78, tz: 'Asia/Jerusalem' },
    { name: 'Bangkok', country: 'Thailand', lat: 13.76, lon: 100.50, tz: 'Asia/Bangkok' },
    { name: 'Kuala Lumpur', country: 'Malaysia', lat: 3.14, lon: 101.69, tz: 'Asia/Kuala_Lumpur' },
    { name: 'Jakarta', country: 'Indonesia', lat: -6.21, lon: 106.85, tz: 'Asia/Jakarta' },
    { name: 'Manila', country: 'Philippines', lat: 14.60, lon: 120.98, tz: 'Asia/Manila' },
    { name: 'Taipei', country: 'Taiwan', lat: 25.03, lon: 121.57, tz: 'Asia/Taipei' },
];

function filterCities(query) {
    const dropdown = document.getElementById('cityDropdown');
    if (!dropdown) return;
    if (!query || query.length < 2) {
        dropdown.classList.remove('active');
        return;
    }
    
    const filtered = cities.filter(c => 
        c.name.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 8);
    
    if (filtered.length === 0) {
        dropdown.classList.remove('active');
        return;
    }
    
    dropdown.innerHTML = filtered.map(c => `
        <div class="city-option" onclick="selectCity('${c.name}')">
            ${c.name}<span class="country">${c.country}</span>
        </div>
    `).join('');
    dropdown.classList.add('active');
}

function showCityDropdown() {
    const input = document.getElementById('onboardingLocation');
    if (input && input.value.length >= 2) {
        filterCities(input.value);
    }
}

function hideCityDropdown() {
    const dropdown = document.getElementById('cityDropdown');
    if (dropdown) dropdown.classList.remove('active');
    const settingsDropdown = document.getElementById('settingsCityDropdown');
    if (settingsDropdown) settingsDropdown.classList.remove('active');
}

function selectCity(cityName) {
    const locInput = document.getElementById('onboardingLocation');
    if (locInput) locInput.value = cityName;
    hideCityDropdown();
    
    // Look up coordinates and calculate real moon data
    const city = cities.find(c => c.name === cityName);
    if (city) {
        updateLocationDisplay(city.name, city.country);
        onLocationObtained(city.lat, city.lon, city.tz);
        // Save to localStorage
        localStorage.setItem('moonpop_location', JSON.stringify({ name: city.name, country: city.country }));
    }
}

// Settings modal city autocomplete
function filterSettingsCities(query) {
    const dropdown = document.getElementById('settingsCityDropdown');
    if (!query || query.length < 2) {
        dropdown.classList.remove('active');
        return;
    }
    
    const filtered = cities.filter(c => 
        c.name.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 8);
    
    if (filtered.length === 0) {
        dropdown.classList.remove('active');
        return;
    }
    
    dropdown.innerHTML = filtered.map(c => `
        <div class="city-option" onclick="selectSettingsCity('${c.name}')">
            ${c.name}<span class="country">${c.country}</span>
        </div>
    `).join('');
    dropdown.classList.add('active');
}

async function selectSettingsCity(cityName) {
    document.getElementById('manualLocation').value = cityName;
    hideCityDropdown();

    // Immediately update location and moon data
    const city = cities.find(c => c.name === cityName);
    if (city) {
        updateLocationDisplay(city.name, city.country);
        onLocationObtained(city.lat, city.lon, city.tz);
        // Save to localStorage
        localStorage.setItem('moonpop_location', JSON.stringify({ name: city.name, country: city.country }));
        // Save to Supabase profile so it persists across refreshes
        if (currentAuthUser) {
            const { error } = await sb.from('profiles').update({
                city: city.name,
                latitude: city.lat,
                longitude: city.lon,
                timezone: city.tz
            }).eq('id', currentAuthUser.id);
            if (error) console.error('[selectSettingsCity] Profile save failed:', error);
            else console.log('[selectSettingsCity] Saved location to DB:', city.name);
        }
    }
}

// Check for geolocation support and show button if available
function checkGeolocationSupport() {
    const btn = document.getElementById('geolocateBtn');
    if (btn && navigator.geolocation) {
        btn.style.display = 'block';
    }
}

function detectOnboardingLocation() {
    if (!navigator.geolocation) return;
    
    const btn = document.getElementById('geolocateBtn');
    if (!btn) return;
    btn.textContent = 'Detecting...';
    btn.disabled = true;
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude, longitude } = pos.coords;
            const locInput = document.getElementById('onboardingLocation');
            if (locInput) locInput.value = 'Current location';
            
            // Store and fetch real moon data (use browser's timezone for GPS)
            const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            updateLocationDisplay('Your location', '');
            onLocationObtained(latitude, longitude, browserTz);
            
            btn.textContent = 'Location detected';
            btn.style.borderColor = '#4caf50';
            btn.style.color = '#4caf50';
        },
        (err) => {
            btn.textContent = 'Use my current location';
            btn.disabled = false;
            if (err.code === err.PERMISSION_DENIED) {
                btn.style.display = 'none';
            }
        },
        { timeout: 10000 }
    );
}

async function completeOnboarding() {
    const locEl = document.getElementById('onboardingLocation');
    const nameEl = document.getElementById('onboardingName');
    const location = locEl ? locEl.value.trim() : '';
    const name = nameEl ? nameEl.value.trim() : '';
    
    if (!location) {
        alert('Please enter your location so we can calculate moonrise times.');
        return;
    }

    // Save to state and UI
    const city = cities.find(c => c.name.toLowerCase() === location.toLowerCase());
    if (city) {
        updateLocationDisplay(city.name, city.country);
    } else {
        updateLocationDisplay(location === 'Current location' ? 'Your location' : location, '');
    }
    
    if (name) {
        document.getElementById('userInitials').textContent = name.charAt(0).toUpperCase();
        const userNameField = document.getElementById('userName');
        if (userNameField) userNameField.value = name;
        localStorage.setItem('moonpop_username', name);
    }

    if (!moonData.userLat && city) {
        onLocationObtained(city.lat, city.lon, city.tz);
    }

    // Save profile to Supabase
    if (currentAuthUser && city) {
        const { error: profileError } = await sb.from('profiles').update({
            username: name || usernameFromEmail(currentAuthUser.email),
            city: city.name,
            latitude: city.lat,
            longitude: city.lon,
            timezone: city.tz
        }).eq('id', currentAuthUser.id);
        if (profileError) console.error('Profile save failed:', profileError);
        else console.log('Profile saved successfully');
    }

    localStorage.setItem('moonpop_seen', 'true');
    localStorage.setItem('moonpop_location', JSON.stringify({ name: city ? city.name : location, country: city ? city.country : '' }));
    hideOnboarding();

    if (moonData.isVisible) {
        setTimeout(() => openModal(), 400);
    }
}

function skipOnboarding() {
    // Save minimal profile to Supabase
    if (currentAuthUser) {
        sb.from('profiles').update({
            username: usernameFromEmail(currentAuthUser.email)
        }).eq('id', currentAuthUser.id);
    }
    localStorage.setItem('moonpop_seen', 'true');
    hideOnboarding();
}

// Close city dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.location-input-wrapper')) {
        hideCityDropdown();
    }
    // Close new contact city dropdown
    if (!e.target.closest('#newContactCity') && !e.target.closest('#newContactCityDropdown')) {
        document.getElementById('newContactCityDropdown')?.classList.remove('active');
    }
});

// Update moon position on orbit (hovering outside)
function updateMoonPosition() {
    const moonOrbit = document.getElementById('moonOrbit');
    
    // Moon always positioned by current time on the 24h ring
    moonOrbit.style.transform = `rotate(${moonData.position}deg)`;
    moonOrbit.style.opacity = moonData.isVisible ? '1' : '0.3';
}

// Update center content
// Render the live timer with each DIGIT in a fixed-width (1ch) cell. The colons
// never change so they stay as plain text. This makes the timer's width and the
// glyph baseline immune to whatever font actually renders: even if the Cormorant
// webfont hasn't loaded and we fall back to a font with proportional or old-style
// figures, each digit sits centered in an identical box and can't shift the row
// horizontally or bob it vertically. (Past tabular-nums-only fixes kept regressing
// because the Windows serif fallback — Georgia — ignores tabular-nums.)
function timerCellsHtml(str) {
    let out = '';
    for (const ch of str) {
        out += ch >= '0' && ch <= '9' ? `<span class="t-digit">${ch}</span>` : ch;
    }
    return out;
}

function updateOrbitCenter() {
    const centerEl = document.getElementById('orbitCenter');
    const heroTitle = document.getElementById('heroTitle');
    const countdown = getCountdown();

    // Live HH:MM:SS format — the only thing that genuinely changes every second.
    const pad = (n) => String(n).padStart(2, '0');
    const timerStr = `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`;

    // Count incoming in-transit items (messages + synthetic reply entries)
    const incomingInTransit = messages.filter(m => m.type === 'received' && m.stillInTransit).length;

    // Total unread = all unread across conversations
    const safeWaiting = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

    // If no location set yet, show a prompt
    if (!moonData.userLat) {
        document.body.classList.remove('moon-down');
        if (heroTitle) heroTitle.textContent = 'MESSAGES RELEASED BY THE MOON';
        centerEl.innerHTML = `
            <p class="visibility-text">Set your location to begin</p>
            <p class="visibility-subtitle">The moon needs to know where you are.</p>
            <button class="cta-button" onclick="toggleSettings()">Set Location</button>
        `;
        window._orbitCenterSig = null; // force a rebuild once location arrives
        return;
    }

    const userName = localStorage.getItem('moonpop_username') || '';

    // Use releaseAt as source of truth (consistent with renderMessageDots)
    const now = new Date();
    const outgoingInTransit = messages.filter(m => m.type === 'sent' && ((m.releaseAt && new Date(m.releaseAt) > now) || (m.status === 'In Transit' && !m.releaseAt))).length;
    const inTransit = outgoingInTransit + incomingInTransit;
    const unreadCount = safeWaiting;

    // This function runs every second only to advance the clock. Everything else here
    // is a pure function of the state below, so we rebuild the markup only when that
    // state changes; otherwise we just patch the timer text node. This avoids tearing
    // down and re-creating the orbit-center subtree (and restarting the live-dot pulse
    // animation) on every tick.
    const sig = JSON.stringify([moonData.isVisible, userName, moonData.moonset || '', unreadCount, inTransit, incomingInTransit]);

    if (sig === window._orbitCenterSig) {
        const timerEl = centerEl && centerEl.querySelector('.live-timer');
        if (timerEl) timerEl.innerHTML = timerCellsHtml(timerStr);
    } else {
        window._orbitCenterSig = sig;

        // Show/hide inbox CTA
        const inboxCta = document.getElementById('inboxNewMsgCta');

        // Moon glow: toggle classes based on visibility
        const moonIconEl = document.getElementById('orbitMoonIcon');
        const orbitRingEl = document.querySelector('.orbit-ring');
        if (moonData.isVisible) {
            if (moonIconEl) moonIconEl.classList.add('moon-glow');
            if (orbitRingEl) orbitRingEl.classList.add('moon-visible');
        } else {
            if (moonIconEl) moonIconEl.classList.remove('moon-glow');
            if (orbitRingEl) orbitRingEl.classList.remove('moon-visible');
        }

        if (moonData.isVisible) {
            // Moon is UP — sender side
            document.body.classList.remove('moon-down');
            if (heroTitle) {
                const greeting = userName ? `Hello ${userName}.` : 'Hello.';
                const moonsetStr = moonData.moonset && moonData.moonset !== '--:--' ? moonData.moonset : '';
                if (moonsetStr) {
                    heroTitle.innerHTML = `${greeting}<br>The Moon Post Service is now open! Closing at moonset at ${moonsetStr}.`;
                } else {
                    heroTitle.innerHTML = `${greeting}<br>The Moon Post Service is now open!`;
                }
            }
            if (inboxCta) inboxCta.style.display = '';

            // Combined status: unread + in-transit in one sentence
            let statusLine = '';
            if (unreadCount > 0 && inTransit > 0) {
                statusLine = `<p class="moon-carrying-indicator">You have <span class="moon-carrying-count">${unreadCount}</span> unread ${unreadCount === 1 ? 'message' : 'messages'} and <span class="moon-carrying-count">${inTransit}</span> ${inTransit === 1 ? 'message' : 'messages'} being delivered</p>`;
            } else if (unreadCount > 0) {
                statusLine = `<p class="moon-carrying-indicator">You have <span class="moon-carrying-count">${unreadCount}</span> unread ${unreadCount === 1 ? 'message' : 'messages'}</p>`;
            } else if (inTransit > 0) {
                statusLine = `<p class="moon-carrying-indicator"><span class="moon-carrying-count">${inTransit}</span> ${inTransit === 1 ? 'message' : 'messages'} being delivered</p>`;
            }

            centerEl.innerHTML = `
                <div class="standby-countdown live-timer">${timerCellsHtml(timerStr)}</div>
                <p class="standby-label">until services close</p>
                <div class="moon-live-indicator"><span class="moon-live-dot"></span> Moon is live</div>
                ${statusLine}
            `;
        } else {
            // Moon is DOWN — receiver side
            document.body.classList.add('moon-down');
            if (inboxCta) inboxCta.style.display = 'none';

            // "Carrying" = only in-transit messages (not unread — those are already delivered)
            const totalCarrying = incomingInTransit;
            if (heroTitle) {
                const greetingPrefix = userName ? `Hello ${userName}.<br>` : '';
                if (totalCarrying > 0 && safeWaiting > 0) {
                    heroTitle.innerHTML = `${greetingPrefix}The moon carries ${totalCarrying} ${totalCarrying === 1 ? 'message' : 'messages'} for you. You also have ${safeWaiting} unread ${safeWaiting === 1 ? 'message' : 'messages'} waiting.`;
                } else if (totalCarrying > 0) {
                    heroTitle.innerHTML = `${greetingPrefix}The moon carries ${totalCarrying} ${totalCarrying === 1 ? 'message' : 'messages'} for you. You'll receive them when the moon reaches your sky.`;
                } else if (safeWaiting > 0) {
                    heroTitle.innerHTML = `${greetingPrefix}You have ${safeWaiting} unread ${safeWaiting === 1 ? 'message' : 'messages'}. The Moon Post Service opens when the moon rises.`;
                } else {
                    heroTitle.innerHTML = `${greetingPrefix}The Moon Post Service opens when the moon rises.`;
                }
            }

            // Ring center: countdown + carrying info
            const carryingLine = totalCarrying > 0
                ? `<p class="moon-carrying-indicator" style="margin-top:8px;opacity:0.7;">🌙 Carrying <span class="moon-carrying-count">${totalCarrying}</span> ${totalCarrying === 1 ? 'message' : 'messages'}</p>`
                : '';
            centerEl.innerHTML = `
                <div class="standby-countdown live-timer" style="opacity:0.6;">${timerCellsHtml(timerStr)}</div>
                <p class="standby-label">until moonrise</p>
                ${carryingLine}
            `;
        }
    }

    // Update reply row gating if conversation detail is open
    updateReplyRowMoonGate();
    updateInboxTransmitBtn();

    // Refresh inbox + dots every 30s to keep progress bars, badges & ring dots current
    if (!window._lastInboxRefresh || Date.now() - window._lastInboxRefresh > 30000) {
        window._lastInboxRefresh = Date.now();
        buildConversations();
        // Render immediately with preserved unreadCounts (from prevUnread in buildConversations)
        renderMessages();
        renderMessageDots();
        // Then refresh metadata from DB and re-render with authoritative counts
        loadConversationMetadata().then(() => {
            renderMessages();
            renderMessageDots();
        });
    }

    // Live-update chat transit countdowns
    document.querySelectorAll('.chat-transit-countdown').forEach(el => {
        const release = el.dataset.release;
        if (!release) return;
        const diff = new Date(release).getTime() - Date.now();
        const noteEl = el.querySelector('.chat-transit-note');
        if (!noteEl) return;
        if (diff > 0) {
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const eta = h > 0 ? `${h}h ${m}m` : `${m}m`;
            noteEl.textContent = `A moon message is on its way — arriving in ${eta}.`;
        } else {
            noteEl.textContent = 'A moon message has arrived.';
        }
    });
}

// --- New Moon Warning + Vaporize Logic ---
//
// There are two banners:
//   • Right-panel banner (`#newMoonWarning`): shows only ON the new moon
//     itself ("the new moon is here") and triggers the vaporize animation.
//   • Inbox-top banner (`#inboxWipeBanner`): the 5-day heads-up with the
//     actual wipe date — this is what users see leading up to the wipe.

function checkNewMoonWarning() {
    const warningEl = document.getElementById('newMoonWarning');
    const warningText = document.getElementById('newMoonWarningText');
    const now = new Date();
    const illum = SunCalc.getMoonIllumination(now);
    const phase = illum.phase;
    const isNewMoon = phase < 0.03 || phase > 0.97;

    if (warningEl && warningText) {
        if (isNewMoon) {
            warningText.textContent = 'The new moon is here \u2014 a new cycle begins';
            warningEl.classList.remove('hidden');
        } else {
            warningEl.classList.add('hidden');
        }
    }

    if (isNewMoon) triggerNewMoonVaporize();

    // Run the inbox-top heads-up on the same tick
    try { checkInboxWipeBanner(); } catch (e) { /* no-op */ }
}

function dismissNewMoonWarning() {
    const todayStr = new Date().toISOString().slice(0, 10);
    localStorage.setItem('moonpop_newmoon_dismiss', todayStr);
    const warningEl = document.getElementById('newMoonWarning');
    if (warningEl) warningEl.classList.add('hidden');
}

// --- Inbox-top wipe heads-up (≤5 days before new moon) ---
//
// Shows the actual date the dark moon arrives and how many days remain.
// Dismissal is keyed to the lunar cycle so the banner reappears the next
// cycle rather than staying dismissed forever.
function checkInboxWipeBanner() {
    const bannerEl = document.getElementById('inboxWipeBanner');
    const titleEl = document.getElementById('inboxWipeBannerTitle');
    const subEl = document.getElementById('inboxWipeBannerSub');
    if (!bannerEl || !titleEl || !subEl) return;

    if (typeof SunCalc === 'undefined') return;

    const now = new Date();
    const illum = SunCalc.getMoonIllumination(now);
    const phase = illum.phase;

    // phase > 0.5 is waning; 1 - phase scales 0→29.53 days to next new moon.
    // 5 days out corresponds to phase ≳ 0.83.
    const daysUntilNew = phase > 0.5 ? (1 - phase) * 29.53 : Infinity;

    if (daysUntilNew > 5) {
        bannerEl.classList.add('hidden');
        return;
    }

    const cycleNum = Math.floor(Date.now() / (29.53 * 24 * 3600 * 1000));
    const dismissedCycle = localStorage.getItem('moonpop_inbox_wipe_dismiss_cycle');
    if (dismissedCycle === String(cycleNum)) {
        bannerEl.classList.add('hidden');
        return;
    }

    const wipeAt = new Date(now.getTime() + daysUntilNew * 24 * 3600 * 1000);
    const dateStr = wipeAt.toLocaleDateString(undefined, {
        weekday: 'long', month: 'short', day: 'numeric'
    });
    const rounded = Math.max(1, Math.ceil(daysUntilNew));
    const dayWord = rounded === 1 ? 'day' : 'days';

    titleEl.textContent = `The dark moon rises ${dateStr}`;
    subEl.textContent = `Your chat history dissolves with it in ${rounded} ${dayWord}. Unread messages under 7 days old are kept.`;
    bannerEl.classList.remove('hidden');
}

function dismissInboxWipeBanner() {
    const cycleNum = Math.floor(Date.now() / (29.53 * 24 * 3600 * 1000));
    localStorage.setItem('moonpop_inbox_wipe_dismiss_cycle', String(cycleNum));
    const bannerEl = document.getElementById('inboxWipeBanner');
    if (bannerEl) bannerEl.classList.add('hidden');
}

function triggerNewMoonVaporize() {
    // Only play once per lunar cycle
    const illum = SunCalc.getMoonIllumination(new Date());
    const cycleNum = Math.floor(Date.now() / (29.53 * 24 * 3600 * 1000));
    const lastCycle = localStorage.getItem('moonpop_last_vaporize_cycle');
    if (lastCycle === String(cycleNum)) return;

    // Only trigger when moon is visible (user's moonrise on new moon day)
    if (!moonData || !moonData.isVisible) return;

    localStorage.setItem('moonpop_last_vaporize_cycle', String(cycleNum));

    // Add vaporizing class to all message pages
    const msgPages = document.querySelectorAll('.message-page-body, .message-page-inner');
    msgPages.forEach(el => el.classList.add('vaporizing'));

    // After animation, clear and show empty state
    setTimeout(() => {
        msgPages.forEach(el => el.classList.remove('vaporizing'));
        // Reload to get fresh (empty) data from server
        debouncedReloadMessages();
    }, 2500);
}

// Run new moon check every 60 seconds
setInterval(checkNewMoonWarning, 60000);

// Format relative ETA for inbox badges
function formatRelativeEta(releaseAt) {
    if (!releaseAt) return '';
    const diff = new Date(releaseAt).getTime() - Date.now();
    if (diff <= 0) return '';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return ` \u00b7 arrives in ${h}h ${m}m`;
    return ` \u00b7 arrives in ${m}m`;
}

// Render all messages chronologically (IM-style)
function renderMessages() {
    const list = document.getElementById('messageList');

    // Build conversation items with sort timestamps for merging with roulette rows
    const convItems = conversations.map((conv, ci) => {
        const initial = (conv.otherName || '?').charAt(0).toUpperCase();
        let avatarUrl = conv.otherAvatar || null;
        // Final safety: never display current user's own avatar on someone else's row
        const myAvatar = localStorage.getItem('moonpop_profilepic');
        if (avatarUrl && myAvatar && avatarUrl === myAvatar) {
            avatarUrl = null;
        }
        const contact = contacts.find(c => {
            // Never match current user's own contact entry
            if (c.linkedProfileId === currentAuthUser?.id) return false;
            return c.name === conv.otherName || (c.email && c.email === conv.otherEmail);
        });
        if (!avatarUrl && contact?.avatar) avatarUrl = contact.avatar;
        // Check online via profile ID first (most reliable), then contact fallback
        const online = (conv.otherProfileId && onlineUsers[conv.otherProfileId]) || isContactOnline(contact);
        const onlineDot = online ? '<span class="online-dot-indicator" style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:#4caf50;border:2px solid var(--bg);z-index:1;"></span>' : '';

        let avatar;
        if (avatarUrl) {
            avatar = `<div class="msg-avatar">${onlineDot}<img src="${avatarUrl}" onerror="this.style.display='none';this.parentElement.innerHTML+='<span>${initial}</span>'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>`;
        } else {
            avatar = `<div class="msg-avatar">${onlineDot}<span>${initial}</span></div>`;
        }

        // Badge for orbiting messages (sent or incoming)
        let badge = '';
        let progressBar = '';
        if (conv.hasInTransit) {
            const eta = formatRelativeEta(conv.transitReleaseAt);
            badge = `<span class="message-status-badge orbiting">${iconSvg('orbiting', 'sm')} Orbiting${eta}</span>`;
            // Progress bar: how far along from sent → moonrise
            if (conv.transitCreatedAt && conv.transitReleaseAt) {
                const sent = new Date(conv.transitCreatedAt).getTime();
                const release = new Date(conv.transitReleaseAt).getTime();
                const now = Date.now();
                const total = release - sent;
                const elapsed = now - sent;
                const pct = total > 0 ? Math.min(100, Math.max(2, (elapsed / total) * 100)) : 50;
                // Don't show progress bar if release time has passed (message delivered)
                if (now < release) {
                    progressBar = `<div class="transit-progress"><div class="transit-progress-bar" style="width:${pct.toFixed(1)}%"></div></div>`;
                }
            }
        } else if (conv.hasIncomingTransit && !moonData.isVisible) {
            // Only show "On Its Way" when YOUR moon is down. If your moon is up,
            // the message should already be released/readable — don't show transit bar.
            const eta = formatRelativeEta(conv.incomingTransitReleaseAt);
            const transitCount = conv.incomingTransitCount || 1;
            const countLabel = transitCount > 1 ? ` (${transitCount})` : '';
            badge = `<span class="message-status-badge arriving">${iconSvg('on-its-way', 'sm')} On Its Way${countLabel}${eta}</span>`;
            // Progress bar: how far along from sent → your moonrise
            if (conv.incomingTransitCreatedAt && conv.incomingTransitReleaseAt) {
                const sent = new Date(conv.incomingTransitCreatedAt).getTime();
                const release = new Date(conv.incomingTransitReleaseAt).getTime();
                const now = Date.now();
                const total = release - sent;
                const elapsed = now - sent;
                const pct = total > 0 ? Math.min(100, Math.max(2, (elapsed / total) * 100)) : 50;
                // Don't show progress bar if release time has passed (message delivered)
                if (now < release) {
                    progressBar = `<div class="transit-progress"><div class="transit-progress-bar incoming" style="width:${pct.toFixed(1)}%"></div></div>`;
                }
            }
        }

        const unreadBadge = conv.unreadCount > 0 ? `<span class="unread-badge pulse">${conv.unreadCount}</span>` : '';
        const isUnread = conv.unreadCount > 0;

        // Moon transit bar — only show when there's active transit AND no progressBar already
        // Don't show if release time has passed (message already delivered)
        const releaseTime = conv.transitReleaseAt || conv.incomingTransitReleaseAt;
        const transitExpired = releaseTime && new Date(releaseTime) <= new Date();
        const hasActiveTransit = (conv.hasInTransit || conv.hasIncomingTransit) && !transitExpired;
        const moonStatus = (hasActiveTransit && !progressBar) ? getContactMoonStatus(conv.location) : null;
        let transitBar = '';
        if (moonStatus) {
            const fillPct = Math.round(moonStatus.progress * 100);
            const barClass = moonStatus.isUp ? 'active' : '';
            // Their moonrise status
            let theirLabel = moonStatus.isUp
                ? 'Moon in their sky'
                : (moonStatus.hoursUntilRise < 1
                    ? `Their moonrise in ${Math.round(moonStatus.hoursUntilRise * 60)}m`
                    : `Their moonrise in ${Math.floor(moonStatus.hoursUntilRise)}h ${Math.round((moonStatus.hoursUntilRise % 1) * 60)}m`);
            // Your moonrise/moonset status (return direction)
            let yourLabel = '';
            if (moonData.isVisible) {
                const cd = getCountdown();
                yourLabel = cd.hours > 0
                    ? ` · Your moonset in ${cd.hours}h ${cd.minutes}m`
                    : ` · Your moonset in ${cd.minutes}m`;
            } else if (moonData._nextRise || moonData._cycleRise) {
                const nextRise = moonData._nextRise || moonData._cycleRise;
                const hrsUntil = Math.max(0, (nextRise - new Date()) / 3600000);
                yourLabel = hrsUntil < 1
                    ? ` · Your moonrise in ${Math.round(hrsUntil * 60)}m`
                    : ` · Your moonrise in ${Math.floor(hrsUntil)}h ${Math.round((hrsUntil % 1) * 60)}m`;
            }
            transitBar = `
                <div class="moon-transit-bar">
                    <div class="moon-transit-fill ${barClass}" style="width:${fillPct}%"></div>
                </div>
                <div class="moon-transit-label">${theirLabel}${yourLabel}</div>
            `;
        }

        const sortTime = conv.latestCreatedAt ? new Date(conv.latestCreatedAt).getTime() : 0;
        return {
            sortTime,
            isUnread: conv.unreadCount > 0,
            html: `
                <li class="message-item msg-row${isUnread ? ' unread' : ''}${ci === currentConversationIndex ? ' active' : ''}" data-sender="${conv.otherName}" data-profile-id="${conv.otherProfileId || ''}" data-orbiting="${conv.hasInTransit}" data-location="${conv.location || ''}"
                    onclick="openConversation(${ci})"
                    onmouseenter="highlightOrbitDot('${conv.otherName}', true)"
                    onmouseleave="highlightOrbitDot('${conv.otherName}', false)">
                    ${avatar}
                    <div class="message-content">
                        <div class="message-sender">${conv.otherUsername || conv.otherName}</div>
                        ${badge}
                        <div class="message-preview">${conv.latestPreview}</div>
                        ${progressBar}
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                        ${conv.latestTime ? `<span class="message-time">${conv.latestTime}</span>` : `<span class="message-time">Now</span>`}
                        ${unreadBadge}
                    </div>
                    ${transitBar}
                </li>
            `
        };
    });

    // Merge roulette rows and apply sort mode
    const rouletteItems = (typeof getRouletteInboxItems === 'function') ? getRouletteInboxItems() : [];
    const allItems = [...convItems, ...rouletteItems];
    if (inboxSortMode === 'oldest') {
        allItems.sort((a, b) => a.sortTime - b.sortTime);
    } else if (inboxSortMode === 'unread') {
        allItems.sort((a, b) => {
            const au = a.isUnread ? 0 : 1, bu = b.isUnread ? 0 : 1;
            return au !== bu ? au - bu : b.sortTime - a.sortTime;
        });
    } else if (inboxSortMode === 'roulette') {
        allItems.sort((a, b) => {
            const ar = a.isRoulette ? 0 : 1, br = b.isRoulette ? 0 : 1;
            return ar !== br ? ar - br : b.sortTime - a.sortTime;
        });
    } else {
        allItems.sort((a, b) => b.sortTime - a.sortTime);
    }
    list.innerHTML = allItems.map(i => i.html).join('');
}

// ========================
