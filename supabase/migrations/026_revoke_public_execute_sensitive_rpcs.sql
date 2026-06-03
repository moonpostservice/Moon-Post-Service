-- Correct Phase 1: the REVOKE in migration 023 (from anon/authenticated) was a
-- no-op because Postgres grants EXECUTE to PUBLIC by default. Revoke from PUBLIC
-- so anon truly loses access. service_role/postgres keep their explicit grants
-- (cron continues to run release_queued_roulette_messages as postgres).
REVOKE EXECUTE ON FUNCTION public.search_users(text)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lookup_user_by_email(text)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_queued_roulette_messages() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_ready_messages()           FROM PUBLIC;

-- search_users must remain callable by logged-in users (contacts search).
GRANT EXECUTE ON FUNCTION public.search_users(text) TO authenticated;
