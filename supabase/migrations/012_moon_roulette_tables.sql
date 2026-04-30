-- Migration: Moon Roulette tables
-- Creates moon_roulette_messages and moon_roulette_reveals.

-- Status enum for roulette message lifecycle.
CREATE TYPE roulette_status AS ENUM (
  'queued',       -- waiting for moonrise at recipient's city
  'delivered',    -- visible to recipient, awaiting action
  'declined',     -- recipient declined; message returned to sender
  'blocked',      -- recipient blocked sender (treated as declined to sender)
  're-launched',  -- sender re-sent the returned message to a new recipient
  'revealed'      -- mutual identity reveal complete
);

-- Core roulette message table.
-- Mirrors relevant columns from messages but recipient is always system-picked.
CREATE TABLE moon_roulette_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id             uuid NOT NULL REFERENCES profiles(id),
  recipient_id          uuid NOT NULL REFERENCES profiles(id),

  -- Content
  message_text          text,
  photo_url             text,
  song_url              text,
  song_title            text,

  -- City fields denormalised at send time.
  -- sender_city: shown to recipient pre-reveal.
  -- recipient_city: shown to sender once delivered (city only, not identity).
  sender_city           text NOT NULL,
  recipient_city        text NOT NULL,

  -- Moon release timing (mirrors messages table)
  status                roulette_status NOT NULL DEFAULT 'queued',
  release_at            timestamptz,
  released_at           timestamptz,
  moon_phase            text,
  moon_illumination     numeric,

  -- Re-launch chain: parent_id points to the message this was relaunched from.
  parent_id             uuid REFERENCES moon_roulette_messages(id),
  send_attempt          int NOT NULL DEFAULT 1,

  -- Soft deletes: each party controls their own view independently.
  sender_deleted_at     timestamptz,
  recipient_deleted_at  timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_has_content CHECK (message_text IS NOT NULL OR photo_url IS NOT NULL),
  CONSTRAINT chk_not_self    CHECK (sender_id != recipient_id)
);

-- Sender inbox queries (status filter, created_at sort)
CREATE INDEX idx_mrm_sender     ON moon_roulette_messages(sender_id, status);
-- Recipient inbox queries
CREATE INDEX idx_mrm_recipient  ON moon_roulette_messages(recipient_id, status);
-- Distribution algorithm: exclude already-sent pairs efficiently
CREATE INDEX idx_mrm_pair       ON moon_roulette_messages(sender_id, recipient_id);
-- pg_cron release job: partial index on queued messages only
CREATE INDEX idx_mrm_release    ON moon_roulette_messages(release_at) WHERE status = 'queued';

-- Auto-update updated_at on any row change.
CREATE OR REPLACE FUNCTION touch_roulette_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_roulette_updated_at
  BEFORE UPDATE ON moon_roulette_messages
  FOR EACH ROW EXECUTE FUNCTION touch_roulette_updated_at();


-- Mutual-consent reveal table.
-- A reveal is complete when both sender and recipient have a row for the same message.
-- UNIQUE constraint guarantees each user can only reveal once per message.
CREATE TABLE moon_roulette_reveals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roulette_message_id   uuid NOT NULL REFERENCES moon_roulette_messages(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES profiles(id),
  revealed_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (roulette_message_id, user_id)
);

CREATE INDEX idx_mrr_message ON moon_roulette_reveals(roulette_message_id);


-- Trigger: when both sender and recipient have revealed, flip message status to 'revealed'.
CREATE OR REPLACE FUNCTION check_mutual_reveal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sender_id    uuid;
  v_recipient_id uuid;
  v_reveal_count int;
BEGIN
  SELECT sender_id, recipient_id
    INTO v_sender_id, v_recipient_id
    FROM moon_roulette_messages
   WHERE id = NEW.roulette_message_id;

  SELECT COUNT(*) INTO v_reveal_count
    FROM moon_roulette_reveals
   WHERE roulette_message_id = NEW.roulette_message_id
     AND user_id IN (v_sender_id, v_recipient_id);

  IF v_reveal_count = 2 THEN
    UPDATE moon_roulette_messages
       SET status = 'revealed', updated_at = now()
     WHERE id = NEW.roulette_message_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_mutual_reveal
  AFTER INSERT ON moon_roulette_reveals
  FOR EACH ROW EXECUTE FUNCTION check_mutual_reveal();
