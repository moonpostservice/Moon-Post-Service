// Email Notifications via Supabase Edge Function

// ============================================
// EMAIL NOTIFICATIONS via Supabase Edge Function (Resend)
// ============================================

// Send message notification email to recipient
async function sendMoonPostEmail(recipientEmail, recipientLocation, messageText, senderName, dbMessageId) {
    senderName = senderName || localStorage.getItem('moonpop_username') || 'Someone on Moon Post Service';

    // Calculate moonrise at recipient's location
    const city = cities.find(c => c.name === recipientLocation);
    let moonriseTime = 'your next moonrise';
    if (city) {
        const info = getRecipientMoonrise(city.name);
        if (info && info.timeStr) {
            moonriseTime = info.timeStr;
        }
    }

    // Get first 3 words for preview
    const words = (messageText || '').trim().split(/\s+/);
    const preview = words.slice(0, 3).join(' ');

    const messageId = dbMessageId || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5));
    const revealLink = window.location.origin + '?m=' + messageId;

    try {
        const { data, error } = await sb.functions.invoke('send-email', {
            body: {
                type: 'message',
                recipientEmail,
                senderName,
                recipientLocation,
                moonriseTime,
                messagePreview: preview,
                revealLink
            }
        });
        if (error) throw error;
        console.log('Email sent via Edge Function:', data);
        return true;
    } catch (error) {
        console.error('Failed to send email:', error);
        return false;
    }
}

// Moon Phase Calculation (real astronomical calculation)
function getMoonPhase(date = new Date()) {
    // Use SunCalc for accurate moon phase data
    const illum = SunCalc.getMoonIllumination(date);
    // illum.phase: 0.0–1.0 (0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter)
    // illum.fraction: 0.0–1.0 (illuminated fraction)
    // illum.angle: midpoint angle of illuminated limb
    const cyclePosition = illum.phase;
    const illumination = illum.fraction;

    // Moon age in days (synodic month ≈ 29.53 days)
    const synodicMonth = 29.53058867;
    const moonAge = Math.floor(cyclePosition * synodicMonth);

    // Determine phase name from SunCalc's accurate phase value
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

    // Calculate next full moon
    let daysToFull = (0.5 - cyclePosition) * synodicMonth;
    if (daysToFull < 0) daysToFull += synodicMonth;
    const nextFullMoon = new Date(date.getTime() + daysToFull * 24 * 60 * 60 * 1000);

    // Moon distance approximation (perigee 356500, apogee 406700)
    const anomalisticMonth = 27.55455;
    const knownNewMoon = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));
    const daysSince = (date - knownNewMoon) / (1000 * 60 * 60 * 24);
    const anomPos = (daysSince % anomalisticMonth) / anomalisticMonth;
    const avgDist = 384400;
    const distAmplitude = 25150;
    const distance = Math.round(avgDist - distAmplitude * Math.cos(anomPos * 2 * Math.PI));

    return {
        cyclePosition,
        illumination,
        phaseName,
        moonAge,
        nextFullMoon,
        distance,
        isWaxing: cyclePosition < 0.5
    };
}

function getMoonZodiac(date = new Date()) {
    // The moon completes the zodiac in one sidereal month (~27.32 days)
    // Known reference: Moon was at 0° Aries (vernal equinox) on Jan 6, 2000
    const knownNewMoon = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));
    const siderealMonth = 27.321661;
    const daysSince = (date - knownNewMoon) / (1000 * 60 * 60 * 24);
    const siderealPos = ((daysSince % siderealMonth) / siderealMonth + 1) % 1; // 0-1
    const signs = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
    const signIndex = Math.floor(siderealPos * 12);
    return {
        sign: signs[signIndex],
        element: ['Fire','Earth','Air','Water'][signIndex % 4],
        quality: ['Cardinal','Fixed','Mutable'][signIndex % 3]
    };
}

// Draw moon phase SVG - fixed clipPath ID collision
function drawMoonPhase(svgElement, phase, bgColor = '#FDF6E3') {
    const illumination = phase.illumination;
    const isWaxing = phase.isWaxing;
    
    // Generate unique ID to avoid collisions
    const clipId = 'moonClip_' + Math.random().toString(16).slice(2);
    
    // Clear existing
    svgElement.innerHTML = '';
    
    // Create moon circle (the illuminated part will be bg color, shadow will be bg-ish)
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clipPath.setAttribute('id', clipId);
    const clipCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    clipCircle.setAttribute('cx', '50');
    clipCircle.setAttribute('cy', '50');
    clipCircle.setAttribute('r', '45');
    clipPath.appendChild(clipCircle);
    defs.appendChild(clipPath);
    svgElement.appendChild(defs);
    
    // Background circle (dark side of moon)
    const darkSide = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    darkSide.setAttribute('cx', '50');
    darkSide.setAttribute('cy', '50');
    darkSide.setAttribute('r', '45');
    darkSide.setAttribute('fill', 'rgba(253, 246, 227, 0.3)'); // faded bg color for shadow
    svgElement.appendChild(darkSide);
    
    // Illuminated part
    if (illumination > 0.01) {
        const lit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        // Calculate the terminator curve
        const r = 45;
        const cx = 50;
        const cy = 50;
        
        let d;
        
        if (illumination >= 0.99) {
            // Full moon - just a circle
            d = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r}`;
        } else {
            // Calculate terminator curve
            const terminatorX = Math.abs(1 - 2 * illumination) * r;
            const sweep = illumination > 0.5 ? 1 : 0;
            
            if (isWaxing) {
                // Light on right side
                d = `M ${cx} ${cy - r} ` +
                    `A ${r} ${r} 0 0 1 ${cx} ${cy + r} ` +
                    `A ${terminatorX} ${r} 0 0 ${sweep} ${cx} ${cy - r}`;
            } else {
                // Light on left side
                d = `M ${cx} ${cy - r} ` +
                    `A ${r} ${r} 0 0 0 ${cx} ${cy + r} ` +
                    `A ${terminatorX} ${r} 0 0 ${1-sweep} ${cx} ${cy - r}`;
            }
        }
        
        lit.setAttribute('d', d);
        lit.setAttribute('fill', bgColor);
        lit.setAttribute('clip-path', `url(#${clipId})`);
        svgElement.appendChild(lit);
    }
}

// Moon phase SVG icons (inline, from /moon phases/*.svg)
const MOON_PHASE_SVGS = {
    'New Moon': '<svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M30 0C46.5685 0 60 13.4315 60 30C60 46.5685 46.5685 60 30 60C13.4315 60 0 46.5685 0 30C0 13.4315 13.4315 0 30 0Z" fill="#4fc3f7"/></svg>',
    'Waxing Crescent': '<svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M30 0C46.5685 0 60 13.4315 60 30C60 46.5685 46.5685 60 30 60C13.4315 60 0 46.5685 0 30C0 13.4315 13.4315 0 30 0ZM33.8838 14.0244C33.4209 13.9076 32.9627 14.2224 32.7773 14.5469C32.5537 14.9383 32.6251 15.3787 32.9268 15.7354C34.0723 17.0901 34.8115 18.6624 35.2002 20.3838C36.0645 24.2035 34.9348 28.1679 32.1885 30.9834C29.4817 33.7578 25.5076 35.0844 21.5645 34.4805C19.3641 34.1436 17.3781 33.1939 15.6738 31.833C15.3746 31.5943 14.9778 31.5853 14.6211 31.6885C14.3169 31.7768 14.1327 32.0503 14.001 32.3672V32.7861C15.1543 37.2821 18.0658 41.0484 22.3184 43.2051C28.9939 46.591 37.1771 45.0872 42.0947 39.5137C44.4065 36.8946 45.7953 33.5964 45.9756 30.1035C46.0012 29.6101 46.0121 29.1501 45.9814 28.6592L45.9463 28.0947C45.5371 21.4967 40.4917 15.7 33.8838 14.0244Z" fill="#4fc3f7"/></svg>',
    'First Quarter': '<svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M30 0C46.5685 0 60 13.4315 60 30C60 46.5685 46.5685 60 30 60C13.4315 60 0 46.5685 0 30C0 13.4315 13.4315 0 30 0ZM29.5 47C39.165 47 47 39.165 47 29.5C47 19.835 39.165 12 29.5 12V47Z" fill="#4fc3f7"/></svg>',
    'Waxing Gibbous': '<svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M30 0C46.5685 0 60 13.4315 60 30C60 46.5685 46.5685 60 30 60C13.4315 60 0 46.5685 0 30C0 13.4315 13.4315 0 30 0ZM29.5 12C25.0159 12 21.514 17.4999 20.5 19C19.486 20.5 17.5465 25.0919 17.5 29.5C17.4535 33.9081 18.4995 39.2387 20.25 41.5C22.0005 43.7613 25.2973 47 29.5 47C39.165 47 47 39.165 47 29.5C47 19.835 39.165 12 29.5 12Z" fill="#4fc3f7"/></svg>',
    'Full Moon': '<svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg"><mask id="fm-mask" fill="white"><path d="M30 0C46.5685 0 60 13.4315 60 30C60 46.5685 46.5685 60 30 60C13.4315 60 0 46.5685 0 30C0 13.4315 13.4315 0 30 0Z"/></mask><path d="M30 0V13C39.3888 13 47 20.6112 47 30H60H73C73 6.25176 53.7482 -13 30 -13V0ZM60 30H47C47 39.3888 39.3888 47 30 47V60V73C53.7482 73 73 53.7482 73 30H60ZM30 60V47C20.6112 47 13 39.3888 13 30H0H-13C-13 53.7482 6.25176 73 30 73V60ZM0 30H13C13 20.6112 20.6112 13 30 13V0V-13C6.25176 -13 -13 6.25176 -13 30H0Z" fill="#4fc3f7" mask="url(#fm-mask)"/></svg>',
    'Waning Gibbous': '<svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M30 60C13.4315 60 1.17422e-06 46.5685 2.62268e-06 30C4.07115e-06 13.4315 13.4315 -4.07115e-06 30 -2.62268e-06C46.5685 -1.17422e-06 60 13.4315 60 30C60 46.5685 46.5685 60 30 60ZM30.5 48C34.9841 48 38.486 42.5001 39.5 41C40.514 39.5 42.4535 34.9081 42.5 30.5C42.5465 26.0919 41.5005 20.7613 39.75 18.5C37.9995 16.2387 34.7027 13 30.5 13C20.835 13 13 20.835 13 30.5C13 40.165 20.835 48 30.5 48Z" fill="#4fc3f7"/></svg>',
    'Last Quarter': '<svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M30 60C13.4315 60 1.17422e-06 46.5685 2.62268e-06 30C4.07115e-06 13.4315 13.4315 -4.07115e-06 30 -2.62268e-06C46.5685 -1.17422e-06 60 13.4315 60 30C60 46.5685 46.5685 60 30 60ZM30.5 13C20.835 13 13 20.835 13 30.5C13 40.165 20.835 48 30.5 48L30.5 13Z" fill="#4fc3f7"/></svg>',
    'Waning Crescent': '<svg viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M30 0C46.5685 0 60 13.4315 60 30C60 46.5685 46.5685 60 30 60C13.4315 60 0 46.5685 0 30C0 13.4315 13.4315 0 30 0ZM27.2236 14.5469C27.0383 14.2226 26.5808 13.9079 26.1182 14.0244C19.5103 15.7 14.4648 21.4967 14.0557 28.0947L14.0195 28.6592C13.9889 29.1501 14.0008 29.6101 14.0264 30.1035C14.2067 33.5964 15.5945 36.8946 17.9062 39.5137C22.8238 45.0873 31.007 46.5909 37.6826 43.2051C41.9352 41.0485 44.8466 37.2821 46 32.7861V32.3672C45.8683 32.0502 45.6842 31.7767 45.3799 31.6885C45.0232 31.5854 44.6273 31.5944 44.3281 31.833C42.6238 33.1941 40.6379 34.1436 38.4375 34.4805C34.4943 35.0846 30.5203 33.7578 27.8135 30.9834C25.067 28.1679 23.9364 24.2036 24.8008 20.3838C25.1895 18.6624 25.9287 17.0901 27.0742 15.7354C27.376 15.3786 27.4474 14.9384 27.2236 14.5469Z" fill="#4fc3f7"/></svg>'
};

// Update the orbit moon icon to match the current phase
function updateMoonPhaseIcon() {
    const iconEl = document.getElementById('orbitMoonIcon');
    if (!iconEl) return;
    const phase = moonData.phase || getMoonPhase();
    const phaseName = phase.phaseName || 'Waxing Crescent';
    const svg = MOON_PHASE_SVGS[phaseName] || MOON_PHASE_SVGS['Waxing Crescent'];
    // Inject a background circle (matching page bg) so the orbit ring
    // doesn't show through the transparent parts of the moon icon
    iconEl.innerHTML = svg.replace(
        /(<svg[^>]*>)/,
        '$1<circle cx="30" cy="30" r="30" fill="#060e1a"/>'
    );
}

// Update moon display
function updateMoonDisplay() {
    const phase = getMoonPhase();

    // Update orbit moon phase icon to match real-time phase
    moonData.phase = phase;
    updateMoonPhaseIcon();


    // Populate moon data bar
    const ageBarEl = document.getElementById('moonAgeBar');
    const distBarEl = document.getElementById('moonDistanceBar');
    if (ageBarEl) ageBarEl.textContent = phase.moonAge + ' days';
    if (distBarEl) distBarEl.textContent = phase.distance.toLocaleString() + ' km';
    
    // Draw in sticky header
    const headerSvg = document.getElementById('headerMoonSvg');
    if (headerSvg) {
        drawMoonPhase(headerSvg, phase, '#ffffff');
        headerMoonDrawn = true;
    }
}

// Dropdown functions
function toggleLocationDropdown() { /* removed from header */ }
function toggleMoonPhaseDropdown() { }

function goToSettings() {
    toggleSettings();
}

// Settings functions
function toggleSettingsSection(headerEl) {
    const section = headerEl.closest('.settings-section');
    if (!section) return;
    // Accordion: close others
    document.querySelectorAll('.settings-section.open').forEach(s => {
        if (s !== section) s.classList.remove('open');
    });
    section.classList.toggle('open');
}

function updateSettingsSummaries() {
    // Profile summary — sender name takes priority
    const senderName = document.getElementById('userName')?.value || localStorage.getItem('moonpop_username') || '';
    const firstName = document.getElementById('settingsFirstName')?.value || '';
    const lastName = document.getElementById('settingsLastName')?.value || '';
    const fullName = (firstName || lastName) ? (firstName + ' ' + lastName).trim() : '';
    const email = currentAuthUser?.email || '';
    const profileSummary = document.getElementById('sectionProfileSummary');
    if (profileSummary) profileSummary.textContent = senderName || fullName || email || 'Profile';

    // Profile section avatar
    const savedPic = localStorage.getItem('moonpop_profilepic');
    const sectionImg = document.getElementById('sectionProfileImg');
    const sectionInitial = document.getElementById('sectionProfileInitial');
    if (savedPic && sectionImg) {
        sectionImg.src = savedPic;
        sectionImg.style.display = 'block';
        if (sectionInitial) sectionInitial.style.display = 'none';
    } else if (sectionInitial) {
        sectionInitial.textContent = (fullName || email || '?').charAt(0).toUpperCase();
        sectionInitial.style.display = '';
        if (sectionImg) sectionImg.style.display = 'none';
    }

    // Location summary — read-only, pulled from stored location
    const locSummary = document.getElementById('sectionLocationSummary');
    if (locSummary) {
        const savedLoc = localStorage.getItem('moonpop_location');
        if (savedLoc) {
            try {
                const loc = JSON.parse(savedLoc);
                locSummary.textContent = loc.country ? `${loc.name}, ${loc.country}` : loc.name;
            } catch(e) { locSummary.textContent = 'Your location'; }
        } else {
            locSummary.textContent = 'Your location';
        }
    }

    // Preferences summary
    const tf = document.getElementById('timeFormat');
    const prefsSummary = document.getElementById('sectionPrefsSummary');
    if (tf && prefsSummary) prefsSummary.textContent = tf.options[tf.selectedIndex]?.text || '24-hour';

    // Account summary
    const acctSummary = document.getElementById('sectionAccountSummary');
    if (acctSummary) acctSummary.textContent = email || 'Account';
}

// Mobile menu
function toggleMobileMenu() {
    const overlay = document.getElementById('mobileMenuOverlay');
    const drawer = document.getElementById('mobileMenuDrawer');
    const isOpen = drawer.classList.contains('open');
    if (isOpen) {
        closeMobileMenu();
    } else {
        overlay.classList.add('open');
        drawer.classList.add('open');
    }
}
function closeMobileMenu() {
    document.getElementById('mobileMenuOverlay')?.classList.remove('open');
    document.getElementById('mobileMenuDrawer')?.classList.remove('open');
}

function toggleSettings() {
    const dd = document.getElementById('settingsDropdown');
    const arrow = document.getElementById('settingsArrow');
    const isOpen = dd.classList.contains('active');

    if (isOpen) {
        dd.classList.remove('active');
        arrow.classList.remove('open');
    } else {
        // Close any open chat/shared sky panels first
        const msgPage = document.getElementById('messagePageView');
        const ssPage = document.getElementById('sharedSkyPage');
        if (msgPage && msgPage.classList.contains('active')) _closeMessageDetailUI();
        if (ssPage && ssPage.classList.contains('active')) closeSharedSkyModal();

        dd.classList.add('active');
        arrow.classList.add('open');

        // Collapse all sections on open
        document.querySelectorAll('.settings-section.open').forEach(s => s.classList.remove('open'));

        // Render blocked users list
        renderBlockedUsersList();

        // Populate profile pic in body
        const savedPic = localStorage.getItem('moonpop_profilepic');
        const userName = document.getElementById('userName')?.value || localStorage.getItem('moonpop_username') || '';
        const picInitial = document.getElementById('profilePicInitial');
        const picImg = document.getElementById('profilePicImg');
        if (savedPic && picImg) {
            picImg.src = savedPic;
            picImg.style.display = 'block';
            if (picInitial) picInitial.style.display = 'none';
        } else if (picInitial) {
            picInitial.textContent = userName ? userName.charAt(0).toUpperCase() : '?';
            picInitial.style.display = '';
            if (picImg) picImg.style.display = 'none';
        }

        // Hide manual location input by default
        const wrapper = document.getElementById('manualLocationWrapper');
        if (wrapper) wrapper.style.display = 'none';

        // Update section summaries and notification button
        updateSettingsSummaries();
        updateNotifButton();
    }
}

function closeSettings() {
    const dd = document.getElementById('settingsDropdown');
    const arrow = document.getElementById('settingsArrow');
    if (dd) dd.classList.remove('active');
    if (arrow) arrow.classList.remove('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dd = document.getElementById('settingsDropdown');
    if (!dd || !dd.classList.contains('active')) return;
    // Don't close if clicking inside the dropdown itself or inside header-right (avatar/arrow)
    if (e.target.closest('#settingsDropdown') || e.target.closest('.header-right')) return;
    closeSettings();
});

function requestLocation() {
    if (!navigator.geolocation) {
        alert('Geolocation not supported in this browser.');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude, longitude } = pos.coords;
            updateLocationDisplay('Your location', '');
            document.getElementById('manualLocation').value = '';
            
            // Store coords and fetch real moon data
            const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            onLocationObtained(latitude, longitude, browserTz);
        },
        () => {
            alert('Location permission denied. You can enter a city manually.');
        }
    );
}

function showManualLocationInput() {
    const wrapper = document.getElementById('manualLocationWrapper');
    wrapper.style.display = wrapper.style.display === 'none' ? 'block' : 'none';
    if (wrapper.style.display === 'block') {
        document.getElementById('manualLocation').focus();
    }
}

function updateAvatarEverywhere(dataUrl) {
    // Header avatar
    const headerImg = document.getElementById('headerAvatarImg');
    const headerInitials = document.getElementById('userInitials');
    if (dataUrl) {
        if (headerImg) { headerImg.src = dataUrl; headerImg.style.display = 'block'; }
        if (headerInitials) headerInitials.style.display = 'none';
    } else {
        if (headerImg) headerImg.style.display = 'none';
        if (headerInitials) headerInitials.style.display = '';
    }
    // Settings avatar
    const settingsImg = document.getElementById('profilePicImg');
    const settingsInitial = document.getElementById('profilePicInitial');
    if (dataUrl) {
        if (settingsImg) { settingsImg.src = dataUrl; settingsImg.style.display = 'block'; }
        if (settingsInitial) settingsInitial.style.display = 'none';
    } else {
        if (settingsImg) settingsImg.style.display = 'none';
        if (settingsInitial) settingsInitial.style.display = '';
    }
}

function handleProfilePic(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target.result;
            // Compress, upload to Storage, and save URL to profile
            await syncAvatarToSupabase(dataUrl);
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function syncAvatarToSupabase(dataUrl) {
    if (!currentAuthUser || !dataUrl) return;
    try {
        const blob = await compressAvatarToBlob(dataUrl);
        if (!blob) { console.error('Avatar compress failed'); return; }

        const filePath = `${currentAuthUser.id}/avatar.jpg`;
        console.log('Uploading avatar to Supabase Storage...');

        // Upload to storage (upsert to overwrite existing)
        const { error: uploadError } = await sb.storage
            .from('avatars')
            .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });

        if (uploadError) {
            console.error('Avatar upload failed:', uploadError);
            return;
        }

        // Get public URL
        const { data: urlData } = sb.storage.from('avatars').getPublicUrl(filePath);
        const publicUrl = urlData.publicUrl + '?t=' + Date.now(); // Cache-bust

        // Save URL to profile (not base64!)
        const { error: updateError } = await sb.from('profiles')
            .update({ avatar_url: publicUrl })
            .eq('id', currentAuthUser.id);

        if (updateError) {
            console.error('Avatar URL save to profile failed:', updateError);
            return;
        }

        // Update locally — tag with owner ID to prevent cross-user leakage
        localStorage.setItem('moonpop_profilepic', publicUrl);
        localStorage.setItem('moonpop_profilepic_owner', currentAuthUser.id);
        updateAvatarEverywhere(publicUrl);
        console.log('Avatar saved to Supabase Storage successfully:', publicUrl);
    } catch(e) {
        console.error('Avatar sync exception:', e);
    }
}

// Compress avatar to a Blob (for Storage upload) instead of data URL
function compressAvatarToBlob(dataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const size = 80; // 80x80 thumbnail
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.6);
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

// Legacy support: compress to data URL (for backward compat)
function compressAvatar(dataUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const size = 80;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
            resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

async function logOut() {
    closeSettings();
    await sb.auth.signOut();
    localStorage.clear();
    window.location.reload();
}

async function deleteAccount() {
    if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
    if (!confirm('This will permanently delete all your messages, contacts, and data. Continue?')) return;
    
    // Sign out
    await sb.auth.signOut();
    localStorage.clear();
    window.location.reload();
}

// Track original profile values to detect changes
let _profileOriginal = { firstName: '', lastName: '', userName: '' };
function captureProfileOriginal() {
    _profileOriginal = {
        firstName: document.getElementById('settingsFirstName')?.value || '',
        lastName: document.getElementById('settingsLastName')?.value || '',
        userName: document.getElementById('userName')?.value || ''
    };
}
function onProfileFieldChange() {
    const cur = {
        firstName: document.getElementById('settingsFirstName')?.value || '',
        lastName: document.getElementById('settingsLastName')?.value || '',
        userName: document.getElementById('userName')?.value || ''
    };
    const changed = cur.firstName !== _profileOriginal.firstName ||
                    cur.lastName !== _profileOriginal.lastName ||
                    cur.userName !== _profileOriginal.userName;
    const wrap = document.getElementById('settingsSaveBtnWrap');
    if (wrap) wrap.style.display = changed ? 'block' : 'none';
}

async function saveSettings() {
    const saveBtn = document.getElementById('settingsSaveBtn');
    if (saveBtn) { saveBtn.textContent = 'Saving...'; saveBtn.disabled = true; }

    // Get values
    const manualLoc = document.getElementById('manualLocation')?.value;
    const timeFormat = document.getElementById('timeFormat')?.value;
    const userName = document.getElementById('userName')?.value?.trim();
    const firstName = document.getElementById('settingsFirstName')?.value?.trim() || '';
    const lastName = document.getElementById('settingsLastName')?.value?.trim() || '';
    
    // Update location and recalculate moon
    if (manualLoc) {
        const city = cities.find(c => c.name.toLowerCase() === manualLoc.toLowerCase());
        if (city) {
            updateLocationDisplay(city.name, city.country);
            onLocationObtained(city.lat, city.lon, city.tz);
            // Persist to localStorage so saveSettings() picks it up for DB save
            localStorage.setItem('moonpop_location', JSON.stringify({ name: city.name, country: city.country }));
        } else {
            updateLocationDisplay(manualLoc, '');
        }
    }
    
    // Store preferences
    if (timeFormat) {
        moonData.timeFormat = timeFormat;
    }
    
    // Update user initials
    if (userName) {
        document.getElementById('userInitials').textContent = userName.charAt(0).toUpperCase();
        localStorage.setItem('moonpop_username', userName);
    }

    // Save to Supabase (await to ensure it persists)
    if (currentAuthUser) {
        const updateData = { 
            username: userName || null,
            first_name: firstName,
            last_name: lastName
        };
        
        // Also save location if set
        const savedLoc = localStorage.getItem('moonpop_location');
        if (savedLoc) {
            try {
                const loc = JSON.parse(savedLoc);
                const city = cities.find(c => c.name === loc.name);
                if (city) {
                    updateData.city = city.name;
                    updateData.latitude = city.lat;
                    updateData.longitude = city.lon;
                    updateData.timezone = city.tz;
                }
            } catch(e) {}
        }
        
        const { error } = await sb.from('profiles').update(updateData).eq('id', currentAuthUser.id);
        if (error) {
            console.error('Profile save failed:', error);
            if (saveBtn) { saveBtn.textContent = 'Save failed'; saveBtn.style.borderColor = '#ff5558'; saveBtn.disabled = false; }
            setTimeout(() => { if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.style.borderColor = ''; } }, 2000);
            return;
        }
    }

    // Sync avatar everywhere
    updateAvatarEverywhere(localStorage.getItem('moonpop_profilepic'));

    // Show success feedback
    if (saveBtn) { saveBtn.textContent = 'Saved!'; saveBtn.style.borderColor = '#4caf50'; saveBtn.style.color = '#4caf50'; }

    // Collapse open section and refresh summaries
    document.querySelectorAll('.settings-section.open').forEach(s => s.classList.remove('open'));
    updateSettingsSummaries();

    // Refresh contacts + conversations so name changes propagate everywhere
    await loadContacts();
    await debouncedReloadMessages();

    // Reset save button after delay and recapture originals
    captureProfileOriginal();
    setTimeout(() => {
        if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.disabled = false; saveBtn.style.borderColor = ''; saveBtn.style.color = ''; }
        const wrap = document.getElementById('settingsSaveBtnWrap');
        if (wrap) wrap.style.display = 'none';
    }, 2000);
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-right')) {
        // Close dropdowns on click outside
    }
    if (!e.target.closest('.moon-phase-selector')) {
        // moon phase dropdown removed
    }
});

// Dot tooltips are now attached dynamically by attachDotTooltips()

