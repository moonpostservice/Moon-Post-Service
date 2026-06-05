// Moon Calculations — SunCalc + Orbit Model

// REAL MOON DATA - SunCalc (pure JS, no API)
// ============================================

// -------------------------------------------------------
// PRECISE MOONRISE / MOONSET FINDER
// 
// SunCalc.getMoonPosition() returns GEOCENTRIC altitude
// with refraction, but does NOT correct for parallax.
// The moon's parallax at the horizon is ~0.95° — without
// correcting for this, all rise/set times are wrong by
// 10+ minutes. This engine fixes that.
//
// How it works:
// 1. Get geocentric alt + refraction from SunCalc
// 2. Subtract parallax (computed from actual distance)
//    to get TOPOCENTRIC apparent altitude
// 3. Add moon's semidiameter for upper-limb rise/set
// 4. Binary search for zero-crossings = rise/set moments
// -------------------------------------------------------

const EARTH_RADIUS_KM = 6378.14;
const MOON_RADIUS_KM  = 1737.4;

// Returns a value where:
//   > 0 = moon's upper limb is above the horizon
//   < 0 = moon's upper limb is below the horizon
// This accounts for parallax and semidiameter.
function moonHorizonValue(time, lat, lon) {
    const pos = SunCalc.getMoonPosition(time, lat, lon);
    
    // Parallax from actual distance (varies ~0.89°–1.02°)
    const parallax = Math.asin(EARTH_RADIUS_KM / pos.distance);
    
    // Moon's angular semidiameter from actual distance
    const sd = Math.asin(MOON_RADIUS_KM / pos.distance);
    
    // SunCalc gives: geocentric altitude + refraction (no parallax)
    // Topocentric apparent alt = SunCalc alt - parallax × cos(altitude)
    const topoAlt = pos.altitude - parallax * Math.cos(pos.altitude);
    
    // Upper limb is above horizon when center is above -semidiameter
    return topoAlt + sd;
}

// Is the moon currently visible? (topocentric, parallax-corrected)
function isMoonVisible(time, lat, lon) {
    return moonHorizonValue(time, lat, lon) > 0;
}

// Get corrected topocentric altitude for orbit positioning
function getTopocentricAltitude(time, lat, lon) {
    const pos = SunCalc.getMoonPosition(time, lat, lon);
    const parallax = Math.asin(EARTH_RADIUS_KM / pos.distance);
    return pos.altitude - parallax * Math.cos(pos.altitude);
}

// Binary search: narrow a horizon crossing to ~5 second precision
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

// Scan a time window for the first moonrise and moonset
function findMoonRiseSet(startTime, lat, lon) {
    const STEP = 3 * 60 * 1000;          // 3 minute steps
    const WINDOW = 24 * 60 * 60 * 1000;  // 24 hours
    
    let rise = null;
    let set = null;
    let prevVal = moonHorizonValue(startTime, lat, lon);
    
    for (let ms = STEP; ms <= WINDOW; ms += STEP) {
        const t = new Date(startTime.getTime() + ms);
        const val = moonHorizonValue(t, lat, lon);
        
        if (prevVal <= 0 && val > 0 && !rise) {
            rise = refineCrossing(
                new Date(startTime.getTime() + ms - STEP), t, lat, lon
            );
        }
        if (prevVal > 0 && val <= 0 && !set) {
            set = refineCrossing(
                new Date(startTime.getTime() + ms - STEP), t, lat, lon
            );
        }
        
        prevVal = val;
        if (rise && set) break;
    }
    
    return { rise, set };
}

// Get midnight in the city's timezone, expressed as a UTC Date
function getCityDayStart(now, tz) {
    if (!tz) {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        return d;
    }
    // Format current time in the city's timezone
    // Use formatToParts to avoid locale-dependent string formats that break HH:MM:SS splitting
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    }).formatToParts(now);
    const get = type => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    let h = get('hour'), m = get('minute'), s = get('second');
    if (h === 24) h = 0; // midnight edge case

    const citySecondsIntoDay = h * 3600 + m * 60 + s;
    return new Date(now.getTime() - citySecondsIntoDay * 1000);
}

// Main: calculate moonrise, moonset, visibility, position
let _prevMoonVisible = null; // Track visibility transitions
function calculateMoonTimes(lat, lon) {
    const now = new Date();
    const tz = moonData.userTz;
    const visible = isMoonVisible(now, lat, lon);
    const visibilityChanged = _prevMoonVisible !== null && _prevMoonVisible !== visible;
    _prevMoonVisible = visible;
    moonData.isVisible = new URLSearchParams(location.search).has('moonup') ? true : visible;
    updateRouletteButtonState();

    // When moon visibility changes (rise or set), reload messages
    // so contentVisible gets recalculated for all received messages
    if (visibilityChanged && _appDataLoaded) {
        console.log('[moon] Visibility changed to', visible, '— reloading messages');
        debouncedReloadMessages();
        // When moon rises, auto-release any in_transit messages addressed to us
        if (visible) {
            autoReleaseInTransitMessages();
        }
    }
    
    // We need to find the moonrise/moonset pair that brackets
    // the CURRENT visible period, plus the next moonrise.
    //
    // If moon is UP:   find the rise before now, set after now
    // If moon is DOWN: find the set before now, rise after now
    
    // Scan backwards to find the most recent event
    // then scan forward for upcoming events
    const dayStart = getCityDayStart(now, tz);
    const yesterday = new Date(dayStart.getTime() - 24 * 3600000);
    const tomorrow = new Date(dayStart.getTime() + 24 * 3600000);
    
    // Gather all rise/set events in a 3-day window
    const d1 = findMoonRiseSet(yesterday, lat, lon);
    const d2 = findMoonRiseSet(dayStart, lat, lon);
    const d3 = findMoonRiseSet(tomorrow, lat, lon);
    
    const allRises = [d1.rise, d2.rise, d3.rise].filter(Boolean).sort((a,b) => a-b);
    const allSets  = [d1.set,  d2.set,  d3.set].filter(Boolean).sort((a,b) => a-b);
    
    let cycleRise, cycleSet, nextRise;
    
    if (visible) {
        // Moon is UP: find the most recent rise ≤ now
        cycleRise = allRises.filter(r => r <= now).pop();
        // Find the next set > now  
        cycleSet = allSets.find(s => s > now);
        // Next rise after that set
        nextRise = cycleSet ? allRises.find(r => r > cycleSet) : null;
        
        // Edge case: if no rise found before now (moon was up at start of window)
        if (!cycleRise && cycleSet) {
            // Estimate: scan further back
            const twoDaysAgo = new Date(dayStart.getTime() - 48 * 3600000);
            const d0 = findMoonRiseSet(twoDaysAgo, lat, lon);
            if (d0.rise) cycleRise = d0.rise;
            else cycleRise = new Date(now.getTime() - 6 * 3600000); // fallback
        }
    } else {
        // Moon is DOWN: find the most recent set ≤ now
        cycleSet = allSets.filter(s => s <= now).pop();
        // Find the next rise > now
        cycleRise = allRises.find(r => r > now);
        // The next set after that rise
        nextRise = cycleRise; // this IS the next rise
        
        // For the ring, we need the PREVIOUS rise/set pair too
        // so we know the full previous-up and current-down durations
        const prevRise = cycleSet ? allRises.filter(r => r < cycleSet).pop() : null;
        
        // Store for ring: the visible period was prevRise→cycleSet
        // The down period is cycleSet→cycleRise(next)
        // We'll store them differently for the ring mapping
        moonData._prevRise = prevRise;
    }
    
    // Store the cycle events
    moonData._cycleRise = cycleRise;
    moonData._cycleSet = cycleSet;
    moonData._nextRise = visible ? nextRise : cycleRise;

    // ── Normalized ring boundaries (always monotonically increasing) ──
    // _ringStart = moonrise that BEGINS this 24h cycle (past or now)
    // _ringMid   = moonset that DIVIDES upper / lower halves
    // _ringEnd   = next moonrise that CLOSES the cycle (future or now)
    if (visible) {
        moonData._ringStart = cycleRise;
        moonData._ringMid   = cycleSet;
        moonData._ringEnd   = nextRise || new Date(cycleRise.getTime() + 24 * 3600000);
    } else {
        moonData._ringStart = moonData._prevRise
            || (cycleSet ? new Date(cycleSet.getTime() - 12 * 3600000) : new Date(now.getTime() - 12 * 3600000));
        moonData._ringMid   = cycleSet || new Date(now.getTime());
        moonData._ringEnd   = cycleRise
            || (cycleSet ? new Date(cycleSet.getTime() + 12 * 3600000) : new Date(now.getTime() + 12 * 3600000));
    }
    console.log('[ring] boundaries:', moonData._ringStart, '→', moonData._ringMid, '→', moonData._ringEnd);
    
    // For display: show today's rise/set times
    // Find the rise and set most relevant to "today"
    const todayRise = allRises.find(r => r >= dayStart) || allRises[allRises.length - 1];
    const todaySet = allSets.find(s => s >= dayStart) || allSets[allSets.length - 1];
    
    if (todayRise) {
        moonData.moonrise = formatTimeInZone(todayRise, tz);
        moonData.moonriseDate = todayRise;
    }
    if (todaySet) {
        moonData.moonset = formatTimeInZone(todaySet, tz);
        moonData.moonsetDate = todaySet;
    }

    // Update the data bar below the ring to match
    const riseTimeEl = document.getElementById('moonriseTime');
    const setTimeEl = document.getElementById('moonsetTime');
    if (riseTimeEl) riseTimeEl.textContent = moonData.moonrise || '--:--';
    if (setTimeEl) setTimeEl.textContent = moonData.moonset || '--:--';
    
    // Altitude / azimuth
    const topoAlt = getTopocentricAltitude(now, lat, lon);
    moonData.altitude = topoAlt;
    moonData.azimuth = SunCalc.getMoonPosition(now, lat, lon).azimuth;
    
    // Moon position on the ring (new model)
    moonData.position = timeToRingDegrees(now);
    
    // Update everything
    updateHorizonMarkers();
    renderMessageDots();
    initCountdown();
    updateMoonPosition();
    updateOrbitCenter();
    updateMoonDisplay();
    if (typeof updateHorizonGlow === 'function') updateHorizonGlow();
}

// =============================================
// SPLIT-RING ORBIT MODEL
//
// Moonrise = 270° (left middle) — ALWAYS
// Moonset  = 90°  (right middle) — ALWAYS
//
// Upper half (270° → 0° → 90°) = moon-up period
//   stretched proportionally regardless of actual duration
// Lower half (90° → 180° → 270°) = moon-down period
//   stretched proportionally regardless of actual duration
//
// Any absolute time maps onto this ring based on which
// period it falls in and how far through that period it is.
// =============================================

// Map an absolute Date to ring degrees using normalized boundaries.
// Upper half (270° → 0° → 90°) = moonrise → moonset  (moon-up)
// Lower half (90° → 180° → 270°) = moonset → next moonrise (moon-down)
function timeToRingDegrees(date) {
    if (!date) return 270; // default to moonrise position
    const t = date.getTime();
    const startT = moonData._ringStart ? moonData._ringStart.getTime() : t;
    const midT   = moonData._ringMid   ? moonData._ringMid.getTime()   : t;
    const endT   = moonData._ringEnd   ? moonData._ringEnd.getTime()   : t;

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

// Map a delivery time (absolute Date) to ring degrees.
// Returns null only if date is missing or ring is uninitialized.
// Times outside the ring window are clamped to 269° (near moonrise marker).
function deliveryTimeToRingDegrees(date) {
    if (!date) return null;

    // Guard: if ring boundaries aren't initialized yet, show dot at bottom as placeholder
    if (!moonData._ringStart || !moonData._ringMid || !moonData._ringEnd) {
        if (window.__DEBUG_DOTS) console.log('Dots: ring not initialized, placing dot at 180°');
        return 180;
    }

    const t = date.getTime();
    const startT = moonData._ringStart.getTime();
    const midT   = moonData._ringMid.getTime();
    const endT   = moonData._ringEnd.getTime();

    // Before the ring starts → clamp near moonrise (message is very far future)
    if (t < startT) return 269;

    // Past ring end → clamp near moonrise (delivery is after the cycle shown on ring)
    // No hard cutoff — the caller's 24h filter handles truly stale dots
    if (t > endT) return 269;

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

    // Fallback: place at bottom of ring
    return 180;
}

// Position a marker element at a given degree and set its time
function positionMarker(el, deg, timeText) {
    if (deg === null) return;
    el.style.transform = `rotate(${deg}deg)`;
    const label = el.querySelector('.horizon-label');
    const timeEl = el.querySelector('.horizon-time');
    if (timeEl) {
        timeEl.textContent = timeText;
    }
    if (label) {
        label.style.transform = `translateX(-50%) rotate(${-deg}deg)`;
    }
}

// Moonrise always at 270°, moonset always at 90°
function updateHorizonMarkers() {
    const riseMarker = document.getElementById('moonriseMarker');
    const setMarker = document.getElementById('moonsetMarker');
    
    positionMarker(riseMarker, 270, moonData.moonrise);
    positionMarker(setMarker, 90, moonData.moonset);
}

// Demo messages — each has a recipient city.
// Moonrise at recipient location = delivery time.
// Calculate moonrise at a given city
function getRecipientMoonrise(cityName) {
    if (!cityName || cityName === 'Unknown') return null;
    const city = cities.find(c => c.name.toLowerCase() === cityName.toLowerCase());
    if (!city) return null;
    
    const now = new Date();
    const dayStart = getCityDayStart(now, city.tz);
    const today = findMoonRiseSet(dayStart, city.lat, city.lon);
    
    let rise = today.rise;
    if (!rise || rise < now) {
        const tmrw = new Date(dayStart.getTime() + 24 * 3600000);
        const tomorrow = findMoonRiseSet(tmrw, city.lat, city.lon);
        if (tomorrow.rise) rise = tomorrow.rise;
    }
    
    if (!rise) return null;
    
    const timeStr = formatTimeInZone(rise, city.tz);
    const hoursUntil = Math.max(0, (rise - now) / 3600000);
    
    return { date: rise, timeStr, hoursUntil, tz: city.tz };
}

// Calculate moon status for a contact's city (for transit bar)
function getContactMoonStatus(cityName) {
    if (!cityName || cityName === 'Unknown') return null;
    const city = cities.find(c => c.name.toLowerCase() === cityName.toLowerCase());
    if (!city) return null;

    const now = new Date();
    const isUp = isMoonVisible(now, city.lat, city.lon);

    if (isUp) {
        // Moon is in their sky - find when it sets
        const dayStart = getCityDayStart(now, city.tz);
        const today = findMoonRiseSet(dayStart, city.lat, city.lon);
        let setTime = today.set;
        if (!setTime || setTime < now) {
            const tmrw = new Date(dayStart.getTime() + 24 * 3600000);
            const tomorrow = findMoonRiseSet(tmrw, city.lat, city.lon);
            if (tomorrow.set) setTime = tomorrow.set;
        }
        const hoursUntilSet = setTime ? Math.max(0, (setTime - now) / 3600000) : 0;
        return { isUp: true, hoursUntilRise: 0, hoursUntilSet, progress: 1.0 };
    }

    // Moon is down - calculate progress toward moonrise
    const recipientMoonrise = getRecipientMoonrise(cityName);
    if (!recipientMoonrise) return { isUp: false, hoursUntilRise: 24, hoursUntilSet: 0, progress: 0 };

    const hoursUntilRise = recipientMoonrise.hoursUntil;
    // Estimate down period as ~12h for progress calculation
    const estimatedDownHours = 14;
    const elapsed = Math.max(0, estimatedDownHours - hoursUntilRise);
    const progress = Math.min(1, Math.max(0, elapsed / estimatedDownHours));

    return { isUp: false, hoursUntilRise, hoursUntilSet: 0, progress };
}

// Auto-release: when the local user's moon rises, mark received messages
// as viewable client-side. No DB updates needed — the contentVisible logic
// in loadMessages() already checks moonData.isVisible + release_at timing.
// The sender's release_at ensures messages aren't visible before moonrise.
async function autoReleaseInTransitMessages() {
    if (!currentAuthUser) return;
    const now = new Date().toISOString();
    console.log('[autoRelease] Moon is up — releasing in_transit messages and updating release_at');

    try {
        // Release messages where I am the recipient — set BOTH status AND release_at to now
        // Setting release_at to now prevents the "release_at > now" check from re-flagging them
        const { data: r1 } = await sb.from('messages')
            .update({ status: 'released', released_at: now, release_at: now })
            .eq('recipient_id', currentAuthUser.id)
            .eq('status', 'in_transit')
            .select('id');
        if (r1?.length) console.log('[autoRelease] Released', r1.length, 'messages by ID');

        // Also by email
        if (currentAuthUser.email) {
            const { data: r2 } = await sb.from('messages')
                .update({ status: 'released', released_at: now, release_at: now })
                .eq('recipient_email', currentAuthUser.email)
                .eq('status', 'in_transit')
                .select('id');
            if (r2?.length) console.log('[autoRelease] Released', r2.length, 'messages by email');
        }

        // Release in_transit replies on messages addressed to me
        // IMPORTANT: only release replies sent BY OTHERS to me, not replies I sent to others
        const { data: myMsgs } = await sb.from('messages')
            .select('id')
            .or(`recipient_id.eq.${currentAuthUser.id}${currentAuthUser.email ? `,recipient_email.eq.${currentAuthUser.email}` : ''}`);
        if (myMsgs?.length) {
            const ids = myMsgs.map(m => m.id);
            const { data: r3 } = await sb.from('replies')
                .update({ status: 'released', release_at: now })
                .in('message_id', ids)
                .eq('status', 'in_transit')
                .neq('sender_id', currentAuthUser.id)
                .select('id');
            if (r3?.length) console.log('[autoRelease] Released', r3.length, 'replies');
        }
    } catch (err) {
        console.error('[autoRelease] Error:', err);
    }

    // Reload to get fresh data
    if (typeof loadMessages === 'function') {
        await loadMessages();
        renderMessages();
        renderMessageDots();
    }
}

// Build and position all message dots on the ring
// Dots represent messages in transit (sent messages going to recipients)
function renderMessageDots() {
    const container = document.getElementById('messageDots');
    if (!container) return;
    container.innerHTML = '';

    // Remove old diagnostic panel if it exists
    const oldDiag = document.getElementById('dotDiag');
    if (oldDiag) oldDiag.remove();

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600000);

    // Count ALL sent messages for diagnostics
    const allSent = messages.filter(m => m.type === 'sent');
    const sentWithRelease = allSent.filter(m => m.releaseAt);
    const sentWithFutureRelease = allSent.filter(m => m.releaseAt && new Date(m.releaseAt) > now);
    const sentInTransitStatus = allSent.filter(m => m.status === 'In Transit');

    // Get messages in transit: use releaseAt as source of truth (not status field)
    const inTransitMessages = messages.filter(m => {
        if (m.type !== 'sent') return false;
        if (m.releaseAt && new Date(m.releaseAt) > now) return true;
        if (m.status === 'In Transit' && !m.releaseAt) return true;
        return false;
    });

    // Update diagnostic display — show ALL sent messages for debugging
    const lastSend = window._lastSendDiag || null;
    let sentDetail = allSent.map(m => {
        const moonStatus = getContactMoonStatus(m.location);
        const moonStr = moonStatus ? (moonStatus.isUp ? '🟢moon UP' : `🔴moon DOWN (${moonStatus.hoursUntilRise?.toFixed(1)}h)`) : '⚪no city data';
        return `  <b>${m.sender}</b> @ ${m.location}<br>` +
            `    releaseAt: ${m.releaseAt || 'NULL'}<br>` +
            `    status: ${m.status} | ${moonStr}`;
    }).join('<br>');
    if (allSent.length === 0) sentDetail = '<i>no sent messages</i>';

    // Diagnostic info logged to console only (no visible panel)
    if (window.__DEBUG_DOTS) console.log('[dots] moon:', moonData.isVisible ? 'UP' : 'DOWN', '| msgs:', messages.length, '| sent:', allSent.length, '| qualifying:', inTransitMessages.length);

    // NOTE: We no longer skip rendering when moon is down.
    // CSS handles reduced opacity via body.moon-down .message-dot { opacity: 0.35 }
    // This ensures dots are always rendered — the ONLY gate is message data.

    let dotsRendered = 0;
    inTransitMessages.forEach((msg) => {
        if (msg.releaseAt && new Date(msg.releaseAt) <= now) return;
        if (msg.createdAt && new Date(msg.createdAt) < twentyFourHoursAgo) return;

        let deliveryDate = msg.releaseAt ? new Date(msg.releaseAt) : null;
        let hoursUntil = deliveryDate ? Math.max(0, (deliveryDate - now) / 3600000) : null;
        let timeStr = '';

        if (!deliveryDate) {
            const info = getRecipientMoonrise(msg.location);
            if (info) {
                deliveryDate = info.date;
                hoursUntil = info.hoursUntil;
                timeStr = info.timeStr;
            }
        } else {
            timeStr = deliveryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        if (!deliveryDate) return;

        const deg = deliveryTimeToRingDegrees(deliveryDate);
        if (deg === null) return;

        const isReleasing = hoursUntil !== null && hoursUntil < 2;

        // METHOD 1: Standard orbit rotation
        const orbit = document.createElement('div');
        orbit.className = 'dot-orbit';
        orbit.style.transform = `rotate(${deg}deg)`;
        const dot = document.createElement('div');
        dot.className = 'message-dot' + (isReleasing ? ' releasing' : '');
        dot.dataset.to = msg.sender;
        dot.dataset.location = msg.location;
        dot.dataset.release = timeStr;
        dot.dataset.hours = (hoursUntil || 0).toFixed(1);
        dot.style.pointerEvents = 'auto';
        // Direct tap handler (bypasses parent pointer-events:none on mobile)
        dot.ontouchend = function(e) {
            e.stopPropagation();
            const name = this.dataset.to;
            if (!name) return;
            const conv = conversations.find(c => c.otherName === name);
            if (conv) openConversation(conv);
        };
        orbit.appendChild(dot);
        container.appendChild(orbit);

        dotsRendered++;
    });

    // Update diagnostic with render count
    if (window.__DEBUG_DOTS) console.log('[dots] rendered:', dotsRendered, 'dots');

    // Incoming messages genuinely in transit (not just "moon is down" — use stillInTransit flag)
    // Don't require releaseAt — we can calculate the dot position from our own moonrise
    const incomingMessages = messages.filter(m => m.type === 'received' && m.stillInTransit);
    if (window.__DEBUG_DOTS && incomingMessages.length > 0) console.log('Dots: incoming messages:', incomingMessages.length);

    incomingMessages.forEach((msg) => {
        // Skip if releaseAt has passed (already revealed)
        const releaseDate = msg.releaseAt ? new Date(msg.releaseAt) : null;
        if (releaseDate && releaseDate <= now) {
            if (window.__DEBUG_DOTS) console.log('Dots: skipping revealed incoming from', msg.sender, '(releaseAt passed)');
            return;
        }
        // 24-hour age filter
        if (msg.createdAt && new Date(msg.createdAt) < twentyFourHoursAgo) {
            if (window.__DEBUG_DOTS) console.log('Dots: skipping old incoming from', msg.sender, '(>24h)');
            return;
        }
        // Use releaseDate for position if available, otherwise use our own moonrise
        const dotDate = releaseDate || (moonData._ringEnd ? moonData._ringEnd : null);
        const deg = dotDate ? deliveryTimeToRingDegrees(dotDate) : 269;
        // Null-degree guard
        if (deg === null) {
            if (window.__DEBUG_DOTS) console.log('Dots: incoming from', msg.sender, 'outside ring window — skipping');
            return;
        }

        const hoursUntil = releaseDate ? Math.max(0, (releaseDate - now) / 3600000) : 12;
        const isNear = hoursUntil < 2;

        const riseTimeStr = moonData.moonrise || '--:--';

        if (window.__DEBUG_DOTS) console.log('Dots: incoming dot from', msg.sender, 'at', deg.toFixed(1), '°, hours until:', hoursUntil.toFixed(1));

        const orbit = document.createElement('div');
        orbit.className = 'dot-orbit';
        orbit.style.transform = `rotate(${deg}deg)`;

        const dot = document.createElement('div');
        dot.className = 'message-dot incoming' + (isNear ? ' releasing' : '');
        dot.dataset.from = msg.sender;
        dot.dataset.release = riseTimeStr;
        dot.dataset.hours = hoursUntil.toFixed(1);
        dot.dataset.incoming = 'true';
        dot.style.pointerEvents = 'auto';
        // Direct tap handler (bypasses parent pointer-events:none on mobile)
        dot.ontouchend = function(e) {
            e.stopPropagation();
            const name = this.dataset.from;
            if (!name) return;
            const conv = conversations.find(c => c.otherName === name);
            if (conv) openConversation(conv);
        };

        orbit.appendChild(dot);
        container.appendChild(orbit);
    });

    // Roulette sent messages in transit — show as anonymous outgoing dots
    const rouletteSent = (typeof rouletteMessages !== 'undefined' ? rouletteMessages.sent : [])
        .filter(m => m.status === 'queued');

    rouletteSent.forEach(msg => {
        const deliveryDate = msg.release_at ? new Date(msg.release_at) : null;
        const hasTime = deliveryDate && deliveryDate > now;
        const deg = hasTime ? deliveryTimeToRingDegrees(deliveryDate) : 270;
        if (deg === null) return;

        const hoursUntil = hasTime ? Math.max(0, (deliveryDate - now) / 3600000) : 0;
        const timeStr = hasTime ? deliveryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
        const isReleasing = hasTime && hoursUntil < 2;

        const orbit = document.createElement('div');
        orbit.className = 'dot-orbit';
        orbit.style.transform = `rotate(${deg}deg)`;
        const dot = document.createElement('div');
        dot.className = 'message-dot roulette-dot' + (isReleasing ? ' releasing' : '');
        dot.dataset.to = 'A Stranger';
        dot.dataset.location = msg.recipient_city ?? 'the world';
        dot.dataset.release = timeStr;
        dot.dataset.hours = hoursUntil.toFixed(1);
        dot.dataset.roulette = 'true';
        dot.style.pointerEvents = 'auto';
        orbit.appendChild(dot);
        container.appendChild(orbit);
        dotsRendered++;
    });

    // Update stats display
    updateMessageStats();

    attachDotTooltips();
}

// Update the message counts (stats line removed, keeping function for orbit dot count)
function updateMessageStats() {
    // Stats display removed - function kept for compatibility
}

// Attach tooltip + click handlers to all current message dots
function attachDotTooltips() {
    const dotTooltip = document.getElementById('dotTooltip');
    if (!dotTooltip) return;

    document.querySelectorAll('.message-dot').forEach(dot => {
        dot.addEventListener('mouseenter', (e) => {
            const isIncoming = dot.dataset.incoming === 'true';
            const release = dot.dataset.release || 'moonrise';
            const hours = parseFloat(dot.dataset.hours) || 0;

            let eta = '';
            if (hours < 1) {
                const mins = Math.round(hours * 60);
                eta = mins <= 1 ? 'arriving soon' : `arriving in ${mins}m`;
            } else {
                eta = `arriving in ${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;
            }

            // Calculate transit progress (estimate: assume 12h max transit)
            const maxTransit = 12;
            const elapsed = maxTransit - hours;
            const progress = Math.min(100, Math.max(5, (elapsed / maxTransit) * 100));

            const progressFill = dotTooltip.querySelector('.tooltip-progress-fill');

            if (isIncoming) {
                const from = dot.dataset.from || 'Someone';
                dotTooltip.querySelector('.tooltip-name').textContent = `From ${from}`;
                dotTooltip.querySelector('.tooltip-meta').textContent = `Moonrise ${release} · ${eta}`;
                dotTooltip.querySelector('.tooltip-phase').textContent = '↓ Incoming';
                progressFill.className = 'tooltip-progress-fill';
            } else if (dot.dataset.roulette === 'true') {
                const location = dot.dataset.location || 'the world';
                dotTooltip.querySelector('.tooltip-name').textContent = `Moon Roulette`;
                dotTooltip.querySelector('.tooltip-meta').textContent = `🌕 To a stranger in ${location} · ${eta}`;
                dotTooltip.querySelector('.tooltip-phase').textContent = '↑ Anonymous';
                progressFill.className = 'tooltip-progress-fill';
            } else {
                const to = dot.dataset.to || 'Someone';
                const location = dot.dataset.location || '';
                dotTooltip.querySelector('.tooltip-name').textContent = `To ${to}`;
                dotTooltip.querySelector('.tooltip-meta').textContent = location ? `📍 ${location} · ${release} · ${eta}` : `${release} · ${eta}`;
                dotTooltip.querySelector('.tooltip-phase').textContent = '↑ Outgoing';
                progressFill.className = 'tooltip-progress-fill outgoing';
            }
            progressFill.style.width = progress + '%';
            dotTooltip.classList.add('visible');
        });

        dot.addEventListener('mousemove', (e) => {
            dotTooltip.style.left = (e.clientX + 15) + 'px';
            dotTooltip.style.top = (e.clientY - 10) + 'px';
        });

        dot.addEventListener('mouseleave', () => {
            dotTooltip.classList.remove('visible');
        });

        // Click: open conversation directly
        dot.addEventListener('click', () => {
            dotTooltip.classList.remove('visible');
            const isIncoming = dot.dataset.incoming === 'true';
            const name = isIncoming ? dot.dataset.from : dot.dataset.to;
            if (!name) return;
            const conv = conversations.find(c => c.otherName === name);
            if (conv) openConversation(conv);
        });
    });
}

// Moon phase popup — show on moon icon click
function initMoonPhasePopup() {
    const moonIcon = document.getElementById('orbitMoonIcon');
    const popup = document.getElementById('moonPhasePopup');
    if (!moonIcon || !popup) return;

    moonIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popup.classList.contains('visible')) {
            popup.classList.remove('visible');
            return;
        }

        // Get phase data from SunCalc
        const now = new Date();
        const illum = SunCalc.getMoonIllumination(now);

        // Phase name + emoji
        const phaseAngle = illum.phase;
        let phaseName, phaseEmoji;
        if (phaseAngle < 0.03 || phaseAngle > 0.97) { phaseName = 'New Moon'; phaseEmoji = '🌑'; }
        else if (phaseAngle < 0.22) { phaseName = 'Waxing Crescent'; phaseEmoji = '🌒'; }
        else if (phaseAngle < 0.28) { phaseName = 'First Quarter'; phaseEmoji = '🌓'; }
        else if (phaseAngle < 0.47) { phaseName = 'Waxing Gibbous'; phaseEmoji = '🌔'; }
        else if (phaseAngle < 0.53) { phaseName = 'Full Moon'; phaseEmoji = '🌕'; }
        else if (phaseAngle < 0.72) { phaseName = 'Waning Gibbous'; phaseEmoji = '🌖'; }
        else if (phaseAngle < 0.78) { phaseName = 'Last Quarter'; phaseEmoji = '🌗'; }
        else { phaseName = 'Waning Crescent'; phaseEmoji = '🌘'; }

        document.getElementById('moonPhaseEmoji').textContent = phaseEmoji;
        document.getElementById('moonPhaseName').textContent = phaseName;

        // Stats
        const illumination = Math.round(illum.fraction * 100);
        const altitude = moonData.altitude !== undefined ? moonData.altitude.toFixed(1) + '°' : '—';
        // Pull distance & age from phase data or data bar
        const phase = moonData.phase || {};
        const distance = phase.distance ? Math.round(phase.distance).toLocaleString() + ' km' : (document.getElementById('moonDistanceBar')?.textContent || '—');
        const age = phase.moonAge !== undefined ? phase.moonAge + ' days' : (phaseAngle * 29.53).toFixed(1) + ' days';

        document.getElementById('moonPhaseStats').innerHTML = `
            <div class="moon-phase-stat"><span class="moon-phase-stat-label">Illumination</span><span class="moon-phase-stat-value">${illumination}%</span></div>
            <div class="moon-phase-stat"><span class="moon-phase-stat-label">Altitude</span><span class="moon-phase-stat-value">${altitude}</span></div>
            <div class="moon-phase-stat"><span class="moon-phase-stat-label">Distance</span><span class="moon-phase-stat-value">${distance}</span></div>
            <div class="moon-phase-stat"><span class="moon-phase-stat-label">Age</span><span class="moon-phase-stat-value">${age}</span></div>
        `;

        // Position popup near the moon icon, clamped to viewport
        const rect = moonIcon.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - 110;
        left = Math.max(16, Math.min(left, window.innerWidth - 230));
        popup.style.left = left + 'px';
        popup.style.top = (rect.bottom + 12) + 'px';

        popup.classList.add('visible');
    });

    // Dismiss on click-outside
    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && !moonIcon.contains(e.target)) {
            popup.classList.remove('visible');
        }
    });
}

// Format a Date in the selected city's timezone as "HH:MM"
function formatTimeInZone(date, tz) {
    if (!date) return '--:--';
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: tz || undefined
        }).formatToParts(date);
        const h = parts.find(p => p.type === 'hour').value;
        const m = parts.find(p => p.type === 'minute').value;
        return `${h}:${m}`;
    } catch (e) {
        const h = date.getHours().toString().padStart(2, '0');
        const m = date.getMinutes().toString().padStart(2, '0');
        return `${h}:${m}`;
    }
}

// Called after location is obtained (geolocation or city selection)
// Update the location display in header and dropdown
function updateLocationDisplay(cityName, countryName) {
    const headerEl = document.getElementById('userLocation');
    const locSummary = document.getElementById('sectionLocationSummary');

    if (headerEl) headerEl.textContent = cityName;
    if (locSummary) {
        locSummary.textContent = countryName ? `${cityName}, ${countryName}` : cityName;
    }
}

function updateRouletteButtonState() {
    const btn = document.querySelector('.new-roulette-btn');
    if (!btn) return;
    const up = moonData.isVisible;
    btn.disabled = !up;
    btn.title = up
        ? 'Send a Moon Roulette message'
        : 'Moon Roulette is only available when the moon is in your sky';
}

function onLocationObtained(lat, lon, tz) {
    moonData.userLat = lat;
    moonData.userLon = lon;
    if (tz) moonData.userTz = tz;
    calculateMoonTimes(lat, lon);

    // Recalculate every 60 seconds
    if (moonData._refreshInterval) clearInterval(moonData._refreshInterval);
    moonData._refreshInterval = setInterval(() => {
        calculateMoonTimes(lat, lon);
    }, 60000);

    // When location changes and moon is visible, release in-transit messages
    // and reload to recompute transit counts for the new location
    if (moonData.isVisible && _appDataLoaded) {
        console.log('[location] Moon is visible at new location — releasing in-transit messages');
        autoReleaseInTransitMessages();
        debouncedReloadMessages();
    }
}

// Initialize countdown based on moonset time (when visible)
function initCountdown() {
    const now = new Date();
    
    // If SunCalc gave us real Date objects, use them directly
    if (moonData.isVisible && moonData.moonsetDate) {
        moonData.countdownTarget = moonData.moonsetDate;
    } else if (!moonData.isVisible && moonData.moonriseDate) {
        moonData.countdownTarget = moonData.moonriseDate;
    } else {
        // Fallback: parse HH:MM strings (skip if no real data yet)
        const timeStr = moonData.isVisible ? moonData.moonset : moonData.moonrise;
        if (!timeStr || timeStr === '--:--') {
            moonData.countdownTarget = new Date(now.getTime() + 86400000); // fallback: 24h
            return;
        }
        const [hours, minutes] = timeStr.split(':').map(Number);
        moonData.countdownTarget = new Date(now);
        moonData.countdownTarget.setHours(hours, minutes, 0, 0);
    }
    
    // If target time has passed, search forward for the next event
    if (moonData.countdownTarget <= now) {
        if (moonData.userLat != null) {
            // Scan from now for the next rise or set
            const next = findMoonRiseSet(now, moonData.userLat, moonData.userLon);
            if (!moonData.isVisible && next.rise) {
                moonData.countdownTarget = next.rise;
            } else if (moonData.isVisible && next.set) {
                moonData.countdownTarget = next.set;
            } else {
                moonData.countdownTarget = new Date(now.getTime() + 86400000);
            }
        } else {
            moonData.countdownTarget = new Date(now.getTime() + 86400000);
        }
    }
}

// Get remaining time
function getCountdown() {
    const now = new Date();
    const diff = moonData.countdownTarget - now;
    
    if (diff <= 0) {
        return { hours: 0, minutes: 0, seconds: 0 };
    }
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    return { hours, minutes, seconds };
}


// Dual export: stays a browser global (non-module <script>), and also exposes
// the pure, dependency-free time helpers for unit testing in plain Node.
// Only safe-to-isolate functions are exported here; functions that depend on
// SunCalc or the DOM are intentionally left out.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getCityDayStart, formatTimeInZone };
}


// ============================================
