// Moon Circles Functions

// MOON CIRCLES FUNCTIONS
// ============================================
let currentCircleIndex = -1;
let newCircleEmoji = '🔥';
let newCircleMembers = [];

function renderCircleRows() {
    const container = document.getElementById('circleRows');
    if (!container) return;
    
    container.innerHTML = moonCircles.map((circle, i) => {
        const tonight = circle.nights[circle.nights.length - 1];
        let statusClass = 'contributed';
        let statusText = 'Up to date';
        
        if (tonight && tonight.yourTurn) {
            const yourContrib = tonight.contributions.find(c => c.member === 'You');
            if (!yourContrib) {
                statusClass = 'awaiting';
                statusText = 'Your turn';
            }
        }
        
        const lastNote = tonight?.contributions[tonight.contributions.length - 1];
        const preview = lastNote ? 
            lastNote.member + ': ' + lastNote.note.text.split('\n')[0].substring(0, 40) + '...' :
            'No notes yet tonight';
        
        return `
            <div class="circle-row" onclick="openCircleDetail(${i})">
                <div class="circle-row-icon">${circle.emoji}</div>
                <div class="circle-row-content">
                    <div class="circle-row-title">${circle.name}</div>
                    <div class="circle-row-subtitle">${preview}</div>
                </div>
                <span class="circle-row-status ${statusClass}">${statusText}</span>
            </div>
        `;
    }).join('');
}

function openCircleDetail(index) {
    currentCircleIndex = index;
    const circle = moonCircles[index];
    document.getElementById('circleDetailTitle').textContent = circle.emoji + ' ' + circle.name;
    renderCircleDetail(circle);
    document.getElementById('circleDetailPage').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeCircleDetail() {
    document.getElementById('circleDetailPage').classList.remove('active');
    document.body.style.overflow = '';
    currentCircleIndex = -1;
    renderCircleRows();
}

function renderCircleDetail(circle) {
    const body = document.getElementById('circleDetailBody');
    let html = '';
    
    // Header
    html += `
        <div class="circle-detail-header">
            <div class="circle-detail-emoji">${circle.emoji}</div>
            <div class="circle-detail-name">${circle.name}</div>
            <div class="circle-detail-members">${circle.members.join(', ')} & You</div>
        </div>
    `;
    
    // Tonight's prompt
    const tonight = circle.nights[circle.nights.length - 1];
    if (tonight) {
        const ps = PROMPT_SETS[tonight.promptSetIndex % PROMPT_SETS.length];
        html += `
            <div class="circle-tonight">
                <div class="circle-tonight-label">Tonight's prompt</div>
                <div class="circle-tonight-prompt">
                    ${ps.prompts.map(p => '• ' + p.label).join('<br>')}
                </div>
            </div>
        `;
        
        // Contribute button or panel
        const yourContrib = tonight.contributions.find(c => c.member === 'You');
        if (!yourContrib && tonight.yourTurn) {
            html += `<div id="circleContributeArea">
                <button class="circle-contribute-btn" onclick="showCircleContribute(${circle.nights.length - 1})">🌙 Add your Lunar Note</button>
            </div>`;
        }
    }
    
    // Render nights (newest first)
    for (let ni = circle.nights.length - 1; ni >= 0; ni--) {
        const night = circle.nights[ni];
        const ps = PROMPT_SETS[night.promptSetIndex % PROMPT_SETS.length];
        const dateLabel = ni === circle.nights.length - 1 ? 'Tonight' : night.date;
        
        html += `<div class="circle-night">
            <div class="circle-night-date">${dateLabel}</div>`;
        
        // Show contributions
        night.contributions.forEach(contrib => {
            if (contrib.note) {
                html += `
                    <div class="circle-note-card">
                        <div class="circle-note-author">${contrib.member}${contrib.location ? ' · ' + contrib.location : ''}</div>
                        <div class="circle-note-text">${contrib.note.text}</div>
                        <div class="circle-note-closing">${contrib.note.closing}</div>
                    </div>
                `;
            }
        });
        
        // Show who hasn't contributed yet
        const allMembers = [...circle.members, 'You'];
        const contributed = night.contributions.filter(c => c.note).map(c => c.member);
        const waiting = allMembers.filter(m => !contributed.includes(m));
        
        if (waiting.length > 0 && ni === circle.nights.length - 1) {
            html += `<div class="circle-note-waiting">Waiting on ${waiting.join(', ')}</div>`;
        }
        
        html += `</div>`;
    }
    
    body.innerHTML = html;
}

function showCircleContribute(nightIndex) {
    const circle = moonCircles[currentCircleIndex];
    const night = circle.nights[nightIndex];
    const ps = PROMPT_SETS[night.promptSetIndex % PROMPT_SETS.length];
    
    const area = document.getElementById('circleContributeArea');
    area.innerHTML = `
        <div class="circle-contribute-panel">
            <div class="thread-lunar-header">
                <span>🌙 Your Lunar Note</span>
            </div>
            <p class="thread-lunar-intro">Give me three things. The moon does the rest.</p>
            <div class="thread-lunar-step">
                <label class="thread-lunar-label">${ps.prompts[0].label}</label>
                <input type="text" class="thread-lunar-input" id="circleInput1" placeholder="${ps.prompts[0].placeholder}" oninput="checkCircleInputs()">
            </div>
            <div class="thread-lunar-step" id="circleStep2" style="display:none;">
                <label class="thread-lunar-label">${ps.prompts[1].label}</label>
                <input type="text" class="thread-lunar-input" id="circleInput2" placeholder="${ps.prompts[1].placeholder}" oninput="checkCircleInputs()">
            </div>
            <div class="thread-lunar-step" id="circleStep3" style="display:none;">
                <label class="thread-lunar-label">${ps.prompts[2].label}</label>
                <input type="text" class="thread-lunar-input" id="circleInput3" placeholder="${ps.prompts[2].placeholder}" oninput="checkCircleInputs()">
            </div>
            <div id="circlePreview" style="display:none;" class="circle-contribute-result"></div>
            <button class="thread-lunar-send" id="circleSubmitBtn" onclick="submitCircleNote()" disabled>Send to Circle</button>
        </div>
    `;
    document.getElementById('circleInput1').focus();
}

let circleContribStep = 1;
function checkCircleInputs() {
    const v1 = document.getElementById('circleInput1')?.value.trim();
    const v2 = document.getElementById('circleInput2')?.value.trim();
    const v3 = document.getElementById('circleInput3')?.value.trim();
    
    if (v1 && circleContribStep === 1) {
        document.getElementById('circleStep2').style.display = 'block';
        circleContribStep = 2;
        document.getElementById('circleInput2').focus();
    }
    if (v2 && circleContribStep === 2) {
        document.getElementById('circleStep3').style.display = 'block';
        circleContribStep = 3;
        document.getElementById('circleInput3').focus();
    }
    
    if (v1 && v2 && v3) {
        const circle = moonCircles[currentCircleIndex];
        const night = circle.nights[circle.nights.length - 1];
        const templateIdx = night.promptSetIndex % lunarTemplates.length;
        const result = lunarTemplates[templateIdx](v1, v2, v3);
        
        const preview = document.getElementById('circlePreview');
        preview.innerHTML = result.lines.replace(/\n/g, '<br>') + 
            '<div class="lunar-closing" style="font-size:12px;color:var(--text-muted);margin-top:6px;font-style:italic;">' + result.closing + '</div>';
        preview.style.display = 'block';
        document.getElementById('circleSubmitBtn').disabled = false;
    }
}

async function submitCircleNote() {
    const circle = moonCircles[currentCircleIndex];
    const night = circle.nights[circle.nights.length - 1];
    
    const v1 = document.getElementById('circleInput1').value.trim();
    const v2 = document.getElementById('circleInput2').value.trim();
    const v3 = document.getElementById('circleInput3').value.trim();
    const templateIdx = night.promptSetIndex % lunarTemplates.length;
    const result = lunarTemplates[templateIdx](v1, v2, v3);
    
    night.contributions.push({
        member: 'You',
        note: { text: result.lines, closing: result.closing }
    });
    night.yourTurn = false;

    // Save to Supabase
    if (currentAuthUser && night.dbId) {
        const { error } = await sb.from('circle_contributions').insert({
            night_id: night.dbId,
            user_id: currentAuthUser.id,
            input_1: v1,
            input_2: v2,
            input_3: v3,
            note_text: result.lines,
            note_closing: result.closing
        });
        if (error) console.error('Circle contribution save failed:', error);
    }
    
    circleContribStep = 1;
    renderCircleDetail(circle);
}

// Create circle
function openCreateCircle() {
    newCircleEmoji = '🔥';
    newCircleMembers = [];
    document.getElementById('newCircleName').value = '';
    document.getElementById('circleSelectedMembers').innerHTML = '';
    document.getElementById('circleMemberDropdown').innerHTML = '';
    document.getElementById('circleMemberSearch').value = '';
    document.getElementById('createCircleBtn').disabled = true;
    document.querySelectorAll('.circle-emoji-pick').forEach(b => b.classList.remove('active'));
    document.querySelector('.circle-emoji-pick').classList.add('active');
    document.getElementById('createCirclePage').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeCreateCircle() {
    document.getElementById('createCirclePage').classList.remove('active');
    document.body.style.overflow = '';
}

function pickCircleEmoji(btn, emoji) {
    newCircleEmoji = emoji;
    document.querySelectorAll('.circle-emoji-pick').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    checkCreateCircle();
}

function filterCircleMembers(query) {
    const dropdown = document.getElementById('circleMemberDropdown');
    const available = contacts.filter(c => 
        c.isOnMoonpop && 
        !newCircleMembers.includes(c.name) &&
        (query === '' || c.name.toLowerCase().includes(query.toLowerCase()))
    );
    
    if (available.length === 0) {
        dropdown.innerHTML = '<div style="padding:10px;font-size:13px;color:var(--text-muted);">No contacts found</div>';
        dropdown.classList.add('active');
        return;
    }
    
    dropdown.innerHTML = available.map(c => `
        <div class="recipient-option" onclick="addCircleMember('${c.name}', '${c.location}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #eee;">
            <strong style="color:var(--blue);">${c.name}</strong>
            <span style="font-size:12px;color:var(--text-muted);margin-left:6px;">${c.location}</span>
        </div>
    `).join('');
    dropdown.classList.add('active');
}

function addCircleMember(name, location) {
    if (newCircleMembers.includes(name)) return;
    newCircleMembers.push(name);
    renderCircleMemberChips();
    document.getElementById('circleMemberSearch').value = '';
    document.getElementById('circleMemberDropdown').innerHTML = '';
    document.getElementById('circleMemberDropdown').classList.remove('active');
    checkCreateCircle();
}

function removeCircleMember(name) {
    newCircleMembers = newCircleMembers.filter(m => m !== name);
    renderCircleMemberChips();
    checkCreateCircle();
}

function renderCircleMemberChips() {
    const container = document.getElementById('circleSelectedMembers');
    container.innerHTML = newCircleMembers.map(m => `
        <span class="circle-member-chip">
            ${m}
            <button class="remove-member" onclick="removeCircleMember('${m}')">×</button>
        </span>
    `).join('');
}

function checkCreateCircle() {
    const name = document.getElementById('newCircleName').value.trim();
    document.getElementById('createCircleBtn').disabled = !(name && newCircleMembers.length >= 1);
}

// Add oninput to name field
document.addEventListener('DOMContentLoaded', () => {
    const nameInput = document.getElementById('newCircleName');
    if (nameInput) nameInput.addEventListener('input', checkCreateCircle);
});

async function createCircle() {
    const name = document.getElementById('newCircleName').value.trim();
    if (!name || newCircleMembers.length < 1) return;
    
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);

    if (currentAuthUser) {
        // Create circle in Supabase
        const { data: circle, error: circleErr } = await sb.from('moon_circles')
            .insert({ name: name, emoji: newCircleEmoji, creator_id: currentAuthUser.id })
            .select()
            .single();

        if (circleErr || !circle) {
            console.error('Create circle failed:', circleErr);
            return;
        }

        // Add creator as member
        await sb.from('circle_members').insert({
            circle_id: circle.id,
            user_id: currentAuthUser.id
        });

        // Create first night
        await sb.from('circle_nights').insert({
            circle_id: circle.id,
            date: new Date().toISOString().split('T')[0],
            prompt_set_index: dayOfYear % PROMPT_SETS.length
        });

        // Add to local array
        const username = localStorage.getItem('moonpop_username') || 'You';
        moonCircles.push({
            id: circle.id,
            name: name,
            emoji: newCircleEmoji,
            members: [username, ...newCircleMembers],
            nights: [{
                date: new Date().toISOString().split('T')[0],
                promptSetIndex: dayOfYear % PROMPT_SETS.length,
                contributions: [],
                yourTurn: true
            }]
        });
    } else {
        moonCircles.push({
            id: 'circle' + Date.now(),
            name: name,
            emoji: newCircleEmoji,
            members: [...newCircleMembers],
            nights: [{
                date: new Date().toISOString().split('T')[0],
                promptSetIndex: dayOfYear % PROMPT_SETS.length,
                contributions: [],
                yourTurn: true
            }]
        });
    }
    
    closeCreateCircle();
    renderCircleRows();
}

