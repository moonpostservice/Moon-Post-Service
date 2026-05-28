-- Migration: Track when the recipient first reads a roulette message.
-- Enables the sender to see "Read in [city]" once the stranger opens it.

-- 1. Add read timestamp column
ALTER TABLE moon_roulette_messages
  ADD COLUMN IF NOT EXISTS recipient_read_at timestamptz;

-- 2. Allow recipient to set recipient_read_at (no other columns need recipient UPDATE access)
CREATE POLICY "Recipient can mark roulette message as read"
  ON moon_roulette_messages FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid() AND status IN ('delivered', 'revealed'))
  WITH CHECK (recipient_id = auth.uid());

-- 3. Rebuild the recipient anonymity view to expose recipient_read_at
CREATE OR REPLACE VIEW roulette_recipient_view AS
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
  m.parent_id,
  m.send_attempt,
  m.recipient_read_at,
  m.created_at,
  m.updated_at,
  -- sender_id only exposed after mutual reveal
  CASE WHEN m.status = 'revealed' THEN m.sender_id ELSE NULL END AS sender_id
FROM moon_roulette_messages m
WHERE m.recipient_id = auth.uid()
  AND m.recipient_deleted_at IS NULL
  AND m.status IN ('delivered', 'revealed');
