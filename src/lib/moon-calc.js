// Moon Calculation Library — SunCalc wrappers, phase, rise/set, zodiac
// Pure functions, no Supabase dependency
import SunCalc from 'suncalc';
import { cities } from './cities.js';

const EARTH_RADIUS_KM = 6378.14;
const MOON_RADIUS_KM = 1737.4;

/**
 * Get moon phase information for a given date.
 * @param {Date} [date=new Date()] - The date to calculate for
 * @returns {{ phase: number, illumination: number, phaseName: string, emoji: string, moonAge: number, nextFullMoon: Date, distance: number, isWaxing: boolean, cyclePosition: number }}
 */
export function getMoonPhase(date = new Date()) {
  const illum = SunCalc.getMoonIllumination(date);
  const cyclePosition = illum.phase;
  const illumination = illum.fraction;

  const synodicMonth = 29.53058867;
  const moonAge = Math.floor(cyclePosition * synodicMonth);

  let phaseName;
  if (cyclePosition < 0.025 || cyclePosition >= 0.975) {
    phaseName = 'New Moon';
  } else if (cyclePosition < 0.225) {
    phaseName = 'Waxing Crescent';
  } else if (cyclePosition < 0.275) {
    phaseName = 'First Quarter';
  } else if (cyclePosition < 0.475) {
    phaseName = 'Waxing Gibbous';
  } else if (cyclePosition < 0.525) {
    phaseName = 'Full Moon';
  } else if (cyclePosition < 0.725) {
    phaseName = 'Waning Gibbous';
  } else if (cyclePosition < 0.775) {
    phaseName = 'Last Quarter';
  } else {
    phaseName = 'Waning Crescent';
  }

  const phaseEmojis = {
    'New Moon': '🌑',
    'Waxing Crescent': '🌒',
    'First Quarter': '🌓',
    'Waxing Gibbous': '🌔',
    'Full Moon': '🌕',
    'Waning Gibbous': '🌖',
    'Last Quarter': '🌗',
    'Waning Crescent': '🌘',
  };

  let daysToFull = (0.5 - cyclePosition) * synodicMonth;
  if (daysToFull < 0) daysToFull += synodicMonth;
  const nextFullMoon = new Date(date.getTime() + daysToFull * 24 * 60 * 60 * 1000);

  const anomalisticMonth = 27.55455;
  const knownNewMoon = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));
  const daysSince = (date - knownNewMoon) / (1000 * 60 * 60 * 24);
  const anomPos = (daysSince % anomalisticMonth) / anomalisticMonth;
  const avgDist = 384400;
  const distAmplitude = 25150;
  const distance = Math.round(avgDist - distAmplitude * Math.cos(anomPos * 2 * Math.PI));

  return {
    phase: cyclePosition,
    cyclePosition,
    illumination,
    phaseName,
    emoji: phaseEmojis[phaseName] || '🌙',
    moonAge,
    nextFullMoon,
    distance,
    isWaxing: cyclePosition < 0.5,
  };
}

/**
 * Get the zodiac sign the moon is currently in.
 * @param {Date} [date=new Date()] - The date to calculate for
 * @returns {{ sign: string, element: string, quality: string }}
 */
export function getMoonZodiac(date = new Date()) {
  const knownNewMoon = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));
  const siderealMonth = 27.321661;
  const daysSince = (date - knownNewMoon) / (1000 * 60 * 60 * 24);
  const siderealPos = ((daysSince % siderealMonth) / siderealMonth + 1) % 1;
  const signs = [
    'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
    'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
  ];
  const signIndex = Math.floor(siderealPos * 12);
  return {
    sign: signs[signIndex],
    element: ['Fire', 'Earth', 'Air', 'Water'][signIndex % 4],
    quality: ['Cardinal', 'Fixed', 'Mutable'][signIndex % 3],
  };
}

/**
 * Returns a value where > 0 means moon's upper limb is above the horizon.
 * Accounts for parallax and semidiameter.
 */
function moonHorizonValue(time, lat, lon) {
  const pos = SunCalc.getMoonPosition(time, lat, lon);
  const parallax = Math.asin(EARTH_RADIUS_KM / pos.distance);
  const sd = Math.asin(MOON_RADIUS_KM / pos.distance);
  const topoAlt = pos.altitude - parallax * Math.cos(pos.altitude);
  return topoAlt + sd;
}

/**
 * Binary search to narrow a horizon crossing to ~5 second precision.
 */
function refineCrossing(t0, t1, lat, lon) {
  let a = t0.getTime();
  let b = t1.getTime();
  const va = moonHorizonValue(new Date(a), lat, lon);
  for (let i = 0; i < 20; i++) {
    const mid = (a + b) / 2;
    const vm = moonHorizonValue(new Date(mid), lat, lon);
    if ((va > 0) === (vm > 0)) {
      a = mid;
    } else {
      b = mid;
    }
  }
  return new Date((a + b) / 2);
}

/**
 * Scan a 24h window for the first moonrise and moonset.
 */
function findMoonRiseSet(startTime, lat, lon) {
  const STEP = 3 * 60 * 1000;
  const WINDOW = 24 * 60 * 60 * 1000;

  let rise = null;
  let set = null;
  let prevVal = moonHorizonValue(startTime, lat, lon);

  for (let ms = STEP; ms <= WINDOW; ms += STEP) {
    const t = new Date(startTime.getTime() + ms);
    const val = moonHorizonValue(t, lat, lon);

    if (prevVal <= 0 && val > 0 && !rise) {
      rise = refineCrossing(new Date(startTime.getTime() + ms - STEP), t, lat, lon);
    }
    if (prevVal > 0 && val <= 0 && !set) {
      set = refineCrossing(new Date(startTime.getTime() + ms - STEP), t, lat, lon);
    }

    prevVal = val;
    if (rise && set) break;
  }

  return { rise, set };
}

/**
 * Get midnight in a city's timezone, expressed as a UTC Date.
 */
function getCityDayStart(now, tz) {
  if (!tz) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const str = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).format(now);

  let [h, m, s] = str.split(':').map(Number);
  if (h === 24) h = 0;

  const citySecondsIntoDay = h * 3600 + m * 60 + (s || 0);
  return new Date(now.getTime() - citySecondsIntoDay * 1000);
}

/**
 * Format a Date in a timezone as "HH:MM".
 */
function formatTimeInZone(date, tz) {
  if (!date) return '--:--';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz || undefined,
    }).formatToParts(date);
    const h = parts.find((p) => p.type === 'hour').value;
    const m = parts.find((p) => p.type === 'minute').value;
    return `${h}:${m}`;
  } catch {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
}

/**
 * Calculate moonrise, moonset, and visibility for a location.
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {{ moonrise: string, moonset: string, moonriseDate: Date|null, moonsetDate: Date|null, isVisible: boolean, altitude: number }}
 */
export function calculateMoonTimes(lat, lon) {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const visible = isMoonVisible(now, lat, lon);

  const dayStart = getCityDayStart(now, tz);
  const yesterday = new Date(dayStart.getTime() - 24 * 3600000);
  const tomorrow = new Date(dayStart.getTime() + 24 * 3600000);

  const d1 = findMoonRiseSet(yesterday, lat, lon);
  const d2 = findMoonRiseSet(dayStart, lat, lon);
  const d3 = findMoonRiseSet(tomorrow, lat, lon);

  const allRises = [d1.rise, d2.rise, d3.rise].filter(Boolean).sort((a, b) => a - b);
  const allSets = [d1.set, d2.set, d3.set].filter(Boolean).sort((a, b) => a - b);

  const todayRise = allRises.find((r) => r >= dayStart) || allRises[allRises.length - 1];
  const todaySet = allSets.find((s) => s >= dayStart) || allSets[allSets.length - 1];

  const pos = SunCalc.getMoonPosition(now, lat, lon);
  const parallax = Math.asin(EARTH_RADIUS_KM / pos.distance);
  const altitude = pos.altitude - parallax * Math.cos(pos.altitude);

  return {
    moonrise: formatTimeInZone(todayRise, tz),
    moonset: formatTimeInZone(todaySet, tz),
    moonriseDate: todayRise || null,
    moonsetDate: todaySet || null,
    isVisible: visible,
    altitude,
  };
}

/**
 * Check if the moon is currently visible (upper limb above horizon).
 * @param {Date} time - The time to check
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {boolean}
 */
export function isMoonVisible(time, lat, lon) {
  return moonHorizonValue(time, lat, lon) > 0;
}

/**
 * Get the next moonrise at a recipient's city.
 * @param {string} cityName - Name of the city
 * @returns {{ date: Date, timeStr: string, hoursUntil: number, tz: string }|null}
 */
export function getRecipientMoonrise(cityName) {
  if (!cityName || cityName === 'Unknown') return null;
  const city = cities.find((c) => c.name.toLowerCase() === cityName.toLowerCase());
  if (!city) return null;

  const now = new Date();
  const dayStart = getCityDayStart(now, city.tz);
  const today = findMoonRiseSet(dayStart, city.lat, city.lon);

  let rise = today.rise;
  if (!rise || rise < now) {
    const tmrw = new Date(dayStart.getTime() + 24 * 3600000);
    const tomorrowData = findMoonRiseSet(tmrw, city.lat, city.lon);
    if (tomorrowData.rise) rise = tomorrowData.rise;
  }

  if (!rise) return null;

  const timeStr = formatTimeInZone(rise, city.tz);
  const hoursUntil = Math.max(0, (rise - now) / 3600000);

  return { date: rise, timeStr, hoursUntil, tz: city.tz };
}

/**
 * Convert a time to degrees on the moon ring UI.
 * Upper half (270° → 0° → 90°) = moonrise → moonset (moon-up)
 * Lower half (90° → 180° → 270°) = moonset → next moonrise (moon-down)
 * @param {Date} date - The date to convert
 * @param {{ _ringStart: Date, _ringMid: Date, _ringEnd: Date }} [ringData] - Ring boundary data
 * @returns {number} Degrees (0-360)
 */
export function timeToRingDegrees(date, ringData = {}) {
  if (!date) return 270;
  const t = date.getTime();
  const startT = ringData._ringStart ? ringData._ringStart.getTime() : t;
  const midT = ringData._ringMid ? ringData._ringMid.getTime() : t;
  const endT = ringData._ringEnd ? ringData._ringEnd.getTime() : t;

  // Upper half: ringStart (moonrise) → ringMid (moonset)
  const upDuration = midT - startT;
  if (upDuration > 0 && t >= startT && t <= midT) {
    const frac = (t - startT) / upDuration;
    return (270 + frac * 180) % 360;
  }

  // Lower half: ringMid (moonset) → ringEnd (next moonrise)
  const downDuration = endT - midT;
  if (downDuration > 0 && t >= midT && t <= endT) {
    const frac = (t - midT) / downDuration;
    return 90 + frac * 180;
  }

  // Before ringStart → clamp to moonrise (270°)
  if (t < startT) return 270;
  // After ringEnd → clamp to moonrise (270°)
  return 270;
}
