/**
 * fast-check arbitraries for generating test data.
 *
 * These generators produce realistic payloads matching the MoonPop
 * database schema. Used by property-based tests to exercise RLS
 * policies, Edge Functions, and service modules across many inputs.
 */
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Generate a valid UUID v4 string.
 * @returns {fc.Arbitrary<string>}
 */
export function uuidArb() {
  return fc.uuid();
}

/**
 * Generate a realistic email address.
 * @returns {fc.Arbitrary<string>}
 */
export function emailArb() {
  return fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9]{2,12}$/),
      fc.constantFrom('moonpop.app', 'test.com', 'example.org', 'mail.dev')
    )
    .map(([local, domain]) => `${local}@${domain}`);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Generate a user object with id (UUID) and email.
 * @returns {fc.Arbitrary<{id: string, email: string}>}
 */
export function userArb() {
  return fc.record({
    id: uuidArb(),
    email: emailArb(),
  });
}

/**
 * Generate a pair of distinct users (guaranteed different IDs).
 * @returns {fc.Arbitrary<[{id: string, email: string}, {id: string, email: string}]>}
 */
export function distinctUserPairArb() {
  return fc
    .tuple(userArb(), userArb())
    .filter(([a, b]) => a.id !== b.id && a.email !== b.email);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Generate a message payload matching the messages table schema.
 *
 * @param {string} senderId — sender's UUID (required for RLS insert policy)
 * @param {string} recipientId — recipient's UUID
 * @param {object} [overrides] — optional field overrides
 * @returns {fc.Arbitrary<object>}
 */
export function messageArb(senderId, recipientId) {
  return fc.record({
    sender_id: fc.constant(senderId),
    recipient_id: fc.constant(recipientId),
    recipient_email: emailArb(),
    text: fc.stringMatching(/^[A-Za-z0-9 .,!?]{1,140}$/),
    sender_city: cityArb(),
    recipient_city: cityArb(),
    status: fc.constantFrom('in_transit', 'released'),
    moon_phase: fc.constantFrom(
      'new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
      'full', 'waning_gibbous', 'last_quarter', 'waning_crescent'
    ),
  });
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * Generate a contact row payload.
 *
 * @param {string} ownerId — the contact owner's UUID
 * @returns {fc.Arbitrary<object>}
 */
export function contactArb(ownerId) {
  return fc.record({
    owner_id: fc.constant(ownerId),
    name: fc.stringMatching(/^[A-Za-z ]{2,30}$/),
    email: emailArb(),
    city: cityArb(),
    is_on_moonpop: fc.boolean(),
  });
}

// ---------------------------------------------------------------------------
// Shared Sky
// ---------------------------------------------------------------------------

/**
 * Generate a Shared Sky post payload.
 *
 * @param {string} userId — the post author's UUID
 * @returns {fc.Arbitrary<object>}
 */
export function sharedSkyPostArb(userId) {
  return fc.record({
    user_id: fc.constant(userId),
    message: fc.stringMatching(/^[A-Za-z0-9 🌕🌙✨]{1,280}$/),
    city: cityArb(),
  });
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/**
 * Generate a reaction payload.
 *
 * @param {string} userId — the reacting user's UUID
 * @param {string} messageId — the message/post being reacted to
 * @returns {fc.Arbitrary<object>}
 */
export function reactionArb(userId, messageId) {
  return fc.record({
    user_id: fc.constant(userId),
    message_id: fc.constant(messageId),
    emoji: fc.constantFrom('🌕', '🌙', '✨', '❤️', '🔥', '👀', '🎉', '💫'),
  });
}

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

/**
 * Generate a Moon Circle payload.
 *
 * @param {string} creatorId — the circle creator's UUID
 * @returns {fc.Arbitrary<object>}
 */
export function circleArb(creatorId) {
  return fc.record({
    name: fc.stringMatching(/^[A-Za-z ]{3,25}$/),
    emoji: fc.constantFrom('🔥', '🌕', '🌙', '✨', '🌊', '🏔️', '🌸', '🦋'),
    creator_id: fc.constant(creatorId),
  });
}

/**
 * Generate a circle member payload.
 *
 * @param {string} circleId — the circle's UUID
 * @param {string} userId — the member's UUID
 * @returns {fc.Arbitrary<object>}
 */
export function circleMemberArb(circleId, userId) {
  return fc.record({
    circle_id: fc.constant(circleId),
    user_id: fc.constant(userId),
  });
}

/**
 * Generate a circle contribution payload.
 *
 * @param {string} nightId — the circle night's UUID
 * @param {string} userId — the contributing user's UUID
 * @returns {fc.Arbitrary<object>}
 */
export function circleContributionArb(nightId, userId) {
  return fc.record({
    night_id: fc.constant(nightId),
    user_id: fc.constant(userId),
    input_1: fc.stringMatching(/^[A-Za-z0-9 ]{0,100}$/),
    input_2: fc.stringMatching(/^[A-Za-z0-9 ]{0,100}$/),
    input_3: fc.stringMatching(/^[A-Za-z0-9 ]{0,100}$/),
    note_text: fc.option(fc.stringMatching(/^[A-Za-z0-9 .,!?]{1,200}$/), { nil: null }),
    note_closing: fc.option(fc.stringMatching(/^[A-Za-z ]{1,30}$/), { nil: null }),
  });
}

// ---------------------------------------------------------------------------
// Blocked Users
// ---------------------------------------------------------------------------

/**
 * Generate a blocked user payload.
 *
 * @param {string} blockerId — the blocking user's UUID
 * @returns {fc.Arbitrary<object>}
 */
export function blockedUserArb(blockerId) {
  return fc.record({
    blocker_id: fc.constant(blockerId),
    blocked_id: uuidArb(),
    blocked_email: fc.option(emailArb(), { nil: null }),
  });
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

/**
 * Generate a reply payload.
 *
 * @param {string} messageId — parent message UUID
 * @param {string} senderId — reply sender's UUID
 * @returns {fc.Arbitrary<object>}
 */
export function replyArb(messageId, senderId) {
  return fc.record({
    message_id: fc.constant(messageId),
    sender_id: fc.constant(senderId),
    text: fc.stringMatching(/^[A-Za-z0-9 .,!?]{1,280}$/),
    status: fc.constantFrom('in_transit', 'released'),
    recipient_city: cityArb(),
  });
}

// ---------------------------------------------------------------------------
// Read Receipts
// ---------------------------------------------------------------------------

/**
 * Generate a read receipt payload.
 *
 * @param {string} userId — the user who read the message
 * @param {string} conversationId — the conversation/message UUID
 * @returns {fc.Arbitrary<object>}
 */
export function readReceiptArb(userId, conversationId) {
  return fc.record({
    user_id: fc.constant(userId),
    conversation_id: fc.constant(conversationId),
    read_at: fc.date({ min: new Date('2024-01-01'), max: new Date('2030-01-01') })
      .map((d) => d.toISOString()),
  });
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * Generate a profile payload.
 *
 * @param {string} userId — the profile owner's UUID
 * @param {string} email — the profile email
 * @returns {fc.Arbitrary<object>}
 */
export function profileArb(userId, email) {
  return fc.record({
    id: fc.constant(userId),
    email: fc.constant(email),
    username: fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/),
    first_name: fc.stringMatching(/^[A-Z][a-z]{1,12}$/),
    last_name: fc.stringMatching(/^[A-Z][a-z]{1,12}$/),
    city: cityArb(),
    avatar_url: fc.option(
      fc.constant('https://example.com/avatar.png'),
      { nil: null }
    ),
  });
}

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

/**
 * Generate a valid avatar storage path for a user.
 *
 * @param {string} userId — the user's UUID
 * @returns {fc.Arbitrary<string>}
 */
export function avatarPathArb(userId) {
  return fc
    .stringMatching(/^[a-z0-9]{4,12}\.(jpg|png|webp)$/)
    .map((filename) => `${userId}/${filename}`);
}

/**
 * Generate a valid moon-photo storage path for a user.
 *
 * @param {string} userId — the user's UUID
 * @returns {fc.Arbitrary<string>}
 */
export function moonPhotoPathArb(userId) {
  return fc
    .tuple(
      fc.constantFrom('shared-sky', 'message', 'circle'),
      fc.stringMatching(/^[a-z0-9]{4,12}\.(jpg|png|webp)$/)
    )
    .map(([context, filename]) => `${context}/${userId}/${filename}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a city name from a realistic set.
 * @returns {fc.Arbitrary<string>}
 */
function cityArb() {
  return fc.constantFrom(
    'New York', 'Los Angeles', 'London', 'Tokyo', 'Paris',
    'Berlin', 'Sydney', 'Toronto', 'Mumbai', 'São Paulo',
    'Cairo', 'Seoul', 'Mexico City', 'Bangkok', 'Istanbul'
  );
}

export { cityArb };
