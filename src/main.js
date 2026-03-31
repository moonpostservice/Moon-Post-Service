// MoonPop — Moon Post Service
// Entry point: initializes app, wires modules, sets up routing.

// --- CSS imports ---
import './styles/base.css';
import './styles/components.css';
import './styles/views.css';

// --- Service imports ---
import { getSession, onAuthStateChange, signOut } from './services/auth.js';
import { sendMessage, loadInbox, releaseMessages, loadReplies, sendReply, sendLunarNote } from './services/messaging.js';
import { loadContacts, addContact, deleteContact, syncContactProfiles, blockUser, unblockUser, getBlockedUsers } from './services/contacts.js';
import { loadSharedSkyPosts, createPost, deletePost, addReaction, removeReaction } from './services/shared-sky.js';
import { loadCircles, createCircle, addMember, addContribution } from './services/circles.js';
import { setupRealtime, cleanupRealtime } from './services/realtime.js';
import { uploadAvatar, uploadMoonPhoto } from './services/storage.js';
import { registerPushNotifications } from './services/notifications.js';

// --- UI imports ---
import { renderApp, showView } from './ui/renderer.js';
import { renderSettings, handleSettingsUpdate, filterSettingsCities } from './ui/settings.js';

// --- Library imports ---
import { getMoonPhase, getMoonZodiac, calculateMoonTimes, isMoonVisible, getRecipientMoonrise, timeToRingDegrees } from './lib/moon-calc.js';

console.log('MoonPop initializing…');

// --- App state ---
let currentUser = null;

/**
 * Handle auth state changes — wire up the app on sign-in, tear down on sign-out.
 * Requirements: 14.1, 18.1
 */
function handleAuthStateChange(event, session) {
  console.log('[main] Auth event:', event);

  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
    const user = session?.user;
    if (!user) return;

    currentUser = user;

    // Render the app shell
    renderApp();

    // Set up realtime subscriptions for live updates
    setupRealtime(user.id, {
      onNewMessage: () => loadInbox(),
      onMessageUpdate: () => loadInbox(),
      onNewReply: () => {},
      onReadReceipt: () => {},
      onProfileUpdate: () => {},
      onSharedSkyPost: () => loadSharedSkyPosts(),
      onPoll: () => loadInbox(),
    });

    // Register push notifications (non-blocking)
    registerPushNotifications().catch((err) => {
      console.warn('[main] Push notification registration failed:', err);
    });

    // Handle deep-link routing after auth is confirmed
    handleInitialRoute();

  } else if (event === 'SIGNED_OUT') {
    currentUser = null;

    // Clean up realtime channels
    cleanupRealtime();

    // Show auth/login screen
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = '';
      app.style.display = '';
    }
  }
}

/**
 * Handle /chat/:id deep-link routing on initial load.
 * If the URL matches /chat/:id, navigate to that conversation.
 */
function handleInitialRoute() {
  const path = window.location.pathname;
  const chatMatch = path.match(/^\/chat\/(.+)$/);

  if (chatMatch) {
    const chatId = chatMatch[1];
    console.log('[main] Deep-link to chat:', chatId);
    showView('conversation');
  }
}

/**
 * Register the service worker for PWA support.
 */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[main] Service workers not supported');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('[main] Service worker registered:', registration.scope);
  } catch (err) {
    console.warn('[main] Service worker registration failed:', err);
  }
}

/**
 * Bootstrap the application.
 */
async function init() {
  // Register service worker
  registerServiceWorker();

  // Set up auth state listener
  onAuthStateChange(handleAuthStateChange);

  // Check for existing session
  const { session } = await getSession();
  if (session) {
    handleAuthStateChange('SIGNED_IN', session);
  }
}

// Start the app
init();
