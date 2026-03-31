// Shared Sky Service — public posts, reactions
import { sb } from './supabase.js';

/**
 * Load the latest Shared Sky posts with profile info and reactions.
 * @returns {Promise<object[]>}
 */
export async function loadSharedSkyPosts() {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;

  const { data, error } = await sb
    .from('shared_sky')
    .select('*, profiles:user_id(username, first_name, last_name)')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[shared-sky] loadSharedSkyPosts failed:', error);
    return [];
  }
  if (!data) return [];

  // Fetch reactions for all posts
  const ssIds = data.map((s) => s.id);
  let reactionsMap = {};
  if (ssIds.length > 0 && user) {
    const { data: rxData } = await sb
      .from('reactions')
      .select('message_id, user_id, emoji')
      .in('message_id', ssIds);
    if (rxData) {
      rxData.forEach((r) => {
        if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
        reactionsMap[r.message_id].push(r);
      });
    }
  }

  return data.map((s) => {
    const p = s.profiles;
    const senderName =
      p?.username || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || null;

    // Aggregate reactions
    const rawRx = reactionsMap[s.id] || [];
    const rxAgg = {};
    rawRx.forEach((r) => {
      if (!rxAgg[r.emoji]) rxAgg[r.emoji] = { emoji: r.emoji, count: 0, mine: false };
      rxAgg[r.emoji].count++;
      if (user && r.user_id === user.id) rxAgg[r.emoji].mine = true;
    });

    return {
      dbId: s.id,
      userId: s.user_id,
      senderName,
      location: s.city || 'Unknown',
      createdAt: s.created_at,
      message: s.message || '',
      photo: s.photo_url || null,
      lunarNoteText: s.lunar_note_text || null,
      lunarNoteClosing: s.lunar_note_closing || null,
      reactions: Object.values(rxAgg),
    };
  });
}

/**
 * Create a new Shared Sky post.
 * @param {object} payload — { message, city, photo_url?, lunar_note_text?, lunar_note_closing? }
 * @returns {Promise<object|null>}
 */
export async function createPost(payload) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return null;

  const insertData = {
    user_id: user.id,
    city: payload.city || 'Unknown',
    message: payload.message || '🌕',
  };
  if (payload.photo_url) insertData.photo_url = payload.photo_url;
  if (payload.lunar_note_text) {
    insertData.lunar_note_text = payload.lunar_note_text;
    insertData.lunar_note_closing = payload.lunar_note_closing || null;
  }

  const { data, error } = await sb.from('shared_sky').insert(insertData).select().single();
  if (error) {
    console.error('[shared-sky] createPost failed:', error);
    return null;
  }
  return data;
}

/**
 * Delete a Shared Sky post (only the author can delete).
 * @param {string} id
 */
export async function deletePost(id) {
  const { error } = await sb.from('shared_sky').delete().eq('id', id);
  if (error) console.error('[shared-sky] deletePost failed:', error);
}

/**
 * Add a reaction (emoji) to a message or post.
 * Uses upsert to handle single-reaction-per-user constraint.
 * @param {string} messageId
 * @param {string} emoji
 */
export async function addReaction(messageId, emoji) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;

  // Remove any existing reaction by this user on this message first
  await sb
    .from('reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', user.id);

  // Insert the new reaction
  const { error } = await sb.from('reactions').upsert(
    { message_id: messageId, user_id: user.id, emoji },
    { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: false }
  );
  if (error) console.error('[shared-sky] addReaction failed:', error);
}

/**
 * Remove a reaction from a message or post.
 * @param {string} messageId
 * @param {string} emoji — unused but kept for API consistency; removes all user reactions on this message
 */
export async function removeReaction(messageId, emoji) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;

  const { error } = await sb
    .from('reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', user.id);
  if (error) console.error('[shared-sky] removeReaction failed:', error);
}
