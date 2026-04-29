// Media — YouTube Embed & Moon Photos

// YOUTUBE EMBED
// ========================
let selectedSongTitle = '';

// Large pool of moon-themed songs
const MOON_SONGS = [
    { url: 'https://open.spotify.com/track/2iuZJX9X9P0GKaE93xcPjk', title: 'Talking to the Moon — Bruno Mars', short: 'Talking to the Moon' },
    { url: 'https://open.spotify.com/track/4hcRMBR9PxDCIG6MbceHqn', title: 'Moon River — Frank Ocean', short: 'Moon River' },
    { url: 'https://open.spotify.com/track/5b7OgMGTUBLFKZKhcHMpPl', title: 'Fly Me to the Moon — Frank Sinatra', short: 'Fly Me to the Moon' },
    { url: 'https://open.spotify.com/track/3CuU9JRx4mkyJfMVuaIGBR', title: 'Moonlight Sonata — Beethoven', short: 'Moonlight Sonata' },
    { url: 'https://open.spotify.com/track/5xJpHo5gchc0peBkmCfziS', title: 'Moondance — Van Morrison', short: 'Moondance' },
    { url: 'https://open.spotify.com/track/20OFwXhEXf12DzwXmaV7fj', title: 'Bad Moon Rising — CCR', short: 'Bad Moon Rising' },
    { url: 'https://open.spotify.com/track/3gdewACMIVMEWVbyb8O9sY', title: 'Rocket Man — Elton John', short: 'Rocket Man' },
    { url: 'https://open.spotify.com/track/72Z17vmmeQKAg8bptWvpVG', title: 'Space Oddity — David Bowie', short: 'Space Oddity' },
    { url: 'https://open.spotify.com/track/6Uy6K2JZymJCi44B6Ij5cn', title: 'Harvest Moon — Neil Young', short: 'Harvest Moon' },
    { url: 'https://open.spotify.com/track/1S3JMefVKIx6gBPjRdCOPE', title: 'Clair de Lune — Debussy', short: 'Clair de Lune' },
    { url: 'https://open.spotify.com/track/0lY11JLscSWjoCiDa8gFaV', title: 'Total Eclipse of the Heart — Bonnie Tyler', short: 'Total Eclipse of the Heart' },
    { url: 'https://open.spotify.com/track/2C3QkLmK4kNmuRRwkbQzxi', title: 'Moon Song — Phoebe Bridgers', short: 'Moon Song' },
    { url: 'https://open.spotify.com/track/76LVXPC8MLNhHNDVFBT3Cb', title: 'Moonshadow — Cat Stevens', short: 'Moonshadow' },
    { url: 'https://open.spotify.com/track/2TfSHkHiFO4gGeldtDBhfz', title: 'To the Moon and Back — Savage Garden', short: 'To the Moon and Back' },
    { url: 'https://open.spotify.com/track/2tpWsVSb9UEmDRxAl1zhX1', title: 'Counting Stars — OneRepublic', short: 'Counting Stars' },
    { url: 'https://open.spotify.com/track/0FDzzruyVECATHXKHnpAkG', title: 'A Sky Full of Stars — Coldplay', short: 'A Sky Full of Stars' },
    { url: 'https://open.spotify.com/track/0QZ5yyl6B6utIWkxeBDxQN', title: 'The Night We Met — Lord Huron', short: 'The Night We Met' },
    { url: 'https://open.spotify.com/track/6lanRgr6wXibZr8KgzXxBl', title: 'A Thousand Years — Christina Perri', short: 'A Thousand Years' },
    { url: 'https://open.spotify.com/track/0fFJOwNBXOXUWrDBZyp0tT', title: 'Dancing in the Moonlight — Toploader', short: 'Dancing in the Moonlight' },
    { url: 'https://open.spotify.com/track/4gMgiXfqyzZLMhsksGmbQV', title: 'Moonlight — XXXTENTACION', short: 'Moonlight' },
    { url: 'https://open.spotify.com/track/3hRV0jL3vUpRrcy398teAU', title: 'Moon — Kanye West', short: 'Moon' },
    { url: 'https://open.spotify.com/track/1YQWosTIljIvxAgHWTp7KP', title: 'Moonlight on the River — Mac DeMarco', short: 'Moonlight on the River' },
    { url: 'https://open.spotify.com/track/3AJwUDP919kvQ9QcozQPxg', title: 'Yellow — Coldplay', short: 'Yellow' },
    { url: 'https://open.spotify.com/track/4aWmUDTfIPGksMNLV2rQP2', title: 'Slow Dancing in the Dark — Joji', short: 'Slow Dancing in the Dark' },
    { url: 'https://open.spotify.com/track/3GCL1PBwZJyBfMciiRfJQo', title: 'New Light — John Mayer', short: 'New Light' },
    { url: 'https://open.spotify.com/track/1mea3bSkSGXuIRvnydlB5b', title: 'Viva la Vida — Coldplay', short: 'Viva la Vida' },
    { url: 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b', title: 'Blinding Lights — The Weeknd', short: 'Blinding Lights' },
    { url: 'https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3', title: 'Shape of You — Ed Sheeran', short: 'Shape of You' },
    { url: 'https://open.spotify.com/track/5HCyWlXZPP0y6Gqq8TgA20', title: 'Stairway to Heaven — Led Zeppelin', short: 'Stairway to Heaven' },
    { url: 'https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv', title: 'Bohemian Rhapsody — Queen', short: 'Bohemian Rhapsody' },
];
let lastSongSuggestions = [];

function refreshSongSuggestions() {
    const container = document.getElementById('songSuggestions');
    if (!container) return;
    // Pick 4 random songs, avoid repeating last set
    const available = MOON_SONGS.filter((_, i) => !lastSongSuggestions.includes(i));
    const shuffled = available.sort(() => Math.random() - 0.5).slice(0, 4);
    lastSongSuggestions = shuffled.map(s => MOON_SONGS.indexOf(s));
    container.innerHTML = shuffled.map(s =>
        `<span class="song-suggestion" onclick="selectSong('${s.url}', '${s.title.replace(/'/g, "\\'")}')">🌙 ${s.short}</span>`
    ).join('') + `<span class="song-suggestion" onclick="refreshSongSuggestions()" style="opacity:0.6;">↻ more</span>`;
}

async function searchYouTubeSong() {
    const input = document.getElementById('songInput');
    const query = input.value.trim();
    if (!query || extractYouTubeId(query) || extractSpotifyTrackId(query)) return;
    const resultsDiv = document.getElementById('songSearchResults');
    resultsDiv.style.display = 'block';
    resultsDiv.innerHTML = '<div style="padding:8px;color:var(--text-muted);font-size:12px;">Searching songs...</div>';
    try {
        // Search curated pool first, then offer Spotify search link
        const q = query.toLowerCase();
        const matches = MOON_SONGS.filter(s =>
            s.title.toLowerCase().includes(q) || s.short.toLowerCase().includes(q)
        );
        let html = '';
        if (matches.length > 0) {
            html += matches.map(s =>
                `<div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(212,181,138,0.06)'" onmouseout="this.style.background=''" onclick="selectSong('${s.url}', '${s.title.replace(/'/g, "\\'")}');document.getElementById('songSearchResults').style.display='none';">
                    <span>🎵</span>
                    <div style="flex:1;font-size:13px;color:var(--blue);font-weight:500;">${s.title}</div>
                </div>`
            ).join('');
        }
        html += `<a href="https://open.spotify.com/search/${encodeURIComponent(query)}" target="_blank" style="display:flex;align-items:center;gap:8px;padding:10px;border-radius:8px;cursor:pointer;text-decoration:none;border-top:1px solid #f0ece4;margin-top:4px;" onmouseover="this.style.background='rgba(212,181,138,0.06)'" onmouseout="this.style.background=''">
            <span>🔍</span>
            <div style="flex:1;font-size:13px;color:var(--blue);font-weight:500;">Search "${query}" on Spotify</div>
            <span style="font-size:11px;color:var(--text-muted);">↗</span>
        </a>`;
        resultsDiv.innerHTML = html;
    } catch(e) {
        resultsDiv.innerHTML = `<a href="https://open.spotify.com/search/${encodeURIComponent(query)}" target="_blank" style="display:block;padding:10px;font-size:13px;color:var(--blue);text-decoration:none;">🔍 Search "${query}" on Spotify ↗</a>`;
    }
}

function extractYouTubeId(url) {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

function extractSpotifyTrackId(url) {
    if (!url) return null;
    const m = url.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
    return m ? m[1] : null;
}

function onSongInput() {
    const input = document.getElementById('songInput');
    const val = input.value.trim();
    const videoId = extractYouTubeId(val);
    const spotifyId = extractSpotifyTrackId(val);
    const searchBtn = document.getElementById('songSearchBtn');
    const searchResults = document.getElementById('songSearchResults');
    const suggestions = document.getElementById('songSuggestions');

    // Remove existing embed
    const existing = document.getElementById('ytEmbed');
    if (existing) existing.remove();

    if (spotifyId) {
        // It's a Spotify URL — embed compact player
        searchBtn.style.display = 'none';
        searchResults.style.display = 'none';
        suggestions.style.display = 'none';
        const title = selectedSongTitle || '';
        const embed = document.createElement('div');
        embed.className = 'yt-embed';
        embed.id = 'ytEmbed';
        embed.innerHTML = `
            <div style="border-radius:12px;overflow:hidden;">
                <iframe src="https://open.spotify.com/embed/track/${spotifyId}?utm_source=generator&theme=0" width="100%" height="152" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" style="border-radius:12px;border:none;"></iframe>
            </div>
            <div class="yt-embed-bar">
                <span class="yt-embed-title">${title || 'Spotify Track'}</span>
                <button class="yt-embed-remove" onclick="clearSong()" title="Remove">×</button>
            </div>
        `;
        const container = document.getElementById('ytEmbedContainer');
        if (container) container.appendChild(embed);
    } else if (videoId) {
        // It's a YouTube URL — embed it (legacy support)
        searchBtn.style.display = 'none';
        searchResults.style.display = 'none';
        suggestions.style.display = 'none';
        const title = selectedSongTitle || '';
        const embed = document.createElement('div');
        embed.className = 'yt-embed';
        embed.id = 'ytEmbed';
        embed.innerHTML = `
            <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:10px;">
                <iframe src="https://www.youtube.com/embed/${videoId}?rel=0" allow="autoplay; encrypted-media" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;"></iframe>
            </div>
            <div class="yt-embed-bar">
                <span class="yt-embed-title">${title || 'youtu.be/' + videoId}</span>
                <button class="yt-embed-remove" onclick="clearSong()" title="Remove">×</button>
            </div>
        `;
        const container = document.getElementById('ytEmbedContainer');
        if (container) container.appendChild(embed);
    } else if (val.length > 1) {
        // It's a text search query — show search button
        searchBtn.style.display = '';
        suggestions.style.display = 'none';
    } else {
        // Empty or short — show suggestions, hide search
        searchBtn.style.display = 'none';
        searchResults.style.display = 'none';
        suggestions.style.display = '';
    }
}

function clearSong() {
    document.getElementById('songInput').value = '';
    selectedSongTitle = '';
    const embed = document.getElementById('ytEmbed');
    if (embed) embed.remove();
    document.getElementById('songSearchBtn').style.display = 'none';
    document.getElementById('songSearchResults').style.display = 'none';
    document.getElementById('songSuggestions').style.display = '';
}

// ========================
// MOON PHOTO: compression + upload utilities
// ========================

// Compress an image File to JPEG blob (max 800px wide, 65% quality)
function compressMoonPhoto(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objUrl);
            const MAX_W = 800;
            let w = img.width, h = img.height;
            if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas toBlob failed'));
            }, 'image/jpeg', 0.65);
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Image load failed')); };
        img.src = objUrl;
    });
}

// Upload a compressed blob to Supabase Storage, return public URL
async function uploadMoonPhoto(blob, context) {
    if (!currentAuthUser) throw new Error('Not authenticated');
    const ts = Date.now();
    const path = `${context}/${currentAuthUser.id}/${ts}.jpg`;

    const userName = localStorage.getItem('moonpop_username') || 'Anonymous';
    const userLoc = localStorage.getItem('moonpop_location');
    let locName = 'Unknown';
    if (userLoc) { try { locName = JSON.parse(userLoc).name || 'Unknown'; } catch(e) {} }
    const phase = moonData.phase ? moonData.phase.phaseName : getMoonPhase().phaseName;

    const { data, error } = await sb.storage.from('moon-photos').upload(path, blob, {
        contentType: 'image/jpeg',
        upsert: false,
        metadata: { uploader: userName, location: locName, moon_phase: phase, date: new Date().toISOString() }
    });
    if (error) throw error;
    const { data: urlData } = sb.storage.from('moon-photos').getPublicUrl(path);
    return urlData.publicUrl;
}

// Generic handler: compress file, show preview, store file ref
function handlePhotoAttachment(input, previewImgId, previewContainerId, labelId, stateKey) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        window['_pendingPhotoFile_' + stateKey] = file;
        // Show preview from original file
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById(previewImgId);
            if (img) img.src = e.target.result;
            const container = document.getElementById(previewContainerId);
            if (container) container.style.display = 'block';
            const label = document.getElementById(labelId);
            if (label) label.textContent = 'Photo attached ✓';
        };
        reader.readAsDataURL(file);
    }
}

function clearPhotoAttachment(inputId, previewContainerId, labelId, labelText, stateKey) {
    window['_pendingPhotoFile_' + stateKey] = null;
    const container = document.getElementById(previewContainerId);
    if (container) container.style.display = 'none';
    const input = document.getElementById(inputId);
    if (input) input.value = '';
    const label = document.getElementById(labelId);
    if (label) label.textContent = labelText || 'Attach a moon photo';
}

// Compress + upload in one step, returns URL or null
async function compressAndUpload(stateKey, context) {
    const file = window['_pendingPhotoFile_' + stateKey];
    if (!file) return null;
    try {
        const blob = await compressMoonPhoto(file);
        return await uploadMoonPhoto(blob, context);
    } catch (err) {
        console.error('Moon photo upload failed:', err);
        return null;
    }
}

// ========================
// MOON PHOTO: New Moon Message (compose modal)
// ========================
let pendingMoonPhoto = null;

function handleMoonPhoto(input) {
    handlePhotoAttachment(input, 'moonPhotoImg', 'moonPhotoPreview', 'moonPhotoLabel', 'compose');
    // Also keep data URL for optimistic display
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => { pendingMoonPhoto = e.target.result; };
        reader.readAsDataURL(input.files[0]);
    }
    if (typeof updateComposeSendBtnState === 'function') updateComposeSendBtnState();
}

function clearMoonPhoto() {
    pendingMoonPhoto = null;
    clearPhotoAttachment('moonPhotoInput', 'moonPhotoPreview', 'moonPhotoLabel', 'Tap to add a moon photo', 'compose');
    if (typeof updateComposeSendBtnState === 'function') updateComposeSendBtnState();
}


// Show delivery info after recipient selection
function updateDeliveryInfo() {
    const box = document.getElementById('deliveryInfoBox');
    if (!box || !selectedRecipient) { if(box) box.style.display='none'; return; }
    
    const contact = contacts.find(c => c.name === selectedRecipient.name);
    const isOnMps = selectedRecipient.isOnMoonpop || (contact && contact.isOnMoonpop);
    
    if (isOnMps) {
        const loc = selectedRecipient.location || contact?.location;
        const info = getRecipientMoonrise(loc);
        let eta = '';
        if (info && info.hoursUntil) {
            const h = Math.floor(info.hoursUntil);
            const m = Math.round((info.hoursUntil % 1) * 60);
            eta = h > 0 ? `${h}h ${m}m` : `${m} minutes`;
        }
        box.className = 'delivery-info-box known';
        box.innerHTML = `<span class="delivery-icon">🌕</span> <strong>${selectedRecipient.name || contact?.name}</strong> is on Moon Post Service. They'll receive this at moonrise over <strong>${loc}</strong>${eta ? ' — in about <strong>' + eta + '</strong>' : ''}.`;
        box.style.display = 'block';
    } else if (selectedRecipient.isNew || (contact && !contact.isOnMoonpop)) {
        const email = selectedRecipient.email || contact?.email || '';
        box.className = 'delivery-info-box new-user';
        box.innerHTML = `<span class="delivery-icon">✉️</span> <strong>${selectedRecipient.name}</strong> isn't on Moon Post Service yet. They'll receive an email${email ? ' at <strong>' + email + '</strong>' : ''} inviting them to read your message at moonrise.`;
        box.style.display = 'block';
    } else {
        box.style.display = 'none';
    }
}
// Filter function for tabs
function filterMessages() {
    renderMessages();
    // Populate shared sky preview
    if (globalTransmissions.length > 0) {
        const latest = globalTransmissions[0];
        const previewEl = document.getElementById('sharedSkyPreview');
        if (previewEl) previewEl.textContent = latest.location + ': ' + latest.message;
        const badgeEl = document.getElementById('sharedSkyBadge');
        updateSharedSkyBadge();
    }

}

// Render global transmissions
function renderGlobalTransmissions() {
    // Render ambient signals on main page (just 2-3 glimpses)
    const signalsContainer = document.getElementById('signalsContainer');
    if (signalsContainer) {
        const displaySignals = globalTransmissions.slice(0, 3);
        signalsContainer.innerHTML = displaySignals.map(trans => `
            <div class="signal-item">
                <div class="signal-location">${trans.location} · ${trans.time}</div>
                <div class="signal-text">${trans.message}</div>
            </div>
        `).join('');
    }

    // Render full list in Shared Sky modal
    const sharedSkySignals = document.getElementById('sharedSkySignals');
    if (sharedSkySignals) {
        sharedSkySignals.innerHTML = globalTransmissions.map(trans => `
            <div class="shared-sky-signal">
                <div class="shared-sky-location">${trans.location} · ${trans.time}</div>
                <div class="shared-sky-text">${trans.message}</div>
                ${trans.photo ? `<img src="${trans.photo}" loading="lazy" style="max-width:100%;max-height:240px;border-radius:10px;margin-top:8px;object-fit:cover;">` : ''}
            </div>
        `).join('');
    }
}

function renderSharedSkySignals() {
    const container = document.getElementById('sharedSkySignals');
    if (!container) return;
    // Render oldest-first (chat order: newest at bottom)
    const sorted = [...globalTransmissions].reverse();
    container.innerHTML = sorted.map(t => {
        const nameLabel = t.senderName || t.location;
        const locationSuffix = t.senderName && t.location ? ` · ${t.location}` : '';
        const reactionsHtml = t.dbId ? renderReactionsBar(t.dbId) : '';
        // Lunar note rendering
        if (t.lunarNoteText) {
            return `
            <div class="shared-sky-signal" style="padding:14px 20px;border-bottom:1px solid rgba(212,181,138,0.1);margin:0 8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:12px;font-weight:700;color:var(--accent);">${nameLabel}<span style="font-weight:400;color:rgba(255,255,255,0.35);">${locationSuffix}</span></span>
                    <span style="font-size:11px;color:rgba(255,255,255,0.35);">${t.time}</span>
                </div>
                <div class="bubble-lunar-note" style="max-width:100%;margin:0;">
                    <div class="bubble-lunar-label">${iconSvg('lunar-note', 'sm')} Lunar Note</div>
                    <div class="bubble-lunar-text">${t.lunarNoteText}</div>
                    ${t.lunarNoteClosing ? `<div class="bubble-lunar-closing">${t.lunarNoteClosing}</div>` : ''}
                </div>
                ${t.message ? `<p style="font-size:14px;color:rgba(255,255,255,0.85);line-height:1.5;margin:8px 0 0;">${t.message}</p>` : ''}
                ${t.photo ? `<img src="${t.photo}" loading="lazy" style="max-width:100%;max-height:240px;border-radius:10px;margin-top:8px;object-fit:cover;">` : ''}
                <div class="msg-actions-row">${reactionsHtml}</div>
            </div>`;
        }
        // Regular message rendering
        return `
        <div class="shared-sky-signal" style="padding:14px 20px;border-bottom:1px solid rgba(212,181,138,0.1);margin:0 8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:12px;font-weight:700;color:var(--accent);">${nameLabel}<span style="font-weight:400;color:rgba(255,255,255,0.35);">${locationSuffix}</span></span>
                <span style="font-size:11px;color:rgba(255,255,255,0.35);">${t.time}</span>
            </div>
            ${t.message ? `<p style="font-size:14px;color:rgba(255,255,255,0.85);line-height:1.5;margin:0;">${t.message}</p>` : ''}
            ${t.photo ? `<img src="${t.photo}" loading="lazy" style="max-width:100%;max-height:240px;border-radius:10px;margin-top:8px;object-fit:cover;">` : ''}
            <div class="msg-actions-row">${reactionsHtml}</div>
        </div>`;
    }).join('');
    // Auto-scroll to bottom (newest messages)
    container.scrollTop = container.scrollHeight;
}

function openSharedSkyModal() {
    closeAllPanels();
    // Update subtitle with user's city
    const subtitle = document.getElementById('sharedSkySubtitle');
    if (subtitle) {
        const savedLoc = localStorage.getItem('moonpop_location');
        const cityName = savedLoc ? (JSON.parse(savedLoc).name || 'Your sky') : 'Your sky';
        subtitle.textContent = `Public thread · Everyone under the moon · ${cityName}`;
    }
    renderSharedSkySignals();
    const page = document.getElementById('sharedSkyPage');
    page.classList.remove('closing');
    page.classList.add('active');
    // Use inline panel on desktop (same as chat)
    if (window.innerWidth >= 901) {
        document.body.classList.add('chat-open');
        // Position panel in the right side, same as openConversation
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
    // Shared Sky is ALWAYS writable — ensure input is enabled regardless of moon state
    const ssInput = document.getElementById('sharedSkyInput');
    if (ssInput) { ssInput.disabled = false; ssInput.placeholder = 'Share something with the sky...'; }
    const ssFooter = document.querySelector('#sharedSkyPage .message-page-footer');
    if (ssFooter) { ssFooter.style.display = ''; ssFooter.style.opacity = '1'; ssFooter.style.pointerEvents = 'auto'; }
    // Mark all as seen
    localStorage.setItem('moonpop_shared_sky_seen', new Date().toISOString());
    const badgeEl = document.getElementById('sharedSkyBadge');
    if (badgeEl) { badgeEl.textContent = ''; badgeEl.style.display = 'none'; }
    // Scroll to bottom
    const feed = document.getElementById('sharedSkySignals');
    if (feed) setTimeout(() => { feed.scrollTop = feed.scrollHeight; }, 100);
    if (!arguments[0]) history.pushState({ page: 'shared-sky' }, '', '/shared-sky');
}

function closeSharedSkyModal() {
    const page = document.getElementById('sharedSkyPage');
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
    if (window.location.pathname === '/shared-sky') history.replaceState(null, '', '/');
}

function sharedSkyPlusAction() {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1);
    if (isMobile) {
        // On mobile: show menu with camera + upload options
        document.querySelectorAll('.ss-camera-only').forEach(el => el.style.display = 'flex');
        document.getElementById('sharedSkyPhotoMenu').classList.toggle('active');
    } else {
        // On desktop: just open file picker directly (no camera available)
        document.getElementById('sharedSkyPhotoInput').click();
    }
}

// Dismiss shared sky photo menu on click outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('sharedSkyPhotoMenu');
    if (menu?.classList.contains('active') && !e.target.closest('#sharedSkyPhotoMenu') && !e.target.closest('#sharedSkyPlusBtn')) {
        menu.classList.remove('active');
    }
});

function updateSharedSkyBadge() {
    const lastSeen = localStorage.getItem('moonpop_shared_sky_seen');
    const badgeEl = document.getElementById('sharedSkyBadge');
    if (!badgeEl) return;

    // Only count messages from OTHER users (not my own)
    const myId = currentAuthUser?.id;
    const othersOnly = globalTransmissions.filter(t => t.userId !== myId);

    if (!lastSeen) {
        // Never seen — all from others are new
        const count = othersOnly.length;
        if (count > 0) { badgeEl.textContent = count; badgeEl.style.display = ''; }
        else { badgeEl.style.display = 'none'; }
    } else {
        const seenDate = new Date(lastSeen);
        const newCount = othersOnly.filter(t => {
            const tDate = t.createdAt ? new Date(t.createdAt) : null;
            return tDate && tDate > seenDate;
        }).length;
        if (newCount > 0) { badgeEl.textContent = newCount; badgeEl.style.display = ''; }
        else { badgeEl.textContent = ''; badgeEl.style.display = 'none'; }
    }
}

// ========================
