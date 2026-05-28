// RLS security tests — no browser, pure Supabase SDK calls.
//
// These verify the DB policies that protect user privacy in Moon Roulette.
// If any of these fail it means a real user could see data they shouldn't.

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

async function insertTestMessage(admin, overrides = {}) {
    const { senderId, recipientId } = loadUsers();
    const { data, error } = await admin
        .from('moon_roulette_messages')
        .insert({
            sender_id:         senderId,
            recipient_id:      recipientId,
            sender_city:       'Test City',
            recipient_city:    'Tokyo',
            message_text:      'RLS test message — safe to delete',
            status:            'delivered',
            moon_phase:        'Full Moon',
            moon_illumination: 1.0,
            release_at:        new Date().toISOString(),
            released_at:       new Date().toISOString(),
            ...overrides,
        })
        .select('id')
        .single();
    if (error) throw new Error(`Failed to insert test message: ${error.message}`);
    return data.id;
}

async function deleteTestMessage(admin, id) {
    await admin.from('moon_roulette_messages').delete().eq('id', id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('recipient cannot read another user\'s sent messages', async () => {
    const admin    = adminClient();
    const msgId    = await insertTestMessage(admin);
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    // Recipient queries the raw table for the sender's message — should be invisible
    const { data } = await recipient
        .from('moon_roulette_messages')
        .select('id')
        .eq('id', msgId);

    expect(data).toHaveLength(0);

    await deleteTestMessage(admin, msgId);
});

test('recipient view hides sender_id before mutual reveal', async () => {
    const admin    = adminClient();
    const msgId    = await insertTestMessage(admin, { status: 'delivered' });
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    const { data, error } = await recipient
        .from('roulette_recipient_view')
        .select('id, sender_id')
        .eq('id', msgId)
        .single();

    expect(error).toBeNull();
    expect(data.id).toBe(msgId);
    expect(data.sender_id).toBeNull(); // identity hidden until revealed

    await deleteTestMessage(admin, msgId);
});

test('queued messages are invisible to the recipient', async () => {
    const admin    = adminClient();
    const msgId    = await insertTestMessage(admin, { status: 'queued' });
    const { access_token } = loadSession('recipient.json');
    const recipient = clientFor(access_token);

    const { data } = await recipient
        .from('roulette_recipient_view')
        .select('id')
        .eq('id', msgId);

    expect(data).toHaveLength(0); // queued = not yet delivered, recipient sees nothing

    await deleteTestMessage(admin, msgId);
});

test('sender cannot read recipient_id from another sender\'s message', async () => {
    const admin = adminClient();
    const { recipientId } = loadUsers();

    // Insert a message from a third, unknown sender by abusing admin insert
    const { data: otherMsg } = await admin
        .from('moon_roulette_messages')
        .insert({
            sender_id:         recipientId, // recipient acting as a sender here
            recipient_id:      (loadUsers()).senderId,
            sender_city:       'Tokyo',
            recipient_city:    'Test City',
            message_text:      'RLS isolation test',
            status:            'delivered',
            moon_phase:        'Full Moon',
            moon_illumination: 1.0,
            release_at:        new Date().toISOString(),
            released_at:       new Date().toISOString(),
        })
        .select('id')
        .single();

    const { access_token } = loadSession('sender.json');
    const sender = clientFor(access_token);

    // Original sender tries to read the OTHER person's sent message
    const { data } = await sender
        .from('moon_roulette_messages')
        .select('id')
        .eq('id', otherMsg.id);

    expect(data).toHaveLength(0);

    await deleteTestMessage(admin, otherMsg.id);
});

test('sender_id is exposed in recipient view after mutual reveal', async () => {
    const admin           = adminClient();
    const { senderId }    = loadUsers();
    const msgId           = await insertTestMessage(admin, { status: 'revealed' });
    const { access_token } = loadSession('recipient.json');
    const recipient        = clientFor(access_token);

    const { data } = await recipient
        .from('roulette_recipient_view')
        .select('id, sender_id')
        .eq('id', msgId)
        .single();

    expect(data.sender_id).toBe(senderId); // identity revealed after mutual reveal

    await deleteTestMessage(admin, msgId);
});
