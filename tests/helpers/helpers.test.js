/**
 * Smoke tests for test helpers — verifies generators produce valid data
 * and test client factories are callable.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  uuidArb,
  emailArb,
  userArb,
  distinctUserPairArb,
  messageArb,
  contactArb,
  sharedSkyPostArb,
  reactionArb,
  circleArb,
  circleMemberArb,
  circleContributionArb,
  blockedUserArb,
  replyArb,
  readReceiptArb,
  profileArb,
  avatarPathArb,
  moonPhotoPathArb,
  cityArb,
} from './generators.js';
import {
  createTestClient,
  createAnonClient,
} from './supabase-test-client.js';

describe('generators', () => {
  it('uuidArb generates valid UUID strings', () => {
    fc.assert(
      fc.property(uuidArb(), (uuid) => {
        expect(uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
      }),
      { numRuns: 50 }
    );
  });

  it('emailArb generates valid email strings', () => {
    fc.assert(
      fc.property(emailArb(), (email) => {
        expect(email).toContain('@');
        expect(email.split('@')).toHaveLength(2);
      }),
      { numRuns: 50 }
    );
  });

  it('userArb generates objects with id and email', () => {
    fc.assert(
      fc.property(userArb(), (user) => {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
        expect(typeof user.id).toBe('string');
        expect(typeof user.email).toBe('string');
      }),
      { numRuns: 50 }
    );
  });

  it('distinctUserPairArb generates two different users', () => {
    fc.assert(
      fc.property(distinctUserPairArb(), ([a, b]) => {
        expect(a.id).not.toBe(b.id);
        expect(a.email).not.toBe(b.email);
      }),
      { numRuns: 50 }
    );
  });

  it('messageArb generates valid message payloads', () => {
    fc.assert(
      fc.property(
        uuidArb(),
        uuidArb(),
        (senderId, recipientId) => {
          const arb = messageArb(senderId, recipientId);
          const msg = fc.sample(arb, 1)[0];
          expect(msg.sender_id).toBe(senderId);
          expect(msg.recipient_id).toBe(recipientId);
          expect(msg).toHaveProperty('text');
          expect(msg).toHaveProperty('status');
          expect(['in_transit', 'released']).toContain(msg.status);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('contactArb generates valid contact payloads', () => {
    fc.assert(
      fc.property(uuidArb(), (ownerId) => {
        const contact = fc.sample(contactArb(ownerId), 1)[0];
        expect(contact.owner_id).toBe(ownerId);
        expect(contact).toHaveProperty('name');
        expect(contact).toHaveProperty('email');
      }),
      { numRuns: 20 }
    );
  });

  it('sharedSkyPostArb generates valid post payloads', () => {
    fc.assert(
      fc.property(uuidArb(), (userId) => {
        const post = fc.sample(sharedSkyPostArb(userId), 1)[0];
        expect(post.user_id).toBe(userId);
        expect(post).toHaveProperty('message');
        expect(post).toHaveProperty('city');
      }),
      { numRuns: 20 }
    );
  });

  it('reactionArb generates valid reaction payloads', () => {
    fc.assert(
      fc.property(uuidArb(), uuidArb(), (userId, messageId) => {
        const reaction = fc.sample(reactionArb(userId, messageId), 1)[0];
        expect(reaction.user_id).toBe(userId);
        expect(reaction.message_id).toBe(messageId);
        expect(reaction).toHaveProperty('emoji');
      }),
      { numRuns: 20 }
    );
  });

  it('circleArb generates valid circle payloads', () => {
    fc.assert(
      fc.property(uuidArb(), (creatorId) => {
        const circle = fc.sample(circleArb(creatorId), 1)[0];
        expect(circle.creator_id).toBe(creatorId);
        expect(circle).toHaveProperty('name');
        expect(circle).toHaveProperty('emoji');
      }),
      { numRuns: 20 }
    );
  });

  it('circleMemberArb generates valid member payloads', () => {
    const member = fc.sample(circleMemberArb('circle-1', 'user-1'), 1)[0];
    expect(member.circle_id).toBe('circle-1');
    expect(member.user_id).toBe('user-1');
  });

  it('circleContributionArb generates valid contribution payloads', () => {
    fc.assert(
      fc.property(uuidArb(), uuidArb(), (nightId, userId) => {
        const contrib = fc.sample(circleContributionArb(nightId, userId), 1)[0];
        expect(contrib.night_id).toBe(nightId);
        expect(contrib.user_id).toBe(userId);
      }),
      { numRuns: 20 }
    );
  });

  it('blockedUserArb generates valid blocked user payloads', () => {
    fc.assert(
      fc.property(uuidArb(), (blockerId) => {
        const blocked = fc.sample(blockedUserArb(blockerId), 1)[0];
        expect(blocked.blocker_id).toBe(blockerId);
        expect(blocked).toHaveProperty('blocked_id');
      }),
      { numRuns: 20 }
    );
  });

  it('replyArb generates valid reply payloads', () => {
    fc.assert(
      fc.property(uuidArb(), uuidArb(), (messageId, senderId) => {
        const reply = fc.sample(replyArb(messageId, senderId), 1)[0];
        expect(reply.message_id).toBe(messageId);
        expect(reply.sender_id).toBe(senderId);
        expect(reply).toHaveProperty('text');
      }),
      { numRuns: 20 }
    );
  });

  it('readReceiptArb generates valid read receipt payloads', () => {
    fc.assert(
      fc.property(uuidArb(), uuidArb(), (userId, convId) => {
        const receipt = fc.sample(readReceiptArb(userId, convId), 1)[0];
        expect(receipt.user_id).toBe(userId);
        expect(receipt.conversation_id).toBe(convId);
        expect(receipt).toHaveProperty('read_at');
      }),
      { numRuns: 20 }
    );
  });

  it('profileArb generates valid profile payloads', () => {
    fc.assert(
      fc.property(uuidArb(), emailArb(), (userId, email) => {
        const profile = fc.sample(profileArb(userId, email), 1)[0];
        expect(profile.id).toBe(userId);
        expect(profile.email).toBe(email);
        expect(profile).toHaveProperty('username');
        expect(profile).toHaveProperty('city');
      }),
      { numRuns: 20 }
    );
  });

  it('avatarPathArb generates paths with userId prefix', () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    fc.assert(
      fc.property(avatarPathArb(userId), (path) => {
        expect(path).toMatch(new RegExp(`^${userId}/`));
        expect(path).toMatch(/\.(jpg|png|webp)$/);
      }),
      { numRuns: 20 }
    );
  });

  it('moonPhotoPathArb generates paths with context/userId prefix', () => {
    const userId = '550e8400-e29b-41d4-a716-446655440000';
    fc.assert(
      fc.property(moonPhotoPathArb(userId), (path) => {
        const parts = path.split('/');
        expect(parts).toHaveLength(3);
        expect(['shared-sky', 'message', 'circle']).toContain(parts[0]);
        expect(parts[1]).toBe(userId);
        expect(parts[2]).toMatch(/\.(jpg|png|webp)$/);
      }),
      { numRuns: 20 }
    );
  });

  it('cityArb generates from known city list', () => {
    fc.assert(
      fc.property(cityArb(), (city) => {
        expect(typeof city).toBe('string');
        expect(city.length).toBeGreaterThan(0);
      }),
      { numRuns: 20 }
    );
  });
});

describe('supabase-test-client', () => {
  const hasEnv = !!process.env.SUPABASE_TEST_ANON_KEY;

  it.skipIf(!hasEnv)('createTestClient returns a client object', () => {
    const client = createTestClient('test-user-id');
    expect(client).toBeDefined();
    expect(client.from).toBeTypeOf('function');
  });

  it.skipIf(!hasEnv)('createAnonClient returns a client object', () => {
    const client = createAnonClient();
    expect(client).toBeDefined();
    expect(client.from).toBeTypeOf('function');
  });

  it('createTestClient and createAnonClient are exported functions', () => {
    expect(createTestClient).toBeTypeOf('function');
    expect(createAnonClient).toBeTypeOf('function');
  });
});
