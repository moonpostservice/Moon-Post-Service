-- 053_anonymous_link_expiry_and_signature.sql
--
-- FEATURE: the landing "send by link" flow becomes a PURE, ANONYMOUS, one-way
-- moon message (no account, no recipient, no replies). See the design note in
-- the project memory (project_send_flow_rethink_handoff).
--
-- This migration carries the schema deltas the redesigned flow needs:
--   1. sender_id may be NULL — an anonymous visitor mints a link with no account.
--   2. sender_display_name — an optional free-text signature ("— from Ada").
--   3. expires_at — the next new moon; the whole link vanishes then.
--   4. creator_ip — abuse backstop for the (account-less) anonymous mint path.
--   5. The conversation-assignment trigger skips shareable rows outright (they
--      never belong to a conversation; this also makes a NULL sender_id safe).
--   6. A "vanish sweep" cron that nulls the content of expired links hourly, so
--      "vanishes with the new moon" is real erasure, not just a hidden flag.
--
-- Writes/reads for shareable messages all go through the send-message /
-- reveal-message edge functions (service role), so no anon table grants are
-- added here — the anon key still cannot touch the messages table directly.

-- ============================================================
-- 1. messages: new columns + nullable sender
-- ============================================================

ALTER TABLE public.messages ALTER COLUMN sender_id DROP NOT NULL;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_display_name text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS expires_at          timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS creator_ip          text;

-- Rate-limit lookup: anonymous mints per IP in the last hour.
CREATE INDEX IF NOT EXISTS messages_creator_ip_created_idx
  ON public.messages (creator_ip, created_at)
  WHERE creator_ip IS NOT NULL;

-- Vanish-sweep lookup: shareable links past their new moon that still hold content.
CREATE INDEX IF NOT EXISTS messages_shareable_expiry_idx
  ON public.messages (expires_at)
  WHERE shareable = true AND expires_at IS NOT NULL;

-- ============================================================
-- 2. Conversation-assignment trigger: never touch shareable rows
-- ============================================================
-- A shareable link is recipient-less and (now) possibly sender-less. It must
-- not flow into find_or_create_conversation at all. Short-circuiting here keeps
-- a NULL sender_id safe and avoids any conversation side effects.

CREATE OR REPLACE FUNCTION public.assign_conversation_on_message_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Anonymous/shareable one-way links are not part of any conversation.
    IF NEW.shareable IS TRUE THEN
        RETURN NEW;
    END IF;

    IF NEW.conversation_id IS NULL THEN
        NEW.conversation_id := find_or_create_conversation(
            NEW.sender_id,
            NEW.recipient_id,
            NEW.recipient_email
        );
    END IF;

    IF NEW.conversation_id IS NOT NULL THEN
        UPDATE conversations
        SET last_message_at = COALESCE(NEW.created_at, now()),
            last_message_preview = LEFT(COALESCE(NEW.message_text, NEW.lunar_note_text, 'Moon message'), 100),
            updated_at = now(),
            -- A new message revives a previously new-moon-erased thread.
            wiped_at = NULL
        WHERE id = NEW.conversation_id;
    END IF;

    RETURN NEW;
END;
$function$;

-- ============================================================
-- 3. Vanish sweep: erase expired shareable content (hourly)
-- ============================================================
-- reveal-message already refuses to serve a message whose expires_at has
-- passed. This makes the erasure real: once the new moon is past, the words
-- themselves are gone from the row (the share_token + metadata remain so the
-- link can still resolve to a graceful "this message has set").

CREATE OR REPLACE FUNCTION public.vanish_expired_links()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.messages
     SET message_text       = NULL,
         lunar_note_text    = NULL,
         lunar_note_closing = NULL,
         photo_url          = NULL,
         song_url           = NULL,
         song_title         = NULL
   WHERE shareable = true
     AND expires_at IS NOT NULL
     AND expires_at <= now()
     AND message_text IS NOT NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.vanish_expired_links() FROM PUBLIC, anon, authenticated;

-- Hourly sweep (precision-to-the-day is plenty for "with the new moon").
SELECT cron.schedule(
  'vanish-expired-links',
  '7 * * * *',
  $$ SELECT public.vanish_expired_links(); $$
);
