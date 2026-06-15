// Moon Post Service — Shared Utilities
// ============================================
// Pure, dependency-free helpers. This file is loaded FIRST (before all other
// scripts) so every other module can rely on these functions.
//
// Goal: consolidate small patterns that were previously copy-pasted across many
// files (and which caused real bugs — e.g. JSON.parse without try/catch, and
// reading .name off a corrupted localStorage value). Centralising them here
// means we fix once, and unit-test once.
//
// All functions in this file are written to be safe to call in any state:
// they never throw on bad input, and they tolerate a missing DOM / localStorage.

// --- Saved location --------------------------------------------------------

// Safely read the saved location object from localStorage. NEVER throws.
// Returns { name, country, ... } or null when absent/corrupt.
function getSavedLocation() {
    try {
        const raw = (typeof localStorage !== 'undefined')
            ? localStorage.getItem('moonpop_location')
            : null;
        if (!raw) return null;
        const loc = JSON.parse(raw);
        if (loc && typeof loc === 'object' && loc.name) return loc;
        return null;
    } catch (e) {
        return null;
    }
}

// Get the saved city name, or a caller-supplied fallback. NEVER throws.
function getSavedCityName(fallback = 'Your sky') {
    const loc = getSavedLocation();
    return (loc && loc.name) ? loc.name : fallback;
}

// --- Safe DOM helpers ------------------------------------------------------

// Set textContent on an element by id, only if it exists. Returns true if set.
// Prevents the "Cannot read properties of null" crashes we kept finding.
function setText(id, text) {
    const el = (typeof document !== 'undefined') ? document.getElementById(id) : null;
    if (el) { el.textContent = text; return true; }
    return false;
}

// --- Username helper -------------------------------------------------------

// Derive a username from an email, tolerating null/undefined emails.
function usernameFromEmail(email, fallback = '') {
    if (!email || typeof email !== 'string') return fallback;
    return email.split('@')[0] || fallback;
}

// --- Moon delivery gate ----------------------------------------------------

// A reply someone ELSE sent me is still sealed (in transit) until its release
// time passes — same rule as top-level messages: release_at in the future OR
// the DB still says in_transit, with a 72h hard cap so nothing can get stuck
// sealed forever (two-hop courier delivery can legitimately exceed 24h: up to a
// full pickup cycle + a full recipient cycle). Replies I sent are never sealed.
function replyStillSealed(r, myUserId) {
    if (!r || r.sender_id === myUserId) return false;
    const tooOld = r.created_at && new Date(r.created_at) < new Date(Date.now() - 72 * 3600000);
    if (tooOld) return false;
    return (r.release_at && new Date(r.release_at) > new Date()) || r.status === 'in_transit';
}

// Dual export: stays a browser global (non-module <script>), and also exports
// for CommonJS so these pure functions can be unit-tested in plain Node.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getSavedLocation, getSavedCityName, setText, usernameFromEmail, replyStillSealed };
}
