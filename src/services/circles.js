// Circles Service — Moon Circles CRUD
import { sb } from './supabase.js';

/**
 * Load all Moon Circles the current user is a member of,
 * including members, nights, and contributions.
 * @returns {Promise<object[]>}
 */
export async function loadCircles() {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return [];

  // Get circles the user is a member of
  const { data: memberships, error: memErr } = await sb
    .from('circle_members')
    .select('circle_id')
    .eq('user_id', user.id);

  if (memErr || !memberships || memberships.length === 0) return [];

  const circleIds = memberships.map((m) => m.circle_id);

  // Get circle details
  const { data: circlesData, error: circErr } = await sb
    .from('moon_circles')
    .select('*')
    .in('id', circleIds);

  if (circErr || !circlesData) return [];

  // Get members for each circle
  const { data: allMembers } = await sb
    .from('circle_members')
    .select('*, profile:profiles!user_id(username, city)')
    .in('circle_id', circleIds);

  // Get nights for each circle
  const { data: allNights } = await sb
    .from('circle_nights')
    .select('*')
    .in('circle_id', circleIds)
    .order('date', { ascending: false });

  // Get contributions for those nights
  let allContributions = [];
  if (allNights && allNights.length > 0) {
    const nightIds = allNights.map((n) => n.id);
    const { data: contribs } = await sb
      .from('circle_contributions')
      .select('*, author:profiles!user_id(username, city)')
      .in('night_id', nightIds);
    if (contribs) allContributions = contribs;
  }

  // Assemble circles
  return circlesData.map((circle) => {
    const members = (allMembers || [])
      .filter((m) => m.circle_id === circle.id)
      .map((m) => m.profile?.username || 'Unknown');

    const nights = (allNights || [])
      .filter((n) => n.circle_id === circle.id)
      .map((night) => {
        const contributions = allContributions
          .filter((c) => c.night_id === night.id)
          .map((c) => ({
            member: c.author?.username || 'Unknown',
            location: c.author?.city || 'Unknown',
            note: c.note_text
              ? { text: c.note_text, closing: c.note_closing || '' }
              : null,
          }));

        const hasUserContribution = allContributions.some(
          (c) => c.night_id === night.id && c.user_id === user.id
        );

        return {
          dbId: night.id,
          date: night.date,
          promptSetIndex: night.prompt_set_index,
          contributions,
          yourTurn: !hasUserContribution,
        };
      });

    return {
      id: circle.id,
      name: circle.name,
      emoji: circle.emoji || '🔥',
      members,
      nights,
    };
  });
}

/**
 * Create a new Moon Circle.
 * @param {string} name
 * @param {string} emoji
 * @returns {Promise<object|null>}
 */
export async function createCircle(name, emoji) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return null;

  const { data: circle, error: circleErr } = await sb
    .from('moon_circles')
    .insert({ name, emoji: emoji || '🔥', creator_id: user.id })
    .select()
    .single();

  if (circleErr || !circle) {
    console.error('[circles] createCircle failed:', circleErr);
    return null;
  }

  // Add creator as first member
  await sb.from('circle_members').insert({
    circle_id: circle.id,
    user_id: user.id,
  });

  // Create first night
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000
  );
  await sb.from('circle_nights').insert({
    circle_id: circle.id,
    date: new Date().toISOString().split('T')[0],
    prompt_set_index: dayOfYear % 10, // modulo prompt set count
  });

  return circle;
}

/**
 * Add a member to a circle.
 * @param {string} circleId
 * @param {string} userId
 */
export async function addMember(circleId, userId) {
  const { error } = await sb.from('circle_members').insert({
    circle_id: circleId,
    user_id: userId,
  });
  if (error) console.error('[circles] addMember failed:', error);
}

/**
 * Add a contribution to a circle night.
 * @param {string} nightId
 * @param {object} payload — { input_1, input_2, input_3, note_text, note_closing }
 */
export async function addContribution(nightId, payload) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;

  const { error } = await sb.from('circle_contributions').insert({
    night_id: nightId,
    user_id: user.id,
    input_1: payload.input_1 || null,
    input_2: payload.input_2 || null,
    input_3: payload.input_3 || null,
    note_text: payload.note_text || null,
    note_closing: payload.note_closing || null,
  });
  if (error) console.error('[circles] addContribution failed:', error);
}
