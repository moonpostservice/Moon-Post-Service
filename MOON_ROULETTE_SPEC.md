# Moon Roulette — Feature Specification

> **Moon Roulette** lets you release a message into the unknown — the system picks a random stranger on the platform and delivers it like a message in a bottle. The recipient doesn't know who you are (only your city), you don't know who they are. They can choose to reveal themselves — but only if you both agree.

---

## Table of Contents

1. [Concept & Glossary](#1-concept--glossary)
2. [User Flows](#2-user-flows)
3. [Business Rules](#3-business-rules)
4. [Database Schema](#4-database-schema)
5. [RLS Policies](#5-rls-policies)
6. [Edge Functions](#6-edge-functions)
7. [Recipient Distribution Algorithm](#7-recipient-distribution-algorithm)
8. [Frontend Architecture](#8-frontend-architecture)
9. [UI & Visual Spec](#9-ui--visual-spec)
10. [Notifications](#10-notifications)
11. [File Map](#11-file-map)

---

## 1. Concept & Glossary

| Term | Definition |
|---|---|
| **Moon Roulette** | The feature name. A message sent to a system-picked stranger. |
| **Roulette message** | The message itself. Travels anonymously. Subject to moon-phase release timing. |
| **Sender** | The user who composes and sends the roulette message. Does not know recipient identity. |
| **Recipient** | The user the system chose. Does not know sender identity (only city). |
| **Decline** | Recipient rejects the message. It returns to the sender's Roulette inbox as "returned." |
| **Block** | Recipient rejects the message AND blocks the sender from ever being matched to them again via roulette. |
| **Re-launch** | Sender action on a "returned" message: edit (optional) and send to a new random recipient. |
| **Reveal** | Mutual-consent identity disclosure. Both parties tap "Reveal yourself?" — when both have, identities are shown simultaneously. |
| **Reveal pending** | One party has tapped Reveal but the other has not yet. Neither can see identity yet. |
| **Opt-out** | User setting: receive_moon_roulette = false. Opted-out users are never picked as recipients. |

---

## 2. User Flows

### 2A — Sender: Sending a Moon Roulette

```
1. Sender taps "Moon Roulette" entry point (compose area)
2. Composer opens — same fields as regular message (text, photo, song) + moon timing applies
3. Sender writes message. No recipient field — system picks.
4. Sender taps Send
5. Edge function `pick-roulette-recipient` selects a random eligible recipient (weighted)
6. Row inserted into `moon_roulette_messages` with status = 'queued'
7. Message held until moonrise at recipient's city (same pg_cron logic as regular messages)
8. On moonrise → status = 'delivered', recipient notified (push + email)
9. Message appears in sender's Moon Roulette inbox as "Sent — awaiting response"
```

### 2B — Recipient: Receiving a Moon Roulette

```
1. Recipient receives notification: "A mystery moon message arrived"
2. Opens Moon Roulette inbox (separate from main inbox)
3. Message card shows: sender's city/region only — NO name, NO avatar (moon icon instead)
4. Recipient reads message
5. Three actions available:
   a. "Reveal yourself?" — see section 2C
   b. "Decline" — see section 2D
   c. "Block" — see section 2E
```

### 2C — Mutual Reveal Flow

```
1. Either party (sender OR recipient) taps "Reveal yourself?"
2. Row inserted into `moon_roulette_reveals` for that user
3. UI shows: "Waiting for the other person to reveal…"
4. When the second party also taps → both reveal rows exist → status updates to 'revealed'
5. Both parties' UIs update simultaneously (via Realtime subscription on `moon_roulette_reveals`)
6. Message card transitions: moon icon → real avatar, city → full name shown
7. A regular conversation can now be started (optional — not automatic)
```

### 2D — Decline Flow

```
1. Recipient taps "Decline"
2. Message status → 'declined'
3. Message disappears from recipient's inbox
4. Message reappears in sender's Moon Roulette inbox as "Returned" with a visual indicator
5. Sender notified: "Your moon roulette message was returned"
6. Sender options on returned message: [Re-launch] [Delete]
   - Re-launch: opens composer pre-filled with original content (editable) → picks new recipient
   - Delete: sender_deleted_at set, removed from sender's view
```

### 2E — Block Flow

```
1. Recipient taps "Block"
2. Row inserted into `blocked_users` (blocker_id = recipient, blocked_id = sender)
3. Message status → 'blocked' (treated same as declined)
4. Sender never matched to this recipient again (distribution algorithm excludes blocked pairs)
5. Same "Returned" experience for sender as Decline — sender does NOT know they were blocked vs. declined
```

### 2F — Re-launch Flow

```
1. Sender opens returned message
2. Taps "Re-launch"
3. Composer opens pre-filled with original message text (editable)
4. Sender edits (optional) and taps Send
5. `pick-roulette-recipient` picks a NEW random recipient (excludes previous recipient)
6. New row in `moon_roulette_messages` with `parent_id` pointing to original message
7. Original message status → 're-launched', removed from "Returned" pile
8. Cycle continues
```

---

## 3. Business Rules

| Rule | Detail |
|---|---|
| **Recipient uniqueness** | Same person NEVER picked twice for the same sender (across all time, not just active messages) |
| **Block enforcement** | If recipient has blocked sender (or vice versa), they are never matched |
| **Opt-out enforcement** | `receive_moon_roulette = false` on profiles → excluded from recipient pool entirely |
| **Inactive deprioritisation** | Active users (login within 30 days) get weight 1.0. 30–90 days: 0.5. 90+ days: 0.2. Never excluded — a roulette message can be a re-engagement trigger. |
| **Moon timing** | All roulette messages obey the same moon-phase release logic as regular messages (held until moonrise at recipient's city) |
| **Anonymity** | Sender's `profile_id` is stored in the DB but never exposed to recipient via RLS until mutual reveal. Only `sender_city` is readable by recipient pre-reveal. |
| **Reveal privacy** | Reveal is opt-in, mutual, and irreversible once both confirm. Neither party can see if the other has tapped Reveal until both have. |
| **Return anonymity** | If recipient blocks (vs. declines), sender sees identical "Returned" state. Sender never knows whether they were declined or blocked. |
| **Re-launch limit** | Unlimited re-launches. No cap. |
| **Inbox separation** | Roulette messages live in a dedicated Moon Roulette view. They never appear in the main inbox. |
| **Sender delete** | Sender can delete any roulette message from their view (sets `sender_deleted_at`). Does not affect recipient's view if still active. |

---

## 4. Database Schema

### 4A — New Table: `moon_roulette_messages`

```sql
CREATE TABLE moon_roulette_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id           uuid NOT NULL REFERENCES profiles(id),
  recipient_id        uuid NOT NULL REFERENCES profiles(id),
  
  -- Content (same fields as messages table)
  message_text        text,
  photo_url           text,
  song_url            text,
  song_title          text,
  
  -- Anonymity data (denormalised — safe to expose to recipient pre-reveal)
  sender_city         text NOT NULL,  -- copied from profiles at send time
  
  -- Moon timing (mirrors messages table)
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','delivered','declined','blocked','re-launched','revealed')),
  release_at          timestamptz,
  released_at         timestamptz,
  moon_phase          text,
  moon_illumination   numeric,
  
  -- Re-launch chain
  parent_id           uuid REFERENCES moon_roulette_messages(id),  -- null if first send
  send_attempt        int NOT NULL DEFAULT 1,
  
  -- Soft deletes (each party controls their own view)
  sender_deleted_at   timestamptz,
  recipient_deleted_at timestamptz,  -- set on Decline or Block
  
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Index: sender's inbox queries
CREATE INDEX idx_mrm_sender ON moon_roulette_messages(sender_id, status);
-- Index: recipient's inbox queries  
CREATE INDEX idx_mrm_recipient ON moon_roulette_messages(recipient_id, status);
-- Index: distribution algorithm (exclude already-sent pairs)
CREATE INDEX idx_mrm_sender_recipient ON moon_roulette_messages(sender_id, recipient_id);
-- Index: release scheduler (pg_cron picks up queued messages)
CREATE INDEX idx_mrm_release ON moon_roulette_messages(release_at) WHERE status = 'queued';
```

**Status lifecycle:**
```
queued → delivered → declined / blocked / revealed
                  ↘ re-launched (after sender re-sends)
```

---

### 4B — New Table: `moon_roulette_reveals`

Tracks mutual-consent reveal. Two rows needed (one per party) before reveal completes.

```sql
CREATE TABLE moon_roulette_reveals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roulette_message_id     uuid NOT NULL REFERENCES moon_roulette_messages(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES profiles(id),
  revealed_at             timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (roulette_message_id, user_id)  -- each user can only reveal once per message
);

CREATE INDEX idx_mrr_message ON moon_roulette_reveals(roulette_message_id);
```

**Reveal completion logic** (enforced via DB trigger or Edge Function):
- After INSERT into `moon_roulette_reveals`, check if both sender_id and recipient_id for the message now have rows.
- If yes → UPDATE `moon_roulette_messages` SET status = 'revealed'.
- Realtime subscription on `moon_roulette_messages` fires on both clients simultaneously.

---

### 4C — Modified Table: `profiles`

Add opt-out flag (default TRUE = opted in):

```sql
ALTER TABLE profiles
  ADD COLUMN receive_moon_roulette boolean NOT NULL DEFAULT true;
```

---

### 4D — Existing Table: `blocked_users` (no change)

Roulette blocks reuse this table. When a recipient blocks in roulette context:
```sql
INSERT INTO blocked_users (blocker_id, blocked_id)
VALUES (recipient_id, sender_id);
```
The distribution algorithm already excludes blocked pairs — no extra table needed.

---

### 4E — Full Schema Summary

| Table | New / Modified | Purpose |
|---|---|---|
| `moon_roulette_messages` | NEW | All roulette messages, status, moon timing |
| `moon_roulette_reveals` | NEW | Mutual consent reveal tracking |
| `profiles.receive_moon_roulette` | MODIFIED | Opt-out flag |
| `blocked_users` | REUSED AS-IS | Roulette blocks (reuse existing) |

---

## 5. RLS Policies

### `moon_roulette_messages`

```sql
ALTER TABLE moon_roulette_messages ENABLE ROW LEVEL SECURITY;

-- Sender can read their own sent messages (excluding sender-deleted)
CREATE POLICY "sender reads own roulette messages"
  ON moon_roulette_messages FOR SELECT TO authenticated
  USING (sender_id = auth.uid() AND sender_deleted_at IS NULL);

-- Recipient can read messages addressed to them (excluding recipient-deleted)
-- CRITICAL: recipient_id is readable but sender_id is NOT exposed via this policy alone.
-- The application layer + view below enforces anonymity.
CREATE POLICY "recipient reads own roulette messages"
  ON moon_roulette_messages FOR SELECT TO authenticated
  USING (recipient_id = auth.uid() AND recipient_deleted_at IS NULL AND status IN ('delivered','revealed'));

-- Only Edge Functions (service role) can INSERT
-- No direct client INSERT allowed.
```

**Anonymity view for recipients (pre-reveal):**

```sql
-- Recipient-safe view: hides sender_id until reveal is complete
CREATE VIEW roulette_recipient_view AS
SELECT
  m.id,
  m.message_text,
  m.photo_url,
  m.song_url,
  m.song_title,
  m.sender_city,
  m.status,
  m.released_at,
  m.moon_phase,
  m.moon_illumination,
  m.created_at,
  -- Only expose sender identity if mutual reveal is complete
  CASE WHEN m.status = 'revealed'
    THEN m.sender_id
    ELSE NULL
  END AS sender_id
FROM moon_roulette_messages m
WHERE m.recipient_id = auth.uid()
  AND m.recipient_deleted_at IS NULL
  AND m.status IN ('delivered', 'revealed');
```

### `moon_roulette_reveals`

```sql
ALTER TABLE moon_roulette_reveals ENABLE ROW LEVEL SECURITY;

-- Users can insert their own reveal
CREATE POLICY "user inserts own reveal"
  ON moon_roulette_reveals FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only read reveals for messages they participate in
-- (but only their OWN row — cannot see if other party has revealed yet)
CREATE POLICY "user reads own reveal row"
  ON moon_roulette_reveals FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

> **Note:** The client only knows "I have revealed" from their own row. They learn the other party revealed via the `moon_roulette_messages.status` flipping to `'revealed'` — not by reading the other party's reveal row directly.

---

## 6. Edge Functions

### `pick-roulette-recipient`

**Trigger:** Called by `send-roulette-message` function.

**Logic:**
```typescript
// 1. Get all profiles where receive_moon_roulette = true
// 2. Exclude: sender themselves
// 3. Exclude: anyone sender has already sent a roulette message to (any status)
// 4. Exclude: anyone who has blocked sender (blocked_users where blocker_id = candidate, blocked_id = sender)
// 5. Exclude: anyone sender has blocked (blocked_users where blocker_id = sender)
// 6. Assign weights based on last_sign_in_at:
//    - within 30 days: weight 1.0
//    - 30–90 days:     weight 0.5
//    - 90+ days:       weight 0.2
// 7. Weighted random selection
// 8. Return recipient profile (id + city only)
```

### `send-roulette-message`

**Trigger:** Client POST.

**Logic:**
1. Validate JWT → get `sender_id`
2. Validate payload (message_text or photo_url required)
3. Call `pick-roulette-recipient` → get `recipient_id` + `recipient_city`
4. Calculate `release_at` using same moon-phase logic as `send-message`
5. INSERT into `moon_roulette_messages`
6. Return message id + estimated release time

### `return-roulette-message`

**Trigger:** Client POST (recipient declining or blocking).

**Logic:**
1. Validate JWT → must be `recipient_id` of the message
2. Validate action: `'decline'` or `'block'`
3. If `block`: INSERT into `blocked_users`
4. UPDATE `moon_roulette_messages` SET status = 'declined' (both decline and block show same status to sender), `recipient_deleted_at = now()`
5. Notify sender (push + email): "Your moon roulette message was returned"

### `reveal-roulette-identity`

**Trigger:** Client POST (either party requesting reveal).

**Logic:**
1. Validate JWT → user must be sender or recipient of the message
2. INSERT into `moon_roulette_reveals` (user_id, roulette_message_id) — ignore if already exists
3. Check if both sender + recipient now have reveal rows
4. If yes → UPDATE `moon_roulette_messages` SET status = 'revealed'
5. Realtime fires on both clients

### `release-roulette-messages` (pg_cron)

Mirrors existing `release-message` logic but for roulette table.

```sql
-- Runs every minute (same as existing message release job)
UPDATE moon_roulette_messages
SET status = 'delivered', released_at = now()
WHERE status = 'queued'
  AND release_at <= now();
```

After update: trigger push + email notification to recipients.

---

## 7. Recipient Distribution Algorithm

```
Eligible pool = all profiles WHERE:
  receive_moon_roulette = true
  AND id != sender_id
  AND id NOT IN (SELECT recipient_id FROM moon_roulette_messages WHERE sender_id = ?)
  AND id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = sender_id)
  AND id NOT IN (SELECT blocker_id FROM blocked_users WHERE blocked_id = sender_id)

For each candidate, assign weight:
  last_sign_in_at >= now() - 30 days  → 1.0
  last_sign_in_at >= now() - 90 days  → 0.5
  else                                 → 0.2

Weighted random pick: one candidate selected proportional to weight.
```

If eligible pool is empty → return error to client: "No new recipients available right now. Try again after the next moon."

---

## 8. Frontend Architecture

### New File: `js/roulette.js`

Responsible for all Moon Roulette UI and logic. Sections:

```
- State: current roulette messages (sent + received), reveal state
- renderRouletteInbox()         — the dedicated Moon Roulette view
- renderRouletteCompose()       — compose flow (wraps existing compose, hides recipient field)
- handleSendRoulette()          — calls send-roulette-message Edge Function
- handleDecline(messageId)      — calls return-roulette-message with action='decline'
- handleBlock(messageId)        — calls return-roulette-message with action='block'
- handleReveal(messageId)       — calls reveal-roulette-identity Edge Function
- handleRelaunch(messageId)     — opens compose pre-filled, picks new recipient on send
- handleSenderDelete(messageId) — sets sender_deleted_at
- subscribeRouletteRealtime()   — listens on moon_roulette_messages + moon_roulette_reveals
- renderRouletteCard(msg, role) — single card renderer (role = 'sender' | 'recipient')
```

### Modified Files

| File | Change |
|---|---|
| `js/router.js` | Add `/roulette` route → `renderRouletteInbox()` |
| `js/realtime.js` | Add Realtime subscriptions for `moon_roulette_messages` and `moon_roulette_reveals` |
| `js/notifications.js` | Add roulette notification templates (new message, returned) |
| `index.html` | Add Moon Roulette nav entry, HTML templates for roulette inbox + cards |
| `styles.css` | Roulette card styles (distinct from regular message cards) |
| `js/auth.js` | Surface `receive_moon_roulette` toggle in profile settings |

### New Edge Function Files

| Path | Purpose |
|---|---|
| `supabase/functions/send-roulette-message/index.ts` | Create roulette message + pick recipient |
| `supabase/functions/return-roulette-message/index.ts` | Decline / block |
| `supabase/functions/reveal-roulette-identity/index.ts` | Mutual reveal |

### New Migration Files

| File | Contents |
|---|---|
| `012_moon_roulette_tables.sql` | Create `moon_roulette_messages`, `moon_roulette_reveals`, all indexes |
| `013_moon_roulette_rls.sql` | RLS enable + all policies + `roulette_recipient_view` |
| `014_profiles_roulette_optin.sql` | `ALTER TABLE profiles ADD COLUMN receive_moon_roulette` |
| `015_roulette_release_cron.sql` | pg_cron job for releasing queued roulette messages |

---

## 9. UI & Visual Spec

### Moon Roulette Entry Point
- Lives in the **compose area** — visible button/icon alongside regular compose
- Label: **"Moon Roulette"** with a short explainer on hover/tap: *"Send a message to a stranger. Only the moon knows who."*

### Moon Roulette Inbox (Dedicated View)
- Accessible from nav, separate from main inbox
- Two tabs within the view: **Sent** | **Received**
- **Sent tab:** shows messages with statuses — Queued (moon icon + release countdown), Delivered (awaiting response), Returned (returned indicator), Re-launched, Revealed
- **Received tab:** shows incoming roulette messages

### Roulette Message Card (Recipient View — pre-reveal)
- No sender avatar → replaced with a **moon phase icon** (phase at time of send)
- No sender name → replaced with **sender's city** (e.g., "From somewhere in Tel Aviv")
- Distinct card background (slightly different from regular message cards — e.g., subtle shimmer or different border)
- Small **"Moon Roulette"** tag/label on the card
- Action row: `[Reveal yourself?]` `[Decline]` `[Block]`
- If one party has revealed but not the other: show "Waiting for them to reveal…" on the revealer's card

### Roulette Message Card (Recipient View — post-reveal)
- Transitions to show real avatar, name, city
- Reveal animation (fade/transition)
- Action row updates: `[Send a message]` (opens regular compose to this person)

### Roulette Message Card (Sender View)
- Shows status badge: Queued / Delivered / Returned / Revealed
- If Returned: "Re-launch" + "Delete" buttons
- Destination shown as: "To someone in [recipient_city]" (city exposed to sender post-delivery)
- Pre-reveal: no recipient name/avatar — same moon icon treatment

### Opt-out UI Surfaces
1. **Settings page** — toggle: "Receive Moon Roulette messages" (default ON)
2. **First-time receipt** — one-time banner at top of received card: *"You received a mystery message. [Keep receiving these] [Turn off]"*
3. **Inside received roulette message** — small "Stop receiving these" link at the bottom

---

## 10. Notifications

### Recipient: new roulette message delivered
- **Push:** "A mystery moon message has arrived 🌕"
- **Email:** Existing `send-email` Edge Function with new type `roulette_received`
  - Shows: sender's city, message preview (truncated), link to Moon Roulette inbox

### Sender: message returned (declined)
- **Push:** "Your moon roulette message found its way back to you"
- **Email:** type `roulette_returned` — shows truncated original message + re-launch CTA

### Both: mutual reveal complete
- **Push:** "Your moon roulette connection revealed themselves ✨"
- In-app Realtime update (card transition) is the primary UX here

---

## 11. File Map

```
supabase/
  migrations/
    012_moon_roulette_tables.sql
    013_moon_roulette_rls.sql
    014_profiles_roulette_optin.sql
    015_roulette_release_cron.sql
  functions/
    send-roulette-message/index.ts
    return-roulette-message/index.ts
    reveal-roulette-identity/index.ts
    send-email/index.ts          ← modified (add roulette email types)

js/
  roulette.js                    ← NEW (main feature module)
  router.js                      ← modified (add /roulette route)
  realtime.js                    ← modified (add roulette subscriptions)
  notifications.js               ← modified (add roulette notification types)
  auth.js                        ← modified (add opt-out toggle in settings)

index.html                       ← modified (nav entry, HTML templates)
styles.css                       ← modified (roulette card styles)
```

---

---

## 12. Known Gaps — Next Session

These are intentionally deferred. Pick up from here in the next session.

### Must-do before launch

| # | Gap | File(s) | Notes |
|---|---|---|---|
| A | **Lat/lng not populated during onboarding** | `js/auth.js`, `supabase/functions/send-roulette-message/index.ts` | Migration 016 adds the columns but `auth.js` never geocodes the city and stores them. Without coordinates, `release_at` stays null and messages sit in `queued` forever. Fix: add a geocoding call (Nominatim or browser Geolocation API) in the profile save flow, storing `latitude` + `longitude`. |
| B | **Recipient email notification on delivery** | `supabase/migrations/015_roulette_release_cron.sql` | pg_cron releases messages but doesn't email the recipient. If they're offline they never know. Fix: set up a Supabase Database Webhook on `moon_roulette_messages` that fires when `status` changes to `delivered`, calling `send-email` with type `roulette_received`. Configure in Supabase Dashboard → Database → Webhooks. |
| C | **Roulette opt-out toggle in Settings UI** | `js/auth.js` | `handleRouletteOptIn/Out()` functions exist in `roulette.js` but there's no button in the Settings panel. Fix: add a toggle row alongside the existing `notify_email` / `notify_push` toggles in `auth.js`. |

### Nice-to-have

| # | Gap | Notes |
|---|---|---|
| D | **First-time recipient banner** | One-time "You received a mystery message. [Keep receiving these] [Turn off]" banner. Show once using `localStorage.getItem('roulette_first_receipt_seen')`. |
| E | **Re-launch sends email to new recipient** | Currently the re-launch flow uses the same `send-roulette-message` function which does not send a notification email. Once gap B is resolved (DB webhook), this is automatic. |

*Last updated: 2026-04-29. Spec owner: product + engineering.*
