// Moon Reveal Page

// ============================================
// MOON REVEAL PAGE (recipient landing page)
// ============================================
let revealCountdownInterval = null;

async function checkMessageLink() {
    const params = new URLSearchParams(window.location.search);
    const messageId = params.get('m');
    if (!messageId) return false;

    // Show the reveal page immediately
    const page = document.getElementById('moonRevealPage');
    page.classList.add('active');
    document.getElementById('revealLoading').style.display = 'block';
    document.getElementById('revealError').style.display = 'none';
    document.getElementById('revealLoaded').style.display = 'none';

    // Fetch the message via secure edge function (no anon DB access)
    const { data: revealData, error } = await sb.functions.invoke('reveal-message', {
        body: { id: messageId }
    });

    document.getElementById('revealLoading').style.display = 'none';

    if (error || !revealData || revealData.error) {
        console.error('Message fetch error:', error || revealData?.error);
        document.getElementById('revealError').style.display = 'block';
        return true;
    }

    const msg = revealData.message;
    const senderProfile = revealData.sender;

    // Populate the reveal page
    const senderName = senderProfile?.username || 'Someone';
    document.getElementById('revealSenderName').textContent = senderName;
    const revealPhase = msg.moon_phase || 'waxing gibbous';
    document.getElementById('revealPhaseName').textContent = revealPhase;
    document.getElementById('revealPhaseIcon').innerHTML = phaseIconSvg(revealPhase, 'md');
    document.getElementById('revealCity').textContent = msg.recipient_city || 'your city';

    const isReleased = msg.status === 'released' || 
        (msg.release_at && new Date(msg.release_at) <= new Date());

    if (isReleased) {
        // Message is released — show it!
        showRevealedMessage(msg);
    } else if (msg.release_at) {
        // Not yet released — show countdown
        showRevealCountdown(msg);
    } else {
        // No release time set — show message anyway
        showRevealedMessage(msg);
    }

    document.getElementById('revealLoaded').style.display = 'block';

    return true;
}

function showRevealedMessage(msg) {
    document.getElementById('revealCountdown').style.display = 'none';
    document.getElementById('revealMessage').style.display = 'block';
    document.getElementById('revealMessage').classList.remove('moon-reveal-blurred');
    document.getElementById('revealCta').style.display = 'block';

    // Set message text
    document.getElementById('revealMessageText').textContent = msg.message_text || '';

    // Show lunar note if present
    if (msg.lunar_note_text) {
        document.getElementById('revealLunarNote').style.display = 'block';
        document.getElementById('revealLunarText').textContent = msg.lunar_note_text;
        document.getElementById('revealLunarClosing').textContent = msg.lunar_note_closing || '';
    }
}

function showRevealCountdown(msg) {
    document.getElementById('revealCountdown').style.display = 'block';
    document.getElementById('revealMessage').style.display = 'block';
    document.getElementById('revealMessage').classList.add('moon-reveal-blurred');
    document.getElementById('revealCta').style.display = 'none';

    // Set blurred message text (it's blurred via CSS so it's not readable)
    document.getElementById('revealMessageText').textContent = msg.message_text || 'A message is waiting for you...';
    if (msg.lunar_note_text) {
        document.getElementById('revealLunarNote').style.display = 'block';
        document.getElementById('revealLunarText').textContent = msg.lunar_note_text;
        document.getElementById('revealLunarClosing').textContent = msg.lunar_note_closing || '';
    }

    const releaseDate = new Date(msg.release_at);

    function updateCountdown() {
        const now = new Date();
        const diff = releaseDate - now;

        if (diff <= 0) {
            // Time's up! Reveal the message
            clearInterval(revealCountdownInterval);
            showRevealedMessage(msg);
            return;
        }

        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        const pad = n => String(n).padStart(2, '0');
        document.getElementById('revealCountdownTime').textContent = 
            `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }

    updateCountdown();
    revealCountdownInterval = setInterval(updateCountdown, 1000);
}

function revealSignupToReply() {
    // Close reveal page and show the signup flow
    closeMoonRevealPage();
    history.replaceState(null, '', window.location.pathname);
    showOnboarding();
}

function closeMoonRevealPage() {
    document.getElementById('moonRevealPage').classList.remove('active');
    if (revealCountdownInterval) {
        clearInterval(revealCountdownInterval);
        revealCountdownInterval = null;
    }
}


