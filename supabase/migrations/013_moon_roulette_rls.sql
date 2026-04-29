-- Migration: Moon Roulette RLS policies and anonymity view

ALTER TABLE moon_roulette_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE moon_roulette_reveals   ENABLE ROW LEVEL SECURITY;


-- ── moon_roulette_messages ────────────────────────────────────────────────────

-- Sender reads their own sent messages (respects sender soft-delete).
CREATE POLICY "Sender reads own roulette messages"
  ON moon_roulette_messages FOR SELECT
  TO authenticated
  USING (
    sender_id = auth.uid()
    AND sender_deleted_at IS NULL
  );

-- Recipient reads delivered/revealed messages addressed to them (respects recipient soft-delete).
-- Does NOT grant access to sender_id directly — use roulette_recipient_view for client queries.
CREATE POLICY "Recipient reads own roulette messages"
  ON moon_roulette_messages FOR SELECT
  TO authenticated
  USING (
    recipient_id = auth.uid()
    AND recipient_deleted_at IS NULL
    AND status IN ('delivered', 'revealed')
  );

-- No direct client INSERT. Edge Functions use the service role key.
-- Status changes go through Edge Functions (service role).
-- Exception: sender may soft-delete their own message by setting sender_deleted_at.
CREATE POLICY "Sender can soft-delete own roulette message"
  ON moon_roulette_messages FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- No DELETE policy = deny by default.


-- ── Anonymity view ────────────────────────────────────────────────────────────
-- Clients querying on behalf of the recipient MUST use this view.
-- sender_id is NULL until status = 'revealed', preventing any identity leak.
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
  m.created_at,
  m.updated_at,
  -- sender_id only exposed after mutual reveal
  CASE WHEN m.status = 'revealed' THEN m.sender_id ELSE NULL END AS sender_id
FROM moon_roulette_messages m
WHERE m.recipient_id = auth.uid()
  AND m.recipient_deleted_at IS NULL
  AND m.status IN ('delivered', 'revealed');


-- ── moon_roulette_reveals ─────────────────────────────────────────────────────

-- Users can insert their own reveal row.
CREATE POLICY "User inserts own reveal"
  ON moon_roulette_reveals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only read their OWN reveal row.
-- They learn the other party has revealed by watching moon_roulette_messages.status
-- flip to 'revealed' via Realtime — not by reading the other party's row.
CREATE POLICY "User reads own reveal row"
  ON moon_roulette_reveals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE or DELETE = reveal is permanent.


-- ── Helper: user participates in roulette message ─────────────────────────────
-- Used by Edge Functions and reactions if extended to roulette messages later.
CREATE OR REPLACE FUNCTION user_participates_in_roulette(msg_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM moon_roulette_messages
    WHERE id = msg_id
      AND (sender_id = auth.uid() OR recipient_id = auth.uid())
  );
$$;
