// RLS / grant security tests for the moon-transit seal — no browser, pure SDK.
//
// Migration 043 moved transit sealing server-side:
//   - clients lost SELECT on content columns of messages/replies (metadata only)
//   - clients lost UPDATE on messages/replies entirely (no force-release)
//   - content reads go through messages_v / replies_v, which NULL content
//     while the row is still sealed for the viewer
//
// If any of these fail, a recipient can read or force-release undelivered
// moon messages straight off the REST API, bypassing the UI seal.
//
// Run with: npm run test:rls  (requires .env.test with SUPABASE_SERVICE_ROLE_KEY
// and the seeded sessions in tests/setup/.auth — same harness as roulette-rls).

const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const AUTH_DIR = path.join(__dirname, '../setup/.auth');

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminClient() {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

function clientFor(accessToken) {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

function loadUsers() {
    return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'test-users.json'), 'utf8'));
}

function loadSession(filename) {
    const state = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, filename), 'utf8'));
    const raw = state.origins[0].localStorage[0].value;
    return JSON.parse(raw);
}

const IN_ONE_HOUR = () => new Date(Date.now() + 3600_000).toISOString();
const ONE_HOUR_AGO = () => new Date(Date.now() - 3600_000).toISOString();

// A direct (non-roulette) moon message, in transit by default.
async function insertTestMessage(admin, overrides = {}) {
    const { senderId, recipientId } = loadUsers();
    const { data, error } = await admin
        .from('messages')
        .insert({
            sender_id:      senderId,
            recipient_id:   recipientId,
            recipient_city: 'Tokyo',
            message_text:   'TRANSIT SEAL TEST — sealed content, safe to delete',
            status:         'in_transit',
            release_at:     IN_ONE_HOUR(),
            ...overrides,
        })
        .select('id')
        .single();
    if (error) throw new Error(`Failed to insert test message: ${error.message}`);
    return data.id;
}

async function insertTestReply(admin, messageId, overrides = {}) {
    const { senderId } = loadUsers();
    const { data, error } = await admin
        .from('replies')
        .insert({
            message_id:     messageId,
            sender_id:      senderId,
            text:           'TRANSIT SEAL TEST reply — sealed content',
            status:         'in_transit',
            release_at:     IN_ONE_HOUR(),
            recipient_city: 'Tokyo',
            ...overrides,
        })
        .select('id')
        .single();
    if (error) throw new Error(`Failed to insert test reply: ${error.message}`);
    return data.id;
}

async function cleanup(admin, msgId) {
    await admin.from('replies').delete().eq('message_id', msgId);
    await admin.from('messages').delete().eq('id', msgId);
}

// ── Base table: content columns are not selectable at all ────────────────────

test('recipient cannot select message content columns on the base table', async () => {
    const admin = adminClient();
    const msgId = await insertTestMessage(admin);
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    // Explicit content column → permission denied (42501), not empty data
    const { error } = await recipient
        .from('messages')
        .select('message_text')
        .eq('id', msgId);
    expect(error).not.toBeNull();

    // select * expands to revoked columns → also denied
    const { error: starErr } = await recipient
        .from('messages')
        .select('*')
        .eq('id', msgId);
    expect(starErr).not.toBeNull();

    await cleanup(admin, msgId);
});

test('recipient can still read seal metadata (status, release_at) on the base table', async () => {
    const admin = adminClient();
    const msgId = await insertTestMessage(admin);
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    // The inbox "On Its Way" countdown needs row existence + release_at
    const { data, error } = await recipient
        .from('messages')
        .select('id, status, release_at, created_at')
        .eq('id', msgId)
        .single();
    expect(error).toBeNull();
    expect(data.status).toBe('in_transit');
    expect(new Date(data.release_at).getTime()).toBeGreaterThan(Date.now());

    await cleanup(admin, msgId);
});

// ── messages_v: masked while sealed, full once released ──────────────────────

test('messages_v NULLs content for the recipient while in transit', async () => {
    const admin = adminClient();
    const msgId = await insertTestMessage(admin, {
        photo_url: 'messages/test-sealed.jpg',
        song_url: 'https://open.spotify.com/track/test',
        lunar_note_text: 'sealed lunar note',
    });
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    const { data, error } = await recipient
        .from('messages_v')
        .select('*')
        .eq('id', msgId)
        .single();

    expect(error).toBeNull();
    expect(data.sealed).toBe(true);
    expect(data.message_text).toBeNull();
    expect(data.lunar_note_text).toBeNull();
    expect(data.photo_url).toBeNull();
    expect(data.song_url).toBeNull();
    expect(data.release_at).not.toBeNull(); // countdown still works

    await cleanup(admin, msgId);
});

test('messages_v shows content to the recipient once release_at has passed', async () => {
    const admin = adminClient();
    const msgId = await insertTestMessage(admin, {
        status: 'released',
        release_at: ONE_HOUR_AGO(),
        released_at: ONE_HOUR_AGO(),
    });
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    const { data, error } = await recipient
        .from('messages_v')
        .select('id, sealed, message_text')
        .eq('id', msgId)
        .single();

    expect(error).toBeNull();
    expect(data.sealed).toBe(false);
    expect(data.message_text).toContain('TRANSIT SEAL TEST');

    await cleanup(admin, msgId);
});

test('sender always sees their own content in messages_v, even in transit', async () => {
    const admin = adminClient();
    const msgId = await insertTestMessage(admin);
    const { access_token } = loadSession('sender.json');
    const sender = clientFor(access_token);

    const { data, error } = await sender
        .from('messages_v')
        .select('id, sealed, message_text')
        .eq('id', msgId)
        .single();

    expect(error).toBeNull();
    expect(data.sealed).toBe(false);
    expect(data.message_text).toContain('TRANSIT SEAL TEST');

    await cleanup(admin, msgId);
});

test('a third party sees no rows at all in messages_v', async () => {
    const admin = adminClient();
    const { senderId } = loadUsers();
    // Message between sender and a synthetic third party — recipient session
    // is the outsider here only if the row names neither of them. Simplest
    // robust check: recipient queries a message addressed to someone else.
    const msgId = await insertTestMessage(admin, {
        recipient_id: senderId,   // sender → sender (self), recipient is outsider
        sender_id: senderId,
    });
    const { access_token } = loadSession('recipient.json');
    const outsider = clientFor(access_token);

    const { data } = await outsider
        .from('messages_v')
        .select('id')
        .eq('id', msgId);
    expect(data).toHaveLength(0);

    await cleanup(admin, msgId);
});

// ── replies_v ────────────────────────────────────────────────────────────────

test('replies_v NULLs reply content for the recipient while in transit', async () => {
    const admin = adminClient();
    const msgId = await insertTestMessage(admin, {
        status: 'released',
        release_at: ONE_HOUR_AGO(),
    });
    // Reply from the sender back on their own message → recipient is the viewer
    const replyId = await insertTestReply(admin, msgId);

    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    const { data, error } = await recipient
        .from('replies_v')
        .select('*')
        .eq('id', replyId)
        .single();

    expect(error).toBeNull();
    expect(data.sealed).toBe(true);
    expect(data.text).toBeNull();
    expect(data.photo_url).toBeNull();
    expect(data.release_at).not.toBeNull();

    await cleanup(admin, msgId);
});

test('recipient cannot select reply content columns on the base table', async () => {
    const admin = adminClient();
    const msgId = await insertTestMessage(admin, { status: 'released', release_at: ONE_HOUR_AGO() });
    const replyId = await insertTestReply(admin, msgId);
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    const { error } = await recipient
        .from('replies')
        .select('text')
        .eq('id', replyId);
    expect(error).not.toBeNull();

    await cleanup(admin, msgId);
});

// ── No client-side force-release ──────────────────────────────────────────────

test('recipient cannot UPDATE messages to force an early release', async () => {
    const admin = adminClient();
    const msgId = await insertTestMessage(admin);
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    const nowIso = new Date().toISOString();
    const { error } = await recipient
        .from('messages')
        .update({ status: 'released', release_at: nowIso, released_at: nowIso })
        .eq('id', msgId);
    expect(error).not.toBeNull(); // UPDATE grant revoked entirely

    // And the row is untouched
    const { data: after } = await adminClient()
        .from('messages')
        .select('status')
        .eq('id', msgId)
        .single();
    expect(after.status).toBe('in_transit');

    await cleanup(admin, msgId);
});

test('recipient cannot UPDATE replies to force an early release', async () => {
    const admin = adminClient();
    const msgId = await insertTestMessage(admin, { status: 'released', release_at: ONE_HOUR_AGO() });
    const replyId = await insertTestReply(admin, msgId);
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    const { error } = await recipient
        .from('replies')
        .update({ status: 'released', release_at: new Date().toISOString() })
        .eq('id', replyId);
    expect(error).not.toBeNull();

    const { data: after } = await adminClient()
        .from('replies')
        .select('status')
        .eq('id', replyId)
        .single();
    expect(after.status).toBe('in_transit');

    await cleanup(admin, msgId);
});

// ── Sender can still create replies and read back metadata ───────────────────

test('sender INSERT on replies still works with metadata-only RETURNING', async () => {
    const admin = adminClient();
    const { senderId, recipientId } = loadUsers();
    const msgId = await insertTestMessage(admin, {
        sender_id: recipientId,
        recipient_id: senderId,
        status: 'released',
        release_at: ONE_HOUR_AGO(),
    });

    const { access_token } = loadSession('sender.json');
    const sender = clientFor(access_token);

    // Mirrors js/chat.js sendReply: insert + .select('id, created_at')
    const { data, error } = await sender
        .from('replies')
        .insert({
            message_id: msgId,
            sender_id: senderId,
            text: 'TRANSIT SEAL TEST — reply insert path',
            status: 'in_transit',
            release_at: IN_ONE_HOUR(),
            recipient_city: 'Tokyo',
        })
        .select('id, created_at')
        .single();

    expect(error).toBeNull();
    expect(data.id).toBeTruthy();

    await cleanup(admin, msgId);
});
