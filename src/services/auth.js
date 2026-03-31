// Auth Service — OTP sign-in, session management, auth state changes
import { sb } from './supabase.js';

/**
 * Send a one-time password to the given email address.
 * @param {string} email
 * @returns {Promise<{error?: object}>}
 */
export async function signInWithOtp(email) {
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  return { error: error || null };
}

/**
 * Verify the OTP code sent to the user's email.
 * @param {string} email
 * @param {string} token — the 8-digit code
 * @returns {Promise<{session?: object, error?: object}>}
 */
export async function verifyOtp(email, token) {
  const { data, error } = await sb.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  return { session: data?.session || null, error: error || null };
}

/**
 * Retrieve the current session (if any).
 * @returns {Promise<{session?: object}>}
 */
export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) console.error('[auth] getSession error:', error);
  return { session: data?.session || null };
}

/**
 * Sign the current user out and clear the session.
 */
export async function signOut() {
  await sb.auth.signOut();
}

/**
 * Subscribe to auth state changes (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, etc.).
 * @param {function} callback — receives (event, session)
 * @returns {{ unsubscribe: function }}
 */
export function onAuthStateChange(callback) {
  const { data } = sb.auth.onAuthStateChange(callback);
  return { unsubscribe: data?.subscription?.unsubscribe || (() => {}) };
}
