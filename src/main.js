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

// --- Expose global functions for inline onclick/oninput/onchange handlers ---
// These are called from HTML onclick="" attributes inherited from the monolith.
// Wire up to module functions where implemented; stub the rest so the app doesn't crash.

function stub(name) {
  return (...args) => console.warn(`[MoonPop] ${name}() not yet wired up`, ...args);
}

// Auth & onboarding
window.showAuthModal = stub('showAuthModal');
window.closeAuthModal = stub('closeAuthModal');
window.sendMoonKey = stub('sendMoonKey');
window.verifyMoonKey = stub('verifyMoonKey');
window.resendMoonKey = stub('resendMoonKey');
window.changeEmail = stub('changeEmail');
window.confirmDetectedLocation = stub('confirmDetectedLocation');
window.filterOnboardingCities = stub('filterOnboardingCities');
window.saveOnboardingProfile = stub('saveOnboardingProfile');
window.previewOnboardingAvatar = stub('previewOnboardingAvatar');
window.autoFillSenderName = stub('autoFillSenderName');

// Navigation & views
window.openPhilosophyPage = () => showView('philosophy');
window.closePhilosophyPage = () => showView('home');
window.openContactsPage = stub('openContactsPage');
window.closeContactsPage = () => showView('home');
window.openSharedSkyModal = () => showView('shared-sky');
window.closeSharedSkyModal = () => showView('home');
window.openNewMessagePicker = stub('openNewMessagePicker');
window.closeNewMessagePicker = () => showView('home');
window.openModal = stub('openModal');

// Settings
window.toggleSettings = () => {
  const dd = document.getElementById('settingsDropdown');
  if (dd) dd.classList.toggle('active');
};
window.toggleSettingsSection = (el) => {
  const section = el.closest('.settings-section');
  if (section) section.classList.toggle('open');
};
window.saveSettings = stub('saveSettings');
window.onProfileFieldChange = stub('onProfileFieldChange');
window.handleProfilePic = stub('handleProfilePic');
window.updateSettingsSummaries = () => { /* called from onchange, safe to no-op */ };
window.deleteAccount = stub('deleteAccount');

// Mobile menu
window.toggleMobileMenu = () => {
  const overlay = document.getElementById('mobileMenuOverlay');
  const drawer = document.getElementById('mobileMenuDrawer');
  if (overlay) overlay.classList.toggle('active');
  if (drawer) drawer.classList.toggle('active');
};
window.closeMobileMenu = () => {
  const overlay = document.getElementById('mobileMenuOverlay');
  const drawer = document.getElementById('mobileMenuDrawer');
  if (overlay) overlay.classList.remove('active');
  if (drawer) drawer.classList.remove('active');
};

// Notifications
window.toggleNotifications = stub('toggleNotifications');
window.toggleEmailNotifications = stub('toggleEmailNotifications');
window.toggleMessageSounds = stub('toggleMessageSounds');

// Auth
window.logOut = () => signOut();

// Compose / messaging
window.composeMainAction = stub('composeMainAction');
window.composeToggleMode = stub('composeToggleMode');
window.handleComposeSend = stub('handleComposeSend');
window.backToRecipientPicker = stub('backToRecipientPicker');
window.showNewContactForm = stub('showNewContactForm');
window.confirmNewContact = stub('confirmNewContact');
window.checkNewContactForm = stub('checkNewContactForm');
window.filterNewContactCities = stub('filterNewContactCities');
window.showRecipientDropdown = stub('showRecipientDropdown');
window.filterRecipients = stub('filterRecipients');
window.filterNewMsgContacts = stub('filterNewMsgContacts');

// Lunar note compose
window.goLunarStep = stub('goLunarStep');
window.revealLunarNote = stub('revealLunarNote');
window.regenerateLunarNote = stub('regenerateLunarNote');
window.editLunarInputs = stub('editLunarInputs');

// Compose add-ons
window.toggleComposeMusic = stub('toggleComposeMusic');
window.toggleComposePhoto = stub('toggleComposePhoto');
window.onSongInput = stub('onSongInput');
window.searchYouTubeSong = stub('searchYouTubeSong');
window.handleMoonPhoto = stub('handleMoonPhoto');
window.clearMoonPhoto = stub('clearMoonPhoto');

// Message detail / chat
window.closeMessageDetail = () => showView('home');
window.openChatProfile = stub('openChatProfile');
window.closeChatProfile = stub('closeChatProfile');
window.chatProfileBlock = stub('chatProfileBlock');
window.sendReply = stub('sendReply');
window.emitTyping = stub('emitTyping');
window.toggleAttachMenu = stub('toggleAttachMenu');
window.triggerPhotoAttach = stub('triggerPhotoAttach');
window.triggerYoutubeAttach = stub('triggerYoutubeAttach');
window.handleReplyPhoto = stub('handleReplyPhoto');
window.clearReplyPhoto = stub('clearReplyPhoto');
window.clearReplyContext = stub('clearReplyContext');
window.toggleNoteMode = stub('toggleNoteMode');

// Thread lunar notes
window.closeThreadLunar = stub('closeThreadLunar');
window.advanceThreadStep = stub('advanceThreadStep');
window.goBackThreadStep = stub('goBackThreadStep');
window.updateThreadLunarNextBtn = stub('updateThreadLunarNextBtn');
window.generateThreadLunarResult = stub('generateThreadLunarResult');
window.regenerateThreadLunar = stub('regenerateThreadLunar');
window.editThreadInputs = stub('editThreadInputs');
window.sendThreadLunarNote = stub('sendThreadLunarNote');

// Shared Sky
window.sendSharedSkyMessage = stub('sendSharedSkyMessage');
window.toggleSSNoteMode = stub('toggleSSNoteMode');
window.goSSLunarStep = stub('goSSLunarStep');
window.revealSSLunarNote = stub('revealSSLunarNote');
window.regenerateSSLunarNote = stub('regenerateSSLunarNote');
window.clearSharedSkyPhoto = stub('clearSharedSkyPhoto');
window.handleSharedSkyPhoto = stub('handleSharedSkyPhoto');
window.sharedSkyPlusAction = stub('sharedSkyPlusAction');

// Contact detail
window.closeContactDetail = stub('closeContactDetail');
window.contactDetailSendMessage = stub('contactDetailSendMessage');
window.debouncedContactSearch = stub('debouncedContactSearch');

// Circles
window.closeCircleDetail = stub('closeCircleDetail');
window.closeCreateCircle = stub('closeCreateCircle');
window.pickCircleEmoji = stub('pickCircleEmoji');
window.filterCircleMembers = stub('filterCircleMembers');
window.createCircle = stub('createCircle');

// Moon down / drift / push prompt modals
window.closeMoonDownModal = stub('closeMoonDownModal');
window.dismissNewMoonWarning = stub('dismissNewMoonWarning');
window.acceptDrift = stub('acceptDrift');
window.dismissDrift = stub('dismissDrift');
window.showManualLocationPicker = stub('showManualLocationPicker');
window.applyManualLocation = stub('applyManualLocation');
window.acceptPushPrompt = stub('acceptPushPrompt');
window.dismissPushPrompt = stub('dismissPushPrompt');

// Moon reveal page
window.closeMoonRevealPage = stub('closeMoonRevealPage');
window.revealSignupToReply = stub('revealSignupToReply');

// Public modal
window.closePublicModal = stub('closePublicModal');
window.sendPublicMessage = stub('sendPublicMessage');

// Start the app
init();
