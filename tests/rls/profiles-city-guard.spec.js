// DB-layer guard tests for migration 045 — profiles must always have a city.
//
// The "verify-last" signup guarantee lives in client JS and has failed twice
// (tab eviction, FB in-app browser wiping localStorage). These tests pin the
// database trigger that makes city-less profile rows impossible regardless of
// client behavior. They run with the SERVICE ROLE on purpose: if even the
// most privileged key is blocked, every client path is blocked.

const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const AUTH_DIR = path.join(__dirname, '../setup/.auth');

function adminClient() {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

function loadUsers() {
    return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'test-users.json'), 'utf8'));
}

test.describe('profiles city guard (migration 045)', () => {
    test('INSERT without a city is rejected even for service role', async () => {
        const admin = adminClient();
        const { senderId } = loadUsers();
        // senderId already has a profile, so if the trigger were missing this
        // would fail on the duplicate key instead — assert the trigger fires FIRST
        // (BEFORE INSERT runs before constraint checks).
        const { error } = await admin.from('profiles').insert({
            id: senderId,
            email: 'city-guard-test@moonpostservice.com',
            username: 'city-guard-test',
        });
        expect(error).not.toBeNull();
        expect(error.message).toContain('city is required');
    });

    test('INSERT with a blank city is rejected', async () => {
        const admin = adminClient();
        const { senderId } = loadUsers();
        const { error } = await admin.from('profiles').insert({
            id: senderId,
            email: 'city-guard-test@moonpostservice.com',
            username: 'city-guard-test',
            city: '   ',
        });
        expect(error).not.toBeNull();
        expect(error.message).toContain('city is required');
    });

    test('UPDATE removing an existing city is rejected', async () => {
        const admin = adminClient();
        const { senderId } = loadUsers();
        const { error } = await admin.from('profiles')
            .update({ city: null })
            .eq('id', senderId);
        expect(error).not.toBeNull();
        expect(error.message).toContain('cannot be removed');
    });

    test('UPDATE setting a city still works (heal path)', async () => {
        const admin = adminClient();
        const { senderId } = loadUsers();
        // Re-assert the seeded city — passes through the trigger's UPDATE branch.
        const { data, error } = await admin.from('profiles')
            .update({ city: 'Test City' })
            .eq('id', senderId)
            .select('city')
            .single();
        expect(error).toBeNull();
        expect(data.city).toBe('Test City');
    });
});
