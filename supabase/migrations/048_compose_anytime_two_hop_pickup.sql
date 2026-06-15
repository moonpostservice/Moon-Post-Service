-- 048_compose_anytime_two_hop_pickup.sql
--
-- PRODUCT SHIFT: composing is no longer gated by the sender's moon. Delivery is
-- a two-hop moon journey:
--   hop 1 (pickup):   if the sender's moon is down at compose, the message waits
--                     "awaiting pickup" until the sender's next moonrise (pickup_at).
--                     If the sender's moon is already up, pickup_at = creation.
--   hop 2 (delivery): it then lands in the recipient's sky at their first moonrise
--                     on/after pickup (release_at — unchanged mechanics).
--
-- "Awaiting pickup" is DERIVED from pickup_at (now < pickup_at), exactly the way
-- "sealed" is derived from release_at — so NO new status value and NO new cron.
-- The existing release_due_messages() cron still flips in_transit -> released at
-- release_at. The courier timing is stamped client-side at send (deterministic
-- SunCalc), passed through the send-message edge function / reply insert.
--
-- A message must be invisible to the recipient before it's collected (the postman
-- hasn't picked it up yet) — so rows with a future pickup_at are visible ONLY to
-- the sender, in both the base-table RLS and the masking views.
--
-- Also widens the seal's "stuck forever" backstop from 24h to 72h: two-hop
-- delivery can legitimately exceed one day (a full pickup cycle + a full
-- recipient cycle), and the old 24h cap would unseal content mid-transit.

-- ============================================================
-- 1. Columns + backfill
-- ============================================================

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS pickup_at timestamptz;
ALTER TABLE public.replies  ADD COLUMN IF NOT EXISTS pickup_at timestamptz;

-- Existing rows were effectively collected the instant they were created.
UPDATE public.messages SET pickup_at = created_at WHERE pickup_at IS NULL;
UPDATE public.replies  SET pickup_at = created_at WHERE pickup_at IS NULL;

-- Metadata-only grant so the client can render the pickup countdown (sender side)
-- and the recipient-side row-visibility predicates can read it. Content columns
-- remain view-only (migration 043 posture).
GRANT SELECT (pickup_at) ON public.messages TO authenticated;
GRANT SELECT (pickup_at) ON public.replies  TO authenticated;

-- ============================================================
-- 2. Base-table RLS: hide pre-pickup rows from everyone but the sender
-- ============================================================

DROP POLICY IF EXISTS "Users can read their messages" ON public.messages;
CREATE POLICY "Users can read their messages" ON public.messages
FOR SELECT USING (
  sender_id = (SELECT auth.uid())
  OR (
    (pickup_at IS NULL OR pickup_at <= now())
    AND (
      recipient_id = (SELECT auth.uid())
      OR recipient_email = (SELECT auth.jwt() ->> 'email')
    )
  )
);

-- replies "Reply access" is an ALL policy (governs INSERT WITH CHECK too). The
-- sender_id branch keeps the sender's own inserts/reads working; the parent-thread
-- branch (recipient reads) gains the same pre-pickup gate.
DROP POLICY IF EXISTS "Reply access" ON public.replies;
CREATE POLICY "Reply access" ON public.replies
FOR ALL USING (
  sender_id = (SELECT auth.uid())
  OR (
    (pickup_at IS NULL OR pickup_at <= now())
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = replies.message_id
        AND (m.sender_id = (SELECT auth.uid()) OR m.recipient_id = (SELECT auth.uid()))
    )
  )
)
-- Preserve the original insert/update guard verbatim (was a separate WITH CHECK):
-- you may only write replies as yourself. Pickup gating applies to reads only.
WITH CHECK (sender_id = (SELECT auth.uid()));

-- ============================================================
-- 3. Masking views: add pickup_at, gate pre-pickup rows, widen cap to 72h
-- ============================================================

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
  m.pickup_at
FROM public.messages m
CROSS JOIN LATERAL (
  SELECT (m.sender_id IS DISTINCT FROM (SELECT auth.uid()))
     AND m.created_at > now() - interval '72 hours'
     AND (   (m.release_at IS NOT NULL AND m.release_at > now())
          OR (m.release_at IS NULL AND m.status = 'in_transit')
         ) AS sealed
) s
-- Row visibility: sender always; recipient (by id or email) only once the
-- message has been collected (pickup_at in the past / null for legacy rows).
WHERE m.sender_id = (SELECT auth.uid())
   OR (
        (m.pickup_at IS NULL OR m.pickup_at <= now())
        AND (
             m.recipient_id = (SELECT auth.uid())
          OR (m.recipient_email IS NOT NULL
              AND lower(m.recipient_email) = lower(COALESCE((SELECT auth.jwt() ->> 'email'), '')))
        )
      );

CREATE OR REPLACE VIEW public.replies_v
WITH (security_barrier = true) AS
SELECT
  r.id,
  r.message_id,
  r.sender_id,
  r.is_lunar_note,
  r.status,
  r.release_at,
  r.recipient_city,
  r.notified_at,
  r.created_at,
  CASE WHEN s.sealed THEN NULL ELSE r.text               END AS text,
  CASE WHEN s.sealed THEN NULL ELSE r.lunar_note_text    END AS lunar_note_text,
  CASE WHEN s.sealed THEN NULL ELSE r.lunar_note_closing END AS lunar_note_closing,
  CASE WHEN s.sealed THEN NULL ELSE r.photo_url          END AS photo_url,
  CASE WHEN s.sealed THEN NULL ELSE r.song_url           END AS song_url,
  CASE WHEN s.sealed THEN NULL ELSE r.song_title         END AS song_title,
  s.sealed,
  r.pickup_at
FROM public.replies r
CROSS JOIN LATERAL (
  SELECT (r.sender_id IS DISTINCT FROM (SELECT auth.uid()))
     AND r.created_at > now() - interval '72 hours'
     AND (   (r.release_at IS NOT NULL AND r.release_at > now())
          OR (r.release_at IS NULL AND r.status = 'in_transit')
         ) AS sealed
) s
-- A reply is visible to its sender, and to a parent-thread participant only once
-- the reply has been collected.
WHERE r.sender_id = (SELECT auth.uid())
   OR (
        (r.pickup_at IS NULL OR r.pickup_at <= now())
        AND EXISTS (
          SELECT 1 FROM public.messages pm
          WHERE pm.id = r.message_id
            AND (   pm.sender_id = (SELECT auth.uid())
                 OR pm.recipient_id = (SELECT auth.uid())
                 OR (pm.recipient_email IS NOT NULL
                     AND lower(pm.recipient_email) = lower(COALESCE((SELECT auth.jwt() ->> 'email'), '')))
                )
        )
      );

-- CREATE OR REPLACE preserves the migration-043 grants (authenticated/service_role).
