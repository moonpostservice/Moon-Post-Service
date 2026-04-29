-- Migration: Add notified_at column to moon_roulette_messages
-- Tracks when the recipient email/push notification was sent for a delivered message.
-- The notify-roulette-deliveries Edge Function writes this after a successful send.

ALTER TABLE moon_roulette_messages
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mrm_notify
  ON moon_roulette_messages(notified_at)
  WHERE status = 'delivered' AND notified_at IS NULL;
