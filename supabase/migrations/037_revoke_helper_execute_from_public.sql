-- 037_revoke_helper_execute_from_public.sql
--
-- Correction to 036: the four RLS helper functions also carry an EXECUTE
-- grant to PUBLIC, so `REVOKE ... FROM anon` was a no-op (anon still inherits
-- EXECUTE via PUBLIC). Revoke from PUBLIC and re-grant explicitly to the roles
-- that actually need it (authenticated evaluates them inside RLS; service_role
-- for server flows). See the PII-exposure lesson: anon-only revokes don't work
-- when PUBLIC holds the grant.

REVOKE EXECUTE ON FUNCTION public.is_circle_member(uuid)                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid)           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_add_conversation_participant(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_participates_in_roulette(uuid)    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_circle_member(uuid)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_add_conversation_participant(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_participates_in_roulette(uuid)    TO authenticated, service_role;
