// Philosophy, Contacts & Message Picker

// PHILOSOPHY PAGE
// ========================
let _philCanvasSetup = false;
let _philCountdownInterval = null;
function openPhilosophyPage(noPush) {
    const page = document.getElementById('philosophyPage');
    page.style.display = 'block';
    page.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    if (!_philCanvasSetup) {
        _philCanvasSetup = true;
        setupRingCanvas('philosophy-ring-canvas');
    }
    // Start philosophy countdown
    startPhilCountdown();
    if (!noPush) history.pushState({ page: 'philosophy' }, '', '/philosophy');
}
function startPhilCountdown() {
    if (_philCountdownInterval) clearInterval(_philCountdownInterval);
    const cdEl = document.getElementById('philCountdown');
    const titleEl = document.getElementById('philMoonTitle');
    if (!cdEl || !titleEl) return;
    function update() {
        try {
            if (moonData && moonData.isVisible) {
                titleEl.textContent = 'The moon is rising now.';
                cdEl.textContent = '';
                return;
            }
            titleEl.textContent = 'The moon rises in';
            // Use moonData if available, otherwise estimate
            if (moonData && moonData.moonrise) {
                const now = new Date();
                // Parse moonrise time (HH:MM format) into a Date
                const parts = moonData.moonrise.split(':');
                if (parts.length === 2) {
                    const target = new Date();
                    target.setHours(parseInt(parts[0]), parseInt(parts[1]), 0, 0);
                    if (target <= now) target.setDate(target.getDate() + 1);
                    const diff = target - now;
                    if (diff > 0) {
                        const h = Math.floor(diff / 3600000);
                        const m = Math.floor((diff % 3600000) / 60000);
                        const s = Math.floor((diff % 60000) / 1000);
                        cdEl.textContent = h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
                        return;
                    }
                }
            }
            cdEl.textContent = '';
            titleEl.textContent = 'The moon rises tonight.';
        } catch(e) {
            cdEl.textContent = '';
            titleEl.textContent = 'The moon rises tonight.';
        }
    }
    update();
    _philCountdownInterval = setInterval(update, 1000);
}
function closePhilosophyPage() {
    document.getElementById('philosophyPage').style.display = 'none';
    document.body.style.overflow = '';
    if (window.location.pathname === '/philosophy') history.replaceState(null, '', '/');
}
// ---- MOON TRANSIT ILLUSTRATION (canvas) ----
function initTransitIllustration() {
    const canvas = document.getElementById('transitCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const wrap = canvas.parentElement;

    let W, H, cx, cy, earthR, orbitR, sc;
    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const ww = wrap.offsetWidth;
        W = ww * dpr; H = ww * dpr;
        canvas.width = W; canvas.height = H;
        canvas.style.width = ww + 'px';
        canvas.style.height = ww + 'px';
        cx = W / 2; cy = H / 2;
        sc = W / 460; // base scale — illustration fills most of the canvas
        earthR = 115 * sc;
        orbitR = 185 * sc;
    }
    resize();
    window.addEventListener('resize', resize);

    // Pin angles on orbit
    const YOU_ANGLE = -55 * Math.PI / 180;
    const THEM_ANGLE = 155 * Math.PI / 180;
    // Pin positions on Earth surface
    function youPos() { return { x: cx + Math.cos(YOU_ANGLE) * earthR * 0.65, y: cy + Math.sin(YOU_ANGLE) * earthR * 0.65 }; }
    function themPos() { return { x: cx + Math.cos(THEM_ANGLE) * earthR * 0.65, y: cy + Math.sin(THEM_ANGLE) * earthR * 0.65 }; }
    // Moon position on orbit
    function moonPos(angle) { return { x: cx + Math.cos(angle) * orbitR, y: cy + Math.sin(angle) * orbitR }; }

    /*
     * FULL CYCLE (20s):
     *  Phase 0: Letter rises from You → moon (1.5s)
     *  Phase 1: Moon carries coral letter You→Them (5s)
     *  Phase 2: Letter drops from moon → Them (1.5s)
     *  Phase 3: Letter rises from Them → moon (1.5s)
     *  Phase 4: Moon carries blue letter Them→You (5s)
     *  Phase 5: Letter drops from moon → You (1.5s)
     *  Pause gaps built into ease
     */
    const CYCLE = 18;
    const PHASES = [
        { name: 'send_you',    dur: 1.2 },
        { name: 'travel_to_them', dur: 5.5 },
        { name: 'drop_them',   dur: 1.2 },
        { name: 'send_them',   dur: 1.2 },
        { name: 'travel_to_you', dur: 5.5 },
        { name: 'drop_you',    dur: 1.2 },
    ];
    const totalDur = PHASES.reduce((s, p) => s + p.dur, 0);
    // Normalize durations
    PHASES.forEach(p => p.frac = p.dur / totalDur);

    function ease(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }

    function getPhase(t) {
        let acc = 0;
        for (let i = 0; i < PHASES.length; i++) {
            if (t < acc + PHASES[i].frac) {
                return { index: i, name: PHASES[i].name, progress: (t - acc) / PHASES[i].frac };
            }
            acc += PHASES[i].frac;
        }
        return { index: 5, name: 'drop_you', progress: 1 };
    }

    // Clockwise angle interpolation
    function lerpAngleCW(from, to, t) {
        let diff = to - from;
        if (diff < 0) diff += Math.PI * 2;
        return from + diff * t;
    }

    // Trail
    const trail = [];
    const TRAIL_LEN = 50;

    // ---- DRAW FUNCTIONS ----

    function drawOrbit() {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, orbitR, 0, Math.PI * 2);
        ctx.setLineDash([10 * sc, 14 * sc]);
        ctx.strokeStyle = 'rgba(208,180,137,0.30)';
        ctx.lineWidth = 1.4 * sc;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    function drawEarth() {
        ctx.save();
        // Earth body — matte dark navy disc
        ctx.beginPath();
        ctx.arc(cx, cy, earthR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(7, 15, 30, 0.85)';
        ctx.fill();
        // Brass rim outline
        ctx.beginPath();
        ctx.arc(cx, cy, earthR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(208, 180, 137, 0.55)';
        ctx.lineWidth = 1 * sc;
        ctx.stroke();

        // Inner concentric brass dotted ring (decorative — celestial instrument feel)
        ctx.beginPath();
        ctx.arc(cx, cy, earthR * 0.62, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(208, 180, 137, 0.22)';
        ctx.lineWidth = 0.6 * sc;
        ctx.setLineDash([2 * sc, 4 * sc]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Equator + meridian thin brass crosshair
        ctx.beginPath();
        ctx.moveTo(cx - earthR, cy);
        ctx.lineTo(cx + earthR, cy);
        ctx.strokeStyle = 'rgba(208, 180, 137, 0.18)';
        ctx.lineWidth = 0.5 * sc;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, cy - earthR);
        ctx.lineTo(cx, cy + earthR);
        ctx.stroke();

        // Outer faint brass halo
        ctx.beginPath();
        ctx.arc(cx, cy, earthR + 5 * sc, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(208, 180, 137, 0.10)';
        ctx.lineWidth = 1 * sc;
        ctx.stroke();
        ctx.restore();
    }

    function drawMoon(x, y) {
        const moonR = 24 * sc;
        // Soft brass glow
        const glow = ctx.createRadialGradient(x, y, 0, x, y, moonR * 2.4);
        glow.addColorStop(0, 'rgba(212, 181, 138, 0.20)');
        glow.addColorStop(0.45, 'rgba(212, 181, 138, 0.04)');
        glow.addColorStop(1, 'rgba(212, 181, 138, 0)');
        ctx.beginPath(); ctx.arc(x, y, moonR * 2.4, 0, Math.PI * 2);
        ctx.fillStyle = glow; ctx.fill();
        // Body — ivory
        ctx.beginPath(); ctx.arc(x, y, moonR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(234, 216, 191, 0.96)';
        ctx.fill();
        // Brass rim
        ctx.beginPath(); ctx.arc(x, y, moonR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(208, 180, 137, 0.45)';
        ctx.lineWidth = 0.6 * sc;
        ctx.stroke();
        // Subtle craters
        ctx.fillStyle = 'rgba(120, 95, 65, 0.22)';
        ctx.beginPath(); ctx.arc(x + 6 * sc, y - 4 * sc, 3.5 * sc, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(120, 95, 65, 0.18)';
        ctx.beginPath(); ctx.arc(x - 7 * sc, y + 6 * sc, 3 * sc, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(120, 95, 65, 0.14)';
        ctx.beginPath(); ctx.arc(x + 2 * sc, y + 9 * sc, 2 * sc, 0, Math.PI * 2); ctx.fill();
    }

    function drawPin(px, py, color, label) {
        const s = sc;
        const isYou = color === '#ff5558';
        const dotColor = isYou ? '#D4B58A' : '#EAD8BF';
        const ringColor = isYou ? 'rgba(212,181,138,0.40)' : 'rgba(234,216,191,0.40)';

        ctx.save();
        // Subtle outer ring
        ctx.beginPath();
        ctx.arc(px, py, 7 * s, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 0.7 * s;
        ctx.stroke();
        // Brass dot
        ctx.beginPath();
        ctx.arc(px, py, 3 * s, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
        // Label below — uses the hero serif (Cormorant Garamond)
        ctx.font = '500 ' + (14 * s) + 'px "Cormorant Garamond", "Iowan Old Style", Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = dotColor;
        ctx.fillText(label, px, py + 20 * s);
        ctx.restore();
    }

    function drawEnvelope(x, y, color, alpha) {
        if (alpha <= 0) return;
        const s = sc;
        const fillColor = color === '#ff5558' ? '#D4B58A' : '#EAD8BF';
        const glowRgb = color === '#ff5558' ? '212,181,138' : '234,216,191';
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        // Restrained warm glow
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 22*s);
        g.addColorStop(0, 'rgba(' + glowRgb + ',0.28)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath(); ctx.arc(0, 0, 22*s, 0, Math.PI*2);
        ctx.fillStyle = g; ctx.fill();
        // Envelope body
        const ew = 22*s, eh = 16*s;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-ew/2, -eh/2, ew, eh, 2*s);
        else { ctx.rect(-ew/2, -eh/2, ew, eh); }
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(3,16,31,0.5)';
        ctx.lineWidth = 1*s;
        ctx.stroke();
        // Flap
        ctx.beginPath();
        ctx.moveTo(-ew/2 + 2*s, -eh/2 + 1*s);
        ctx.lineTo(0, 2*s);
        ctx.lineTo(ew/2 - 2*s, -eh/2 + 1*s);
        ctx.strokeStyle = 'rgba(3,16,31,0.55)';
        ctx.lineWidth = 1.2*s;
        ctx.stroke();
        ctx.restore();
    }

    function drawTrail(color) {
        for (let i = 0; i < trail.length; i++) {
            const p = trail[i];
            const alpha = (1 - i / trail.length) * 0.32;
            const size = (1 - i / trail.length) * 4 * sc + 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            const c = color === '#ff5558' ? '212,181,138' : '234,216,191';
            ctx.fillStyle = 'rgba(' + c + ',' + alpha + ')';
            ctx.fill();
        }
    }

    // Lerp between two positions
    function lerp2(a, b, t) { return { x: a.x + (b.x - a.x)*t, y: a.y + (b.y - a.y)*t }; }

    let startTime = null;
    function draw(ts) {
        if (!startTime) startTime = ts;
        const elapsed = (ts - startTime) / 1000;
        const t = (elapsed % CYCLE) / CYCLE;

        const phase = getPhase(t);
        const p = ease(phase.progress);

        const you = youPos();
        const them = themPos();

        // Moon angle based on phase
        let moonAngle;
        if (phase.name === 'send_you' || phase.name === 'drop_you') moonAngle = YOU_ANGLE;
        else if (phase.name === 'drop_them' || phase.name === 'send_them') moonAngle = THEM_ANGLE;
        else if (phase.name === 'travel_to_them') moonAngle = lerpAngleCW(YOU_ANGLE, THEM_ANGLE, p);
        else moonAngle = lerpAngleCW(THEM_ANGLE, YOU_ANGLE + Math.PI*2, p);

        const moon = moonPos(moonAngle);

        // Trail (only during travel)
        if (phase.name === 'travel_to_them' || phase.name === 'travel_to_you') {
            trail.unshift({ x: moon.x, y: moon.y });
            if (trail.length > TRAIL_LEN) trail.length = TRAIL_LEN;
        } else {
            // Fade out trail
            if (trail.length > 0) trail.splice(-1, 1);
        }

        // Envelope position + color
        let envX, envY, envAlpha = 1, envColor;
        const moonBottom = { x: moon.x, y: moon.y + 34*sc };

        if (phase.name === 'send_you') {
            // Coral letter rises from You to moon
            envColor = '#ff5558';
            const pos = lerp2(you, moonBottom, p);
            envX = pos.x; envY = pos.y;
            envAlpha = 0.5 + p * 0.5;
        } else if (phase.name === 'travel_to_them') {
            // Moon carries coral letter
            envColor = '#ff5558';
            envX = moonBottom.x; envY = moonBottom.y;
        } else if (phase.name === 'drop_them') {
            // Coral letter drops to Them
            envColor = '#ff5558';
            const pos = lerp2(moonBottom, them, p);
            envX = pos.x; envY = pos.y;
            envAlpha = 1 - p * 0.5;
        } else if (phase.name === 'send_them') {
            // Golden letter rises from Them to moon
            envColor = '#FFD54F';
            const pos = lerp2(them, moonBottom, p);
            envX = pos.x; envY = pos.y;
            envAlpha = 0.5 + p * 0.5;
        } else if (phase.name === 'travel_to_you') {
            // Moon carries golden letter
            envColor = '#FFD54F';
            envX = moonBottom.x; envY = moonBottom.y;
        } else {
            // Golden letter drops to You
            envColor = '#FFD54F';
            const pos = lerp2(moonBottom, you, p);
            envX = pos.x; envY = pos.y;
            envAlpha = 1 - p * 0.5;
        }

        // ---- RENDER ----
        ctx.clearRect(0, 0, W, H);
        drawOrbit();
        drawEarth();
        const trailColor = (phase.name.includes('you') && !phase.name.includes('to_you')) || phase.name === 'travel_to_them' ? '#ff5558' : '#FFD54F';
        drawTrail(trailColor);
        drawPin(you.x, you.y, '#ff5558', 'YOU');
        drawPin(them.x, them.y, '#FFD54F', 'THEM');
        drawEnvelope(envX, envY, envColor, envAlpha);
        drawMoon(moon.x, moon.y);

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
}

function setupRingCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const hero = canvas.parentElement;
    let W, H, cx, cy, baseR;
    const RINGS = [
        { radiusFrac: 0.38, speed: 0.0055, dir: 1, ringColor: 'rgba(79,195,247,0.12)', ringWidth: 0.5, dots: [{ angle: 0, color: [79,195,247], size: 4.5, trail: 120, history: [] }, { angle: Math.PI, color: [53,125,197], size: 3, trail: 80, history: [] }] },
        { radiusFrac: 0.62, speed: 0.0032, dir: 1, ringColor: 'rgba(100,160,220,0.18)', ringWidth: 0.8, dots: [{ angle: 0, color: [79,195,247], size: 5.5, trail: 160, history: [] }, { angle: Math.PI*0.67, color: [53,125,197], size: 3.5, trail: 100, history: [] }, { angle: Math.PI*1.33, color: [79,195,247], size: 3, trail: 80, history: [] }] },
        { radiusFrac: 0.80, speed: 0.0018, dir: -1, ringColor: 'rgba(79,195,247,0.08)', ringWidth: 0.5, dots: [{ angle: Math.PI*0.25, color: [79,195,247], size: 3, trail: 90, history: [] }, { angle: Math.PI*1.25, color: [53,125,197], size: 2.5, trail: 70, history: [] }] },
    ];
    function resize() {
        W = hero.offsetWidth; H = hero.offsetHeight;
        canvas.width = W; canvas.height = H;
        cx = W / 2; cy = H * 0.48;
        baseR = Math.min(W * 0.45, 310);
    }
    resize();
    window.addEventListener('resize', resize);
    let last = null;
    function draw(ts) {
        if (!last) last = ts;
        const dt = Math.min((ts - last) / 1000, 0.05);
        last = ts;
        ctx.clearRect(0, 0, W, H);
        RINGS.forEach(ring => {
            const r = baseR * ring.radiusFrac / 0.62;
            // Draw ring stroke
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = ring.ringColor; ctx.lineWidth = ring.ringWidth || 0.5; ctx.stroke();
            // Subtle dashed inner ring for depth
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.setLineDash([2, 12]); ctx.strokeStyle = ring.ringColor.replace(/[\d.]+\)$/, (m) => (parseFloat(m) * 0.4).toFixed(2) + ')'); ctx.lineWidth = 0.5; ctx.stroke();
            ctx.setLineDash([]);
            ring.dots.forEach(dot => {
                dot.angle += ring.speed * ring.dir * dt * 60;
                const x = cx + Math.cos(dot.angle) * r;
                const y = cy + Math.sin(dot.angle) * r;
                dot.history.unshift({ x, y });
                if (dot.history.length > dot.trail) dot.history.length = dot.trail;
                const [cr, cg, cb] = dot.color;
                for (let i = 1; i < dot.history.length; i++) {
                    const p0 = dot.history[i-1], p1 = dot.history[i];
                    const progress = i / dot.history.length;
                    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
                    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${Math.pow(1-progress,1.8)*0.55})`;
                    ctx.lineWidth = dot.size * (1 - progress * 0.85); ctx.lineCap = 'round'; ctx.stroke();
                }
                const glow = ctx.createRadialGradient(x, y, 0, x, y, dot.size * 4.5);
                glow.addColorStop(0, `rgba(${cr},${cg},${cb},0.45)`); glow.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.15)`); glow.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
                ctx.beginPath(); ctx.arc(x, y, dot.size * 4.5, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();
                const dotG = ctx.createRadialGradient(x, y, 0, x, y, dot.size);
                dotG.addColorStop(0, `rgba(255,255,255,0.95)`); dotG.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.9)`); dotG.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
                ctx.beginPath(); ctx.arc(x, y, dot.size, 0, Math.PI * 2); ctx.fillStyle = dotG; ctx.fill();
            });
        });
        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
}

// CONTACTS PAGE
// ========================
function openContactsPage(noPush) {
    renderContactsList();
    const page = document.getElementById('contactsPage');
    page.style.display = 'block';
    page.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    // Reset search
    document.getElementById('contactSearchInput').value = '';
    document.getElementById('contactSearchResults').innerHTML = '';
    _lastSearchResults = [];
    setTimeout(() => document.getElementById('contactSearchInput').focus(), 100);
    if (!noPush) history.pushState({ page: 'contacts' }, '', '/contacts');
}

function closeContactsPage() {
    document.getElementById('contactsPage').style.display = 'none';
    document.body.style.overflow = '';
    if (window.location.pathname === '/contacts') history.replaceState(null, '', '/');
}

function toggleContactsAddView() {
    document.getElementById('contactSearchInput').focus();
}

function switchContactsTab(tab) {
    // Legacy — tabs removed; just focus search
    document.getElementById('contactSearchInput').focus();
}

// Debounced search for users in DB
let contactSearchTimer = null;
let _lastSearchResults = []; // Cache search results so we can reference by index

function debouncedContactSearch() {
    clearTimeout(contactSearchTimer);
    const query = document.getElementById('contactSearchInput').value.trim();
    if (query.length < 2) {
        document.getElementById('contactSearchResults').innerHTML = '';
        _lastSearchResults = [];
        return;
    }
    contactSearchTimer = setTimeout(() => searchUsersForContact(query), 300);
}

async function searchUsersForContact(query) {
    const resultsDiv = document.getElementById('contactSearchResults');
    if (!currentAuthUser) return;

    resultsDiv.innerHTML = '<div style="padding:8px;color:var(--text-muted);font-size:13px;">Searching...</div>';

    // Check if query is an email address
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query);

    try {
        const { data, error } = await sb.rpc('search_users', { search_query: query });

        if (error) {
            console.error('User search error:', error);
            resultsDiv.innerHTML = '<div style="padding:8px;color:var(--coral);font-size:13px;">Search failed. Try again.</div>';
            return;
        }

        _lastSearchResults = data || [];
        const existingIds = new Set(contacts.map(c => c.linkedProfileId).filter(Boolean));
        const existingEmails = new Set(contacts.map(c => (c.email || '').toLowerCase()).filter(Boolean));

        let html = '';

        if (_lastSearchResults.length > 0) {
            html += _lastSearchResults.map((u, idx) => {
                const isSelf = u.id === currentAuthUser.id;
                const displayName = u.username || [u.first_name, u.last_name].filter(Boolean).join(' ') || 'MoonPop User';
                const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
                const usernameTag = u.username ? `<span style="font-size:11px;color:var(--text-muted);margin-left:4px;">@${u.username}</span>` : '';
                const location = u.city || '';
                const initial = (displayName || '?').charAt(0).toUpperCase();
                const avatarHtml = u.avatar_url
                    ? `<img src="${u.avatar_url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`
                    : `<div style="width:36px;height:36px;border-radius:50%;background:var(--blue);color:white;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;">${initial}</div>`;

                const isExisting = existingIds.has(u.id) || (u.email && existingEmails.has(u.email.toLowerCase()));
                const selfBadge = isSelf ? ` <span style="font-size:10px;color:var(--coral);font-weight:600;background:rgba(231,111,81,0.1);padding:2px 8px;border-radius:10px;">You</span>` : '';

                let actionHtml;
                if (isExisting) {
                    actionHtml = `<span style="font-size:11px;color:#4caf50;font-weight:600;">✓ Contact</span>`;
                } else if (isSelf) {
                    actionHtml = '';
                } else {
                    actionHtml = `<button onclick="event.stopPropagation();addSearchResult(${idx})" style="background:var(--blue);color:white;border:none;border-radius:16px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">Add</button>`;
                }

                return `
                    <div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid rgba(79,195,247,0.08);">
                        ${avatarHtml}
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.9);">${fullName || displayName}${usernameTag}${selfBadge}</div>
                            <div style="font-size:11px;color:rgba(255,255,255,0.4);">${location || ''}</div>
                        </div>
                        ${actionHtml}
                    </div>
                `;
            }).join('');
        }

        // If email search found no exact match, show invite option
        if (isEmail) {
            const exactMatch = _lastSearchResults.find(u => u.email && u.email.toLowerCase() === query.toLowerCase());
            if (!exactMatch) {
                html += `
                    <div style="display:flex;align-items:center;gap:10px;padding:12px 4px;border-bottom:1px solid rgba(79,195,247,0.08);">
                        <div style="width:36px;height:36px;border-radius:50%;background:var(--coral);color:white;display:flex;align-items:center;justify-content:center;font-size:16px;">✉</div>
                        <div style="flex:1;">
                            <div style="font-size:14px;font-weight:600;color:var(--coral);">${query}</div>
                            <div style="font-size:11px;color:var(--text-muted);">Not on Moon Post Service yet</div>
                        </div>
                        <button onclick="inviteEmailFromSearch('${query.replace(/'/g, "\\'")}')" style="background:var(--coral);color:white;border:none;border-radius:16px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">Invite</button>
                    </div>
                `;
            }
        }

        if (!html) {
            html = `
                <div style="padding:16px 4px;font-size:13px;color:var(--text-muted);">
                    No users found for "${query}"<br>
                    <span style="font-size:11px;">Try typing their exact email address to invite them.</span>
                </div>`;
        }

        resultsDiv.innerHTML = html;
    } catch(e) {
        console.error('User search exception:', e);
        resultsDiv.innerHTML = '<div style="padding:8px;color:var(--coral);font-size:13px;">Search failed. Try again.</div>';
    }
}

// Add contact from search results by index (avoids passing avatar in onclick)
async function addSearchResult(idx) {
    const u = _lastSearchResults[idx];
    if (!u) return;

    const displayName = u.username || [u.first_name, u.last_name].filter(Boolean).join(' ') || 'MoonPop User';

    // Check if already in contacts
    if (contacts.find(c => c.linkedProfileId === u.id || (c.email && u.email && c.email.toLowerCase() === u.email.toLowerCase()))) {
        // Already exists, just refresh display
        const currentQuery = document.getElementById('contactSearchInput').value.trim();
        if (currentQuery.length >= 2) searchUsersForContact(currentQuery);
        return;
    }

    const newContact = {
        name: displayName,
        location: u.city || 'Unknown',
        email: u.email || null,
        avatar: u.avatar_url || null,
        username: u.username || null,
        firstName: u.first_name || null,
        lastName: u.last_name || null,
        isOnMoonpop: true,
        linkedProfileId: u.id
    };
    contacts.push(newContact);

    // Save to Supabase
    if (currentAuthUser) {
        const { error } = await sb.from('contacts').insert({
            owner_id: currentAuthUser.id,
            name: displayName,
            city: u.city || null,
            email: u.email || null,
            is_on_moonpop: true,
            linked_profile_id: u.id
        });
        if (error) console.error('Contact save failed:', error);
    }

    renderContactsList();
    // Refresh search results to show ✓ Contact
    const currentQuery = document.getElementById('contactSearchInput').value.trim();
    if (currentQuery.length >= 2) {
        searchUsersForContact(currentQuery);
    } else {
        document.getElementById('contactSearchResults').innerHTML = '';
    }
}

// Legacy stub — invite tab removed
async function sendInviteFromContacts() {}

// Invite email from search results
async function inviteEmailFromSearch(email) {
    if (!email) return;
    const senderName = localStorage.getItem('moonpop_username') || 'Someone on Moon Post Service';
    const resultsDiv = document.getElementById('contactSearchResults');

    try {
        // Show sending state
        const inviteBtn = resultsDiv.querySelector('button[onclick*="inviteEmailFromSearch"]');
        if (inviteBtn) { inviteBtn.textContent = 'Sending...'; inviteBtn.disabled = true; }

        const { data, error } = await sb.functions.invoke('send-email', {
            body: {
                type: 'invite',
                recipientEmail: email,
                senderName,
                revealLink: window.location.origin + '?invite_email=' + encodeURIComponent(email)
            }
        });
        if (error) throw error;

        // Also add as contact (off-platform)
        if (!contacts.find(c => c.email && c.email.toLowerCase() === email.toLowerCase())) {
            const newContact = {
                name: email,
                location: 'Unknown',
                email: email,
                avatar: null,
                isOnMoonpop: false,
                linkedProfileId: null
            };
            contacts.push(newContact);
            if (currentAuthUser) {
                await sb.from('contacts').insert({
                    owner_id: currentAuthUser.id,
                    name: email,
                    email: email,
                    is_on_moonpop: false
                });
            }
            renderContactsList();
        }

        // Update button to show success
        if (inviteBtn) { inviteBtn.textContent = '✓ Invited'; inviteBtn.style.background = '#4caf50'; }
        else alert('Invite sent to ' + email + '!');
    } catch(e) {
        console.error('Invite send failed:', e);
        alert('Failed to send invite. Please try again.');
        const inviteBtn = resultsDiv.querySelector('button[onclick*="inviteEmailFromSearch"]');
        if (inviteBtn) { inviteBtn.textContent = 'Invite'; inviteBtn.disabled = false; }
    }
}

function renderContactsList() {
    const container = document.getElementById('contactsListBody');
    if (!container) return;

    const visibleContacts = contacts;

    if (visibleContacts.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
                <div style="margin-bottom:12px;color:var(--blue);"><svg class="app-icon xxl"><use href="#icon-contacts"/></svg></div>
                <h4 style="color:var(--blue);margin-bottom:8px;">No contacts yet</h4>
                <p style="font-size:13px;margin-bottom:16px;">Search for MoonPop users or invite someone new.</p>
                <button onclick="document.getElementById('contactSearchInput').focus()" style="background:var(--blue);color:white;border:none;border-radius:20px;padding:8px 20px;font-size:13px;cursor:pointer;">+ Add a contact</button>
            </div>
        `;
        return;
    }

    const sorted = [...visibleContacts].sort((a, b) => {
        if (a.isOnMoonpop && !b.isOnMoonpop) return -1;
        if (!a.isOnMoonpop && b.isOnMoonpop) return 1;
        return (a.name || '').localeCompare(b.name || '');
    });

    const onMps = sorted.filter(c => c.isOnMoonpop);
    const offMps = sorted.filter(c => !c.isOnMoonpop);

    let html = '';
    
    if (onMps.length > 0) {
        html += `<div style="padding:12px 20px 6px;font-size:11px;font-weight:700;color:#4fc3f7;text-transform:uppercase;letter-spacing:0.5px;">Your Contacts</div>`;
        html += onMps.map(c => renderContactRow(c, true)).join('');
    }
    
    if (offMps.length > 0) {
        html += `<div style="padding:12px 20px 6px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;">Invited · ${offMps.length}</div>`;
        html += offMps.map(c => renderContactRow(c, false)).join('');
    }

    container.innerHTML = html;
}

function renderContactRow(contact, isOnMps) {
    const initial = (contact.name || '?').charAt(0).toUpperCase();
    const escapedName = (contact.name || '').replace(/'/g, "\\'");
    const avatarInner = contact.avatar
        ? `<img src="${contact.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : `<span>${initial}</span>`;
    const online = isContactOnline(contact);
    const statusDotColor = online ? '#4caf50' : (isOnMps ? '#4caf50' : '');
    const statusDot = statusDotColor ? `<span style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:${statusDotColor};border:2px solid #0a1628;z-index:1;${!online && isOnMps ? 'opacity:0.4;' : ''}"></span>` : '';

    // Display name with username and self badge
    const displayName = contact.name || 'Unknown';
    const usernameTag = contact.username ? `<span style="font-size:12px;color:var(--text-muted);font-weight:400;margin-left:4px;">@${contact.username}</span>` : '';
    const selfBadge = contact._isSelf ? `<span style="font-size:10px;color:var(--coral);font-weight:600;margin-left:6px;background:rgba(231,111,81,0.1);padding:2px 8px;border-radius:10px;">You</span>` : '';

    return `
        <div style="display:flex;align-items:center;padding:12px 20px;border-bottom:1px solid rgba(79,195,247,0.08);gap:12px;">
            <div class="msg-avatar" style="margin-right:0;">
                ${statusDot}
                ${avatarInner}
            </div>
            <div style="flex:1;min-width:0;cursor:pointer;" onclick="openContactDetail('${escapedName}')">
                <div style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.9);">
                    ${displayName}${usernameTag}${selfBadge}
                    ${online ? '<span style="font-size:11px;color:#4caf50;margin-left:6px;">● online</span>' : ''}
                </div>
                <div style="font-size:11px;color:rgba(255,255,255,0.4);">
                    ${!isOnMps ? '<span style="color:rgba(255,255,255,0.3);">Not on Moon Post Service</span>' : ''}
                    ${contact.location && contact.location !== 'Unknown' ? (isOnMps ? '' : ' · ') + contact.location : ''}
                </div>
            </div>
            <div style="position:relative;">
                <button onclick="event.stopPropagation();toggleContactMenu(this)" style="background:none;border:none;cursor:pointer;font-size:18px;color:rgba(255,255,255,0.3);padding:4px 8px;line-height:1;" title="Options">⋮</button>
                <div class="contact-menu" style="display:none;position:absolute;right:0;top:100%;background:#0d1b2a;border:1px solid rgba(79,195,247,0.15);border-radius:12px;overflow:hidden;z-index:100;min-width:140px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
                    <button onclick="event.stopPropagation();closeAllContactMenus();deleteContact('${escapedName}')" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;color:rgba(255,255,255,0.8);font-size:13px;cursor:pointer;font-family:inherit;">Remove</button>
                    ${contact.linkedProfileId ? `<button onclick="event.stopPropagation();closeAllContactMenus();blockUser('${contact.linkedProfileId}','${(contact.email||'').replace(/'/g,"\\'")}','${escapedName}')" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;color:#ff5558;font-size:13px;cursor:pointer;font-family:inherit;border-top:1px solid rgba(79,195,247,0.08);">Block</button>` : ''}
                </div>
            </div>
        </div>
    `;
}

function toggleContactMenu(btn) {
    const menu = btn.nextElementSibling;
    const wasOpen = menu.style.display !== 'none';
    closeAllContactMenus();
    if (!wasOpen) menu.style.display = 'block';
}
function closeAllContactMenus() {
    document.querySelectorAll('.contact-menu').forEach(m => m.style.display = 'none');
}
// Close menus on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.contact-menu') && !e.target.closest('[onclick*="toggleContactMenu"]')) {
        closeAllContactMenus();
    }
});

async function deleteContact(contactName) {
    if (!confirm('Remove ' + contactName + ' from your contacts?')) return;
    
    const contact = contacts.find(c => c.name === contactName);
    contacts = contacts.filter(c => c.name !== contactName);
    
    if (currentAuthUser && contact?.id) {
        await sb.from('contacts').delete().eq('id', contact.id).eq('owner_id', currentAuthUser.id);
    } else if (currentAuthUser) {
        await sb.from('contacts').delete().eq('name', contactName).eq('owner_id', currentAuthUser.id);
    }
    
    renderContactsList();
}

// ========================
// BLOCK USER SYSTEM
// ========================
const blockedUserIds = new Set();
const blockedUserEmails = new Set();
let blockedUsersData = []; // full rows for settings display

async function loadBlockedUsers() {
    if (!currentAuthUser) return;
    const { data, error } = await sb.from('blocked_users')
        .select('*')
        .eq('blocker_id', currentAuthUser.id);
    if (error) { console.error('loadBlockedUsers error:', error); return; }
    blockedUserIds.clear();
    blockedUserEmails.clear();
    blockedUsersData = data || [];
    (data || []).forEach(b => {
        if (b.blocked_id) blockedUserIds.add(b.blocked_id);
        if (b.blocked_email) blockedUserEmails.add(b.blocked_email.toLowerCase());
    });
}

function isBlocked(profileId, email) {
    if (profileId && blockedUserIds.has(profileId)) return true;
    if (email && blockedUserEmails.has(email.toLowerCase())) return true;
    return false;
}

async function blockUser(profileId, email, displayName) {
    if (!currentAuthUser) return;
    if (!confirm(`Block ${displayName || 'this user'}? They won't be able to reach you and their messages will be hidden.`)) return;

    // Insert block record
    const { error } = await sb.from('blocked_users').insert({
        blocker_id: currentAuthUser.id,
        blocked_id: profileId || null,
        blocked_email: email || null
    });
    if (error) { console.error('blockUser error:', error); return; }

    // Update local state
    if (profileId) blockedUserIds.add(profileId);
    if (email) blockedUserEmails.add(email.toLowerCase());
    await loadBlockedUsers(); // refresh full list

    // Remove from contacts if present
    const contact = contacts.find(c => c.linkedProfileId === profileId || (email && c.email === email));
    if (contact) {
        contacts = contacts.filter(c => c !== contact);
        if (contact.id) {
            await sb.from('contacts').delete().eq('id', contact.id).eq('owner_id', currentAuthUser.id);
        }
    }

    // Close chat if viewing blocked user
    if (currentConversation && (currentConversation.otherProfileId === profileId)) {
        closeMessageDetail();
    }

    // Close any open modals
    const chatProfileModal = document.getElementById('chatProfileModal');
    if (chatProfileModal) chatProfileModal.style.display = 'none';
    closeContactDetail();

    // Rebuild conversations to hide blocked user
    await loadMessages();
    renderMessages();
    renderContactsList();
}

async function unblockUser(profileId) {
    if (!currentAuthUser || !profileId) return;
    const { error } = await sb.from('blocked_users')
        .delete()
        .eq('blocker_id', currentAuthUser.id)
        .eq('blocked_id', profileId);
    if (error) { console.error('unblockUser error:', error); return; }

    blockedUserIds.delete(profileId);
    await loadBlockedUsers();
    await loadMessages();
    renderMessages();
    renderBlockedUsersList();
}

// ========================
// CHAT PROFILE POPUP (tap avatar in conversation header)
// ========================
function openChatProfile() {
    if (!currentConversation) return;
    const conv = currentConversation;
    const modal = document.getElementById('chatProfileModal');

    // Avatar
    const initial = (conv.otherName || '?').charAt(0).toUpperCase();
    document.getElementById('chatProfileInitial').textContent = initial;
    const img = document.getElementById('chatProfileImg');
    const avatarUrl = conv.otherAvatar || null;
    if (avatarUrl) {
        img.src = avatarUrl;
        img.style.display = 'block';
        document.getElementById('chatProfileInitial').style.display = 'none';
    } else {
        img.style.display = 'none';
        document.getElementById('chatProfileInitial').style.display = '';
    }

    // Name & location
    document.getElementById('chatProfileName').textContent = conv.otherName || 'Unknown';
    document.getElementById('chatProfileLocation').textContent = conv.location || '';

    // Online status
    const online = conv.otherProfileId && onlineUsers[conv.otherProfileId];
    document.getElementById('chatProfileOnline').style.display = online ? '' : 'none';

    // Stats
    const totalMsgs = conv.messages ? conv.messages.length : 0;
    const statsEl = document.getElementById('chatProfileStats');
    statsEl.textContent = `${totalMsgs} transmission${totalMsgs !== 1 ? 's' : ''}`;

    // Block button — store data for action
    const blockBtn = document.getElementById('chatProfileBlockBtn');
    blockBtn.dataset.profileId = conv.otherProfileId || '';
    blockBtn.dataset.email = conv.otherEmail || '';
    blockBtn.dataset.name = conv.otherName || '';

    modal.style.display = 'flex';
}

function closeChatProfile() {
    document.getElementById('chatProfileModal').style.display = 'none';
}

function chatProfileBlock() {
    const btn = document.getElementById('chatProfileBlockBtn');
    blockUser(btn.dataset.profileId || null, btn.dataset.email || null, btn.dataset.name || 'this user');
}

async function renderBlockedUsersList() {
    const container = document.getElementById('blockedUsersList');
    if (!container) return;
    if (blockedUsersData.length === 0) {
        container.innerHTML = '<span style="color:rgba(255,255,255,0.4);">No blocked users</span>';
        return;
    }
    // Fetch profile names for blocked IDs
    const ids = blockedUsersData.map(b => b.blocked_id).filter(Boolean);
    let profileMap = {};
    if (ids.length > 0) {
        const { data } = await sb.from('profiles').select('id, username, first_name, last_name').in('id', ids);
        if (data) data.forEach(p => { profileMap[p.id] = p; });
    }
    container.innerHTML = blockedUsersData.map(b => {
        const p = b.blocked_id ? profileMap[b.blocked_id] : null;
        const name = p?.username || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || b.blocked_email || 'Unknown';
        const initial = name.charAt(0).toUpperCase();
        return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(79,195,247,0.06);">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:32px;height:32px;border-radius:50%;background:rgba(79,195,247,0.12);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:rgba(255,255,255,0.6);">${initial}</div>
                    <span style="font-size:13px;color:rgba(255,255,255,0.7);">${name}</span>
                </div>
                <button onclick="unblockUser('${b.blocked_id}')" style="font-size:11px;padding:4px 12px;border-radius:8px;border:1px solid rgba(79,195,247,0.2);background:transparent;color:rgba(79,195,247,0.7);cursor:pointer;font-family:inherit;">Unblock</button>
            </div>
        `;
    }).join('');
}

// ========================
// CONTACT DETAIL POPUP
// ========================
let currentContactDetail = null;

function openContactDetail(contactName) {
    const contact = contacts.find(c => c.name === contactName);
    if (!contact) return;
    currentContactDetail = contact;

    const modal = document.getElementById('contactDetailModal');

    // Avatar
    const initial = (contact.name || '?').charAt(0).toUpperCase();
    document.getElementById('contactDetailInitial').textContent = initial;
    const img = document.getElementById('contactDetailImg');
    if (contact.avatar) {
        img.src = contact.avatar;
        img.style.display = 'block';
        document.getElementById('contactDetailInitial').style.display = 'none';
    } else {
        img.style.display = 'none';
        document.getElementById('contactDetailInitial').style.display = '';
    }

    // Name & username
    document.getElementById('contactDetailName').textContent = contact.name;
    const usernameEl = document.getElementById('contactDetailUsername');
    if (contact.username) {
        usernameEl.textContent = '@' + contact.username;
        usernameEl.style.display = '';
    } else {
        usernameEl.style.display = 'none';
    }
    document.getElementById('contactDetailLocation').textContent =
        (contact.location && contact.location !== 'Unknown') ? contact.location : '';

    // Online status
    const online = isContactOnline(contact);
    document.getElementById('contactDetailOnline').style.display = online ? '' : 'none';

    // Chat stats
    const chatCount = conversations.filter(c =>
        c.otherProfileId === contact.linkedProfileId ||
        c.otherName === contact.name ||
        (contact.email && c.otherEmail === contact.email)
    ).length;
    const msgCount = messages.filter(m =>
        (m.type === 'sent' && (m.recipientId === contact.linkedProfileId || m.recipientEmail === contact.email)) ||
        (m.type === 'received' && (m.senderId === contact.linkedProfileId))
    ).length;
    const statsEl = document.getElementById('contactDetailStats');
    if (msgCount > 0) {
        statsEl.textContent = `${msgCount} moon message${msgCount !== 1 ? 's' : ''} exchanged`;
        statsEl.style.display = '';
    } else {
        statsEl.textContent = 'No messages yet — send the first one!';
        statsEl.style.display = '';
    }

    // CTA button
    const displayUsername = contact.username || contact.name;
    document.getElementById('contactDetailCta').textContent = `Write ${displayUsername} a moon message`;

    modal.style.display = 'flex';
}

function closeContactDetail() {
    document.getElementById('contactDetailModal').style.display = 'none';
    currentContactDetail = null;
}

function contactDetailSendMessage() {
    if (!currentContactDetail) return;
    const contact = currentContactDetail;
    closeContactDetail();
    closeContactsPage();
    // WhatsApp-style: go directly to compose with recipient pre-filled
    if (!moonData.isVisible) {
        openMoonDownModal();
        return;
    }
    selectedRecipient = {
        name: contact.name,
        email: contact.email,
        location: contact.location,
        isOnMoonpop: contact.isOnMoonpop,
        linkedProfileId: contact.linkedProfileId
    };
    openModalForRecipient();
}

function contactAction(contactName) {
    closeContactsPage();
    pickContactForMessage(contactName);
}

// Recipient dropdown
function showRecipientDropdown() {
    const dropdown = document.getElementById('recipientDropdown');
    renderRecipientOptions(contacts);
    dropdown.classList.add('active');
}

function hideRecipientDropdown() {
    setTimeout(() => {
        document.getElementById('recipientDropdown').classList.remove('active');
    }, 200);
}

function filterRecipients(query) {
    const filtered = contacts.filter(c => 
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.location.toLowerCase().includes(query.toLowerCase())
    );
    renderRecipientOptions(filtered, query);
}

function renderRecipientOptions(list, query = '') {
    const dropdown = document.getElementById('recipientDropdown');
    
    // Check if no contacts
    if (contacts.length === 0) {
        dropdown.innerHTML = `
            <div class="empty-contacts">
                <div class="empty-contacts-icon"></div>
                <h4>No contacts yet</h4>
                <p>Send your first moon message to someone special</p>
                <button onclick="showNewContactForm()" style="margin-top:12px;padding:8px 20px;background:var(--blue);color:white;border:none;border-radius:20px;font-size:14px;cursor:pointer;">+ Add a contact</button>
            </div>
            ${query.length > 0 ? `
                <div class="recipient-option new-contact" onclick="selectNewContact('${query}')">
                    + Send to "${query}" (new contact)
                </div>
            ` : ''}
        `;
        return;
    }
    
    let html = list.map(c => {
        const escapedName = (c.name || '').replace(/'/g, "\\'");
        return `
        <div class="recipient-option" onclick="selectRecipientByName('${escapedName}')">
            <span class="name">${c.name}${c.isOnMoonpop ? ' <span style=&quot;color:#4caf50;font-size:11px;&quot;>●</span>' : ''}</span>
            <span class="location">${c.location}</span>
        </div>
    `}).join('');
    
    // Always show "send to new person" option
    html += `
        <div class="recipient-option new-contact" onclick="showNewContactForm()">
            + Add new contact
        </div>
    `;
    
    if (query.length > 0 && !list.some(c => c.name.toLowerCase() === query.toLowerCase())) {
        html += `
            <div class="recipient-option new-contact" onclick="selectNewContact('${query}')">
                + Send to "${query}" (new)
            </div>
        `;
    }
    
    dropdown.innerHTML = html || '<div class="recipient-option" style="color: var(--text-muted);">No contacts found</div>';
}

function selectRecipientByName(name) {
    const contact = contacts.find(c => c.name === name);
    if (contact) {
        document.getElementById('recipient').value = contact.name;
        document.getElementById('recipientDropdown').classList.remove('active');
        selectedRecipient = { 
            name: contact.name, 
            location: contact.location,
            email: contact.email || null,
            isOnMoonpop: contact.isOnMoonpop || false,
            linkedProfileId: contact.linkedProfileId || null
        };
        isNewContact = false;
        updateDeliveryInfo();
    }
}

function selectRecipient(name, location) {
    // Legacy fallback
    selectRecipientByName(name);
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.recipient-selector')) {
        document.getElementById('recipientDropdown').classList.remove('active');
    }
});

// Attachments
function toggleAttachment(btn, type) {
    btn.classList.toggle('active');
    
    if (type === 'voice' && btn.classList.contains('active')) {
        // Voice recording would be implemented with Web Audio API
        // For now, just toggle the visual state
    }
}

function toggleMoonDetails(btn) {
    btn.classList.toggle('active');
    moonData.includeMoonDetails = btn.classList.contains('active');
    
    if (moonData.includeMoonDetails) {
        btn.querySelector('.label').textContent = 'Moon details included';
    } else {
        btn.querySelector('.label').textContent = 'Include your moon details';
    }
}

// Get moon stamp data for messages
function getMoonStamp() {
    const phase = moonData.phase || getMoonPhase();
    const now = new Date();
    return {
        phaseName: phase.phaseName,
        illumination: Math.round(phase.illumination * 100),
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        location: document.getElementById('userLocation')?.textContent || 'Unknown'
    };
}

function handlePublicMoonUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        moonData.publicMoonPhotoDataUrl = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.parentElement.classList.add('active');
    const label = e.target.parentElement.querySelector('.label');
    label.textContent = 'Photo added';
}

// Modal functions
// ========================
// NEW MESSAGE PICKER (WhatsApp-style: pick contact first, then compose)
// ========================
function openNewMessagePicker() {
    if (!moonData.isVisible) {
        openMoonDownModal();
        return;
    }
    closeAllPanels();

    renderNewMsgContactList();
    const page = document.getElementById('newMessagePicker');
    page.classList.remove('closing');
    page.classList.add('active');
    document.getElementById('newMsgContactSearch').value = '';

    if (window.innerWidth >= 901) {
        document.body.classList.add('chat-open');
        // Delay measurement to ensure split layout has rendered
        requestAnimationFrame(() => {
            const leftPanel = document.querySelector('.split-left');
            const splitLayout = document.querySelector('.split-layout');
            if (leftPanel && splitLayout) {
                const slRect = splitLayout.getBoundingClientRect();
                page.style.left = (leftPanel.getBoundingClientRect().right + 24) + 'px';
                page.style.top = slRect.top + 'px';
                page.style.bottom = (window.innerHeight - slRect.bottom) + 'px';
                page.style.height = 'auto';
            }
        });
    } else {
        document.body.style.overflow = 'hidden';
    }

    setTimeout(() => document.getElementById('newMsgContactSearch').focus(), 100);
    history.pushState({ page: 'new-message' }, '', '/new-message');
}

function closeNewMessagePicker() {
    const page = document.getElementById('newMessagePicker');
    if (window.innerWidth >= 901) {
        page.classList.add('closing');
        setTimeout(() => {
            page.classList.remove('active', 'closing');
            page.style.left = '';
            page.style.top = '';
            page.style.bottom = '';
            page.style.height = '';
            document.body.classList.remove('chat-open');
        }, 200);
    } else {
        page.classList.remove('active');
        document.body.style.overflow = '';
    }
    if (window.location.pathname === '/new-message') history.replaceState(null, '', '/');
}

function renderNewMsgContactList(query) {
    const container = document.getElementById('newMsgContactList');
    // Merge contacts + conversation partners not already in contacts
    let allContacts = [...contacts];
    const contactKeys = new Set(contacts.map(c => (c.linkedProfileId || c.name || '').toLowerCase()));
    conversations.forEach(conv => {
        const key = (conv.otherProfileId || conv.otherName || '').toLowerCase();
        if (key && !contactKeys.has(key) && conv.otherName) {
            allContacts.push({
                name: conv.otherUsername || conv.otherName,
                email: conv.otherEmail || null,
                location: conv.location || null,
                avatar: conv.otherAvatar || null,
                linkedProfileId: conv.otherProfileId || null,
                isOnMoonpop: !!conv.otherProfileId,
                _fromConversation: true
            });
            contactKeys.add(key);
        }
    });
    let filtered = [...allContacts];
    if (query) {
        const q = query.toLowerCase();
        filtered = filtered.filter(c =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.location || '').toLowerCase().includes(q)
        );
    }

    // Sort: on Moon Post Service first, then alphabetical
    filtered.sort((a, b) => {
        if (a.isOnMoonpop && !b.isOnMoonpop) return -1;
        if (!a.isOnMoonpop && b.isOnMoonpop) return 1;
        return (a.name || '').localeCompare(b.name || '');
    });

    let html = '';

    // If query looks like email, show email invite option
    if (query && query.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.trim())) {
        html += `
            <div style="display:flex;align-items:center;padding:14px 20px;border-bottom:1px solid rgba(79,195,247,0.1);gap:14px;cursor:pointer;" onclick="pickEmailForMessage('${query.trim().replace(/'/g, "\\'")}')">
                <div class="msg-avatar" style="margin-right:0;background:rgba(79,195,247,0.2);border:1px solid rgba(79,195,247,0.3);">
                    <span style="font-size:16px;">✉</span>
                </div>
                <div style="flex:1;">
                    <div style="font-size:14px;font-weight:600;color:#4fc3f7;">Send to ${query.trim()}</div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.4);">Invite them to MoonPop with your message</div>
                </div>
            </div>
        `;
    }

    const onMps = filtered.filter(c => c.isOnMoonpop && !c._isSelf);
    const offMps = filtered.filter(c => !c.isOnMoonpop);

    if (onMps.length > 0) {
        html += `<div style="padding:12px 20px 6px;font-size:11px;font-weight:700;color:#4fc3f7;text-transform:uppercase;letter-spacing:0.5px;">Your Contacts</div>`;
        html += onMps.map(c => renderPickerRow(c)).join('');
    }

    if (offMps.length > 0) {
        if (onMps.length === 0) {
            html += `<div style="padding:12px 20px 6px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;">Your Contacts</div>`;
        } else {
            html += `<div style="padding:12px 20px 6px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;">Other Contacts</div>`;
        }
        html += offMps.map(c => renderPickerRow(c)).join('');
    }

    if (filtered.length === 0 && !query) {
        html += `<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.4);font-size:13px;">
            <div style="font-size:32px;margin-bottom:12px;">🔍</div>
            <p style="margin-bottom:8px;">Search for MoonPop users by name</p>
            <p style="font-size:12px;">Or type an email address to invite someone new</p>
        </div>`;
    } else if (filtered.length === 0 && query && query.trim().length < 2) {
        html += `<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.4);font-size:13px;">Keep typing to search...</div>`;
    }

    container.innerHTML = html;
}

function renderPickerRow(contact) {
    const initial = (contact.name || '?').charAt(0).toUpperCase();
    const escapedName = (contact.name || '').replace(/'/g, "\\'");
    const avatarInner = contact.avatar
        ? `<img src="${contact.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : `<span>${initial}</span>`;
    const online = isContactOnline(contact);
    const statusDot = online ? `<span style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:#4caf50;border:2px solid #0a1628;z-index:1;"></span>` : '';

    return `
        <div style="display:flex;align-items:center;padding:12px 20px;border-bottom:1px solid rgba(79,195,247,0.1);gap:14px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(79,195,247,0.06)'" onmouseout="this.style.background='transparent'" onclick="pickContactForMessage('${escapedName}')">
            <div class="msg-avatar" style="margin-right:0;">
                ${statusDot}
                ${avatarInner}
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:600;color:white;">
                    ${contact.name}
                    ${online ? '<span style="font-size:11px;color:#4caf50;margin-left:6px;">online</span>' : ''}
                </div>
                <div style="font-size:11px;color:rgba(255,255,255,0.4);">
                    ${contact.location && contact.location !== 'Unknown' ? contact.location : ''}
                </div>
            </div>
        </div>
    `;
}

let newMsgSearchTimer = null;
function filterNewMsgContacts(query) {
    // Always show local contacts filter immediately
    renderNewMsgContactList(query);
    // If query is long enough, also search all MoonPop users (debounced)
    clearTimeout(newMsgSearchTimer);
    if (query && query.trim().length >= 2) {
        newMsgSearchTimer = setTimeout(() => searchAllUsersForNewMsg(query.trim()), 400);
    }
}

async function searchAllUsersForNewMsg(query) {
    if (!currentAuthUser) return;
    try {
        const { data, error } = await sb.rpc('search_users', { search_query: query });
        if (error || !data) return;

        const container = document.getElementById('newMsgContactList');
        if (!container) return;

        // Get current search query (may have changed during async call)
        const currentQuery = document.getElementById('newMsgContactSearch')?.value?.trim() || '';
        if (currentQuery.length < 2) return; // User cleared search

        // Build local contacts display
        const q = currentQuery.toLowerCase();
        const localFiltered = contacts.filter(c =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.location || '').toLowerCase().includes(q)
        );

        // Filter out users already in local contacts (by profile ID or email)
        const localIds = new Set(contacts.map(c => c.linkedProfileId).filter(Boolean));
        const localEmails = new Set(contacts.map(c => (c.email || '').toLowerCase()).filter(Boolean));
        const newUsers = data.filter(u =>
            u.id !== currentAuthUser.id &&
            !localIds.has(u.id) &&
            !(u.email && localEmails.has(u.email.toLowerCase()))
        );

        let html = '';

        // Invite by email option at top
        if (currentQuery.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentQuery)) {
            html += `
                <div style="display:flex;align-items:center;padding:14px 20px;border-bottom:1px solid #f0ece4;gap:14px;cursor:pointer;" onclick="pickEmailForMessage('${currentQuery.replace(/'/g, "\\'")}')">
                    <div class="msg-avatar" style="margin-right:0;background:var(--coral);">
                        <span style="font-size:16px;">✉</span>
                    </div>
                    <div style="flex:1;">
                        <div style="font-size:14px;font-weight:600;color:var(--coral);">Send to ${currentQuery}</div>
                        <div style="font-size:11px;color:var(--text-muted);">Invite them to MoonPop with your message</div>
                    </div>
                </div>
            `;
        }

        // Your contacts that match
        if (localFiltered.length > 0) {
            html += `<div style="padding:12px 20px 6px;font-size:11px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:0.5px;">Your Contacts</div>`;
            localFiltered.sort((a, b) => {
                if (a.isOnMoonpop && !b.isOnMoonpop) return -1;
                if (!a.isOnMoonpop && b.isOnMoonpop) return 1;
                return (a.name || '').localeCompare(b.name || '');
            });
            html += localFiltered.map(c => renderPickerRow(c)).join('');
        }

        // New MoonPop users found via search
        if (newUsers.length > 0) {
            html += `<div style="padding:12px 20px 6px;font-size:11px;font-weight:700;color:#4fc3f7;text-transform:uppercase;letter-spacing:0.5px;">Users on Moon Post Service</div>`;
            html += newUsers.map(u => {
                const displayName = u.username || [u.first_name, u.last_name].filter(Boolean).join(' ') || 'MoonPop User';
                return renderSearchedUserRow(u, displayName);
            }).join('');
        }

        if (!html && localFiltered.length === 0 && newUsers.length === 0) {
            html += `<div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px;">
                No users found for "${currentQuery}"<br>
                <span style="font-size:12px;">Try an email address to invite someone new.</span>
            </div>`;
        }

        container.innerHTML = html;
    } catch (e) {
        console.error('searchAllUsersForNewMsg error:', e);
    }
}

function renderSearchedUserRow(user, displayName) {
    const initial = (displayName || '?').charAt(0).toUpperCase();
    const escapedId = user.id;
    const escapedName = (displayName || '').replace(/'/g, "\\'");
    const escapedEmail = (user.email || '').replace(/'/g, "\\'");
    const escapedCity = (user.city || '').replace(/'/g, "\\'");
    const avatarInner = user.avatar_url
        ? `<img src="${user.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : `<span>${initial}</span>`;
    const username = user.username ? `<span style="font-size:11px;color:var(--text-muted);margin-left:4px;">@${user.username}</span>` : '';

    return `
        <div style="display:flex;align-items:center;padding:12px 20px;border-bottom:1px solid #f0ece4;gap:14px;cursor:pointer;" onclick="pickSearchedUserForMessage('${escapedId}', '${escapedName}', '${escapedEmail}', '${escapedCity}')">
            <div class="msg-avatar" style="margin-right:0;">
                ${avatarInner}
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:600;color:var(--blue);">
                    ${displayName}${username}
                </div>
                <div style="font-size:11px;color:var(--text-muted);">
                    <span style="color:#4caf50;">On Moon Post Service</span>
                    ${user.city ? ' · ' + user.city : ''}
                </div>
            </div>
        </div>
    `;
}

function pickSearchedUserForMessage(profileId, name, email, city) {
    // Auto-add to contacts
    if (!contacts.find(c => c.linkedProfileId === profileId)) {
        const newContact = {
            name: name,
            location: city || 'Unknown',
            email: email,
            avatar: null,
            isOnMoonpop: true,
            linkedProfileId: profileId
        };
        contacts.push(newContact);
        if (currentAuthUser) {
            sb.from('contacts').insert({
                owner_id: currentAuthUser.id,
                name: name,
                city: city || null,
                email: email,
                is_on_moonpop: true,
                linked_profile_id: profileId
            });
        }
    }
    // Open compose
    closeNewMessagePicker();
    selectedRecipient = {
        name: name,
        email: email,
        location: city || 'Unknown',
        isOnMoonpop: true,
        linkedProfileId: profileId
    };
    openModalForRecipient();
}

function pickEmailForMessage(email) {
    closeNewMessagePicker();
    selectedRecipient = {
        name: email,
        email: email,
        location: 'Unknown',
        isOnMoonpop: false,
        linkedProfileId: null,
        isNew: true
    };
    openModalForRecipient();
}

function pickContactForMessage(contactName) {
    const contact = contacts.find(c => c.name === contactName);
    if (!contact) return;
    closeNewMessagePicker();
    selectedRecipient = {
        name: contact.name,
        email: contact.email,
        location: contact.location,
        isOnMoonpop: contact.isOnMoonpop,
        linkedProfileId: contact.linkedProfileId
    };
    openModalForRecipient();
}

function _openComposePanel() {
    // Close other panels first
    if (document.getElementById('sharedSkyPage').classList.contains('active')) closeSharedSkyModal();
    if (document.getElementById('messagePageView').classList.contains('active')) _closeMessageDetailUI();

    const page = document.getElementById('messageModal');
    page.classList.remove('closing');
    page.classList.add('active');
    if (window.innerWidth >= 901) {
        document.body.classList.add('chat-open');
        const leftPanel = document.querySelector('.split-left');
        const splitLayout = document.querySelector('.split-layout');
        if (leftPanel && splitLayout) {
            const slRect = splitLayout.getBoundingClientRect();
            page.style.left = (leftPanel.getBoundingClientRect().right + 24) + 'px';
            page.style.top = slRect.top + 'px';
            page.style.bottom = (window.innerHeight - slRect.bottom) + 'px';
            page.style.height = 'auto';
        }
    } else {
        document.body.style.overflow = 'hidden';
    }
}

function _closeComposePanel() {
    const page = document.getElementById('messageModal');
    if (window.innerWidth >= 901) {
        page.classList.add('closing');
        setTimeout(() => {
            page.classList.remove('active', 'closing');
            page.style.left = '';
            page.style.top = '';
            page.style.bottom = '';
            page.style.height = '';
            document.body.classList.remove('chat-open');
        }, 200);
    } else {
        page.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function openNewContactForMessage() {
    closeNewMessagePicker();
    selectedRecipient = null;
    // Open compose modal directly to new contact form
    showDefaultCompose();
    _openComposePanel();
    // Show new contact form immediately
    document.getElementById('composeStep1').style.display = 'none';
    document.getElementById('composeNewContact').style.display = 'block';
    // Update header (dark theme)
    const header = document.getElementById('composeHeader');
    header.innerHTML = `
        <button class="compose-header-btn" onclick="backToRecipientPicker()">
            <svg width="18" height="18" style="color:white"><use href="#icon-back"/></svg>
        </button>
        <span style="font-weight:700;color:white;font-size:15px;">New Contact</span>
        <span style="width:36px;"></span>
    `;
}

// Open compose modal with a pre-selected recipient (WhatsApp-style: always recipient first)
function openModalForRecipient() {
    showDefaultCompose();
    _openComposePanel();

    // Refresh song suggestions each time compose opens
    refreshSongSuggestions();

    // Start in Open Note mode (default)
    composeToggleMode('open-note');

    // Show dark-themed header with recipient info
    if (selectedRecipient) {
        const header = document.getElementById('composeHeader');
        const initials = selectedRecipient.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        header.innerHTML = `
            <button class="compose-header-btn" onclick="backToRecipientPicker()">
                <svg width="18" height="18" style="color:white"><use href="#icon-back"/></svg>
            </button>
            <div class="compose-header-content">
                <div class="compose-avatar">
                    <div class="compose-avatar-inner">${initials}</div>
                    <div class="compose-avatar-sparkle">
                        <svg width="10" height="10" style="color:#ffd54f"><use href="#icon-sparkle"/></svg>
                    </div>
                </div>
                <div>
                    <div class="compose-recipient-name">
                        ${selectedRecipient.name}
                        <span class="compose-recipient-badge">Recipient</span>
                    </div>
                    <div class="compose-arrival-time">Arrives at moonrise</div>
                </div>
            </div>
            <button class="compose-header-btn" onclick="closeModal()">
                <svg width="18" height="18" style="color:white"><use href="#icon-close"/></svg>
            </button>
        `;
    }
}

// Compose toggle between Open Note and Go Lunar modes
function composeToggleMode(mode) {
    const openNoteBtn = document.getElementById('toggleOpenNote');
    const goLunarBtn = document.getElementById('toggleGoLunar');
    const openNoteContent = document.getElementById('composeOpenNote');
    const goLunarContent = document.getElementById('composeGoLunar');
    if (!openNoteBtn || !goLunarBtn) return;

    if (mode === 'open-note') {
        openNoteBtn.classList.add('active');
        goLunarBtn.classList.remove('active');
        openNoteContent.style.display = 'block';
        goLunarContent.style.display = 'none';
        lunarNoteActive = false;
    } else {
        openNoteBtn.classList.remove('active');
        goLunarBtn.classList.add('active');
        openNoteContent.style.display = 'none';
        goLunarContent.style.display = 'block';

        // Activate lunar note wizard with unique combinatorial prompts
        if (!lunarNoteActive) {
            lunarNoteActive = true;
            currentLunarTemplate = -1;

            // Pick unique prompts from combinatorial pools using hash
            const userId = currentAuthUser?.id || 'anonymous';
            const seed = hashCode(userId + Date.now().toString());
            const p1 = Math.abs(seed) % LUNAR_POOL_1.length;
            const p2 = Math.abs(seed * 31 + 7) % LUNAR_POOL_2.length;
            const p3 = Math.abs(seed * 37 + 13) % LUNAR_POOL_3.length;
            currentPromptSet = Math.abs(seed) % 10000;

            // Set moon data for moon-aware templates
            const moonPhase = getMoonPhase();
            const moonZodiac = getMoonZodiac();
            _lunarMoonPhase = moonPhase.phaseName.toLowerCase();
            _lunarZodiac = moonZodiac.sign;

            // Apply prompts from independent pools
            document.getElementById('lunarLabel1').textContent = LUNAR_POOL_1[p1].label;
            document.getElementById('lunarInput1').placeholder = LUNAR_POOL_1[p1].placeholder;
            document.getElementById('lunarLabel2').textContent = LUNAR_POOL_2[p2].label;
            document.getElementById('lunarInput2').placeholder = LUNAR_POOL_2[p2].placeholder;
            document.getElementById('lunarLabel3').textContent = LUNAR_POOL_3[p3].label;
            document.getElementById('lunarInput3').placeholder = LUNAR_POOL_3[p3].placeholder;

            goLunarStep(1);
        }
    }
}

// Toggle music expansion panel
function toggleComposeMusic() {
    const panel = document.getElementById('composeMusicPanel');
    const btn = document.getElementById('composeMusicBtn');
    if (!panel || !btn) return;
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    btn.classList.toggle('active', !isVisible);
    if (!isVisible) {
        refreshSongSuggestions();
        setTimeout(() => document.getElementById('songInput')?.focus(), 100);
    }
}

// Toggle photo expansion panel
function toggleComposePhoto() {
    const panel = document.getElementById('composePhotoPanel');
    const btn = document.getElementById('composePhotoBtn');
    if (!panel || !btn) return;
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
    btn.classList.toggle('active', !isVisible);
}

function openModal() {
    // WhatsApp-style: always pick recipient first
    openNewMessagePicker();
}

function openMoonDownModal() {
    const countdown = getCountdown();
    const timeStr = countdown.hours > 0
        ? `${countdown.hours}h ${countdown.minutes}m`
        : `${countdown.minutes}m`;
    document.getElementById('moonDownCountdown').textContent = timeStr;
    const riseTimeEl = document.getElementById('moonDownRiseTime');
    if (riseTimeEl) {
        const riseTime = moonData.moonrise !== '--:--' ? moonData.moonrise : '';
        riseTimeEl.textContent = riseTime ? `Moonrise at ${riseTime}` : '';
    }
    document.getElementById('moonDownModal').classList.add('active');
}

function closeMoonDownModal() {
    document.getElementById('moonDownModal').classList.remove('active');
}

// VAPID public key for Web Push (matches push-notify Edge Function)
const VAPID_PUBLIC_KEY = 'BHqBb8cUt0T7Zb2aBo3G8vFpQRw0zBVnKbGqT5Fv3qYxPkPU4A9J-a4dIWx7U5VnSXBqK8aGnL1yMzRsQf3xG8';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
    return arr;
}

async function toggleNotifications() {
    const btn = document.getElementById('notifToggleBtn');
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        if (btn) { btn.textContent = 'Not supported'; btn.disabled = true; }
        return;
    }
    if (Notification.permission === 'granted') {
        // Already enabled — unsubscribe
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) await sub.unsubscribe();
            if (currentAuthUser) {
                await sb.from('push_subscriptions').delete().eq('user_id', currentAuthUser.id);
            }
            if (btn) { btn.textContent = 'Enable'; btn.style.background = 'transparent'; btn.style.color = 'var(--blue)'; }
        } catch(e) { console.error('Unsubscribe failed:', e); }
        return;
    }
    if (Notification.permission === 'denied') {
        alert('Notifications are blocked. Please enable them in your browser settings.');
        return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        await subscribeToPush();
        if (btn) { btn.textContent = 'Enabled'; btn.style.background = 'var(--blue)'; btn.style.color = 'white'; }
    }
}

function updateNotifButton() {
    const btn = document.getElementById('notifToggleBtn');
    if (!btn) return;
    if (!('Notification' in window)) {
        btn.textContent = 'Not supported'; btn.disabled = true; return;
    }
    if (Notification.permission === 'granted') {
        btn.textContent = 'Enabled'; btn.style.background = 'var(--blue)'; btn.style.color = 'white';
    } else if (Notification.permission === 'denied') {
        btn.textContent = 'Blocked'; btn.style.background = '#ccc'; btn.style.color = '#666';
    } else {
        btn.textContent = 'Enable'; btn.style.background = 'transparent'; btn.style.color = 'var(--blue)';
    }
}

// ========================
