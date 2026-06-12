// Regression test for the city-less-profile bug (2026-06-11).
//
// Scenario: a user's email gets confirmed in a browser context that has NO
// signup draft (FB in-app browser wiped localStorage / email link opened in a
// different browser). The old code inserted a placeholder profile with no city;
// the fix defers the profile INSERT until the user actually chooses a city.
//
// This test logs in as a freshly-confirmed user with no profile row and no
// draft, and asserts:
//   1. The mandatory location step is shown.
//   2. NO profile row exists while the user sits on that step.
//   3. Choosing a city creates the profile row complete WITH the city.

const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

const {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    APP_URL = 'https://www.moonpostservice.com',
} = process.env;

const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

// Matches the 'test-%@moonpostservice.com' exclusion in get_admin_analytics,
// so a failed cleanup can never pollute the incomplete-signups canary.
const EMAIL = `test-cityguard-${Date.now()}@moonpostservice.com`;

function adminClient() {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

test.describe('deferred profile creation', () => {
    let admin;
    let userId;
    let session;

    test.beforeAll(async () => {
        admin = adminClient();
        // Create + confirm a brand-new user with NO profile row (same technique
        // as global-setup: generateLink creates the user, verifyOtp by hashed
        // token confirms it and yields a session).
        const { data, error } = await admin.auth.admin.generateLink({
            type: 'magiclink',
            email: EMAIL,
        });
        if (error) throw new Error(`generateLink failed: ${error.message}`);
        userId = data.user.id;

        const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: verified, error: vErr } = await anon.auth.verifyOtp({
            token_hash: data.properties.hashed_token,
            type: 'magiclink',
        });
        if (vErr) throw new Error(`verifyOtp failed: ${vErr.message}`);
        session = verified.session;
    });

    test.afterAll(async () => {
        if (!userId) return;
        await admin.from('profiles').delete().eq('id', userId);
        await admin.auth.admin.deleteUser(userId);
    });

    test('no profile row until a city is chosen; row is complete after', async ({ browser }) => {
        test.setTimeout(90_000);

        const context = await browser.newContext({
            storageState: {
                cookies: [],
                origins: [{
                    origin: new URL(APP_URL).origin,
                    localStorage: [{ name: STORAGE_KEY, value: JSON.stringify(session) }],
                }],
            },
        });
        const page = await context.newPage();
        await page.goto('/');

        // 1. Confirmed user, no draft, no profile → mandatory location step.
        await expect(page.locator('#authStepLocation')).toBeVisible({ timeout: 30_000 });

        // 2. Crucially, NO profile row may exist yet (the old bug inserted a
        //    city-less placeholder right here).
        const { data: before } = await admin.from('profiles').select('id').eq('id', userId);
        expect(before).toHaveLength(0);

        // 3. Choose a city — via the timezone-detected card if offered,
        //    otherwise through the manual picker.
        const confirmBtn = page.locator('#confirmLocationBtn');
        if (await confirmBtn.isVisible()) {
            await confirmBtn.click();
        } else {
            await page.locator('#manualCityPicker').waitFor({ state: 'visible' });
            await page.locator('#onboardingCityInput').fill('Tokyo');
            await page.locator('#onboardingCityDropdown div', { hasText: 'Tokyo' }).first().click();
        }

        // The profile row must now exist, complete with its city.
        await expect.poll(async () => {
            const { data } = await admin.from('profiles')
                .select('city, username, email')
                .eq('id', userId);
            return data && data[0] ? data[0].city : null;
        }, { timeout: 20_000 }).not.toBeNull();

        const { data: after } = await admin.from('profiles')
            .select('city, email, username')
            .eq('id', userId)
            .single();
        expect(after.city).toBeTruthy();
        expect(after.email).toBe(EMAIL);

        await context.close();
    });
});
