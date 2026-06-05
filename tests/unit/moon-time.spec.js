// Unit tests for the pure time helpers in js/moon-calc.js.
// These are the core of "the moon postal service only opens when the moon is
// above you" — so getting timezone math right is business-critical.
//
// Both functions tested here previously had real bugs that were fixed:
//   - getCityDayStart: produced "Invalid Date" for some locales (now uses
//     Intl formatToParts instead of string-splitting).
//   - formatTimeInZone: must never throw on a bad timezone.
// These tests lock those fixes in permanently.

const { test, expect } = require('@playwright/test');
const path = require('path');

const { getCityDayStart, formatTimeInZone } = require(
    path.join(__dirname, '../../js/moon-calc.js')
);

// Helper: read the hour/minute/second of a Date as seen in a given timezone.
function partsInZone(date, tz) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date);
    const get = (t) => parseInt(parts.find(p => p.type === t).value, 10);
    return { h: get('hour') % 24, m: get('minute'), s: get('second') };
}

test.describe('getCityDayStart', () => {
    const zones = ['UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/Paris', 'Australia/Sydney', 'Pacific/Kiritimati'];

    for (const tz of zones) {
        test(`returns a valid Date (never Invalid Date) for ${tz}`, () => {
            const result = getCityDayStart(new Date('2026-06-01T12:34:56Z'), tz);
            expect(result instanceof Date).toBe(true);
            expect(Number.isNaN(result.getTime())).toBe(false);
        });

        test(`result is local midnight in ${tz}`, () => {
            const now = new Date('2026-06-01T12:34:56Z');
            const result = getCityDayStart(now, tz);
            const { h, m, s } = partsInZone(result, tz);
            // Midnight in the city's own timezone
            expect(h).toBe(0);
            expect(m).toBe(0);
            expect(s).toBe(0);
        });
    }

    test('falls back to local midnight when tz is missing', () => {
        const result = getCityDayStart(new Date('2026-06-01T12:34:56Z'), null);
        expect(result instanceof Date).toBe(true);
        expect(result.getHours()).toBe(0);
        expect(result.getMinutes()).toBe(0);
    });
});

test.describe('formatTimeInZone', () => {
    test('returns the placeholder for a falsy date', () => {
        expect(formatTimeInZone(null, 'UTC')).toBe('--:--');
        expect(formatTimeInZone(undefined, 'UTC')).toBe('--:--');
    });

    test('formats a UTC time correctly', () => {
        expect(formatTimeInZone(new Date('2026-06-01T09:05:00Z'), 'UTC')).toBe('09:05');
    });

    test('shifts correctly into another timezone', () => {
        // 09:05 UTC is 18:05 in Tokyo (UTC+9)
        expect(formatTimeInZone(new Date('2026-06-01T09:05:00Z'), 'Asia/Tokyo')).toBe('18:05');
    });

    test('always returns HH:MM shape', () => {
        const out = formatTimeInZone(new Date('2026-06-01T23:59:00Z'), 'UTC');
        expect(out).toMatch(/^\d{2}:\d{2}$/);
    });

    test('never throws on an invalid timezone — falls back gracefully', () => {
        const out = formatTimeInZone(new Date('2026-06-01T09:05:00Z'), 'Not/AZone');
        expect(out).toMatch(/^\d{2}:\d{2}$/);
    });
});
