-- 040_roulette_graduate_on_reveal.sql
--
-- BUG: after two people mutually reveal in a Moon Roulette thread, the roulette
-- conversation and any regular conversation with that same person stayed as TWO
-- separate inbox boxes. moon_roulette_messages and public.messages are distinct
-- tables keyed differently (roulette by thread-root id, regular by person id) and
-- nothing ever merged them. So a revealed roulette chat + a normal message from the
-- now-known person showed up as duplicate chatboxes for one human.
--
-- FIX ("graduate on reveal"): the moment a thread is mutually revealed, copy its
-- messages into the normal public.messages system under the single conversation
-- between the two users (reusing an existing one via find_or_create_conversation,
-- which the messages BEFORE INSERT trigger calls automatically), and mark the
-- roulette rows graduated so they drop out of the roulette inbox. From then on the
-- pair has exactly ONE chatbox containing the full history + any normal messages.
--
-- Idempotent: graduated rows are skipped on re-run (graduated_at guard), so the
-- trigger firing again or the backfill running twice is a no-op.

-- 1. Marker column: a graduated roulette message has been mirrored into messages
--    and must no longer surface as a roulette inbox row.
ALTER TABLE moon_roulette_messages
  ADD COLUMN IF NOT EXISTS graduated_at timestamptz;

-- 2. Hide graduated messages from the recipient anonymity view.
--    (Recreated verbatim from migration 013 + the graduated_at filter.)
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
  m.recipient_read_at,
  CASE WHEN m.status = 'revealed' THEN m.sender_id ELSE NULL END AS sender_id
FROM moon_roulette_messages m
WHERE m.recipient_id = auth.uid()
  AND m.recipient_deleted_at IS NULL
  AND m.graduated_at IS NULL
  AND m.status IN ('delivered', 'revealed');

-- 3. Graduate one thread: mirror every delivered/revealed message in the thread
--    that contains p_message_id into public.messages, then mark them graduated.
--    conversation_id is left NULL so the messages BEFORE INSERT trigger
--    (assign_conversation_on_message_insert) links them to the one canonical
--    conversation between the two users.
CREATE OR REPLACE FUNCTION graduate_roulette_thread(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_root uuid;
  r      record;
BEGIN
  -- Walk parent_id links up to the thread root.
  WITH RECURSIVE up AS (
    SELECT id, parent_id FROM moon_roulette_messages WHERE id = p_message_id
    UNION ALL
    SELECT m.id, m.parent_id
      FROM moon_roulette_messages m
      JOIN up ON m.id = up.parent_id
  )
  SELECT id INTO v_root FROM up WHERE parent_id IS NULL LIMIT 1;

  IF v_root IS NULL THEN
    SELECT id INTO v_root FROM moon_roulette_messages WHERE id = p_message_id;
  END IF;

  IF v_root IS NULL THEN
    RETURN; -- message vanished; nothing to do
  END IF;

  -- Mirror the whole thread (root + all descendants), oldest first so the
  -- conversation's last_message_preview ends up reflecting the newest message.
  FOR r IN
    WITH RECURSIVE thread AS (
      SELECT * FROM moon_roulette_messages WHERE id = v_root
      UNION ALL
      SELECT m.*
        FROM moon_roulette_messages m
        JOIN thread t ON m.parent_id = t.id
    )
    SELECT * FROM thread
     WHERE status IN ('delivered', 'revealed')
       AND graduated_at IS NULL
     ORDER BY created_at ASC
  LOOP
    INSERT INTO messages (
      sender_id, recipient_id,
      message_text, photo_url, song_url, song_title,
      moon_phase, moon_illumination,
      status, release_at, released_at, read_at,
      created_at, conversation_id
    ) VALUES (
      r.sender_id, r.recipient_id,
      r.message_text, r.photo_url, r.song_url, r.song_title,
      r.moon_phase, r.moon_illumination,
      'released',
      COALESCE(r.released_at, r.release_at, r.created_at),
      COALESCE(r.released_at, r.release_at, r.created_at),
      COALESCE(r.recipient_read_at, r.created_at),
      r.created_at,
      NULL  -- trigger assigns the canonical conversation between the pair
    );

    UPDATE moon_roulette_messages SET graduated_at = now() WHERE id = r.id;
  END LOOP;
END;
$$;

-- Internal only: invoked from the reveal trigger (which runs as definer). No client
-- ever calls this directly.
REVOKE EXECUTE ON FUNCTION graduate_roulette_thread(uuid) FROM PUBLIC;

-- 4. Hook graduation into the mutual-reveal trigger: when both parties have
--    revealed, flip status AND graduate the thread in the same transaction.
CREATE OR REPLACE FUNCTION check_mutual_reveal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    PERFORM graduate_roulette_thread(NEW.roulette_message_id);
  END IF;

  RETURN NEW;
END;
$$;
