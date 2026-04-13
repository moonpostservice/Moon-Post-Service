// Moon Post Service — State & Icon Helpers

console.log('%c[MoonPop] v68 loaded — DIAGNOSTIC: full sent message data + recipient moon status', 'color: #4fc3f7; font-weight: bold;');
// ============================================
// STATE - Must be declared first
// ============================================
let moonData = {
    isVisible: false, // Will be set by SunCalc
    moonrise: '--:--',
    moonset: '--:--',
    moonriseDate: null,
    moonsetDate: null,
    visibility: 'UNKNOWN',
    nextFullMoon: '',
    countdownTarget: null,
    position: 180, // Bottom of orbit (below horizon default)
    messagesInTransit: 0,
    messagesUnlocked: 0,
    messagesCarrying: 0,
    phase: null,
    userLat: null,
    userLon: null,
    userTz: null,
    altitude: null,
    azimuth: null,
    includeMoonDetails: false,
    timeFormat: '24',
    _refreshInterval: null,
    _cycleRise: null,
    _cycleSet: null,
    _nextRise: null,
    _prevRise: null
};

// ============================================
// SVG ICON HELPERS
// ============================================

// Map phase name to SVG icon ID
const PHASE_ICON_MAP = {
    'new moon': 'icon-new-moon',
    'waxing crescent': 'icon-waxing-crescent',
    'first quarter': 'icon-first-quarter',
    'waxing gibbous': 'icon-waxing-gibbous',
    'full moon': 'icon-full-moon',
    'waning gibbous': 'icon-waning-gibbous',
    'last quarter': 'icon-last-quarter',
    'waning crescent': 'icon-waning-crescent'
};

// Get SVG icon HTML for a moon phase name
function phaseIconSvg(phaseName, size = 'md') {
    const id = PHASE_ICON_MAP[(phaseName || '').toLowerCase()] || 'icon-full-moon';
    return `<svg class="app-icon ${size}"><use href="#${id}"/></svg>`;
}

// Get SVG icon HTML by icon ID
function iconSvg(name, size = 'md') {
    return `<svg class="app-icon ${size}"><use href="#icon-${name}"/></svg>`;
}

