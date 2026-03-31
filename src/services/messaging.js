// Messaging Service — send via Edge Function, inbox, replies, lunar notes
import { sb } from './supabase.js';

/**
 * Send a message via the send-message Edge Function exclusively.
 * SECURITY: No direct sb.from('messages').insert() fallback (Req 12.3).
 * @param {object} payload — message fields (sender_id, recipient_email, etc.)
 * @returns {Promise<{data?: object, error?: object}>}
 */
export async function sendMessage(payload) {
  try {
    const { data: fnData, error: fnError } = await sb.functions.invoke('send-message', {
      body: payload,
    });

    if (fnError) {
      return { data: null, error: fnError };
    }

    if (fnData && fnData.error) {
      // Server-side validation error
      return {
        data: null,
        error: { message: fnData.details ? fnData.details.join(', ') : fnData.error },
      };
    }

    if (fnData && fnData.message) {
      return { data: fnData.message, error: null };
    }

    return { data: null, error: { message: 'Unexpected response from send-message function' } };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Load the user's inbox — sent and received messages.
 * Returns raw DB rows; the caller maps them to the app's message format.
 * @returns {Promise<{sent: object[], received: object[]}>}
 */
export async function loadInbox() {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return { sent: [], received: [] };

  // 1. Fetch messages I sent (latest 200)
  const { data: sent, error: sentErr } = await sb
    .from('messages')
    .select('*')
    .eq('sender_id', user.id)
    .order('created_at', { ascending: false })
    .range(0, 199);
  if (sentErr) console.error('[messaging] sent query failed:', sentErr.message);

  // 2. Fetch messages sent TO me
  let received = [];

  // 2a. By recipient_id
  const { data: recvById, error: err1 } = await sb
    .from('messages')
    .select('*')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .range(0, 199);
  if (err1) console.error('[messaging] recv by id failed:', err1.message);
  if (recvById) received = received.concat(recvById);

  // 2b. By recipient_email (catches messages sent before profile was linked)
  if (user.email) {
    const { data: recvByEmail, error: err2 } = await sb
      .from('messages')
      .select('*')
      .eq('recipient_email', user.email)
      .order('created_at', { ascending: false })
      .range(0, 199);
    if (err2) console.error('[messaging] recv by email failed:', err2.message);
    if (recvByEmail) {
      const existingIds = new Set(received.map((m) => m.id));
      recvByEmail.forEach((m) => {
        if (!existingIds.has(m.id)) received.push(m);
      });
    }
  }

  return { sent: sent || [], received };
}

/**
 * Release in-transit messages addressed to the current user.
 * Sets status to 'released' and release_at/released_at to now.
 */
export async function releaseMessages() {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;

  const now = new Date().toISOString();

  try {
    // Release messages where I am the recipient by ID
    await sb
      .from('messages')
      .update({ status: 'released', released_at: now, release_at: now })
      .eq('recipient_id', user.id)
      .eq('status', 'in_transit');

    // Also by email
    if (user.email) {
      await sb
        .from('messages')
        .update({ status: 'released', released_at: now, release_at: now })
        .eq('recipient_email', user.email)
        .eq('status', 'in_transit');
    }

    // Release in-transit replies on messages addressed to me
    const { data: myMsgs } = await sb
      .from('messages')
      .select('id')
      .or(
        `recipient_id.eq.${user.id}${user.email ? `,recipient_email.eq.${user.email}` : ''}`
      );
    if (myMsgs?.length) {
      const ids = myMsgs.map((m) => m.id);
      await sb
        .from('replies')
        .update({ status: 'released', release_at: now })
        .in('message_id', ids)
        .eq('status', 'in_transit')
        .neq('sender_id', user.id);
    }
  } catch (err) {
    console.error('[messaging] releaseMessages error:', err);
  }
}

/**
 * Load all replies for a given message (or set of message IDs).
 * @param {string|string[]} messageId — single ID or array of IDs
 * @returns {Promise<object[]>}
 */
export async function loadReplies(messageId) {
  const ids = Array.isArray(messageId) ? messageId : [messageId];
  const { data, error } = await sb
    .from('replies')
    .select('*')
    .in('message_id', ids)
    .order('created_at', { ascending: true });
  if (error) console.error('[messaging] loadReplies failed:', error);
  return data || [];
}

/**
 * Send a reply to a message.
 * @param {string} messageId — parent message ID
 * @param {object} payload — { text, status, release_at, recipient_city, photo_url? }
 * @returns {Promise<{data?: object, error?: object}>}
 */
export async function sendReply(messageId, payload) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return { data: null, error: { message: 'Not authenticated' } };

  const insertData = {
    message_id: messageId,
    sender_id: user.id,
    ...payload,
  };

  const { data, error } = await sb.from('replies').insert(insertData).select().single();
  if (error) console.error('[messaging] sendReply failed:', error);
  return { data: data || null, error: error || null };
}

/**
 * Send a lunar note as a reply to a message.
 * @param {string} messageId — parent message ID
 * @param {object} payload — { text, lunar_note_text, lunar_note_closing, status, release_at, recipient_city }
 * @returns {Promise<{data?: object, error?: object}>}
 */
export async function sendLunarNote(messageId, payload) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return { data: null, error: { message: 'Not authenticated' } };

  const insertData = {
    message_id: messageId,
    sender_id: user.id,
    is_lunar_note: true,
    ...payload,
  };

  const { data, error } = await sb.from('replies').insert(insertData).select().single();
  if (error) console.error('[messaging] sendLunarNote failed:', error);
  return { data: data || null, error: error || null };
}
