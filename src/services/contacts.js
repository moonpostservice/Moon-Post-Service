// Contacts Service — contact management, blocking
import { sb } from './supabase.js';

/**
 * Load all contacts for the current user, enriched with linked profile data.
 * @returns {Promise<object[]>}
 */
export async function loadContacts() {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return [];

  const { data, error } = await sb
    .from('contacts')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (!data) {
    console.error('[contacts] loadContacts failed:', error);
    return [];
  }

  const contacts = data.map((c) => ({
    id: c.id,
    name: c.name,
    location: c.city || 'Unknown',
    email: c.email,
    avatar: null,
    username: null,
    firstName: null,
    lastName: null,
    isOnMoonpop: c.is_on_moonpop || false,
    linkedProfileId: c.linked_profile_id || null,
  }));

  // Batch-fetch linked profiles
  const linkedIds = contacts.filter((c) => c.linkedProfileId).map((c) => c.linkedProfileId);
  const profileMap = {};
  if (linkedIds.length > 0) {
    const { data: profiles } = await sb
      .from('profiles')
      .select('id, username, first_name, last_name, city, avatar_url, email')
      .in('id', linkedIds);
    if (profiles) profiles.forEach((p) => { profileMap[p.id] = p; });
  }

  // Apply profile data to contacts
  for (const c of contacts) {
    if (c.linkedProfileId && profileMap[c.linkedProfileId]) {
      const p = profileMap[c.linkedProfileId];
      c.avatar = p.avatar_url || null;
      c.username = p.username || null;
      c.firstName = p.first_name || null;
      c.lastName = p.last_name || null;
      c.location = p.city || c.location;
      c.isOnMoonpop = true;
      const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
      if (p.username) c.name = p.username;
      else if (fullName) c.name = fullName;
    }
  }

  return contacts;
}

/**
 * Add a new contact.
 * @param {string} email
 * @param {string} name
 * @returns {Promise<object|null>}
 */
export async function addContact(email, name) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return null;

  // Try to find a matching profile by email
  let linkedProfileId = null;
  let city = null;
  let isOnMoonpop = false;

  if (email) {
    const { data: found } = await sb
      .from('profiles')
      .select('id, username, first_name, last_name, city, avatar_url')
      .eq('email', email)
      .limit(1);
    if (found && found.length > 0) {
      const p = found[0];
      linkedProfileId = p.id;
      city = p.city || null;
      isOnMoonpop = true;
      const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
      if (p.username) name = p.username;
      else if (fullName) name = fullName;
    }
  }

  const { data, error } = await sb
    .from('contacts')
    .insert({
      owner_id: user.id,
      name,
      email,
      city,
      is_on_moonpop: isOnMoonpop,
      linked_profile_id: linkedProfileId,
    })
    .select()
    .single();

  if (error) {
    console.error('[contacts] addContact failed:', error);
    return null;
  }
  return data;
}

/**
 * Delete a contact by ID.
 * @param {string} id
 */
export async function deleteContact(id) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;

  const { error } = await sb
    .from('contacts')
    .delete()
    .eq('id', id)
    .eq('owner_id', user.id);
  if (error) console.error('[contacts] deleteContact failed:', error);
}

/**
 * Sync contact profiles — re-link unlinked contacts by email lookup.
 */
export async function syncContactProfiles() {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;

  const { data: contactRows } = await sb
    .from('contacts')
    .select('*')
    .eq('owner_id', user.id)
    .is('linked_profile_id', null);

  if (!contactRows || contactRows.length === 0) return;

  for (const c of contactRows) {
    if (!c.email) continue;
    try {
      const { data: found } = await sb
        .from('profiles')
        .select('id, username, first_name, last_name, city, avatar_url')
        .eq('email', c.email)
        .limit(1);
      if (found && found.length > 0) {
        const p = found[0];
        const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
        const resolvedName = p.username || fullName || c.name;
        await sb
          .from('contacts')
          .update({
            linked_profile_id: p.id,
            is_on_moonpop: true,
            name: resolvedName,
            city: p.city || null,
          })
          .eq('id', c.id);
      }
    } catch (e) {
      console.error('[contacts] syncContactProfiles lookup failed for', c.email, e);
    }
  }
}

/**
 * Block a user by profile ID and/or email.
 * @param {string|null} profileId
 * @param {string|null} email
 */
export async function blockUser(profileId, email) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;

  const { error } = await sb.from('blocked_users').insert({
    blocker_id: user.id,
    blocked_id: profileId || null,
    blocked_email: email || null,
  });
  if (error) console.error('[contacts] blockUser failed:', error);
}

/**
 * Unblock a user by removing the block record.
 * @param {string} blockId — the blocked_users row ID or blocked profile ID
 */
export async function unblockUser(blockId) {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return;

  const { error } = await sb
    .from('blocked_users')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_id', blockId);
  if (error) console.error('[contacts] unblockUser failed:', error);
}

/**
 * Get all blocked users for the current user.
 * @returns {Promise<object[]>}
 */
export async function getBlockedUsers() {
  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return [];

  const { data, error } = await sb
    .from('blocked_users')
    .select('*')
    .eq('blocker_id', user.id);
  if (error) {
    console.error('[contacts] getBlockedUsers failed:', error);
    return [];
  }
  return data || [];
}
