// UI Renderer — DOM rendering and view switching

/**
 * Map of view names to their DOM element IDs.
 * Views are shown/hidden by toggling display.
 */
const VIEW_MAP = {
  home: 'homePage',
  inbox: 'inboxSection',
  compose: 'composeModal',
  conversation: 'messagePage',
  'shared-sky': 'sharedSkyPage',
  circles: 'circlesPage',
  settings: 'settingsDropdown',
  philosophy: 'philosophyPage',
};

/** Currently active view name */
let currentView = 'home';

/**
 * Render the main app shell. Called once on startup after auth is confirmed.
 * Sets up the initial view state and attaches global event listeners.
 */
export function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;

  // Show the main app content (hidden during auth)
  app.style.display = '';

  // Initialize with home view
  showView('home');

  // Set up scroll listener for sticky header
  const header = document.querySelector('.header');
  if (header) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    });
  }
}

/**
 * Switch to a named view, hiding all others.
 * @param {string} viewName - The view to show (e.g., 'home', 'inbox', 'compose', 'conversation', 'shared-sky', 'circles', 'settings', 'philosophy')
 */
export function showView(viewName) {
  // Hide all views
  Object.values(VIEW_MAP).forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      // Use the appropriate hide mechanism
      if (el.classList.contains('modal-overlay')) {
        el.classList.remove('active');
      } else if (el.classList.contains('message-page')) {
        el.classList.remove('active');
      } else if (el.classList.contains('settings-dropdown')) {
        el.classList.remove('active');
      } else {
        el.style.display = 'none';
      }
    }
  });

  // Show the requested view
  const targetId = VIEW_MAP[viewName];
  if (targetId) {
    const el = document.getElementById(targetId);
    if (el) {
      if (el.classList.contains('modal-overlay')) {
        el.classList.add('active');
      } else if (el.classList.contains('message-page')) {
        el.classList.add('active');
      } else if (el.classList.contains('settings-dropdown')) {
        el.classList.add('active');
      } else {
        el.style.display = '';
      }
    }
  }

  // Always show home page elements when on home
  if (viewName === 'home') {
    const homePage = document.getElementById('homePage');
    if (homePage) homePage.style.display = '';
    const inboxSection = document.getElementById('inboxSection');
    if (inboxSection) inboxSection.style.display = '';
  }

  currentView = viewName;
}
