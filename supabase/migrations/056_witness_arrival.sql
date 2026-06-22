-- 056_witness_arrival.sql
--
-- FEATURE: "Witness the arrival" — the landing sender's signup hook.
--
-- A logged-out visitor casts a shareable moon note (migration 049): the message
-- is born with sender_id = NULL (anonymous). The share sheet now offers
-- "Save it to your sky →", which is the signup. On completing signup the
-- claim-sent-message edge function binds that orphan note to the new account
-- (sets messages.sender_id). From then on the sender can WATCH their note land:
-- message_link_opens already records every opener's city + reveal time, and the
-- "sender reads opens of own messages" RLS policy (049) already lets them read it.
--
-- This migration adds the ONE missing piece — letting the moonrise digest tell
-- the sender when an opener has actually read their note, exactly once per open.
-- No new tables; the read/location data all lives in message_link_opens already.

-- ============================================================
-- 1. message_link_opens: per-open "we told the sender" stamp
-- ============================================================
-- release-messages (the digest cron) folds "someone opened your note from <city>"
-- into the sender's next moonrise email. sender_notified_at marks an open as
-- already-announced so the same reveal is never emailed twice — mirrors the
-- messages.notified_at / replies.notified_at posture in the same digest.

ALTER TABLE public.message_link_opens
  ADD COLUMN IF NOT EXISTS sender_notified_at timestamptz;

-- Cron lookup: revealed opens whose sender hasn't been told yet. Partial index
-- keeps it tiny — only the handful of un-announced reveals are ever indexed.
CREATE INDEX IF NOT EXISTS message_link_opens_sender_notify_idx
  ON public.message_link_opens (message_id)
  WHERE revealed_at IS NOT NULL AND sender_notified_at IS NULL;

-- Writes stay service-role only (049): the digest fn stamps sender_notified_at.
-- No new grants — authenticated already has SELECT (row-scoped by RLS), and the
-- new column carries no content, just a timestamp.
