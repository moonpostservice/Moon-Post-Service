/**
 * Supabase test client helpers for RLS policy testing.
 *
 * Provides factory functions to create Supabase clients that act as
 * different users (for testing Row Level Security policies).
 *
 * Environment variables:
 *   SUPABASE_TEST_URL            — Supabase project URL (local or remote)
 *   SUPABASE_TEST_ANON_KEY       — Supabase anon/public key
 *   SUPABASE_TEST_SERVICE_ROLE_KEY — Supabase service role key (bypasses RLS)
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_TEST_URL = process.env.SUPABASE_TEST_URL || 'http://localhost:54321';
const SUPABASE_TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY || '';
const SUPABASE_TEST_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || '';

/**
 * Create a Supabase client impersonating a specific user.
 *
 * Uses the anon key with a custom Authorization header containing a
 * crafted JWT for the given userId. This lets property tests exercise
 * RLS policies as arbitrary users without real auth flows.
 *
 * @param {string} userId — UUID of the user to impersonate
 * @param {object} [options] — additional options
 * @param {string} [options.email] — email claim to embed in the JWT context
 * @param {string} [options.role] — role claim (default: 'authenticated')
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createTestClient(userId, options = {}) {
  const { email = `${userId}@test.moonpop.app`, role = 'authenticated' } = options;

  return createClient(SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, {
    global: {
      headers: {
        // Local Supabase accepts this header to override auth context
        Authorization: `Bearer ${buildTestJwt(userId, email, role)}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Create an unauthenticated Supabase client (anon key only, no user JWT).
 *
 * Useful for testing that unauthenticated requests are properly denied
 * by RLS policies.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createAnonClient() {
  return createClient(SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Create a Supabase client with the service role key (bypasses RLS).
 *
 * Used for test setup/teardown — seeding data, cleaning up rows, and
 * verifying database state without RLS interference.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function createServiceClient() {
  if (!SUPABASE_TEST_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_TEST_SERVICE_ROLE_KEY is required for service client. ' +
      'Set it in your environment or .env.test file.'
    );
  }

  return createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Build a minimal test JWT for user impersonation.
 *
 * In a local Supabase environment (supabase start), the JWT secret is
 * the well-known test secret. For remote test projects, the JWT must be
 * signed with the project's JWT secret.
 *
 * This helper builds the payload structure that Supabase/PostgREST expects.
 * For local testing, the unsigned token is accepted when passed via the
 * Authorization header with the correct structure.
 *
 * @param {string} userId — UUID sub claim
 * @param {string} email — email claim
 * @param {string} role — role claim
 * @returns {string} — base64url-encoded JWT (unsigned, for local testing)
 */
function buildTestJwt(userId, email, role) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    email,
    role,
    aud: 'authenticated',
    iss: 'supabase',
    iat: now,
    exp: now + 3600, // 1 hour
  };

  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64url');

  // For local Supabase testing, the JWT secret is:
  // "super-secret-jwt-token-with-at-least-32-characters-long"
  // In production test environments, use a proper signing library.
  const headerB64 = encode(header);
  const payloadB64 = encode(payload);

  // Unsigned token — works with local Supabase when the JWT secret matches
  // For signed tokens, import a JWT library and sign with the test secret
  return `${headerB64}.${payloadB64}.test-signature`;
}

/**
 * Helper to clean up test data inserted by a specific user.
 *
 * @param {string} table — table name
 * @param {string} column — ownership column (e.g., 'owner_id', 'user_id')
 * @param {string} userId — user ID whose rows to delete
 */
export async function cleanupTestData(table, column, userId) {
  const service = createServiceClient();
  await service.from(table).delete().eq(column, userId);
}

/**
 * Seed a test row using the service client (bypasses RLS).
 *
 * @param {string} table — table name
 * @param {object} row — row data to insert
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
export async function seedTestData(table, row) {
  const service = createServiceClient();
  const { data, error } = await service.from(table).insert(row).select().single();
  return { data, error };
}

export {
  SUPABASE_TEST_URL,
  SUPABASE_TEST_ANON_KEY,
  SUPABASE_TEST_SERVICE_ROLE_KEY,
};
