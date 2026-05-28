// E2E: Roulette send flow
//
// Runs in a real browser against the deployed app.
// The edge function call is intercepted so no real message is created —
// we're testing the UI responds correctly, not that Supabase delivers it.

const { test, expect } = require('@playwright/test');

const FAKE_MESSAGE_ID = '00000000-0000-0000-0000-000000000001';

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

test('compose modal opens and closes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.split-layout')).toBeVisible({ timeout: 15_000 });

    await page.locator('.new-roulette-btn').click();
    await expect(page.locator('#rouletteComposeModal')).toBeVisible();

    await page.locator('.roulette-close-btn').click();
    await expect(page.locator('#rouletteComposeModal')).not.toBeVisible();
});

test('send shows success toast and closes modal', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.split-layout')).toBeVisible({ timeout: 15_000 });

    await page.locator('.new-roulette-btn').click();
    await expect(page.locator('#rouletteComposeModal')).toBeVisible();

    await page.locator('#rouletteComposeText').fill('Testing from the moon 🌕');
    await page.locator('#rouletteSendBtn').click();

    // Toast appears with correct text
    await expect(page.locator('#notificationToast'))
        .toContainText('on its way to a stranger', { timeout: 8_000 });

    // Modal closes after successful send
    await expect(page.locator('#rouletteComposeModal')).not.toBeVisible({ timeout: 5_000 });
});

test('cannot send an empty message', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.split-layout')).toBeVisible({ timeout: 15_000 });

    await page.locator('.new-roulette-btn').click();
    await page.locator('#rouletteSendBtn').click();

    // Toast shows validation error, modal stays open
    await expect(page.locator('#notificationToast')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#rouletteComposeModal')).toBeVisible();
});

test('ring shows a roulette dot after send', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.split-layout')).toBeVisible({ timeout: 15_000 });

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
    await page.locator('#rouletteComposeText').fill('A message for the cosmos');
    await page.locator('#rouletteSendBtn').click();

    await expect(page.locator('#notificationToast'))
        .toContainText('on its way to a stranger', { timeout: 8_000 });

    // Ring has a roulette dot (diamond shape, blue)
    await expect(page.locator('#messageDots .roulette-dot')).toBeVisible({ timeout: 5_000 });
});
