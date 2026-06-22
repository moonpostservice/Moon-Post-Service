-- 055_notification_cooldown.sql
--
-- Per-recipient notification fatigue guard.
--
-- Delivery is "instant when the recipient's moon is already up" (release_at is
-- in the past → the per-minute release-messages cron emails within a minute).
-- That's great for back-and-forth, but a flurry of replies could mean many
-- emails in a short span. This column lets the release-messages edge function
-- enforce "at most one notification per recipient per cooldown window": the
-- first message still lands instantly, and anything that follows inside the
-- window is held and batched into the next digest once it clears.
--
-- The function stamps last_notified_at = now() whenever it actually sends an
-- email or push to a recipient. NULL = never notified (first message goes out
-- immediately). This does NOT affect in-app visibility — messages still release
-- on schedule; only the email/push cadence is throttled.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

COMMENT ON COLUMN public.profiles.last_notified_at IS
  'Last time a digest email/push was sent to this user; used by release-messages to throttle notification cadence (fatigue guard). NULL = never notified.';
