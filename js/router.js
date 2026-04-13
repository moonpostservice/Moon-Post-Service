// URL Routing & Resize Handler

// ========================
// URL ROUTING (popstate)
// ========================

window.addEventListener('popstate', async function(e) {
    const path = window.location.pathname;
    const chatMatch = path.match(/\/chat\/([a-f0-9-]+)/);

    // Close all overlays first
    document.getElementById('philosophyPage').style.display = 'none';
    document.getElementById('contactsPage').style.display = 'none';

    if (e.state?.page === 'philosophy' || path === '/philosophy') {
        openPhilosophyPage(true);
    } else if (e.state?.page === 'contacts' || path === '/contacts') {
        openContactsPage(true);
    } else if (e.state?.page === 'shared-sky' || path === '/shared-sky') {
        _closeMessageDetailUI();
        openSharedSkyModal(true);
    } else if (e.state?.page === 'new-message' || path === '/new-message') {
        // Can't reliably reopen compose, go to inbox
        _closeMessageDetailUI();
        renderMessages();
    } else if (chatMatch) {
        // Navigated forward/back to a chat URL — open it
        const chatId = chatMatch[1];
        const convIdx = conversations.findIndex(c => c.dbConversationId === chatId);
        if (convIdx !== -1) {
            const conv = conversations[convIdx];
            currentConversation = conv;
            currentConversationIndex = convIdx;
            if (!conv._fullThreadLoaded && conv.dbConversationId) {
                await loadFullConversationThread(conv);
            }
            renderConversationThread();
            const _page = document.getElementById('messagePageView');
            _page.classList.add('active');
            document.body.style.overflow = 'hidden';
            const _mob = window.matchMedia('(max-width: 900px)').matches;
            if (!_mob) {
                document.body.classList.add('chat-open');
                const _lp = document.querySelector('.split-left');
                const _sl = document.querySelector('.split-layout');
                if (_lp && _sl) {
                    const _slR = _sl.getBoundingClientRect();
                    _page.style.left = (_lp.getBoundingClientRect().right + 24) + 'px';
                    _page.style.top = _slR.top + 'px';
                    _page.style.bottom = (window.innerHeight - _slR.bottom) + 'px';
                    _page.style.height = 'auto';
                }
                renderMessages();
            }
        }
    } else {
        // Navigated back to inbox
        _closeMessageDetailUI();
        closeSharedSkyModal();
        document.body.style.overflow = '';
        renderMessages();
    }
});

// ========================
// RESIZE HANDLER — inline chat positioning
// ========================
window.addEventListener('resize', function() {
    const page = document.getElementById('messagePageView');
    if (!page || !page.classList.contains('active')) return;
    const mob = window.matchMedia('(max-width: 900px)').matches;
    if (mob) {
        // Mobile: reset to full-page overlay
        page.style.left = '';
        page.style.top = '';
        page.style.bottom = '';
        page.style.height = '';
        document.body.classList.remove('chat-open');
    } else {
        // Desktop: recalculate inline position
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
    }
});

