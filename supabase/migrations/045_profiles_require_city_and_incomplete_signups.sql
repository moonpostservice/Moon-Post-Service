-- 045: Profiles must always have a city + surface incomplete signups in admin analytics
--
-- WHY: Two real users (2026-06-11) ended up with city-less placeholder profiles.
-- The "verify-last" signup guarantee lived entirely in client JS, and browser
-- contexts keep finding ways to lose the signup draft (tab eviction, Facebook's
-- in-app browser wiping localStorage between webview restarts, email links opened
-- in a different browser). The client now defers the profile INSERT until a city
-- is chosen; this trigger makes the whole bug class impossible at the database
-- layer, regardless of future client regressions.
--
-- Existing city-less rows (legacy abandoners + seeded test users) are left in
-- place: the guard blocks NEW city-less rows and blocks removing a city from a
-- row that has one. Updates that don't touch a legacy NULL city still work, and
-- setting a city on a legacy row is allowed (that's how those rows get healed).

CREATE OR REPLACE FUNCTION public.enforce_profile_city()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.city IS NULL OR btrim(NEW.city) = '' THEN
      RAISE EXCEPTION 'profiles.city is required: profile rows are created only after the user chooses a city (deferred-insert onboarding)';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.city IS NULL OR btrim(NEW.city) = '') AND OLD.city IS NOT NULL THEN
      RAISE EXCEPTION 'profiles.city cannot be removed once set';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger functions must never be directly callable (project convention, see 030).
REVOKE EXECUTE ON FUNCTION public.enforce_profile_city() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_require_city ON public.profiles;
CREATE TRIGGER trg_profiles_require_city
  BEFORE INSERT OR UPDATE OF city ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_city();

-- ─────────────────────────────────────────────────────────────────────────────
-- get_admin_analytics: add 'incomplete_signups' — confirmed auth users that have
-- no profile row (abandoned at the location step) or a profile without a city
-- (legacy rows from before the trigger above). Surfaced on the admin Analytics
-- tab so a regression is noticed the same day, with emails so real signups can
-- be rescued. Seeded test users are excluded.

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
