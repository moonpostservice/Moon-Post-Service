// E2E: Roulette send flow
//
// Runs in a real browser against the deployed app.
// The edge function call is intercepted so no real message is created —
// we're testing the UI responds correctly, not that Supabase delivers it.
//
// Flow under test (js/roulette.js openRouletteFromInbox):
//   .new-roulette-btn → first-use consent modal (#rouletteIntroModal, gated on
//   localStorage 'moonpop_roulette_intro_seen') → on accept, the FAMILIAR
//   composer opens (the regular compose panel #messageModal in roulette mode
//   via openComposeForRoulette), NOT the standalone #rouletteComposeModal.
//   The standalone modal survives only for the re-launch entry point
//   (_doOpenRouletteCompose) and gets one test of its own at the bottom.

const { test, expect } = require('@playwright/test');

const FAKE_MESSAGE_ID = '00000000-0000-0000-0000-000000000001';
const INTRO_SEEN_KEY = 'moonpop_roulette_intro_seen';

async function gotoInbox(page) {
    await page.goto('/');
    await expect(page.locator('.split-layout')).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
    // Intercept the roulette send edge function — return a fake queued message
    await page.route('**/functions/v1/send-roulette-message', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                message: {
                    id: FAKE_MESSAGE_ID,
                    status: 'queued',
                    release_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
                    moon_phase: 'Waxing Gibbous',
                },
            }),
        })
    );
});

test('first use: intro modal gates the composer, accept opens it', async ({ page }) => {
    // Storage state only carries the auth token, but clear the flag anyway
    // so this test stays valid if the seeded state ever changes.
    await page.addInitScript((key) => localStorage.removeItem(key), INTRO_SEEN_KEY);
    await gotoInbox(page);

    // First click → consent modal, composer stays closed
    await page.locator('.new-roulette-btn').click();
    await expect(page.locator('#rouletteIntroModal')).toBeVisible();
    await expect(page.locator('#messageModal')).not.toBeVisible();

    // Cancel → nothing opens, flag not set
    await page.locator('#rouletteIntroModal button', { hasText: 'Cancel' }).click();
    await expect(page.locator('#rouletteIntroModal')).not.toBeVisible();
    await expect(page.locator('#messageModal')).not.toBeVisible();

    // Click again and accept → familiar composer opens in roulette mode
    await page.locator('.new-roulette-btn').click();
    await page.locator('#rouletteIntroModal button', { hasText: 'I understand' }).click();
    await expect(page.locator('#rouletteIntroModal')).not.toBeVisible();
    await expect(page.locator('#messageModal')).toBeVisible();
    await expect(page.locator('#composeHeader')).toContainText('Send to a Stranger');

    // Consent persisted
    expect(await page.evaluate((key) => localStorage.getItem(key), INTRO_SEEN_KEY))
        .toBe('true');
});

test.describe('intro already seen', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript((key) => localStorage.setItem(key, 'true'), INTRO_SEEN_KEY);
        await gotoInbox(page);
    });

    test('composer opens in roulette mode and closes', async ({ page }) => {
        await page.locator('.new-roulette-btn').click();

        // No intro modal on repeat use — straight to the familiar composer
        await expect(page.locator('#rouletteIntroModal')).not.toBeVisible();
        await expect(page.locator('#messageModal')).toBeVisible();
        await expect(page.locator('#composeHeader')).toContainText('Send to a Stranger');
        await expect(page.locator('#composeHeader')).toContainText('Moon Roulette');

        // Open Note mode is active with the regular textarea
        await expect(page.locator('#messageText')).toBeVisible();

        // Close via the header close button (both header buttons call closeModal)
        await page.locator('#composeHeader .compose-header-btn').last().click();
        await expect(page.locator('#messageModal')).not.toBeVisible({ timeout: 5_000 });
    });

    test('send shows success toast and closes composer', async ({ page }) => {
        await page.locator('.new-roulette-btn').click();
        await expect(page.locator('#messageModal')).toBeVisible();

        await page.locator('#messageText').fill('Testing from the moon 🌕');
        await page.locator('#composeMainBtn').click();

        // Toast appears with correct text
        await expect(page.locator('#notificationToast'))
            .toContainText('on its way to a stranger', { timeout: 8_000 });

        // Composer closes after successful send
        await expect(page.locator('#messageModal')).not.toBeVisible({ timeout: 5_000 });
    });

    test('cannot send an empty message', async ({ page }) => {
        await page.locator('.new-roulette-btn').click();
        await expect(page.locator('#messageModal')).toBeVisible();

        await page.locator('#composeMainBtn').click();

        // Toast shows validation error, composer stays open
        await expect(page.locator('#notificationToast'))
            .toContainText('Write a message to a stranger first', { timeout: 3_000 });
        await expect(page.locator('#messageModal')).toBeVisible();
    });

    test('ring shows a roulette dot after send', async ({ page }) => {
        // Intercept the loadRouletteMessages DB fetch so the ring dot appears
        // even though our mocked edge function didn't insert a real row
        await page.route('**/rest/v1/moon_roulette_messages**', async (route) => {
            const url = route.request().url();
            // Only intercept the sent-messages query (sender_id filter)
            if (url.includes('sender_id')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([{
                        id: FAKE_MESSAGE_ID,
                        status: 'queued',
                        release_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
                        recipient_city: 'Tokyo',
                        moon_phase: 'Waxing Gibbous',
                        sender_city: 'Test City',
                        created_at: new Date().toISOString(),
                    }]),
                });
            } else {
                await route.continue();
            }
        });

        await page.locator('.new-roulette-btn').click();
        await page.locator('#messageText').fill('A message for the cosmos');
        await page.locator('#composeMainBtn').click();

        await expect(page.locator('#notificationToast'))
            .toContainText('on its way to a stranger', { timeout: 8_000 });

        // Ring has a roulette dot (diamond shape, blue)
        await expect(page.locator('#messageDots .roulette-dot')).toBeVisible({ timeout: 5_000 });
    });

    // The standalone modal is no longer reachable from the inbox button, but
    // it's still the UI for re-launching a returned message (roulette.js
    // handleRelaunch → openRouletteCompose). Drive it directly so a regression
    // in _doOpenRouletteCompose / handleSendRoulette doesn't go unnoticed.
    test('standalone modal (re-launch entry) still sends', async ({ page }) => {
        await page.evaluate(() => openRouletteCompose());
        await expect(page.locator('#rouletteComposeModal')).toBeVisible();

        await page.locator('#rouletteComposeText').fill('Second chance for this message');
        await page.locator('#rouletteSendBtn').click();

        await expect(page.locator('#notificationToast'))
            .toContainText('on its way to a stranger', { timeout: 8_000 });
        await expect(page.locator('#rouletteComposeModal')).not.toBeVisible({ timeout: 5_000 });
    });
});
