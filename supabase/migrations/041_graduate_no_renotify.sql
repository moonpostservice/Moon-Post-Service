-- 041_graduate_no_renotify.sql
--
-- BUG: graduating a revealed roulette thread (migration 040) mirrors its messages
-- into public.messages with read_at set but notified_at NULL. The release-messages
-- cron emails any status='released' + notified_at IS NULL message, so the moment a
-- thread was revealed the recipient got a "The moon just rose — 1 message waiting"
-- digest for messages they had ALREADY read (often weeks old). Confirmed in prod:
-- graduated rows from 2026-05-26 / 2026-06-05 got notified_at = today right after
-- reveal.
--
-- FIX: graduated messages are historical, already-delivered copies — they must be
-- born already "notified" so the cron never treats them as new arrivals. Set
-- notified_at in the graduation INSERT (to the original delivery time), and backfill
-- any existing already-read-but-unnotified messages so the next cron run can't fire
-- more spurious digests. (The release-messages edge function also gained an
-- `is('read_at', null)` guard as defense-in-depth.)

-- 1. Graduation now stamps notified_at on the mirrored rows.
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
    RETURN;
  END IF;

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
      notified_at,                       -- NEW: born already-notified (historical copy)
      created_at, conversation_id
    ) VALUES (
      r.sender_id, r.recipient_id,
      r.message_text, r.photo_url, r.song_url, r.song_title,
      r.moon_phase, r.moon_illumination,
      'released',
      COALESCE(r.released_at, r.release_at, r.created_at),
      COALESCE(r.released_at, r.release_at, r.created_at),
      COALESCE(r.recipient_read_at, r.created_at),
      COALESCE(r.released_at, r.release_at, r.created_at),   -- notified_at
      r.created_at,
      NULL  -- trigger assigns the canonical conversation between the pair
    );

    UPDATE moon_roulette_messages SET graduated_at = now() WHERE id = r.id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION graduate_roulette_thread(uuid) FROM PUBLIC;

-- 2. Backfill: a message that's already been read should never trigger a "waiting
--    for you" digest. Stamp notified_at on existing already-read, unnotified rows so
--    the next cron tick can't email them.
UPDATE public.messages
   SET notified_at = COALESCE(notified_at, now())
 WHERE notified_at IS NULL
   AND read_at IS NOT NULL;
