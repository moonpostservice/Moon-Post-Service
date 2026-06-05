// Unit tests for js/utils.js — the shared, pure helpers.
// These run in plain Node (no browser, no network). They are the start of a
// safety net: any future change that breaks these helpers will fail CI loudly
// instead of shipping a silent bug.

const { test, expect } = require('@playwright/test');
const path = require('path');

// Minimal localStorage stub so the browser-oriented helpers run under Node.
function makeLocalStorage(initial = {}) {
    const store = { ...initial };
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
    };
}

// Load utils.js fresh each time with a given localStorage in scope.
function loadUtils(localStorageStub) {
    global.localStorage = localStorageStub;
    const modPath = require.resolve(path.join(__dirname, '../../js/utils.js'));
    delete require.cache[modPath]; // force re-eval so it re-reads global.localStorage
    return require(modPath);
}

test.describe('getSavedLocation', () => {
    test('returns null when nothing is stored', () => {
        const { getSavedLocation } = loadUtils(makeLocalStorage());
        expect(getSavedLocation()).toBeNull();
    });

    test('returns the parsed object for valid JSON', () => {
        const { getSavedLocation } = loadUtils(makeLocalStorage({
            moonpop_location: JSON.stringify({ name: 'Tokyo', country: 'Japan' }),
        }));
        expect(getSavedLocation()).toEqual({ name: 'Tokyo', country: 'Japan' });
    });

    test('returns null for corrupt JSON instead of throwing', () => {
        const { getSavedLocation } = loadUtils(makeLocalStorage({
            moonpop_location: '{ this is not valid json',
        }));
        expect(getSavedLocation()).toBeNull();
    });

    test('returns null when stored object has no name', () => {
        const { getSavedLocation } = loadUtils(makeLocalStorage({
            moonpop_location: JSON.stringify({ country: 'Japan' }),
        }));
        expect(getSavedLocation()).toBeNull();
    });
});

test.describe('getSavedCityName', () => {
    test('returns the city name when present', () => {
        const { getSavedCityName } = loadUtils(makeLocalStorage({
            moonpop_location: JSON.stringify({ name: 'Paris', country: 'France' }),
        }));
        expect(getSavedCityName()).toBe('Paris');
    });

    test('returns the fallback when nothing is stored', () => {
        const { getSavedCityName } = loadUtils(makeLocalStorage());
        expect(getSavedCityName('Your sky')).toBe('Your sky');
    });

    test('returns the fallback for corrupt data', () => {
        const { getSavedCityName } = loadUtils(makeLocalStorage({
            moonpop_location: 'broken',
        }));
        expect(getSavedCityName('Unknown')).toBe('Unknown');
    });
});

test.describe('usernameFromEmail', () => {
    test('extracts the local part of an email', () => {
        const { usernameFromEmail } = loadUtils(makeLocalStorage());
        expect(usernameFromEmail('alice@example.com')).toBe('alice');
    });

    test('returns the fallback for null/undefined email', () => {
        const { usernameFromEmail } = loadUtils(makeLocalStorage());
        expect(usernameFromEmail(null, 'guest')).toBe('guest');
        expect(usernameFromEmail(undefined, 'guest')).toBe('guest');
    });

    test('returns empty string fallback by default for missing email', () => {
        const { usernameFromEmail } = loadUtils(makeLocalStorage());
        expect(usernameFromEmail(null)).toBe('');
    });
});
