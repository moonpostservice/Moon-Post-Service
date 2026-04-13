// Reactions System

// REACTIONS — Clean rewrite using event delegation
// ========================
const MOON_REACTIONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

// Helper: find message OR reply by dbId — searches conversation messages + their replies, then global
function findMsgByDbId(dbId) {
    if (!dbId) return null;
    if (currentConversation && currentConversation.messages) {
        // Check top-level messages first
        const m = currentConversation.messages.find(m => m.dbId === dbId);
        if (m) return m;
        // Then check replies within each message (each reply has its own dbId)
        for (const msg of currentConversation.messages) {
            if (msg.replies) {
                const r = msg.replies.find(r => r.dbId === dbId);
                if (r) return r;
            }
        }
    }
    // Global messages
    const g = messages.find(m => m.dbId === dbId);
    if (g) return g;
    // Global message replies
    for (const msg of messages) {
        if (msg.replies) {
            const r = msg.replies.find(r => r.dbId === dbId);
            if (r) return r;
        }
    }
    // Shared Sky messages
    if (typeof globalTransmissions !== 'undefined') {
        const ss = globalTransmissions.find(t => t.dbId === dbId);
        if (ss) return ss;
    }
    return null;
}

// Render reactions HTML for a message (returns static HTML with data attributes)
// ALWAYS returns a trigger button if msgDbId is provided, even if message not found
function renderReactionsBar(msgDbId) {
    if (!msgDbId) {
        console.warn('[Reactions] renderReactionsBar called with empty msgDbId');
        return '';
    }

    // Trigger button — ALWAYS shown for any message with a dbId
    const trigger = `
        <div class="msg-react-trigger"
             data-action="open-reaction-picker"
             data-msg-dbid="${msgDbId}"
             title="React with moon phase"
             role="button"
             tabindex="0">🌙</div>
    `;

    // Look up message for existing reaction chips
    const msg = findMsgByDbId(msgDbId);
    if (!msg) {
        console.warn('[Reactions] Message not found for dbId:', msgDbId, '— trigger still shown');
        return trigger;
    }

    const reactions = msg.reactions || [];
    if (reactions.length > 0) {
        console.log('[Reactions] renderReactionsBar dbId:', msgDbId, 'reactions:', JSON.stringify(reactions), 'msg.createdAt:', msg.createdAt);
    }

    // Reaction chips (existing reactions)
    const chips = reactions.map((r, ri) => `
        <span class="reaction-chip ${r.mine ? 'active' : ''}"
              data-action="toggle-reaction"
              data-msg-dbid="${msgDbId}"
              data-emoji="${r.emoji}">
            <span>${r.emoji}</span>
            <span class="reaction-count">${r.count}</span>
        </span>
    `).join('');

    const chipsBar = chips
        ? `<div class="reactions-bar">${chips}</div>`
        : '';

    return trigger + chipsBar;
}

// ---- Reaction Picker (position:fixed, appended to body) ----
let _activeReactionPicker = null;
let _activePickerMsgDbId = null;

function openReactionPicker(triggerEl, msgDbId) {
    // If picker is already open for this message, close it (toggle behavior)
    if (_activeReactionPicker && _activePickerMsgDbId === msgDbId) {
        closeReactionPicker();
        return;
    }
    closeReactionPicker();

    const rect = triggerEl.getBoundingClientRect();
    const picker = document.createElement('div');
    picker.className = 'reaction-picker-fixed';
    picker.setAttribute('data-reaction-picker', 'true');
    picker.innerHTML = `
        <span class="reaction-picker-label">Moon Phases</span>
        ${MOON_REACTIONS.map(e =>
            `<span class="reaction-option"
                   data-action="pick-reaction"
                   data-msg-dbid="${msgDbId}"
                   data-emoji="${e}"
                   role="button"
                   tabindex="0">${e}</span>`
        ).join('')}
    `;

    // Position: prefer below trigger, fallback above
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow >= 80) {
        picker.style.top = (rect.bottom + 6) + 'px';
    } else {
        picker.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    }
    // Horizontal: align to trigger, keep on screen
    const rightEdge = window.innerWidth - rect.right;
    picker.style.right = Math.max(8, rightEdge) + 'px';

    document.body.appendChild(picker);
    _activeReactionPicker = picker;
    _activePickerMsgDbId = msgDbId;

    // Close on scroll (the content area scrolls, position becomes stale)
    const scrollEl = document.getElementById('detailContent');
    if (scrollEl) {
        const onScroll = () => { closeReactionPicker(); scrollEl.removeEventListener('scroll', onScroll); };
        scrollEl.addEventListener('scroll', onScroll, { passive: true });
    }
}

function closeReactionPicker() {
    if (_activeReactionPicker) {
        _activeReactionPicker.remove();
        _activeReactionPicker = null;
        _activePickerMsgDbId = null;
    }
}

// ---- Core reaction logic: add/remove reaction ----
// Reaction debug logging (console only)
function rxLog(text) { console.log('[Reactions]', text); }
// Remove old debug panel if it exists
{ const old = document.getElementById('rxDebug'); if (old) old.remove(); }

let _reactionCooldown = false;
async function handleReaction(msgDbId, emoji) {
    rxLog(`CLICK: ${emoji} on ${msgDbId.substring(0,8)}...`);
    _reactionCooldown = true;
    setTimeout(() => { _reactionCooldown = false; }, 8000);
    // Prevent double-fire from event bubbling
    if (handleReaction._lastCall && Date.now() - handleReaction._lastCall < 500) {
        rxLog(`BLOCKED: double-fire <500ms`);
        return;
    }
    handleReaction._lastCall = Date.now();
    let msg = findMsgByDbId(msgDbId);
    // Fallback: search all conversations (messages + their replies) if not found
    if (!msg) {
        for (const conv of conversations) {
            if (conv.messages) {
                msg = conv.messages.find(m => m.dbId === msgDbId);
                if (msg) break;
                for (const m of conv.messages) {
                    if (m.replies) {
                        msg = m.replies.find(r => r.dbId === msgDbId);
                        if (msg) break;
                    }
                }
                if (msg) break;
            }
        }
    }
    if (!msg) { rxLog(`ERROR: msg not found for ${msgDbId.substring(0,8)}`); return; }
    if (!msg.reactions) msg.reactions = [];

    // SINGLE REACTION PER USER: find any existing reaction by this user
    const myExisting = msg.reactions.find(r => r.mine);
    const targetExisting = msg.reactions.find(r => r.emoji === emoji);
    rxLog(`reactions: [${msg.reactions.map(r => r.emoji + (r.mine?'✓':'') + r.count).join(', ')}]`);
    rxLog(`myExisting: ${myExisting ? myExisting.emoji : 'NONE'}, target: ${targetExisting ? emoji + ' count=' + targetExisting.count : 'NONE'}`);

    if (myExisting && myExisting.emoji === emoji) {
        // REMOVE: clicking same emoji = toggle off
        rxLog(`PATH: REMOVE (same emoji toggle off)`);
        myExisting.count--;
        myExisting.mine = false;
        if (myExisting.count <= 0) {
            msg.reactions = msg.reactions.filter(r => r !== myExisting);
        }
        _reactionCache[msgDbId] = { reactions: JSON.parse(JSON.stringify(msg.reactions)), cachedAt: Date.now() };
        if (currentConversation) renderConversationThread(); renderSharedSkySignals();
        if (currentAuthUser && msg.dbId) {
            try {
                const { error } = await sb.from('reactions').delete()
                    .eq('message_id', msg.dbId)
                    .eq('user_id', currentAuthUser.id);
                rxLog(`DB DELETE: ${error ? 'FAILED ' + error.message : 'OK'}`);
                if (error) {
                    // Rollback
                    const ex2 = msg.reactions.find(r => r.emoji === emoji);
                    if (ex2) { ex2.count++; ex2.mine = true; }
                    else { msg.reactions.push({ emoji, count: 1, mine: true }); }
                    _reactionCache[msgDbId] = { reactions: JSON.parse(JSON.stringify(msg.reactions)), cachedAt: Date.now() };
                    if (currentConversation) renderConversationThread(); renderSharedSkySignals();
                }
            } catch (e) { rxLog(`DB DELETE EXCEPTION: ${e.message}`); }
        }
    } else {
        // REPLACE or NEW: remove old reaction first, then add new one
        const oldEmoji = myExisting ? myExisting.emoji : null;
        if (myExisting) {
            rxLog(`PATH: REPLACE ${myExisting.emoji} → ${emoji}`);
            myExisting.count--;
            myExisting.mine = false;
            if (myExisting.count <= 0) {
                msg.reactions = msg.reactions.filter(r => r !== myExisting);
            }
        } else {
            rxLog(`PATH: NEW reaction ${emoji}`);
        }
        // Add new emoji
        const newTarget = msg.reactions.find(r => r.emoji === emoji);
        if (newTarget) {
            newTarget.count++;
            newTarget.mine = true;
        } else {
            msg.reactions.push({ emoji, count: 1, mine: true });
        }
        _reactionCache[msgDbId] = { reactions: JSON.parse(JSON.stringify(msg.reactions)), cachedAt: Date.now() };
        if (currentConversation) renderConversationThread(); renderSharedSkySignals();
        if (currentAuthUser && msg.dbId) {
            try {
                // Delete old reaction first (if replacing)
                if (oldEmoji) {
                    await sb.from('reactions').delete()
                        .eq('message_id', msg.dbId)
                        .eq('user_id', currentAuthUser.id);
                    rxLog(`DB DELETE OLD ${oldEmoji}: OK`);
                }
                // Insert new reaction
                const { error } = await sb.from('reactions').upsert({
                    message_id: msg.dbId,
                    user_id: currentAuthUser.id,
                    emoji: emoji
                }, { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: false });
                rxLog(`DB UPSERT NEW ${emoji}: ${error ? 'FAILED ' + error.message : 'OK'}`);
                if (error) {
                    // Rollback: undo the local changes
                    const addedR = msg.reactions.find(r => r.emoji === emoji && r.mine);
                    if (addedR) { addedR.count--; addedR.mine = false; if (addedR.count <= 0) msg.reactions = msg.reactions.filter(r => r !== addedR); }
                    if (oldEmoji) {
                        const oldR = msg.reactions.find(r => r.emoji === oldEmoji);
                        if (oldR) { oldR.count++; oldR.mine = true; }
                        else { msg.reactions.push({ emoji: oldEmoji, count: 1, mine: true }); }
                    }
                    _reactionCache[msgDbId] = { reactions: JSON.parse(JSON.stringify(msg.reactions)), cachedAt: Date.now() };
                    if (currentConversation) renderConversationThread(); renderSharedSkySignals();
                }
            } catch (e) { rxLog(`DB REACTION EXCEPTION: ${e.message}`); }
        }
    }
    rxLog(`DONE. cache keys: ${Object.keys(_reactionCache).length}`);
}

// ---- EVENT DELEGATION: single document-level handler for ALL reaction interactions ----
document.addEventListener('click', function(e) {
    const target = e.target;

    // 1. Click on reaction trigger → open picker
    const triggerEl = target.closest('[data-action="open-reaction-picker"]');
    if (triggerEl) {
        e.stopPropagation();
        e.preventDefault();
        const msgDbId = triggerEl.getAttribute('data-msg-dbid');
        if (msgDbId) {
            openReactionPicker(triggerEl, msgDbId);
        }
        return;
    }

    // 2. Click on emoji in picker → add reaction
    const pickEl = target.closest('[data-action="pick-reaction"]');
    if (pickEl) {
        e.stopPropagation();
        e.preventDefault();
        const msgDbId = pickEl.getAttribute('data-msg-dbid');
        const emoji = pickEl.getAttribute('data-emoji');
        if (msgDbId && emoji) {
            // Brief pulse animation on the trigger
            const trig = document.querySelector(`.msg-react-trigger[data-msg-dbid="${msgDbId}"]`);
            if (trig) { trig.classList.add('pulse'); setTimeout(() => trig.classList.remove('pulse'), 400); }
            handleReaction(msgDbId, emoji);
            closeReactionPicker();
        }
        return;
    }

    // 3. Click on existing reaction chip → toggle reaction
    const chipEl = target.closest('[data-action="toggle-reaction"]');
    if (chipEl) {
        e.stopPropagation();
        e.preventDefault();
        const msgDbId = chipEl.getAttribute('data-msg-dbid');
        const emoji = chipEl.getAttribute('data-emoji');
        if (msgDbId && emoji) {
            handleReaction(msgDbId, emoji);
        }
        return;
    }

    // 4. Click inside the picker (but not on an emoji) → do nothing (keep picker open)
    const insidePicker = target.closest('[data-reaction-picker]');
    if (insidePicker) {
        e.stopPropagation();
        return;
    }

    // 5. Click anywhere else → close picker
    closeReactionPicker();
}, true); // useCapture=true so this fires FIRST before any inline handlers

// Also close picker on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeReactionPicker();
});

// Legacy aliases (in case old code references these)
async function addReaction(msgDbId, emoji) { return handleReaction(msgDbId, emoji); }
async function toggleReaction(msgDbId, reactionIndex) {
    const msg = findMsgByDbId(msgDbId);
    if (!msg || !msg.reactions || !msg.reactions[reactionIndex]) return;
    return handleReaction(msgDbId, msg.reactions[reactionIndex].emoji);
}

// ========================
