// E2E regression: a roulette inline reply must appear in the OPEN chatbox
// immediately after sending — without closing and reopening the thread.
//
// Bug (fixed): handleInlineRouletteReply() called loadRouletteMessages() to
// refresh the global arrays but never re-rendered the open detail panel, so
// the just-sent reply only showed up after closing + reopening the thread.
//
// Strategy: drive the REAL deployed UI, but intercept the network so we own
// the data. We open a delivered roulette thread (recipient role), type a
// reply, and assert the reply bubble shows in #rouletteDetailBody while the
// panel stays open. The reload after send returns the reply in the sent
// array only once the (mocked) send has fired.

const { test, expect } = require('@playwright/test');

const PARENT_ID = '00000000-0000-0000-0000-0000000000a0';
const REPLY_ID  = '00000000-0000-0000-0000-0000000000a1';
const STRANGER_TEXT = 'a whisper from a stranger';
const MY_REPLY_TEXT = 'my reply across the sky';

async function gotoInbox(page) {
    await page.goto('/');
    await expect(page.locator('.split-layout')).toBeVisible({ timeout: 15_000 });
}

// The app's service worker intercepts fetches, which would shadow page.route()
// (Playwright doesn't see service-worker-originated requests). Stop it from
// registering so our network mocks take effect. A fresh context has no SW yet,
// so blocking registration is enough.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        if (navigator.serviceWorker && navigator.serviceWorker.register) {
            navigator.serviceWorker.register = () =>
                Promise.reject(new Error('service worker disabled for test'));
        }
    });
});

test('inline roulette reply renders in the open chatbox without reopening', async ({ page }) => {
    const now = new Date().toISOString();
    let replySent = false;

    // The inline reply edge-function call — flip the flag so the next reload
    // includes the reply, and report success.
    await page.route('**/functions/v1/send-roulette-message', (route) => {
        replySent = true;
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ message: { id: REPLY_ID, status: 'delivered' } }),
        });
    });

    // Received view (recipient role): the delivered parent message.
    await page.route('**/rest/v1/roulette_recipient_view**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{
                id: PARENT_ID,
                status: 'delivered',
                message_text: STRANGER_TEXT,
                sender_city: 'Lisbon',
                recipient_city: 'Tokyo',
                moon_phase: 'full moon',
                parent_id: null,
                created_at: now,
                released_at: now,
            }]),
        })
    );

    // Sent table (sender_id filter): empty until the reply is sent, then it
    // contains my reply (sender_id = me). Non-GET / other queries pass through.
    await page.route('**/rest/v1/moon_roulette_messages**', async (route) => {
        const req = route.request();
        const url = req.url();
        if (req.method() === 'GET' && url.includes('sender_id')) {
            const rows = replySent ? [{
                id: REPLY_ID,
                status: 'delivered',
                message_text: MY_REPLY_TEXT,
                recipient_id: null,
                recipient_city: 'Lisbon',
                moon_phase: 'full moon',
                parent_id: PARENT_ID,
                created_at: new Date(Date.now() + 1000).toISOString(),
            }] : [];
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(rows),
            });
        }
        return route.continue();
    });

    // Reveal intents — none.
    await page.route('**/rest/v1/moon_roulette_reveals**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    await gotoInbox(page);

    // Load the (mocked) roulette data and open the delivered thread as recipient.
    await page.evaluate(async (pid) => {
        await loadRouletteMessages();
        openRouletteDetail(pid, 'recipient');
    }, PARENT_ID);

    // Panel is open and shows the stranger's message; reply box is present.
    await expect(page.locator('#rouletteMessagePage')).toHaveClass(/active/);
    await expect(page.locator('#rouletteDetailBody')).toContainText(STRANGER_TEXT);
    const replyBox = page.locator(`#rouletteInlineText_${PARENT_ID}`);
    await expect(replyBox).toBeVisible();

    // Sanity: the reply text is NOT present before we send.
    await expect(page.locator('#rouletteDetailBody')).not.toContainText(MY_REPLY_TEXT);

    // Type and send the reply.
    await replyBox.fill(MY_REPLY_TEXT);
    await page.locator('.roulette-inline-send').click();

    // THE ASSERTION: the reply bubble appears in the still-open panel, with no
    // close/reopen. This fails on the pre-fix code.
    await expect(page.locator('#rouletteDetailBody'))
        .toContainText(MY_REPLY_TEXT, { timeout: 8_000 });

    // REGRESSION GUARD: the prior conversation must NOT vanish when the reply
    // is shown. (The first re-render-based fix rebuilt the thread from reloaded
    // arrays and dropped history that wasn't reloadable, e.g. graduated msgs.)
    await expect(page.locator('#rouletteDetailBody')).toContainText(STRANGER_TEXT);

    // And the panel never closed.
    await expect(page.locator('#rouletteMessagePage')).toHaveClass(/active/);
});

// Mirrors the real-world break: a revealed thread graduates into a normal
// conversation, so its earlier messages are filtered out of the roulette
// arrays (graduated_at IS NULL). The detail panel may still display that
// history (rendered before reload), and sending a reply must NOT wipe it.
// We simulate "history the reload can't reconstruct" by seeding the panel body
// directly, then asserting the optimistic append preserves it.
test('reply preserves on-screen history that reload cannot reconstruct', async ({ page }) => {
    const FAKE_ID = '00000000-0000-0000-0000-0000000000c0';
    // Reload returns an EMPTY thread (as if every prior message graduated away).
    await page.route('**/functions/v1/send-roulette-message', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ message: { id: '00000000-0000-0000-0000-0000000000c1', status: 'delivered' } }) }));
    await page.route('**/rest/v1/roulette_recipient_view**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/rest/v1/moon_roulette_messages**', async (route) => {
        const req = route.request();
        if (req.method() === 'GET' && req.url().includes('sender_id'))
            return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return route.continue();
    });
    await page.route('**/rest/v1/moon_roulette_reveals**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

    await gotoInbox(page);

    // Build a detail panel by hand: graduated history + an active reply box.
    await page.evaluate((id) => {
        const page = document.getElementById('rouletteMessagePage');
        document.getElementById('rouletteDetailBody').innerHTML =
            '<div class="roulette-detail-content">' +
            '<div class="message-bubble roulette-bubble"><p>GRADUATED-HISTORY-LINE</p></div>' +
            '</div>';
        document.getElementById('rouletteDetailFooter').innerHTML =
            '<div class="roulette-detail-actions"><div class="roulette-inline-reply">' +
            `<textarea id="rouletteInlineText_${id}" class="roulette-inline-textarea"></textarea>` +
            `<button class="roulette-inline-send" onclick="handleInlineRouletteReply('${id}')">↩</button>` +
            '</div></div>';
        page.classList.add('active');
    }, FAKE_ID);

    await expect(page.locator('#rouletteDetailBody')).toContainText('GRADUATED-HISTORY-LINE');

    await page.locator(`#rouletteInlineText_${FAKE_ID}`).fill('BRAND-NEW-LINE');
    await page.locator('.roulette-inline-send').click();

    // New reply shows AND the graduated history is still there.
    await expect(page.locator('#rouletteDetailBody')).toContainText('BRAND-NEW-LINE', { timeout: 8_000 });
    await expect(page.locator('#rouletteDetailBody')).toContainText('GRADUATED-HISTORY-LINE');
});
