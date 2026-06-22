-- 054_analytics_anonymous_landing_sends.sql
--
-- ANALYTICS: surface anonymous landing-page sends.
--
-- The landing hero lets a logged-out visitor mint a one-way "send by link" moon
-- message with no account (see project_send_flow_rethink_handoff). Those rows
-- live in `messages` with `sender_id IS NULL AND shareable = true` and carry a
-- `creator_ip`. Until now they were invisible on the admin Analytics tab — they
-- were silently folded into the "Direct messages" total, so we had no read on
-- how many people send from the landing without signing in.
--
-- This migration extends get_admin_analytics() with:
--   * messaging.anon_links_{total,7d,30d} — count of anonymous landing sends
--   * messaging.anon_people              — distinct creator_ip (≈ unique people)
--   * messages_by_day[].anon             — anonymous sends per day (a third,
--     NON-overlapping series; the existing `dm` count is redefined to EXCLUDE
--     anonymous sends so the stacked chart never double-counts them).
--
-- Everything else in the RPC is preserved verbatim. SECURITY DEFINER + the
-- is_admin() gate are unchanged (EXECUTE stays revoked from anon — see
-- project_admin_gate_fail_open).

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
      'roulette_senders', (SELECT count(DISTINCT sender_id) FROM moon_roulette_messages),
      -- Anonymous landing-page sends: a logged-out visitor minted a "send by
      -- link" message (no account). `creator_ip` is the only identity we have, so
      -- distinct IPs is our best proxy for "how many people".
      'anon_links_total', (SELECT count(*) FROM messages WHERE shareable AND sender_id IS NULL),
      'anon_links_7d',    (SELECT count(*) FROM messages WHERE shareable AND sender_id IS NULL AND created_at > now() - interval '7 days'),
      'anon_links_30d',   (SELECT count(*) FROM messages WHERE shareable AND sender_id IS NULL AND created_at > now() - interval '30 days'),
      'anon_people',      (SELECT count(DISTINCT creator_ip) FROM messages WHERE shareable AND sender_id IS NULL AND creator_ip IS NOT NULL)
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
      SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d, 'dm', dm, 'roulette', rl, 'anon', an) ORDER BY d), '[]'::jsonb)
      FROM (
        SELECT g::date AS d,
          -- `dm` now means signed-in direct messages only, so dm + anon don't
          -- overlap when the chart stacks them.
          (SELECT count(*) FROM messages m
             WHERE m.created_at::date = g::date
               AND NOT (m.shareable AND m.sender_id IS NULL)) AS dm,
          (SELECT count(*) FROM moon_roulette_messages r WHERE r.created_at::date = g::date) AS rl,
          (SELECT count(*) FROM messages m
             WHERE m.created_at::date = g::date
               AND m.shareable AND m.sender_id IS NULL) AS an
        FROM generate_series((now()::date - interval '29 days'), now()::date, interval '1 day') g
      ) s
    ),
    'top_cities', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('city', city, 'count', c) ORDER BY c DESC), '[]'::jsonb)
      FROM (
        SELECT city, count(*) AS c FROM profiles
        WHERE city IS NOT NULL GROUP BY city ORDER BY c DESC LIMIT 10
      ) s
    ),
    'incomplete_signups', (
      SELECT jsonb_build_object(
        'count', count(*),
        'users', COALESCE(
          jsonb_agg(jsonb_build_object('email', email, 'reason', reason, 'created_at', created_at)
                    ORDER BY created_at DESC)
            FILTER (WHERE rn <= 20),
          '[]'::jsonb)
      )
      FROM (
        SELECT u.email, u.created_at,
               CASE WHEN p.id IS NULL THEN 'no_profile' ELSE 'no_city' END AS reason,
               row_number() OVER (ORDER BY u.created_at DESC) AS rn
        FROM auth.users u
        LEFT JOIN profiles p ON p.id = u.id
        WHERE u.email_confirmed_at IS NOT NULL
          AND (p.id IS NULL OR p.city IS NULL)
          AND u.email NOT LIKE 'test-%@moonpostservice.com'
      ) s
    )
  ) INTO result;

  RETURN result;
END;
$$;
