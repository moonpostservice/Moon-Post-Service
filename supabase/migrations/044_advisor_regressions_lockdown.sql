-- 044_advisor_regressions_lockdown.sql
--
-- Two findings from the post-043 security advisor pass:
--
-- 1. check_login_email(text) IS BACK. Migration 038 dropped it (anon-callable
--    email-enumeration oracle: row => registered account), and the login UI has
--    no caller since (js/auth.js shows the neutral "if an account exists" copy).
--    Something recreated it with the original 022 body — likely a dashboard
--    restore. Drop it again; same rationale as 038 (DROP removes the implicit
--    PUBLIC EXECUTE grant in one shot).
--
-- 2. graduate_roulette_thread(uuid) was EXECUTE-able by anon AND authenticated
--    via /rest/v1/rpc/. Any caller could force-graduate an arbitrary roulette
--    thread (mirror its messages into public.messages and pop it out of the
--    roulette inbox) without a mutual reveal. Its only legitimate caller is the
--    mutual-reveal trigger (SECURITY DEFINER, migration 040/041), which is
--    unaffected by these revokes. 037 pattern: revoke from PUBLIC too.

DROP FUNCTION IF EXISTS public.check_login_email(text);

REVOKE EXECUTE ON FUNCTION public.graduate_roulette_thread(uuid)
  FROM PUBLIC, anon, authenticated;
