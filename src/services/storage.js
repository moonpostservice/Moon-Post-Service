// Storage Service — avatar and moon photo upload helpers
import { sb } from './supabase.js';

/**
 * Upload an avatar image for the given user.
 * Path ownership enforced: uploads to `{userId}/avatar.jpg`.
 *
 * @param {string} userId — must match the authenticated user's ID
 * @param {Blob} blob — compressed image blob
 * @returns {Promise<string>} — public URL of the uploaded avatar
 */
export async function uploadAvatar(userId, blob) {
  const filePath = `${userId}/avatar.jpg`;

  const { error: uploadError } = await sb.storage
    .from('avatars')
    .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });

  if (uploadError) {
    throw new Error(`Avatar upload failed: ${uploadError.message}`);
  }

  const { data: urlData } = sb.storage.from('avatars').getPublicUrl(filePath);
  // Cache-bust to ensure fresh avatar
  return urlData.publicUrl + '?t=' + Date.now();
}

/**
 * Upload a moon photo.
 * Path ownership enforced: uploads to `{context}/{userId}/{timestamp}.jpg`.
 *
 * @param {string} context — e.g. 'messages', 'replies', 'shared-sky'
 * @param {string} userId — must match the authenticated user's ID
 * @param {Blob} blob — compressed image blob
 * @returns {Promise<string>} — public URL of the uploaded photo
 */
export async function uploadMoonPhoto(context, userId, blob) {
  const ts = Date.now();
  const path = `${context}/${userId}/${ts}.jpg`;

  const { data, error } = await sb.storage.from('moon-photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });

  if (error) {
    throw new Error(`Moon photo upload failed: ${error.message}`);
  }

  const { data: urlData } = sb.storage.from('moon-photos').getPublicUrl(path);
  return urlData.publicUrl;
}
