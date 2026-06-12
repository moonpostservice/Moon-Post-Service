// Runs once before the full test suite.
// Creates test user sessions via Supabase admin (no email needed) and
// writes Playwright storageState files so tests start already authenticated.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

const {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    APP_URL = 'https://moonpostservice.com',
    TEST_SENDER_EMAIL,
    TEST_RECIPIENT_EMAIL,
} = process.env;

const AUTH_DIR = path.join(__dirname, '.auth');

// Extract project ref from URL (e.g. "znfqqehthxcrizcixzpu")
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const STORAGE_KEY  = `sb-${PROJECT_REF}-auth-token`;

async function getSession(adminClient, anonClient, email) {
    // generateLink creates the user if it doesn't exist, or issues a new link for existing ones
    const { data, error } = await adminClient.auth.admin.generateLink({
        type: 'magiclink',
        email,
    });
    if (error) throw new Error(`generateLink failed for ${email}: ${error.message}`);

    // The action_link's token param carries the HASHED token on current GoTrue,
    // so the legacy email+token verification rejects it — verify by token_hash.
    const { data: { session }, error: sessionError } = await anonClient.auth.verifyOtp({
        token_hash: data.properties.hashed_token,
        type: 'magiclink',
    });
    if (sessionError) throw new Error(`verifyOtp failed for ${email}: ${sessionError.message}`);

    return { session, userId: data.user.id };
}

function storageState(session) {
    return {
        cookies: [],
        origins: [{
            origin: new URL(APP_URL).origin,
            localStorage: [{
                name: STORAGE_KEY,
                value: JSON.stringify(session),
            }],
        }],
    };
}

module.exports = async function globalSetup() {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error(
            'SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
            'Get it from: Supabase dashboard → Settings → API → service_role key\n' +
            'Then add it to .env.test'
        );
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    fs.mkdirSync(AUTH_DIR, { recursive: true });

    // ── Sender ────────────────────────────────────────────────────────────
    const { session: senderSession, userId: senderId } =
        await getSession(admin, anon, TEST_SENDER_EMAIL);

    // Sender opts OUT of receiving roulette so they're never picked as a recipient
    await admin.from('profiles').upsert(
        { id: senderId, city: 'Test City', receive_moon_roulette: false, is_test_account: true },
        { onConflict: 'id' }
    );

    fs.writeFileSync(
        path.join(AUTH_DIR, 'sender.json'),
        JSON.stringify(storageState(senderSession), null, 2)
    );

    // ── Recipient ─────────────────────────────────────────────────────────
    const { session: recipientSession, userId: recipientId } =
        await getSession(admin, anon, TEST_RECIPIENT_EMAIL);

    // Recipient must be eligible: has city + coordinates + roulette opt-in
    await admin.from('profiles').upsert(
        {
            id: recipientId,
            city: 'Tokyo',
            latitude: 35.6762,
            longitude: 139.6503,
            receive_moon_roulette: true,
            is_test_account: true,
        },
        { onConflict: 'id' }
    );

    fs.writeFileSync(
        path.join(AUTH_DIR, 'recipient.json'),
        JSON.stringify(storageState(recipientSession), null, 2)
    );

    // Shared metadata for RLS tests (loaded by the spec files)
    fs.writeFileSync(
        path.join(AUTH_DIR, 'test-users.json'),
        JSON.stringify({ senderId, recipientId }, null, 2)
    );

    console.log(`\n✓ Test sessions ready`);
    console.log(`  sender    → ${TEST_SENDER_EMAIL} (${senderId})`);
    console.log(`  recipient → ${TEST_RECIPIENT_EMAIL} (${recipientId})\n`);
};
