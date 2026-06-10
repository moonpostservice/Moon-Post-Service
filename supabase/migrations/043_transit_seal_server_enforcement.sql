-- 043_transit_seal_server_enforcement.sql
--
-- SECURITY FIX (HIGH): moon-transit sealing was client-side only.
--
-- Root cause, two holes:
--   1. The RLS SELECT policies on public.messages / public.replies return FULL
--      rows to the recipient while a message is still in transit. The UI seals
--      content with replyStillSealed()/contentVisible, but any recipient could
--      read undelivered message_text / lunar_note_text / photo_url / song_url /
--      text straight off the REST API with their own session. RLS gates rows,
--      not columns (same lesson as migration 029).
--   2. `authenticated` held UPDATE on messages/replies, and the client's
--      autoReleaseInTransitMessages() leaned on it — so a recipient could also
--      flip status/release_at themselves and force-release early.
--
-- Fix, mirroring the 029 column-grant pattern:
--   A. Masking views messages_v / replies_v: same rows the user could already
--      see, but content columns are NULLed while the row is sealed for the
--      viewer. Row existence, status, release_at, recipient_city etc. stay
--      visible so the inbox can keep showing "On Its Way" + countdown. All
--      client CONTENT reads move to these views.
--   B. Column-level SELECT grants on the base tables: metadata only. This also
--      strips content from Realtime postgres_changes payloads — WALRUS "filters
--      out all columns that are not visible to the user's role" — closing the
--      live-subscription leak with the same stroke.
--   C. UPDATE revoked entirely from anon/authenticated on both tables. The
--      release transition is server-side only: the release-messages edge
--      function (service role) plus the pg_cron backstop added here, both of
--      which release strictly when release_at <= now().
--   D. conversations: SELECT narrowed to the three columns the client reads,
--      so a trigger-maintained last-message preview (if present) can't leak
--      in-transit content either.
--
-- The seal predicate deliberately mirrors the client gate (utils.js
-- replyStillSealed / circles-state contentVisible), with release_at as the
-- source of truth and the same 24h hard cap so nothing stays sealed forever:
--   sealed = viewer is not the sender
--        AND created_at > now() - 24h
--        AND (release_at > now() OR (release_at IS NULL AND status = 'in_transit'))
-- Server-visible ⊇ client-visible: the client may still hide released content
-- until the local moon is up (cosmetic), but the server never returns content
-- the client would show.

-- ============================================================
-- A. Masking views
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
  s.sealed
FROM public.messages m
CROSS JOIN LATERAL (
  SELECT (m.sender_id IS DISTINCT FROM (SELECT auth.uid()))
     AND m.created_at > now() - interval '24 hours'
     AND (   (m.release_at IS NOT NULL AND m.release_at > now())
          OR (m.release_at IS NULL AND m.status = 'in_transit')
         ) AS sealed
) s
-- Row visibility: the view runs as its owner (bypassing base RLS), so the row
-- scope is re-stated here — sender, recipient by id, or recipient by email.
WHERE m.sender_id = (SELECT auth.uid())
   OR m.recipient_id = (SELECT auth.uid())
   OR (m.recipient_email IS NOT NULL
       AND lower(m.recipient_email) = lower(COALESCE((SELECT auth.jwt() ->> 'email'), '')));

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
  s.sealed
FROM public.replies r
CROSS JOIN LATERAL (
  SELECT (r.sender_id IS DISTINCT FROM (SELECT auth.uid()))
     AND r.created_at > now() - interval '24 hours'
     AND (   (r.release_at IS NOT NULL AND r.release_at > now())
          OR (r.release_at IS NULL AND r.status = 'in_transit')
         ) AS sealed
) s
-- A reply is visible to its sender and to anyone who can see the parent message.
WHERE r.sender_id = (SELECT auth.uid())
   OR EXISTS (
        SELECT 1 FROM public.messages pm
        WHERE pm.id = r.message_id
          AND (   pm.sender_id = (SELECT auth.uid())
               OR pm.recipient_id = (SELECT auth.uid())
               OR (pm.recipient_email IS NOT NULL
                   AND lower(pm.recipient_email) = lower(COALESCE((SELECT auth.jwt() ->> 'email'), '')))
              )
      );

-- Supabase default privileges grant broadly on new objects — lock the views to
-- authenticated only (REVOKE FROM PUBLIC, per migration 026/037 lesson).
REVOKE ALL ON public.messages_v, public.replies_v FROM PUBLIC, anon;
GRANT SELECT ON public.messages_v, public.replies_v TO authenticated, service_role;

-- ============================================================
-- B. Base tables: metadata-only SELECT for clients
-- ============================================================
-- Counts, in-transit dot queries and Realtime keep working off these columns;
-- content is view-only. service_role keeps its full grants (edge functions,
-- graduation trigger, admin RPCs are SECURITY DEFINER and unaffected).

REVOKE SELECT ON public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, sender_id, recipient_id, recipient_email, recipient_name,
              recipient_city, conversation_id, moon_phase, moon_illumination,
              status, release_at, released_at, read_at, notified_at, created_at)
  ON public.messages TO authenticated;

REVOKE SELECT ON public.replies FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, message_id, sender_id, is_lunar_note, status, release_at,
              recipient_city, notified_at, created_at)
  ON public.replies TO authenticated;

-- ============================================================
-- C. Release transition is server-side only
-- ============================================================
-- No client code legitimately updates messages/replies — releases go through
-- the service role. Strip UPDATE entirely (autoReleaseInTransitMessages() in
-- js/moon-calc.js is degutted in the same change).

REVOKE UPDATE ON public.messages FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.replies  FROM PUBLIC, anon, authenticated;

-- Same stroke closes two adjacent tamper holes found while verifying policies:
-- the replies "Reply access" ALL policy (USING: sender or thread participant)
-- combined with broad grants let a participant UPDATE or DELETE other people's
-- replies; messages' UPDATE policy had no WITH CHECK at all. No client code
-- deletes messages/replies (delete_my_account() is SECURITY DEFINER).
REVOKE DELETE ON public.messages FROM PUBLIC, anon, authenticated;
REVOKE DELETE ON public.replies  FROM PUBLIC, anon, authenticated;

-- pg_cron backstop mirroring 015: release strictly at release_at <= now().
-- Coexists safely with the release-messages edge function (idempotent UPDATEs;
-- the edge function still picks rows up for digests via notified_at IS NULL).
CREATE OR REPLACE FUNCTION public.release_due_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.messages
     SET status      = 'released',
         released_at = COALESCE(released_at, now())
   WHERE status     = 'in_transit'
     AND release_at <= now();

  UPDATE public.replies
     SET status = 'released'
   WHERE status     = 'in_transit'
     AND release_at <= now();
END;
$$;

-- SECURITY DEFINER ⇒ never callable by clients (037 pattern).
REVOKE EXECUTE ON FUNCTION public.release_due_messages() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('release-due-messages');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job didn't exist yet
END;
$$;

SELECT cron.schedule(
  'release-due-messages',
  '* * * * *',
  $$SELECT public.release_due_messages()$$
);

-- ============================================================
-- D. conversations: no denormalized content for clients
-- ============================================================
-- The client only ever reads id, wiped_at, last_message_at (js/circles-state.js).
-- conversations.last_message_preview is trigger-maintained and echoes the
-- newest message's content — including in-transit ones — so it must not be
-- client-readable. Grant lists only the three columns actually used.

REVOKE SELECT ON public.conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, wiped_at, last_message_at) ON public.conversations TO authenticated;

-- Clients never write conversations directly: rows are created via the
-- SECURITY DEFINER find_or_create_conversation() (032) and maintained by the
-- definer trigger on messages. The participant UPDATE policy + broad grants
-- only enabled preview/timestamps tampering.
REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM PUBLIC, anon, authenticated;
