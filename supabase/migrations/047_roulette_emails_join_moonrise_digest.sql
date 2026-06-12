-- 047: Roulette emails join the moonrise digest (stop per-message instant emails)
--
-- Before: every roulette message that flipped to 'delivered' fired its own
-- email within seconds (AFTER UPDATE trigger + 5-min sweep cron calling the
-- notify-roulette-deliveries edge fn). Same-city sends and anonymous replies
-- deliver instantly, so an active reply thread emailed the recipient once
-- per reply — way too many emails.
--
-- After: roulette rows carry notify_at (the recipient's next moonrise).
-- The release-messages digest (already one email per recipient per cycle)
-- picks up due roulette rows alongside regular messages/replies, shown as
-- "A stranger from {city}". The message itself is still visible in-app the
-- moment it's delivered — only the email waits for moonrise.

alter table public.moon_roulette_messages
  add column if not exists notify_at timestamptz;

-- Existing unnotified rows: due at their release time (past = next digest run)
update public.moon_roulette_messages
set notify_at = coalesce(release_at, created_at)
where notify_at is null;

-- Retire the instant-notification path
drop trigger if exists roulette_message_delivery_notify on public.moon_roulette_messages;
drop function if exists public.trigger_roulette_delivery_notification();
drop function if exists public.sweep_roulette_delivery_notifications();

do $$
begin
  perform cron.unschedule('sweep-roulette-notifications');
exception when others then
  null; -- job already absent
end $$;
