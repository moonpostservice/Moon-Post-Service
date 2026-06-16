-- 049_send_by_link_shareable_messages.sql
--
-- FEATURE: "Send by link" — a shareable moon message.
--
-- Instead of binding a message to one known recipient (email + city) at send
-- time, the sender confirms their identity, then shares a secret link. The
-- message row is born WITHOUT a recipient (recipient_id / recipient_email /
-- recipient_city / release_at all NULL) and carries an unguessable share_token.
--
-- The link is REUSABLE: every person who opens it locks THEIR OWN location and
-- gets THEIR OWN moonrise reveal time. So a single message can reach many
-- people, each as a separate "open". We can't store one recipient on the
-- message row, so each open lives in its own table: public.message_link_opens.
--
-- pickup_at keeps its two-hop meaning (migration 048): when the SENDER's moon
-- collects the note. Each opener's release_at (hop 2, their moonrise) is stamped
-- per-open in message_link_opens, computed client-side at claim time and passed
-- through the claim-link edge function (same SunCalc-stamped-client posture as
-- the normal send path).

-- ============================================================
-- 1. messages: shareable flag + secret token
-- ============================================================

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS shareable   boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS share_token text;

-- One token per message; the edge function generates a url-safe random token.
CREATE UNIQUE INDEX IF NOT EXISTS messages_share_token_key
  ON public.messages (share_token)
  WHERE share_token IS NOT NULL;

-- Sender renders/copies the link from their own row. Metadata-only grants,
-- consistent with migration 043/048 posture (content stays view-only).
GRANT SELECT (shareable)   ON public.messages TO authenticated;
GRANT SELECT (share_token) ON public.messages TO authenticated;

-- ============================================================
-- 2. message_link_opens: one row per person who opens a shared link
-- ============================================================

CREATE TABLE IF NOT EXISTS public.message_link_opens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  -- NULL until the opener signs up to write back; then linked to their profile.
  recipient_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Locked when they confirm their city on open (auto-detected, confirmable).
  recipient_city text,
  recipient_lat  double precision,
  recipient_lon  double precision,
  recipient_tz   text,
  -- Hop 2: this opener's first moonrise on/after the sender's pickup_at.
  release_at    timestamptz,
  -- Stamped when this opener has actually seen the content (release_at passed).
  revealed_at   timestamptz,
  -- "Remind me when my moon rises": if the opener opts in, we hold their email
  -- and the release-messages cron emails them once release_at passes, stamping
  -- reminder_sent_at so it fires exactly once. Anonymous — not a profile.
  reminder_email   text,
  reminder_sent_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Cron lookup: due reminders not yet sent.
CREATE INDEX IF NOT EXISTS message_link_opens_reminder_due_idx
  ON public.message_link_opens (release_at)
  WHERE reminder_email IS NOT NULL AND reminder_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS message_link_opens_message_id_idx
  ON public.message_link_opens (message_id);
CREATE INDEX IF NOT EXISTS message_link_opens_recipient_id_idx
  ON public.message_link_opens (recipient_id)
  WHERE recipient_id IS NOT NULL;

-- ============================================================
-- 3. RLS: writes are service-role only (claim-link edge fn). Reads are scoped
--    to the opener (their own claims) and the message's sender (their opens).
-- ============================================================

ALTER TABLE public.message_link_opens ENABLE ROW LEVEL SECURITY;

-- An opener who has signed up can read their own claim rows.
DROP POLICY IF EXISTS "Opener reads own link opens" ON public.message_link_opens;
CREATE POLICY "Opener reads own link opens" ON public.message_link_opens
FOR SELECT USING (recipient_id = (SELECT auth.uid()));

-- The sender can read all opens of their own shared messages (inbox / "who
-- opened it" — content gating still happens in the masking view / edge fn).
DROP POLICY IF EXISTS "Sender reads opens of own messages" ON public.message_link_opens;
CREATE POLICY "Sender reads opens of own messages" ON public.message_link_opens
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_link_opens.message_id
      AND m.sender_id = (SELECT auth.uid())
  )
);

-- No INSERT/UPDATE/DELETE policies → only the service role (claim-link,
-- reveal-message, signup-link edge functions) can write. anon/authenticated
-- cannot forge or mutate an open.
REVOKE ALL ON public.message_link_opens FROM anon;
GRANT SELECT ON public.message_link_opens TO authenticated;
GRANT ALL    ON public.message_link_opens TO service_role;

-- ============================================================
-- 4. messages_v: expose shareable + share_token (sender-side rendering)
-- ============================================================
-- CREATE OR REPLACE keeps the existing security_barrier + grants. The seal
-- logic is unchanged: a shareable message has release_at IS NULL and
-- status='in_transit', so for a NON-sender viewer the LATERAL marks it sealed
-- (content NULL) — but the row-visibility WHERE below still only lets the
-- SENDER see a shareable row through the view (it has no recipient_id/email).
-- Per-opener reveal is handled by the reveal-message edge function (service
-- role) against message_link_opens, not this view.

CREATE OR REPLACE VIEW public.messages_v
WITH (security_barrier = true) AS
SELECT
  m.id,
  m.sender_id,
  m.recipient_id,
  m.recipient_email,
  m.recipient_name,
  m.recipient_city,
  m.conversation_id,
  m.moon_phase,
  m.moon_illumination,
  m.status,
  m.release_at,
  m.released_at,
  m.read_at,
  m.notified_at,
  m.created_at,
  CASE WHEN s.sealed THEN NULL ELSE m.message_text       END AS message_text,
  CASE WHEN s.sealed THEN NULL ELSE m.lunar_note_text    END AS lunar_note_text,
  CASE WHEN s.sealed THEN NULL ELSE m.lunar_note_closing END AS lunar_note_closing,
  CASE WHEN s.sealed THEN NULL ELSE m.photo_url          END AS photo_url,
  CASE WHEN s.sealed THEN NULL ELSE m.song_url           END AS song_url,
  CASE WHEN s.sealed THEN NULL ELSE m.song_title         END AS song_title,
  s.sealed,
  m.pickup_at,
  m.shareable,
  m.share_token
FROM public.messages m
CROSS JOIN LATERAL (
  SELECT (m.sender_id IS DISTINCT FROM (SELECT auth.uid()))
     AND m.created_at > now() - interval '72 hours'
     AND (   (m.release_at IS NOT NULL AND m.release_at > now())
          OR (m.release_at IS NULL AND m.status = 'in_transit')
         ) AS sealed
) s
WHERE m.sender_id = (SELECT auth.uid())
   OR (
        (m.pickup_at IS NULL OR m.pickup_at <= now())
        AND (
             m.recipient_id = (SELECT auth.uid())
          OR (m.recipient_email IS NOT NULL
              AND lower(m.recipient_email) = lower(COALESCE((SELECT auth.jwt() ->> 'email'), '')))
        )
      );
