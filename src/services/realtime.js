// Realtime Service — Supabase Realtime subscriptions, polling fallback
import { sb } from './supabase.js';

let realtimeChannels = [];
let pollInterval = null;
let realtimeWorking = false;

/**
 * Set up realtime subscriptions for messages, replies, and shared sky.
 * Falls back to polling if realtime channels fail.
 *
 * @param {string} userId — current user's ID
 * @param {object} callbacks — event handlers:
 *   { onNewMessage, onMessageUpdate, onNewReply, onReadReceipt, onProfileUpdate, onSharedSkyPost }
 */
export function setupRealtime(userId, callbacks = {}) {
  if (!userId) return;

  // Clean up any existing channels first
  cleanupRealtime();

  // ---- MESSAGES: INSERT + UPDATE ----
  const msgChannel = sb
    .channel('inbox-messages')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        realtimeWorking = true;
        if (callbacks.onNewMessage) callbacks.onNewMessage(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload) => {
        realtimeWorking = true;
        if (callbacks.onMessageUpdate) callbacks.onMessageUpdate(payload.new);
      }
    )
    .subscribe((status) => {
      console.log('[realtime] messages channel:', status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[realtime] messages channel failed, relying on polling fallback');
      }
    });
  realtimeChannels.push(msgChannel);

  // ---- REPLIES: live chat ----
  const replyChannel = sb
    .channel('live-replies')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'replies' },
      (payload) => {
        realtimeWorking = true;
        if (callbacks.onNewReply) callbacks.onNewReply(payload.new);
      }
    )
    .subscribe((status) => {
      console.log('[realtime] replies channel:', status);
    });
  realtimeChannels.push(replyChannel);

  // ---- SHARED SKY: new posts ----
  const skyChannel = sb
    .channel('shared-sky-live')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'shared_sky' },
      (payload) => {
        realtimeWorking = true;
        if (callbacks.onSharedSkyPost) callbacks.onSharedSkyPost(payload.new);
      }
    )
    .subscribe((status) => {
      console.log('[realtime] shared sky channel:', status);
    });
  realtimeChannels.push(skyChannel);

  // ---- READ RECEIPTS ----
  const receiptChannel = sb
    .channel('read-receipts')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'read_receipts' },
      (payload) => {
        realtimeWorking = true;
        if (callbacks.onReadReceipt) callbacks.onReadReceipt(payload.new);
      }
    )
    .subscribe((status) => {
      console.log('[realtime] read receipts channel:', status);
    });
  realtimeChannels.push(receiptChannel);

  // ---- PROFILES: updates (avatar, username changes) ----
  const profileChannel = sb
    .channel('profile-updates')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles' },
      (payload) => {
        realtimeWorking = true;
        if (callbacks.onProfileUpdate) callbacks.onProfileUpdate(payload.new);
      }
    )
    .subscribe((status) => {
      console.log('[realtime] profiles channel:', status);
    });
  realtimeChannels.push(profileChannel);

  // ---- POLLING FALLBACK ----
  // Reload periodically to catch anything missed by realtime
  pollInterval = setInterval(() => {
    if (callbacks.onPoll) callbacks.onPoll();
  }, 30000); // every 30 seconds
}

/**
 * Clean up all realtime channels and polling intervals.
 */
export function cleanupRealtime() {
  realtimeChannels.forEach((ch) => {
    try {
      sb.removeChannel(ch);
    } catch (e) {
      /* ignore */
    }
  });
  realtimeChannels = [];

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  realtimeWorking = false;
  console.log('[realtime] all channels cleaned up');
}
