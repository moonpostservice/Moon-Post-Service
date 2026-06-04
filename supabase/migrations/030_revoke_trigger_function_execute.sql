-- 030_revoke_trigger_function_execute.sql
--
-- SECURITY HARDENING (Low): several SECURITY DEFINER functions whose ONLY purpose is to
-- back a table trigger were also exposed as callable RPCs via /rest/v1/rpc/<name> to the
-- anon and authenticated roles (flagged by the Supabase linter, lint 0028/0029).
-- Trigger functions execute as the table owner when the trigger fires regardless of who
-- holds EXECUTE, so revoking EXECUTE from PUBLIC does NOT affect trigger behaviour — it
-- only removes the unnecessary direct-call attack surface.
--
-- NOTE: we intentionally do NOT touch the boolean helpers used inside RLS policies
-- (is_conversation_member, is_circle_member, can_add_conversation_participant,
-- user_participates_in_roulette) — RLS evaluation requires the calling role to retain
-- EXECUTE on them.

REVOKE EXECUTE ON FUNCTION public.trigger_roulette_delivery_notification()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_roulette_updated_at()               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_conversation_on_message_insert()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_profile_email()                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_profile_for_user()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_mutual_reveal()                     FROM PUBLIC, anon, authenticated;
