-- 050_send_by_link_reply_graduation.sql
--
-- Phase 3 of "send by link": when a shareable-link OPENER signs up to reply,
-- graduate their open into a normal 1:1 conversation with the sender. We mirror
-- the shared message as a regular messages row (sender → this opener) with
-- conversation_id NULL, so the existing BEFORE INSERT trigger
-- (assign_conversation_on_message_insert → find_or_create_conversation) links
-- the canonical conversation between the two users. The opener then replies
-- through the normal reply flow, and it threads back to the sender — same
-- machinery roulette uses to "graduate on reveal" (migration 040).
--
-- Reusable link → one graduated conversation PER replying opener. Reading stays
-- anonymous; only replying creates the thread.

-- Idempotency marker: the messages row this open graduated into.
ALTER TABLE public.message_link_opens
  ADD COLUMN IF NOT EXISTS graduated_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;

-- Bind an open to the now-known user and mirror the shared message into a real
-- conversation. Returns the conversation id (so the client can open the thread).
-- SECURITY DEFINER: bypasses messages RLS to insert sender_id = the ORIGINAL
-- sender (not the caller), exactly like graduate_roulette_thread.
CREATE OR REPLACE FUNCTION public.graduate_link_reply(p_token text, p_open_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_open     record;
  v_msg      record;
  v_release  timestamptz;
  v_released boolean;
  v_new_id   uuid;
  v_conv     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT * INTO v_open FROM message_link_opens WHERE id = p_open_id;
  IF v_open.id IS NULL THEN RETURN NULL; END IF;

  -- The token must match the open's message (defends against forged pairings).
  SELECT * INTO v_msg
    FROM messages
   WHERE id = v_open.message_id AND shareable = true AND share_token = p_token;
  IF v_msg.id IS NULL THEN RETURN NULL; END IF;

  -- You can't reply to your own broadcast.
  IF v_msg.sender_id = v_uid THEN RETURN NULL; END IF;

  -- Claim this open for the signed-up user (first writer wins).
  IF v_open.recipient_id IS NULL THEN
    UPDATE message_link_opens SET recipient_id = v_uid WHERE id = p_open_id;
  ELSIF v_open.recipient_id <> v_uid THEN
    RETURN NULL; -- already belongs to a different account
  END IF;

  -- Already graduated → return the existing conversation.
  IF v_open.graduated_message_id IS NOT NULL THEN
    SELECT conversation_id INTO v_conv FROM messages WHERE id = v_open.graduated_message_id;
    RETURN v_conv;
  END IF;

  v_release  := COALESCE(v_open.release_at, v_msg.pickup_at, v_msg.created_at);
  v_released := v_release <= now();

  INSERT INTO messages (
    sender_id, recipient_id,
    message_text, lunar_note_text, lunar_note_closing,
    photo_url, song_url, song_title,
    moon_phase, moon_illumination,
    status, release_at, released_at, read_at,
    pickup_at, created_at, conversation_id
  ) VALUES (
    v_msg.sender_id, v_uid,
    v_msg.message_text, v_msg.lunar_note_text, v_msg.lunar_note_closing,
    v_msg.photo_url, v_msg.song_url, v_msg.song_title,
    v_msg.moon_phase, v_msg.moon_illumination,
    CASE WHEN v_released THEN 'released' ELSE 'in_transit' END,
    v_release,
    CASE WHEN v_released THEN v_release ELSE NULL END,
    -- "read" only if they've actually seen it (revealed). If still sealed, leave
    -- null so the moonrise digest can ping them like any other recipient.
    CASE WHEN v_released THEN now() ELSE NULL END,
    COALESCE(v_msg.pickup_at, v_msg.created_at),
    v_msg.created_at,
    NULL  -- trigger assigns the canonical conversation between the pair
  )
  RETURNING id, conversation_id INTO v_new_id, v_conv;

  UPDATE message_link_opens
     SET graduated_message_id = v_new_id, recipient_id = v_uid
   WHERE id = p_open_id;

  RETURN v_conv;
END;
$$;

-- Authenticated openers call this on signup-to-reply; anon must not.
-- Supabase default privileges grant anon an EXPLICIT execute that REVOKE FROM
-- PUBLIC does not remove, so revoke anon explicitly too (authenticated only).
REVOKE EXECUTE ON FUNCTION public.graduate_link_reply(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.graduate_link_reply(text, uuid) TO authenticated;
