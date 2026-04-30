-- Migration: pg_cron job to release queued Moon Roulette messages
-- Mirrors the existing message release logic.
-- Requires the pg_cron extension to be enabled in Supabase dashboard.

-- Release all roulette messages whose moonrise time has passed.
-- The Edge Function send-roulette-message pre-calculates release_at using the
-- same SunCalc moon-phase logic as send-message.
CREATE OR REPLACE FUNCTION release_queued_roulette_messages()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE moon_roulette_messages
     SET status      = 'delivered',
         released_at = now(),
         updated_at  = now()
   WHERE status     = 'queued'
     AND release_at <= now();
END;
$$;

-- Schedule: runs every minute, same cadence as regular message release.
SELECT cron.schedule(
  'release-roulette-messages',
  '* * * * *',
  $$SELECT release_queued_roulette_messages()$$
);
