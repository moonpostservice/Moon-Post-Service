// @ts-check
// Standalone config for UNIT tests only.
// Intentionally has NO globalSetup, NO browser, NO Supabase/network dependency,
// so `npm run test:unit` works on any machine with zero credentials.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/unit',
    timeout: 10_000,
    use: { storageState: undefined },
});
