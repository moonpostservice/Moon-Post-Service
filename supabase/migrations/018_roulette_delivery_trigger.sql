-- Migration: DB trigger to call notify-roulette-deliveries Edge Function
-- on status → 'delivered' transitions.
--
-- Requires pg_net extension (enabled by default in Supabase).
-- Requires two one-time setup steps in Supabase SQL Editor (run once after applying this migration):
--
--   1. Set your project URL:
--      SELECT set_config('app.supabase_project_url', 'https://YOUR_PROJECT_REF.supabase.co', false);
--      -- To make it permanent, add to supabase/config.toml or run as superuser:
--      ALTER DATABASE postgres SET "app.supabase_project_url" = 'https://YOUR_PROJECT_REF.supabase.co';
--
--   2. Set the internal notify secret (generate any random string):
--      ALTER DATABASE postgres SET "app.internal_notify_secret" = 'your-random-secret-here';
--      -- Also add INTERNAL_NOTIFY_SECRET = 'your-random-secret-here' to the Edge Function secrets
--      -- in Supabase Dashboard → Edge Functions → notify-roulette-deliveries → Secrets.

CREATE OR REPLACE FUNCTION trigger_roulette_delivery_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  project_url text;
  notify_secret text;
BEGIN
  -- Only fire when transitioning into 'delivered'
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  project_url   := current_setting('app.supabase_project_url', true);
  notify_secret := current_setting('app.internal_notify_secret', true);

  -- If project URL not configured, skip silently (pg_cron sweep will catch it)
  IF project_url IS NULL OR project_url = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := project_url || '/functions/v1/notify-roulette-deliveries',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', COALESCE(notify_secret, '')
    ),
    body    := jsonb_build_object('message_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the status update
  RAISE WARNING '[roulette] delivery notification trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER roulette_message_delivery_notify
  AFTER UPDATE ON moon_roulette_messages
  FOR EACH ROW
  EXECUTE FUNCTION trigger_roulette_delivery_notification();

-- Safety net: a pg_cron job that sweeps for any unnotified delivered messages
-- every 5 minutes in case a trigger call was missed (network hiccup, cold start).
-- This job is a no-op when all messages are already notified.
CREATE OR REPLACE FUNCTION sweep_roulette_delivery_notifications()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  project_url   text;
  notify_secret text;
  pending_count int;
BEGIN
  SELECT COUNT(*) INTO pending_count
    FROM moon_roulette_messages
   WHERE status = 'delivered'
     AND notified_at IS NULL;

  IF pending_count = 0 THEN
    RETURN;
  END IF;

  project_url   := current_setting('app.supabase_project_url', true);
  notify_secret := current_setting('app.internal_notify_secret', true);

  IF project_url IS NULL OR project_url = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := project_url || '/functions/v1/notify-roulette-deliveries',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-internal-secret', COALESCE(notify_secret, '')
    ),
    body    := '{}'::jsonb
  );
END;
$$;

SELECT cron.schedule(
  'sweep-roulette-notifications',
  '*/5 * * * *',
  $$SELECT sweep_roulette_delivery_notifications()$$
);
