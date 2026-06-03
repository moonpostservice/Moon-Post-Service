-- Phase 1 security hardening: close anon/authenticated access to sensitive RPCs.
-- These SECURITY DEFINER functions had no internal auth check and were callable
-- with the public anon key, exposing PII (search_users / lookup_user_by_email)
-- or allowing forced early message release (release_* functions).
-- Cron runs release_queued_roulette_messages as the postgres role, so revoking
-- anon/authenticated does not affect the schedule.
--
-- NOTE: this revoke alone is INEFFECTIVE because Postgres also grants EXECUTE to
-- the PUBLIC pseudo-role by default. See migration 026 which revokes from PUBLIC.

REVOKE EXECUTE ON FUNCTION public.search_users(text)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.lookup_user_by_email(text)         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_queued_roulette_messages() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_ready_messages()           FROM anon, authenticated;
