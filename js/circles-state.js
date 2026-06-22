// Moon Circles — State & Rendering

// MOON CIRCLES
// ============================================
// Moon Circles - loaded from Supabase
let moonCircles = [];

async function loadMoonCircles() {
    if (!currentAuthUser) return;

    // Get circles the user is a member of
    const { data: memberships, error: memErr } = await sb.from('circle_members')
        .select('circle_id')
        .eq('user_id', currentAuthUser.id);

    if (memErr || !memberships || memberships.length === 0) return;

    const circleIds = memberships.map(m => m.circle_id);

    // Get circle details
    const { data: circlesData, error: circErr } = await sb.from('moon_circles')
        .select('*')
        .in('id', circleIds);

    if (circErr || !circlesData) return;

    // Get members for each circle
    const { data: allMembers } = await sb.from('circle_members')
        .select('*, profile:profiles!user_id(username, city)')
        .in('circle_id', circleIds);

    // Get nights for each circle
    const { data: allNights } = await sb.from('circle_nights')
        .select('*')
        .in('circle_id', circleIds)
        .order('date', { ascending: false });

    // Get contributions for those nights
    let allContributions = [];
    if (allNights && allNights.length > 0) {
        const nightIds = allNights.map(n => n.id);
        const { data: contribs } = await sb.from('circle_contributions')
            .select('*, author:profiles!user_id(username, city)')
            .in('night_id', nightIds);
        if (contribs) allContributions = contribs;
    }

    // Assemble circles
    moonCircles = circlesData.map(circle => {
        const members = (allMembers || [])
            .filter(m => m.circle_id === circle.id)
            .map(m => m.profile?.username || 'Unknown');

        const nights = (allNights || [])
            .filter(n => n.circle_id === circle.id)
            .map(night => {
                const contributions = allContributions
                    .filter(c => c.night_id === night.id)
                    .map(c => ({
                        member: c.author?.username || 'Unknown',
                        location: c.author?.city || 'Unknown',
                        note: c.note_text ? {
                            text: c.note_text,
                            closing: c.note_closing || ''
                        } : null
                    }));

                const hasUserContribution = allContributions.some(
                    c => c.night_id === night.id && c.user_id === currentAuthUser.id
                );

                return {
                    dbId: night.id,
                    date: night.date,
                    promptSetIndex: night.prompt_set_index,
                    contributions: contributions,
                    yourTurn: !hasUserContribution
                };
            });

        return {
            id: circle.id,
            name: circle.name,
            emoji: circle.emoji || '🔥',
            members: members,
            nights: nights
        };
    });
}

// Contacts database — loaded from Supabase
let contacts = [];

async function loadContacts() {
    if (!currentAuthUser) {
        // Try to recover session — currentAuthUser may have been cleared by a race condition
        const { data } = await sb.auth.getSession();
        if (data?.session) {
            currentAuthUser = data.session.user;
            console.warn('loadContacts: recovered session from auth state');
        } else {
            console.warn('loadContacts: no currentAuthUser and no session, skipping');
            return;
        }
    }

    // Load raw contacts (no FK join — it's unreliable)
    const { data, error } = await sb.from('contacts')
        .select('*')
        .eq('owner_id', currentAuthUser.id)
        .order('created_at', { ascending: false });

    if (!data) { console.error('Load contacts failed:', error); return; }

    // First pass: build contacts array from DB
    contacts = data.map(c => ({
        id: c.id,
        name: c.name,
        location: c.city || 'Unknown',
        email: c.email,
        avatar: null,
        username: null,
        firstName: null,
        lastName: null,
        isOnMoonpop: c.is_on_moonpop || false,
        linkedProfileId: c.linked_profile_id || null
    }));

    // Second pass: batch-fetch all linked profiles in ONE query (fast + no auth.users access)
    const linkedIds = contacts.filter(c => c.linkedProfileId).map(c => c.linkedProfileId);
    const profileMap = {};
    if (linkedIds.length > 0) {
        const { data: profiles } = await sb.from('profiles')
            .select('id, username, first_name, last_name, city, avatar_url, email')
            .in('id', linkedIds);
        if (profiles) profiles.forEach(p => { profileMap[p.id] = p; });
    }

    // Apply profile data to contacts
    for (let i = 0; i < contacts.length; i++) {
        const c = contacts[i];
        if (c.linkedProfileId && profileMap[c.linkedProfileId]) {
            const p = profileMap[c.linkedProfileId];
            contacts[i].avatar = p.avatar_url || null;
            contacts[i].username = p.username || null;
            contacts[i].firstName = p.first_name || null;
            contacts[i].lastName = p.last_name || null;
            contacts[i].location = p.city || c.location;
            contacts[i].isOnMoonpop = true;
            // Use username (sender name) as primary display name
            // Fall back to full name if no username set
            const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
            if (p.username) contacts[i].name = p.username;
            else if (fullName) contacts[i].name = fullName;

            // Persist updated name back to contacts DB (fire and forget)
            const resolvedName = p.username || fullName || c.name;
            if (resolvedName !== c.name) {
                sb.from('contacts').update({ name: resolvedName }).eq('id', c.id);
            }
        }
    }

    // Third pass: for contacts WITHOUT a linked profile, try to find them by email.
    // ONE batched query for all unlinked emails (was N+1: a query per contact in a
    // serial loop — the single biggest contributor to slow inbox load).
    const unlinked = contacts.filter(c => c.email && !c.linkedProfileId);
    if (unlinked.length > 0) {
        try {
            const unlinkedEmails = unlinked.map(c => c.email);
            const { data: foundProfiles } = await sb.from('profiles')
                .select('id, username, first_name, last_name, city, avatar_url, email')
                .in('email', unlinkedEmails);
            // Index found profiles by lowercased email for matching
            const byEmail = {};
            (foundProfiles || []).forEach(p => { if (p.email) byEmail[p.email.toLowerCase()] = p; });

            for (const c of unlinked) {
                const p = byEmail[(c.email || '').toLowerCase()];
                if (!p) continue;
                const idx = contacts.indexOf(c);
                const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
                contacts[idx].avatar = p.avatar_url || null;
                contacts[idx].username = p.username || null;
                contacts[idx].firstName = p.first_name || null;
                contacts[idx].lastName = p.last_name || null;
                contacts[idx].location = p.city || c.location;
                contacts[idx].isOnMoonpop = true;
                contacts[idx].linkedProfileId = p.id;
                if (p.username) contacts[idx].name = p.username;
                else if (fullName) contacts[idx].name = fullName;

                // Update DB with resolved profile (fire and forget)
                const resolvedName = p.username || fullName || c.name;
                sb.from('contacts').update({
                    linked_profile_id: p.id,
                    is_on_moonpop: true,
                    name: resolvedName,
                    city: p.city || null
                }).eq('id', c.id);
            }
        } catch(e) {
            console.error('Contact batch email lookup failed:', e);
        }
    }

    // Mark self-contacts so we can show "You" badge
    contacts.forEach(c => {
        c._isSelf = (c.linkedProfileId && c.linkedProfileId === currentAuthUser.id) ||
                    (c.email && currentAuthUser.email && c.email.toLowerCase() === currentAuthUser.email.toLowerCase());
    });

    console.log('Contacts loaded:', contacts.length, 'on Moon Post Service:', contacts.filter(c => c.isOnMoonpop).length);
}

// Messages - loaded from Supabase
let messages = [];
let conversations = []; // Grouped by person
let currentConversation = null; // Currently open conversation
// Dissolved (new-moon-wiped) conversations with no surviving messages. Cached by
// loadWipedConversations() and re-merged on EVERY buildConversations() so realtime/
// effects rebuilds don't drop them from the inbox.
let _wipedConvCache = [];
// My per-conversation read state: conversation_id -> last_read_at (ISO). This app
// tracks "read" in the read_receipts table, NOT messages.read_at — so message
// visibility must consult THIS to tell already-seen messages (don't re-seal under a
// down moon) from genuinely-new ones (gate until moonrise).
let myReadReceipts = {};

// Build conversations: group messages by the other person
function buildConversations() {
    // Preserve existing unread counts + transit state across rebuilds
    const prevUnread = {};
    const prevTransit = {};
    if (conversations && conversations.length) {
        conversations.forEach(c => {
            prevUnread[c.otherKey] = c.unreadCount || 0;
            prevTransit[c.otherKey] = {
                hasIncomingTransit: c.hasIncomingTransit,
                incomingTransitCount: c.incomingTransitCount,
                incomingTransitCreatedAt: c.incomingTransitCreatedAt,
                incomingTransitReleaseAt: c.incomingTransitReleaseAt,
                hasInTransit: c.hasInTransit,
            };
        });
    }
    const convMap = {};
    // Get current user's identifiers for safety checks
    const myId = currentAuthUser?.id;
    const myEmail = (currentAuthUser?.email || '').toLowerCase();

    messages.forEach(msg => {
        // Skip synthetic dot entries — they're only for ring rendering, not conversations
        if (msg.isReplyDot) return;

        // Determine the "other person" key (use ID when available, fallback to email/name)
        let otherKey, otherName, otherAvatar, otherProfileId, otherEmail;
        if (msg.type === 'sent') {
            // For sent messages: the "other" person is the RECIPIENT
            otherKey = msg.recipientId || msg.recipientEmail || msg.sender;
            otherName = msg.sender; // In sent messages, sender field = recipient name
            otherAvatar = msg.senderAvatar;
            otherProfileId = msg.recipientId;
            otherEmail = msg.recipientEmail;
            // Safety: if otherKey accidentally resolves to current user, skip
            if (otherKey === myId || (typeof otherKey === 'string' && otherKey.toLowerCase() === myEmail)) return;
        } else {
            // For received messages: the "other" person is the SENDER
            otherKey = msg.senderId || msg.sender;
            otherName = msg.sender;
            otherAvatar = msg.senderAvatar;
            otherProfileId = msg.senderId;
            otherEmail = null; // Don't use recipientEmail here — that's the current user's email, not the sender's
            // Safety: if sender is actually us (self-message slipped through), skip
            if (otherKey === myId) return;
        }

        // Skip messages with no valid other person key (ghost conversations)
        if (!otherKey || otherKey === 'Unknown' || otherKey === 'Someone') return;

        // GUARD: never use current user's own avatar for other people
        const myStoredAvatar = localStorage.getItem('moonpop_profilepic');
        if (otherAvatar && myStoredAvatar && otherAvatar === myStoredAvatar) {
            console.warn('[buildConversations] Blocked own avatar leak for', otherName);
            otherAvatar = null;
        }

        if (!convMap[otherKey]) {
            convMap[otherKey] = {
                otherKey,
                otherName,
                otherAvatar,
                otherProfileId,
                otherEmail,
                location: msg.location,
                messages: [],
                latestCreatedAt: msg.createdAt,
                latestPreview: '',
                latestTime: '',
                dbConversationId: null,
                unreadCount: prevUnread[otherKey] || 0,
                otherReadAt: null,
                // Preserve transit state across rebuilds
                ...(prevTransit[otherKey] || {}),
            };
        }
        convMap[otherKey].messages.push(msg);
        // Propagate DB conversation ID from messages that have one
        if (msg.conversationId && !convMap[otherKey].dbConversationId) {
            convMap[otherKey].dbConversationId = msg.conversationId;
        }
        // Update avatar if we get a better one
        // GUARD: never assign current user's own avatar to another person's conversation
        if (msg.senderAvatar && !convMap[otherKey].otherAvatar && msg.senderAvatar !== localStorage.getItem('moonpop_profilepic')) {
            convMap[otherKey].otherAvatar = msg.senderAvatar;
        }
    });

    // Enrich conversations with contact info and fix name resolution
    const myUsername = document.getElementById('settingsUsername')?.value || '';
    const myNameLC = myUsername.toLowerCase();
    const myEmailPrefix = (currentAuthUser?.email?.split('@')[0] || '').toLowerCase();
    Object.values(convMap).forEach(conv => {
        // Find matching contact — EXCLUDE self-contacts to avoid name confusion
        const contact = contacts.find(c =>
            !c._isSelf && (
                (conv.otherProfileId && c.linkedProfileId === conv.otherProfileId) ||
                (c.name === conv.otherName) ||
                (conv.otherEmail && c.email && c.email.toLowerCase() === conv.otherEmail.toLowerCase())
            )
        );
        // Only use contact username if it's NOT the current user's username
        const contactUsername = contact?.username || null;
        conv.otherUsername = (contactUsername && contactUsername.toLowerCase() !== myNameLC)
            ? contactUsername : null;
        // Prefer profile-resolved name (fresh from DB); only use contact name
        // as fallback for non-MPS contacts or when we have no name at all
        const hasProfileName = conv.otherProfileId && conv.otherName
            && conv.otherName !== 'Unknown' && conv.otherName !== 'Someone';
        if (contact && contact.name && !hasProfileName) {
            conv.otherName = contact.name;
        }
        // Fallback: if otherName still equals current user's name/email, clear it
        const nameLC = conv.otherName?.toLowerCase() || '';
        if (nameLC === myEmail || nameLC === myNameLC || nameLC === myEmailPrefix) {
            // otherName is accidentally the current user — try to find a better name
            if (contact && contact.name) {
                conv.otherName = contact.name;
            } else if (conv.otherProfileId) {
                conv.otherName = 'Unknown';
            }
        }
    });

    // For each conversation, determine latest preview text and time
    Object.values(convMap).forEach(conv => {
        // Sort messages newest first
        conv.messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const latest = conv.messages[0];
        conv.latestCreatedAt = latest.createdAt;
        conv.latestTime = latest.time;

        // Check if any reply is more recent than the latest top-level message
        // This ensures conversations with recent replies sort to the top
        let latestReplyTime = null;
        conv.messages.forEach(m => {
            if (m.replies && m.replies.length > 0) {
                m.replies.forEach(r => {
                    if (r.createdAt && (!latestReplyTime || new Date(r.createdAt) > new Date(latestReplyTime))) {
                        latestReplyTime = r.createdAt;
                    }
                });
            }
        });
        if (latestReplyTime && new Date(latestReplyTime) > new Date(conv.latestCreatedAt)) {
            conv.latestCreatedAt = latestReplyTime;
            conv.latestTime = timeAgo(latestReplyTime);
        }

        // Store the timestamp of the last sent message (used for implicit read receipt)
        const lastSent = conv.messages.find(m => m.type === 'sent');
        conv._lastSentAt = lastSent ? lastSent.createdAt : null;

        // Find the most recent reply across all messages in this conversation
        let latestReply = null;
        let latestReplyMsg = null;
        conv.messages.forEach(m => {
            if (m.replies && m.replies.length > 0) {
                m.replies.forEach(r => {
                    if (r.createdAt && (!latestReply || new Date(r.createdAt) > new Date(latestReply.createdAt))) {
                        latestReply = r;
                        latestReplyMsg = m;
                    }
                });
            }
        });

        // Determine if the latest activity is a reply or a top-level message
        const replyIsNewer = latestReply && new Date(latestReply.createdAt) > new Date(latest.createdAt);
        const effectiveLatest = replyIsNewer ? latestReply : latest;
        const isSentReply = replyIsNewer && latestReply.senderId === currentAuthUser?.id;
        const isSentMsg = !replyIsNewer && latest.type === 'sent';

        // Preview = the most recent activity in the conversation
        const youPrefix = (isSentReply || isSentMsg) ? 'You: ' : '';
        if (replyIsNewer && isSentReply && latestReply.text) {
            // Latest is a reply WE sent — show preview of our reply text
            conv.latestPreview = youPrefix + latestReply.text;
        } else if (replyIsNewer && !isSentReply) {
            // Latest is an incoming reply — never show text while it's still in
            // transit, and only show released text if the moon is up
            if (latestReply.stillInTransit || latestReply.status === 'Arriving') {
                conv.latestPreview = '🌙 On its way';
            } else {
                conv.latestPreview = moonData.isVisible ? (latestReply.text || 'Moon message') : '🌙 Moon message';
            }
        } else if (latest.stillInTransit && latest.type === 'received') {
            conv.latestPreview = '🌙 On its way';
        } else if (latest.status === 'In Transit') {
            conv.latestPreview = '🌙 On its way';
        } else if (latest.messageText) {
            conv.latestPreview = youPrefix + latest.messageText;
        } else if (latest.lunarNote) {
            // Show snippet of actual lunar note text instead of generic label
            const noteSnippet = latest.lunarNote.text
                ? latest.lunarNote.text.replace(/\n/g, ' ').substring(0, 40)
                : 'Lunar Note';
            conv.latestPreview = youPrefix + '🌙 ' + noteSnippet;
        } else if (latest.songUrl) {
            conv.latestPreview = youPrefix + '🎵 Song';
        } else if (latest.photoUrl) {
            conv.latestPreview = youPrefix + '📷 Photo';
        } else {
            conv.latestPreview = youPrefix + 'Moon message';
        }

        // Truncate preview
        if (conv.latestPreview.length > 50) {
            conv.latestPreview = conv.latestPreview.substring(0, 50) + '...';
        }
        conv.location = latest.location;
        // Bug fix #3/#4: Only count a message as in-transit if status is 'In Transit'
        // AND its release_at is in the future (or null). If release_at has passed,
        // the server cron should have released it — treat it as released client-side.
        const now = new Date();
        const transitMsg = conv.messages.find(m => {
            if (m.type !== 'sent' || m.status !== 'In Transit') return false;
            // If release_at has passed, this message should have been released
            if (m.releaseAt && new Date(m.releaseAt) <= now) return false;
            // 72h hard cutoff: two-hop courier (pickup cycle + recipient cycle) can exceed 24h
            if (m.createdAt && new Date(m.createdAt) < new Date(now.getTime() - 72 * 3600000)) return false;
            return true;
        });
        // Also check for in-transit reply dots (synthetic entries from sendReply)
        if (!transitMsg) {
            const otherNameLC = (conv.otherName || '').toLowerCase();
            const otherKeyLC = (conv.otherKey || '').toLowerCase();
            const replyDot = messages.find(m =>
                m.isReplyDot && m.status === 'In Transit' &&
                ((m.recipientProfileId && m.recipientProfileId === conv.otherProfileId) ||
                 m.sender?.toLowerCase() === otherNameLC ||
                 m.sender?.toLowerCase() === otherKeyLC) &&
                m.releaseAt && new Date(m.releaseAt) > now
            );
            if (replyDot) {
                conv.hasInTransit = true;
                conv.transitCreatedAt = replyDot.createdAt;
                conv.transitReleaseAt = replyDot.releaseAt;
            } else {
                conv.hasInTransit = false;
                conv.transitCreatedAt = null;
                conv.transitReleaseAt = null;
            }
        } else {
            conv.hasInTransit = true;
            conv.transitCreatedAt = transitMsg.createdAt;
            conv.transitReleaseAt = transitMsg.releaseAt;
        }
        if (conv.hasInTransit) {
            console.log('[inbox] transit to', conv.otherName, 'created:', conv.transitCreatedAt, 'release:', conv.transitReleaseAt);
        }

        // Also detect incoming messages genuinely in transit (not just "moon is down")
        const incomingTransitMsg = conv.messages.find(m => {
            if (m.type !== 'received') return false;
            // Use the stillInTransit flag (true only if release_at is future AND < 24h old)
            if (m.stillInTransit) return true;
            // Fallback: check status + time guards
            if (m.status !== 'Arriving') return false;
            if (m.releaseAt && new Date(m.releaseAt) <= now) return false;
            if (m.createdAt && new Date(m.createdAt) < new Date(now.getTime() - 24 * 3600000)) return false;
            return true;
        });
        conv.hasIncomingTransit = !!incomingTransitMsg;
        conv.incomingTransitCount = conv.messages.filter(m => m.type === 'received' && m.stillInTransit).length;
        conv.incomingTransitCreatedAt = incomingTransitMsg?.createdAt || null;
        conv.incomingTransitReleaseAt = incomingTransitMsg?.releaseAt || null;
        if (conv.hasIncomingTransit) {
            console.log('[inbox] incoming from', conv.otherName, 'created:', conv.incomingTransitCreatedAt, 'release:', conv.incomingTransitReleaseAt);
        }
    });

    // Recalculate time strings and sort conversations by latest activity
    conversations = Object.values(convMap);

    // Merge dissolved (new-moon-wiped) conversations that have no surviving
    // messages, so they stay in the inbox across EVERY rebuild — not just the
    // one inside loadMessages(). Skip any that already have a real (un-wiped)
    // entry from surviving messages, deduped by conversation id or person.
    if (_wipedConvCache.length) {
        const haveConvId = new Set(conversations.map(c => c.dbConversationId).filter(Boolean));
        const haveProfile = new Set(conversations.map(c => c.otherProfileId).filter(Boolean));
        _wipedConvCache.forEach(w => {
            if (w.dbConversationId && haveConvId.has(w.dbConversationId)) return;
            if (w.otherProfileId && haveProfile.has(w.otherProfileId)) return;
            conversations.push({ ...w });
        });
    }

    conversations.forEach(conv => {
        conv.latestTime = timeAgo(conv.latestCreatedAt);
    });
    conversations.sort((a, b) =>
        new Date(b.latestCreatedAt) - new Date(a.latestCreatedAt)
    );
}

// Fetch dissolved (new-moon-wiped) conversations that have no surviving messages
// and cache them so buildConversations() can re-merge them on every rebuild.
// (Previously this injection lived inline in loadMessages, so any later
// buildConversations() call from realtime/effects silently dropped these rows.)
async function loadWipedConversations() {
    _wipedConvCache = [];
    if (!currentAuthUser) return;
    try {
        const { data: myParticipations } = await sb.from('conversation_participants')
            .select('conversation_id')
            .eq('profile_id', currentAuthUser.id);
        if (!myParticipations || myParticipations.length === 0) return;

        const ids = myParticipations.map(p => p.conversation_id);
        const { data: wipedConvs } = await sb.from('conversations')
            .select('id, wiped_at, last_message_at')
            .in('id', ids)
            .not('wiped_at', 'is', null);
        if (!wipedConvs || wipedConvs.length === 0) return;

        const wipedIds = wipedConvs.map(c => c.id);
        const { data: otherParts } = await sb.from('conversation_participants')
            .select('conversation_id, profile_id, email')
            .in('conversation_id', wipedIds)
            .neq('profile_id', currentAuthUser.id);

        const otherProfileIds = (otherParts || []).map(p => p.profile_id).filter(Boolean);
        const otherProfileMap = {};
        if (otherProfileIds.length > 0) {
            const { data: otherProfiles } = await sb.from('profiles')
                .select('id, username, first_name, last_name, avatar_url, city')
                .in('id', otherProfileIds);
            (otherProfiles || []).forEach(p => { otherProfileMap[p.id] = p; });
        }

        wipedConvs.forEach(conv => {
            const other = (otherParts || []).find(p => p.conversation_id === conv.id);
            if (!other) return;
            const profile = other.profile_id ? otherProfileMap[other.profile_id] : null;
            const otherName = profile
                ? (profile.username || profile.first_name || other.email || 'Unknown')
                : (other.email || 'Unknown');
            const wipedDate = new Date(conv.wiped_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            _wipedConvCache.push({
                otherKey: other.profile_id || other.email,
                otherName,
                otherUsername: profile?.username || null,
                otherAvatar: profile?.avatar_url || null,
                otherProfileId: other.profile_id || null,
                otherEmail: other.email || null,
                location: profile?.city || null,
                messages: [],
                latestCreatedAt: conv.wiped_at,
                latestPreview: 'New moon erased this conversation',
                latestTime: wipedDate,
                dbConversationId: conv.id,
                wipedAt: conv.wiped_at,
                unreadCount: 0,
                hasInTransit: false,
                hasIncomingTransit: false,
            });
        });
    } catch (e) {
        console.error('[loadWipedConversations] failed:', e);
    }
}

// Load conversation metadata: unread counts + read receipts from DB
// Uses localStorage as fallback when DB read receipts query fails (RLS issues)
function getLocalReadReceipts() {
    try {
        return JSON.parse(localStorage.getItem('moonpop_read_receipts') || '{}');
    } catch { return {}; }
}
function saveLocalReadReceipt(convId) {
    try {
        const receipts = getLocalReadReceipts();
        receipts[convId] = new Date().toISOString();
        localStorage.setItem('moonpop_read_receipts', JSON.stringify(receipts));
    } catch {}
}

async function loadConversationMetadata() {
    if (!currentAuthUser) return;
    try {
        // The four reads below only depend on values already in hand (the current
        // user, the conversation ids, and the message ids) — none depends on another's
        // result. Compute the id lists first, then fire all four CONCURRENTLY instead
        // of paying four sequential round-trips.
        const myConvIds = conversations.map(c => c.dbConversationId).filter(Boolean);
        const allMsgIds = [];
        const msgToConv = {};
        conversations.forEach(conv => {
            conv.messages.forEach(m => {
                if (m.dbId) {
                    allMsgIds.push(m.dbId);
                    msgToConv[m.dbId] = conv;
                }
            });
        });

        const _emptyRes = Promise.resolve({ data: [] });
        const [
            { data: myReceipts, error: receiptErr },
            { data: convRows, error: convErr },
            { data: otherReceipts },
            { data: recentReplies },
        ] = await Promise.all([
            // 1. My read_receipts (to calculate unread counts)
            sb.from('read_receipts').select('conversation_id, last_read_at').eq('user_id', currentAuthUser.id),
            // 2a. conversations.wiped_at for the new-moon-wipe empty-state UI
            myConvIds.length > 0
                ? sb.from('conversations').select('id, wiped_at').in('id', myConvIds)
                : _emptyRes,
            // 2b. Other participants' read_receipts (blue checkmarks on sent messages)
            myConvIds.length > 0
                ? sb.from('read_receipts').select('conversation_id, last_read_at').in('conversation_id', myConvIds).neq('user_id', currentAuthUser.id)
                : _emptyRes,
            // 3. Latest replies per conversation for preview + unread.
            // replies_v (not replies): the masking view NULLs text/lunar_note_text
            // while a reply is sealed for me, so an in-transit reply can never
            // leak into a preview. Base-table content columns are no longer
            // readable by clients (migration 043).
            allMsgIds.length > 0
                ? sb.from('replies_v').select('id, message_id, text, is_lunar_note, lunar_note_text, sender_id, created_at').in('message_id', allMsgIds).order('created_at', { ascending: false }).limit(100)
                : _emptyRes,
        ]);

        if (receiptErr) {
            console.error('read_receipts SELECT failed:', receiptErr.message, receiptErr.code);
        }

        // Build receipt map from DB, then merge localStorage fallback
        const myReceiptMap = {};
        const localReceipts = getLocalReadReceipts();

        // DB receipts first (authoritative)
        if (myReceipts && myReceipts.length > 0) {
            myReceipts.forEach(r => { myReceiptMap[r.conversation_id] = r.last_read_at; });
        }
        // Merge localStorage fallback (use whichever is more recent)
        Object.entries(localReceipts).forEach(([convId, readAt]) => {
            if (!myReceiptMap[convId] || new Date(readAt) > new Date(myReceiptMap[convId])) {
                myReceiptMap[convId] = readAt;
            }
        });

        // Apply conversations.wiped_at so the chat empty-state can show the
        // "new moon wiped this conversation" UI for wiped threads.
        if (convErr) {
            console.error('conversations SELECT (wiped_at) failed:', convErr.message);
        } else if (convRows) {
            const wipedMap = {};
            convRows.forEach(r => { wipedMap[r.id] = r.wiped_at; });
            conversations.forEach(conv => {
                if (conv.dbConversationId) {
                    conv.wipedAt = wipedMap[conv.dbConversationId] || null;
                }
            });
        }

        let otherReceiptMap = {};
        if (otherReceipts) {
            otherReceipts.forEach(r => {
                if (!otherReceiptMap[r.conversation_id] || new Date(r.last_read_at) > new Date(otherReceiptMap[r.conversation_id])) {
                    otherReceiptMap[r.conversation_id] = r.last_read_at;
                }
            });
        }

        let latestReplyPerConv = {};
        let allRecentReplies = recentReplies || [];
        {
            if (recentReplies) {
                recentReplies.forEach(r => {
                    const conv = msgToConv[r.message_id];
                    if (!conv) return;
                    const key = conv.otherKey;
                    if (!latestReplyPerConv[key] || new Date(r.created_at) > new Date(latestReplyPerConv[key].created_at)) {
                        latestReplyPerConv[key] = r;
                    }
                });
            }
        }

        // 4. Enrich conversations with unread counts + reply-aware previews
        conversations.forEach(conv => {
            if (!conv.dbConversationId) return;

            const myLastRead = myReceiptMap[conv.dbConversationId];
            conv.otherReadAt = otherReceiptMap[conv.dbConversationId] || null;

            // Check if there's a reply newer than the latest top-level message
            const latestReply = latestReplyPerConv[conv.otherKey];
            if (latestReply && new Date(latestReply.created_at) > new Date(conv.latestCreatedAt)) {
                // Update preview with the latest reply
                conv.latestCreatedAt = latestReply.created_at;
                conv.latestTime = timeAgo(latestReply.created_at);
                const isMine = latestReply.sender_id === currentAuthUser.id;
                const youPrefix = isMine ? 'You: ' : '';
                if (latestReply.is_lunar_note && latestReply.lunar_note_text) {
                    const snippet = latestReply.lunar_note_text.replace(/\n/g, ' ').substring(0, 40);
                    conv.latestPreview = youPrefix + '🌙 ' + snippet;
                } else if (latestReply.text) {
                    conv.latestPreview = youPrefix + latestReply.text;
                }
                if (conv.latestPreview && conv.latestPreview.length > 50) {
                    conv.latestPreview = conv.latestPreview.substring(0, 50) + '...';
                }
            }

            // Determine the effective "last read" time:
            // Use the most recent of: read receipt, last sent message, last sent reply.
            // If you sent anything at time T, you've seen the conversation up to T.
            let effectiveReadTime = null;
            if (myLastRead) effectiveReadTime = new Date(myLastRead);
            if (conv._lastSentAt) {
                const sentTime = new Date(conv._lastSentAt);
                if (!effectiveReadTime || sentTime > effectiveReadTime) {
                    effectiveReadTime = sentTime;
                }
            }
            // Also check latest sent reply as implicit read time
            if (latestReply && latestReply.sender_id === currentAuthUser.id) {
                const replySentTime = new Date(latestReply.created_at);
                if (!effectiveReadTime || replySentTime > effectiveReadTime) {
                    effectiveReadTime = replySentTime;
                }
            }

            // Count unread = received messages + received replies newer than effectiveReadTime
            let unreadMsgCount = 0;
            let unreadReplyCount = 0;
            if (effectiveReadTime) {
                unreadMsgCount = conv.messages.filter(m =>
                    m.type === 'received' && new Date(m.createdAt) > effectiveReadTime
                ).length;
                // Also count unread replies from other users
                if (allRecentReplies.length > 0) {
                    unreadReplyCount = allRecentReplies.filter(r => {
                        const rConv = msgToConv[r.message_id];
                        return rConv === conv &&
                               r.sender_id !== currentAuthUser.id &&
                               new Date(r.created_at) > effectiveReadTime;
                    }).length;
                }
            } else {
                // Never sent or read anything = all received are unread
                unreadMsgCount = conv.messages.filter(m => m.type === 'received').length;
                if (allRecentReplies.length > 0) {
                    unreadReplyCount = allRecentReplies.filter(r => {
                        const rConv = msgToConv[r.message_id];
                        return rConv === conv && r.sender_id !== currentAuthUser.id;
                    }).length;
                }
            }
            conv.unreadCount = unreadMsgCount + unreadReplyCount;
        });

        // Re-sort conversations since reply timestamps may have changed ordering
        conversations.sort((a, b) =>
            new Date(b.latestCreatedAt) - new Date(a.latestCreatedAt)
        );
    } catch (err) {
        console.error('loadConversationMetadata error:', err);
    }
}

// Helper: WhatsApp-style time display
function timeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    if (isNaN(date)) return '';
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today - msgDay) / 86400000);

    if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Auto-create contacts for conversation partners not already in contacts table
async function syncConversationContacts() {
    if (!currentAuthUser) return;
    const existingKeys = new Set();
    contacts.forEach(c => {
        if (c.linkedProfileId) existingKeys.add(c.linkedProfileId);
        if (c.email) existingKeys.add(c.email.toLowerCase());
    });

    const toCreate = [];
    for (const conv of conversations) {
        // Skip self, shared sky, circles
        if (!conv.otherName || conv.isSharedSky || conv.isCircle) continue;
        const profileId = conv.otherProfileId || null;
        const email = conv.otherEmail || null;
        // Already a contact?
        if (profileId && existingKeys.has(profileId)) continue;
        if (email && existingKeys.has(email.toLowerCase())) continue;
        // Skip if matched by name
        if (contacts.some(c => (c.name || '').toLowerCase() === (conv.otherName || '').toLowerCase())) continue;

        const entry = {
            owner_id: currentAuthUser.id,
            name: conv.otherUsername || conv.otherName,
            email: email,
            city: conv.location || null,
            is_on_moonpop: !!profileId,
            linked_profile_id: profileId
        };
        toCreate.push(entry);
        // Track to avoid duplicates within same batch
        if (profileId) existingKeys.add(profileId);
        if (email) existingKeys.add(email.toLowerCase());
    }

    if (toCreate.length > 0) {
        console.log('[syncContacts] Auto-creating', toCreate.length, 'contacts from conversations');
        const { error } = await sb.from('contacts').insert(toCreate);
        if (error) {
            console.error('[syncContacts] Insert error:', error);
        } else {
            // Reload contacts to get the new entries with profile data
            await loadContacts();
        }
    }
}

async function loadMessages(retryCount = 0) {
    if (!currentAuthUser) {
        // Try to recover session — currentAuthUser may have been cleared by a race condition
        const { data } = await sb.auth.getSession();
        if (data?.session) {
            currentAuthUser = data.session.user;
            console.warn('loadMessages: recovered session from auth state');
        } else {
            console.warn('loadMessages: no currentAuthUser and no session, skipping');
            return;
        }
    }

    try {
        // Ensure we have a fresh session (prevents stale JWT issues)
        if (retryCount > 0) {
            const { data: { session } } = await sb.auth.getSession();
            if (!session) {
                console.error('loadMessages: session lost on retry, cannot load');
                return;
            }
            currentAuthUser = session.user;
        }

        console.log('loadMessages: starting (attempt ' + (retryCount + 1) + ') for user', currentAuthUser.id, currentAuthUser.email);

        // *** NO FK JOINS — they silently fail if FK missing or value is NULL ***

        // Fire the independent reads CONCURRENTLY instead of in series. Sent,
        // received-by-id, received-by-email and my read-receipts only depend on the
        // current user — there's no reason to pay four sequential round-trips. This
        // collapses ~4 serial network waits into one.
        // messages_v (not messages): the masking view NULLs content columns while
        // a message is sealed for me — the transit seal is enforced server-side
        // since migration 043; the contentVisible gate below stays as the
        // cosmetic moon-up layer on top.
        const _emailQuery = currentAuthUser.email
            ? sb.from('messages_v').select('*').eq('recipient_email', currentAuthUser.email).order('created_at', { ascending: false }).range(0, 199)
            : Promise.resolve({ data: [], error: null });
        const [
            { data: sent, error: sentErr },
            { data: recvById, error: err1 },
            { data: recvByEmail, error: err2 },
            { data: _rcpts, error: _rcptErr },
        ] = await Promise.all([
            sb.from('messages_v').select('*').eq('sender_id', currentAuthUser.id).order('created_at', { ascending: false }).range(0, 199),
            sb.from('messages_v').select('*').eq('recipient_id', currentAuthUser.id).order('created_at', { ascending: false }).range(0, 199),
            _emailQuery,
            sb.from('read_receipts').select('conversation_id, last_read_at').eq('user_id', currentAuthUser.id),
        ]);

        if (sentErr) {
            console.error('loadMessages: sent query failed:', sentErr.message, sentErr.code, sentErr.details);
            // If auth error, try getting fresh session
            if (sentErr.code === 'PGRST301' || sentErr.message?.includes('JWT') || sentErr.code === '401') {
                if (retryCount < 2) {
                    console.log('loadMessages: auth error, getting session and retrying...');
                    const { data } = await sb.auth.getSession();
                    if (data?.session) {
                        currentAuthUser = data.session.user;
                        return loadMessages(retryCount + 1);
                    }
                }
            }
        }

        // Merge the two "received" result sets (id + email), de-duped by message id
        let received = [];
        if (err1) console.error('loadMessages: recv by id failed:', err1.message);
        if (recvById) received = received.concat(recvById);
        if (err2) console.error('loadMessages: recv by email failed:', err2.message);
        if (recvByEmail) {
            const existingIds = new Set(received.map(m => m.id));
            recvByEmail.forEach(m => { if (!existingIds.has(m.id)) received.push(m); });
        }

        // Filter out messages from/to blocked users
        if (blockedUserIds.size > 0 || blockedUserEmails.size > 0) {
            received = received.filter(m => !isBlocked(m.sender_id, m.sender_email));
            if (sent) {
                for (let i = sent.length - 1; i >= 0; i--) {
                    if (isBlocked(sent[i].recipient_id, sent[i].recipient_email)) sent.splice(i, 1);
                }
            }
        }

        // 3. Batch-fetch profiles for senders and recipients
        const profileIds = new Set();
        (sent || []).forEach(m => { if (m.recipient_id) profileIds.add(m.recipient_id); });
        received.forEach(m => { if (m.sender_id) profileIds.add(m.sender_id); });

        const profileMap = {};
        if (profileIds.size > 0) {
            const { data: profiles } = await sb.from('profiles')
                .select('id, username, first_name, last_name, city, avatar_url')
                .in('id', Array.from(profileIds));
            if (profiles) profiles.forEach(p => { profileMap[p.id] = p; });
        }

        // Read receipts were prefetched in the concurrent batch above so message
        // visibility can tell "already seen" (read at/after the message) from
        // genuinely-new messages. (read_receipts is this app's real read signal;
        // messages.read_at is unused.)
        if (_rcptErr) console.error('[loadMessages] read_receipts prefetch failed:', _rcptErr.message);
        myReadReceipts = {};
        (_rcpts || []).forEach(r => { myReadReceipts[r.conversation_id] = r.last_read_at; });

        const allMessages = [];
        const seenIds = new Set(); // Global dedup across sent + received

        // Filter out self-messages and ghost messages
        if (sent) {
            const selfEmail = (currentAuthUser.email || '').toLowerCase();
            for (let i = sent.length - 1; i >= 0; i--) {
                const m = sent[i];
                // Skip self-messages (sent to yourself)
                if (m.recipient_id && m.recipient_id === currentAuthUser.id) { sent.splice(i, 1); continue; }
                if (m.recipient_email && m.recipient_email.toLowerCase() === selfEmail) { sent.splice(i, 1); continue; }
            }
        }

        // Map sent messages
        if (sent) {
            sent.forEach(m => {
                if (seenIds.has(m.id)) return;
                seenIds.add(m.id);

                // Status logic: use release_at as the source of truth
                // If release_at is in the future, the message is still in transit
                // regardless of what the DB status field says
                let statusDisplay = '';
                const releasePast = m.release_at && new Date(m.release_at) <= new Date();
                if (m.release_at && !releasePast) {
                    // release_at is in the future → still in transit
                    statusDisplay = 'In Transit';
                } else if (m.status === 'in_transit' && !releasePast) {
                    statusDisplay = 'In Transit';
                } else {
                    statusDisplay = 'Released';
                }

                const rp = m.recipient_id ? profileMap[m.recipient_id] : null;

                allMessages.push({
                    dbId: m.id,
                    senderId: currentAuthUser.id,
                    recipientId: m.recipient_id || null,
                    sender: rp?.username || m.recipient_name || 'Unknown',
                    senderAvatar: rp?.avatar_url || null,
                    recipientEmail: m.recipient_email,
                    preview: '',
                    status: statusDisplay,
                    type: 'sent',
                    location: m.recipient_city || rp?.city || 'Unknown',
                    time: timeAgo(m.created_at),
                    createdAt: m.created_at,
                    conversationId: m.conversation_id || null,
                    phaseName: m.moon_phase || '',
                    messageText: m.message_text || '',
                    lunarNote: m.lunar_note_text ? { text: m.lunar_note_text, closing: m.lunar_note_closing || '' } : null,
                    songUrl: m.song_url,
                    songTitle: m.song_title,
                    photoUrl: m.photo_url || null,
                    releaseAt: m.release_at,
                    pickupAt: m.pickup_at || null,
                    reactions: [],
                    replies: []
                });
            });
        }

        // Map received messages — ALL messages always visible (WhatsApp-like persistence)
        // in_transit messages show as "arriving" notifications, released messages show full content
        received.forEach(m => {
            if (seenIds.has(m.id)) return; // Skip if already counted as sent (self-message)
            seenIds.add(m.id);

            const sp = m.sender_id ? profileMap[m.sender_id] : null;
            // Use sender's profile name. NEVER fallback to recipient_name for received messages
            // (recipient_name = current user's name, not the sender's name)
            const senderName = sp?.username || [sp?.first_name, sp?.last_name].filter(Boolean).join(' ') || 'Someone';
            const senderCity = sp?.city || 'Unknown';

            // Determine if message content should be revealed
            // Rule: Moon MUST be in your sky AND message must be released.
            // Defense-in-depth: treat message as in-transit if EITHER:
            //   - release_at is in the future, OR
            //   - DB status is still 'in_transit' (covers edge function timing issues)
            // A message is in-transit ONLY if release_at is in the future.
            // If release_at has passed, it's released — regardless of DB status field.
            const releaseFuture = m.release_at && new Date(m.release_at) > new Date();
            const noReleaseButTransit = !m.release_at && m.status === 'in_transit';
            const stillInTransit = releaseFuture || noReleaseButTransit;
            // 72h hard cutoff (two-hop courier can exceed 24h: pickup + recipient cycle)
            const tooOld = m.created_at && new Date(m.created_at) < new Date(Date.now() - 72 * 3600000);
            const actuallyInTransit = stillInTransit && !tooOld;
            // Once a message has been read it stays readable — the moon-gate only
            // seals genuinely new/unread incoming messages, never re-hides history
            // the recipient has already seen. "Read" = my read_receipt for this
            // conversation is at/after the message (NOT messages.read_at, which is
            // never set for received messages).
            const _lastRead = m.conversation_id ? myReadReceipts[m.conversation_id] : null;
            // Receipt must be at/after the RELEASE time (not created_at): opening the
            // chat stamps a receipt at "now", which would otherwise unseal messages
            // still in transit. See same gate in chat.js loadFullConversationThread.
            const _readGate = m.release_at || m.created_at;
            const alreadyRead = !!(_lastRead && _readGate && new Date(_lastRead) >= new Date(_readGate));
            const contentVisible = alreadyRead || (!!moonData.isVisible && !actuallyInTransit);

            allMessages.push({
                dbId: m.id,
                senderId: m.sender_id || null,
                recipientId: currentAuthUser.id,
                sender: senderName,
                senderAvatar: sp?.avatar_url || null,
                recipientEmail: m.recipient_email,
                preview: contentVisible ? (m.message_text || '') : '',
                status: contentVisible ? '' : 'Arriving',
                stillInTransit: actuallyInTransit,
                type: 'received',
                location: senderCity,
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
                pickupAt: m.pickup_at || null,
                reactions: [],
                replies: []
            });
        });

        // Fetch the three reply result-sets CONCURRENTLY. None depends on another's
        // result — only on the message-id list already built above — so paying three
        // sequential round-trips here was pure wasted latency.
        const _replyMsgIds = allMessages
            .filter(m => m.dbId && !m.isReplyDot && !m.isIncomingReplyTransit)
            .map(m => m.dbId)
            .filter(Boolean);
        const _emptyRes = Promise.resolve({ data: [] });
        const [_inTransitRes, _incomingRes, _latestRes] = await Promise.all([
            sb.from('replies')
                .select('id, sender_id, release_at, recipient_city, created_at, message_id')
                .eq('sender_id', currentAuthUser.id)
                .eq('status', 'in_transit')
                .gt('release_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(50),
            _replyMsgIds.length > 0
                ? sb.from('replies')
                    .select('id, sender_id, release_at, recipient_city, created_at, message_id, status')
                    .in('message_id', _replyMsgIds)
                    .neq('sender_id', currentAuthUser.id)
                    .eq('status', 'in_transit')
                    .order('created_at', { ascending: false })
                    .limit(50)
                : _emptyRes,
            // replies_v: reads `text`, which clients can no longer select on the
            // base table (migration 043) — and the view NULLs it while sealed.
            _replyMsgIds.length > 0
                ? sb.from('replies_v')
                    .select('message_id, created_at, sender_id, text, status, release_at')
                    .in('message_id', _replyMsgIds)
                    .order('created_at', { ascending: false })
                    .limit(200)
                : _emptyRes,
        ]);

        // Also fetch sent replies that are still in_transit (for dot rendering on reload)
        try {
            const inTransitReplies = _inTransitRes.data;
            if (inTransitReplies && inTransitReplies.length > 0) {
                console.log('[loadMessages] Found', inTransitReplies.length, 'in-transit replies for dot rendering');
                // Look up recipient names from the parent message
                for (const r of inTransitReplies) {
                    // Find the parent message to get recipient info
                    const parentMsg = allMessages.find(m => m.dbId === r.message_id);
                    const otherName = parentMsg?.sender || 'Unknown';
                    const city = r.recipient_city || parentMsg?.location || 'Unknown';
                    allMessages.push({
                        dbId: r.id,
                        senderId: currentAuthUser.id,
                        recipientProfileId: (parentMsg?.type === 'sent' ? parentMsg?.recipientId : parentMsg?.senderId) || null,
                        sender: otherName,
                        type: 'sent',
                        location: city,
                        status: 'In Transit',
                        releaseAt: r.release_at,
                        createdAt: r.created_at,
                        time: timeAgo(r.created_at),
                        isReplyDot: true,
                        preview: '',
                        replies: []
                    });
                }
            }
        } catch (e) {
            console.error('[loadMessages] Failed to fetch in-transit replies:', e);
        }

        // Also fetch INCOMING in-transit replies (from others, on messages where I'm the recipient)
        // These show as "On Its Way" in the inbox with a progress bar
        try {
            const incomingTransitReplies = _incomingRes.data;
            if (incomingTransitReplies && incomingTransitReplies.length > 0) {
                    console.log('[loadMessages] Found', incomingTransitReplies.length, 'incoming in-transit replies');
                    // No need to set _incomingTransitReplies — synthetic entries handle counting
                    // Add as synthetic received entries so buildConversations picks them up
                    for (const r of incomingTransitReplies) {
                        const parentMsg = allMessages.find(m => m.dbId === r.message_id);
                        const senderName = parentMsg?.sender || 'Unknown';
                        allMessages.push({
                            dbId: 'incoming-reply-' + r.id,
                            senderId: r.sender_id,
                            sender: senderName,
                            type: 'received',
                            location: parentMsg?.location || r.recipient_city || 'Unknown',
                            status: 'Arriving',
                            stillInTransit: true,
                            releaseAt: r.release_at,
                            createdAt: r.created_at,
                            time: timeAgo(r.created_at),
                            messageText: '',
                            contentVisible: false,
                            isIncomingReplyTransit: true,
                            preview: '',
                            replies: []
                        });
                    }
                }
        } catch (e) {
            console.error('[loadMessages] Failed to fetch incoming in-transit replies:', e);
        }

        // Fetch latest reply timestamp per message for correct conversation sorting
        // Without this, conversations revert to top-level message order on reload
        try {
            const latestReplies = _latestRes.data;
            if (latestReplies && latestReplies.length > 0) {
                {
                    // Group by message_id and get the latest
                    const latestByMsg = {};
                    latestReplies.forEach(r => {
                        if (!latestByMsg[r.message_id] || new Date(r.created_at) > new Date(latestByMsg[r.message_id].created_at)) {
                            latestByMsg[r.message_id] = r;
                        }
                    });
                    // Attach to message objects so buildConversations can use them
                    allMessages.forEach(m => {
                        const lr = latestByMsg[m.dbId];
                        if (lr) {
                            // Incoming replies still in transit must not leak their text
                            // into the inbox preview or the synthetic reply entry.
                            const lrSealed = replyStillSealed(lr, currentAuthUser?.id);
                            m._latestReplyAt = lr.created_at;
                            m._latestReplyText = lrSealed ? '' : lr.text;
                            m._latestReplySenderId = lr.sender_id;
                            // Add as synthetic reply so buildConversations finds it
                            if (!m.replies) m.replies = [];
                            if (!m.replies.some(r => r.createdAt === lr.created_at)) {
                                m.replies.push({
                                    createdAt: lr.created_at,
                                    text: lrSealed ? '' : lr.text,
                                    senderId: lr.sender_id,
                                    sent: lr.sender_id === currentAuthUser?.id,
                                    status: lrSealed ? 'Arriving' : '',
                                    stillInTransit: lrSealed,
                                    releaseAt: lr.release_at || null
                                });
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.error('[loadMessages] Failed to fetch latest reply timestamps:', e);
        }

        // Sort by created_at descending
        allMessages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        messages = allMessages;

        // Build conversations (grouped by person)
        // Fetch dissolved (new-moon-wiped) conversations into the cache FIRST, then
        // build — buildConversations() re-merges the cache on every rebuild so later
        // realtime/effects refreshes keep these rows in the inbox (the old inline
        // injection ran only here, so any later rebuild silently dropped them).
        await loadWipedConversations();
        buildConversations();

        // Load unread counts + read receipt metadata from DB
        await loadConversationMetadata();

        // Update message stats
        moonData.messagesInTransit = messages.filter(m => m.type === 'sent' && m.status === 'In Transit').length;

        // Count in-transit replies headed TO me (for receiver display)
        try {
            // Include ALL message IDs (sent + received) because replies on
            // sent messages are also incoming to me
            const myMsgIds = [...(sent || []), ...received].map(m => m.id).filter(Boolean);
            if (myMsgIds.length > 0) {
                const { count: transitReplyCount } = await sb.from('replies')
                    .select('id', { count: 'exact', head: true })
                    .in('message_id', myMsgIds)
                    .eq('status', 'in_transit')
                    .neq('sender_id', currentAuthUser.id);
                window._incomingTransitReplies = transitReplyCount || 0;
                if (transitReplyCount > 0) console.log('[loadMessages] Incoming in-transit replies:', transitReplyCount);
            } else {
                window._incomingTransitReplies = 0;
            }
        } catch (e) {
            console.error('[loadMessages] Failed to count incoming transit replies:', e);
            window._incomingTransitReplies = 0;
        }

        console.log('loadMessages: SUCCESS -', messages.length, 'messages (sent:', (sent||[]).length, ', received:', received.length, '), conversations:', conversations.length);

        // If zero messages AND no wiped conversations, retry with fresh session (auth may have been stale)
        if (messages.length === 0 && conversations.length === 0 && retryCount === 0) {
            console.log('loadMessages: 0 messages loaded, retrying with fresh session...');
            const { data } = await sb.auth.getSession();
            if (data?.session) {
                currentAuthUser = data.session.user;
                return loadMessages(1);
            }
        }
    } catch (err) {
        console.error('loadMessages: UNEXPECTED ERROR:', err);
        // On unexpected error, try one more time with current session
        if (retryCount < 1) {
            console.log('loadMessages: retrying after error...');
            try {
                const { data } = await sb.auth.getSession();
                if (data?.session) {
                    currentAuthUser = data.session.user;
                    return loadMessages(retryCount + 1);
                }
            } catch (e) {
                console.error('loadMessages: retry also failed:', e);
            }
        }
    }
}

let globalTransmissions = [];

async function loadSharedSky() {
    const { data, error } = await sb.from('shared_sky')
        .select('*, profiles:user_id(username, first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) { console.error('Load shared sky failed:', error); return; }
    if (data) {
        // Fetch reactions for all shared sky messages
        const ssIds = data.map(s => s.id);
        let reactionsMap = {};
        if (ssIds.length > 0 && currentAuthUser) {
            const { data: rxData } = await sb.from('reactions')
                .select('message_id, user_id, emoji')
                .in('message_id', ssIds);
            if (rxData) {
                rxData.forEach(r => {
                    if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
                    reactionsMap[r.message_id].push(r);
                });
            }
        }
        globalTransmissions = data.map(s => {
            const p = s.profiles;
            const senderName = p?.username || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || null;
            // Aggregate reactions
            const rawRx = reactionsMap[s.id] || [];
            const rxAgg = {};
            rawRx.forEach(r => {
                if (!rxAgg[r.emoji]) rxAgg[r.emoji] = { emoji: r.emoji, count: 0, mine: false };
                rxAgg[r.emoji].count++;
                if (currentAuthUser && r.user_id === currentAuthUser.id) rxAgg[r.emoji].mine = true;
            });
            return {
                dbId: s.id,
                userId: s.user_id,
                senderName: senderName,
                location: s.city || 'Unknown',
                time: timeAgo(s.created_at),
                createdAt: s.created_at,
                message: s.message || '',
                photo: s.photo_url || null,
                lunarNoteText: s.lunar_note_text || null,
                lunarNoteClosing: s.lunar_note_closing || null,
                reactions: Object.values(rxAgg)
            };
        });
    }
}

let selectedRecipient = null;
let isNewContact = false;

// ============================================
