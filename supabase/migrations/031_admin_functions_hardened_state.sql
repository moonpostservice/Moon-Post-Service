-- 031_admin_functions_hardened_state.sql
--
-- Brings the repo migrations in line with the hardened LIVE database state.
--
-- Background: migrations 020 and 021 created get_admin_roulette_data /
-- get_admin_users_data with a fail-OPEN gate:
--     IF (SELECT email FROM profiles WHERE id = auth.uid()) NOT IN (...admins...) THEN
--        RAISE EXCEPTION 'Access denied';
-- When auth.uid() is NULL (anonymous), the subquery is NULL and `NULL NOT IN (...)`
-- is NULL (not TRUE), so the guard never fires — the function would return all PII.
-- The live DB was already fixed to use the positive `IF NOT public.is_admin()` gate
-- (is_admin() requires auth.uid() IS NOT NULL, so it fails CLOSED for anon), and the
-- get_admin_analytics function was added directly in the live DB with no migration.
--
-- This migration re-asserts the correct definitions + grants so a from-scratch
-- migration replay ends in the same hardened state as production. It is idempotent
-- and safe to run against the live DB (definitions match what is already there).

-- 1. Admin identity helper — fails closed for anonymous callers.
CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM profiles p
       WHERE p.id = auth.uid()
         AND p.email IN ('mymanko@gmail.com', 'yoashf@gmail.com')
     );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 2. Admin roulette dump — gated by is_admin().
CREATE OR REPLACE FUNCTION public.get_admin_roulette_data()
  RETURNS TABLE(id uuid, status roulette_status, message_text text, photo_url text, song_title text, sender_id uuid, sender_username text, sender_email text, sender_city_profile text, sender_city text, recipient_id uuid, recipient_username text, recipient_email text, recipient_city_profile text, recipient_city text, created_at timestamptz, release_at timestamptz, released_at timestamptz, notified_at timestamptz, recipient_read_at timestamptz, parent_id uuid, send_attempt integer, moon_phase text, moon_illumination numeric, sender_deleted_at timestamptz, recipient_deleted_at timestamptz, admin_deleted_at timestamptz, reveal_count bigint, sender_last_active timestamptz, recipient_last_active timestamptz, receive_moon_roulette boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    m.id, m.status, m.message_text, m.photo_url, m.song_title,
    m.sender_id, sp.username, sp.email, sp.city, m.sender_city,
    m.recipient_id, rp.username, rp.email, rp.city, m.recipient_city,
    m.created_at, m.release_at, m.released_at, m.notified_at, m.recipient_read_at,
    m.parent_id, m.send_attempt, m.moon_phase, m.moon_illumination,
    m.sender_deleted_at, m.recipient_deleted_at, m.admin_deleted_at,
    (SELECT COUNT(*) FROM moon_roulette_reveals r WHERE r.roulette_message_id = m.id) AS reveal_count,
    sp.last_active, rp.last_active, rp.receive_moon_roulette
  FROM moon_roulette_messages m
  LEFT JOIN profiles sp ON sp.id = m.sender_id
  LEFT JOIN profiles rp ON rp.id = m.recipient_id
  ORDER BY m.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_roulette_data() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_roulette_data() TO authenticated;

-- 3. Admin users dump — gated by is_admin().
CREATE OR REPLACE FUNCTION public.get_admin_users_data()
  RETURNS TABLE(id uuid, username text, email text, city text, created_at timestamptz, last_active timestamptz, suspended_at timestamptz, suspended_reason text, receive_roulette boolean, roulette_sent bigint, roulette_received bigint, conversations bigint, has_push_sub boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.username, p.email, p.city, p.created_at, p.last_active,
    p.suspended_at, p.suspended_reason,
    COALESCE(p.receive_moon_roulette, true) AS receive_roulette,
    (SELECT COUNT(*) FROM moon_roulette_messages m WHERE m.sender_id = p.id)    AS roulette_sent,
    (SELECT COUNT(*) FROM moon_roulette_messages m WHERE m.recipient_id = p.id) AS roulette_received,
    (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.profile_id = p.id) AS conversations,
    (SELECT EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = p.id)) AS has_push_sub
  FROM profiles p
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_users_data() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_users_data() TO authenticated;

-- 4. Admin analytics — previously had NO migration file at all. Gated by is_admin().
CREATE OR REPLACE FUNCTION public.get_admin_analytics()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'confirmed_users', (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NOT NULL),
      'profiles',        (SELECT count(*) FROM profiles),
      'with_city',       (SELECT count(*) FROM profiles WHERE city IS NOT NULL),
      'with_name',       (SELECT count(*) FROM profiles WHERE first_name IS NOT NULL),
      'with_push',       (SELECT count(DISTINCT user_id) FROM push_subscriptions),
      'roulette_opt_in', (SELECT count(*) FROM profiles WHERE COALESCE(receive_moon_roulette, true))
    ),
    'active', jsonb_build_object(
      'd1',  (SELECT count(*) FROM profiles WHERE last_active > now() - interval '1 day'),
      'd7',  (SELECT count(*) FROM profiles WHERE last_active > now() - interval '7 days'),
      'd30', (SELECT count(*) FROM profiles WHERE last_active > now() - interval '30 days')
    ),
    'messaging', jsonb_build_object(
      'dm_total',         (SELECT count(*) FROM messages),
      'dm_7d',            (SELECT count(*) FROM messages WHERE created_at > now() - interval '7 days'),
      'dm_30d',           (SELECT count(*) FROM messages WHERE created_at > now() - interval '30 days'),
      'dm_senders',       (SELECT count(DISTINCT sender_id) FROM messages),
      'roulette_total',   (SELECT count(*) FROM moon_roulette_messages),
      'roulette_7d',      (SELECT count(*) FROM moon_roulette_messages WHERE created_at > now() - interval '7 days'),
      'roulette_30d',     (SELECT count(*) FROM moon_roulette_messages WHERE created_at > now() - interval '30 days'),
      'roulette_senders', (SELECT count(DISTINCT sender_id) FROM moon_roulette_messages)
    ),
    'funnel', jsonb_build_object(
      'signed_up', (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NOT NULL),
      'set_city',  (SELECT count(*) FROM profiles WHERE city IS NOT NULL),
      'set_name',  (SELECT count(*) FROM profiles WHERE first_name IS NOT NULL),
      'activated', (SELECT count(DISTINCT s) FROM (
                      SELECT sender_id AS s FROM messages
                      UNION
                      SELECT sender_id FROM moon_roulette_messages
                    ) q WHERE s IS NOT NULL)
    ),
    'signups_by_day', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d, 'count', c) ORDER BY d), '[]'::jsonb)
      FROM (
        SELECT g::date AS d,
          (SELECT count(*) FROM auth.users u
             WHERE u.email_confirmed_at IS NOT NULL AND u.created_at::date = g::date) AS c
        FROM generate_series((now()::date - interval '29 days'), now()::date, interval '1 day') g
      ) s
    ),
    'messages_by_day', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d, 'dm', dm, 'roulette', rl) ORDER BY d), '[]'::jsonb)
      FROM (
        SELECT g::date AS d,
          (SELECT count(*) FROM messages m WHERE m.created_at::date = g::date) AS dm,
          (SELECT count(*) FROM moon_roulette_messages r WHERE r.created_at::date = g::date) AS rl
        FROM generate_series((now()::date - interval '29 days'), now()::date, interval '1 day') g
      ) s
    ),
    'top_cities', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('city', city, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (
        SELECT city, count(*) AS c FROM profiles
        WHERE city IS NOT NULL GROUP BY city ORDER BY c DESC LIMIT 10
      ) s
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_analytics() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_analytics() TO authenticated;
