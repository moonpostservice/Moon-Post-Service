// @ts-check
const { defineConfig } = require('@playwright/test');
require('dotenv').config({ path: '.env.test' });

module.exports = defineConfig({
    testDir: './tests',
    timeout: 30_000,
    globalSetup: './tests/setup/global-setup.js',

    use: {
        baseURL: process.env.APP_URL ?? 'https://moonpostservice.com',
        // default storage state = sender (most tests act as the message sender)
        storageState: 'tests/setup/.auth/sender.json',
        headless: true,
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        // E2E browser tests (run as the sender)
        {
            name: 'e2e',
            testDir: './tests/e2e',
        },
        // RLS / DB security tests — no browser, just Supabase SDK calls
        {
            name: 'rls',
            testDir: './tests/rls',
            use: { storageState: undefined },
        },
    ],
});
