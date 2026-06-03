-- Anon-callable login pre-check.
-- The login screen runs as the anon role, which has no read access to `profiles`
-- (RLS only grants SELECT to `authenticated`). A direct table query therefore
-- always returned empty and falsely reported "This email isn't in our system".
-- This SECURITY DEFINER function returns a row only if the email exists and
-- exposes just the suspension status. Case-insensitive match.
CREATE OR REPLACE FUNCTION check_login_email(p_email text)
RETURNS TABLE(suspended_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.suspended_at
  FROM profiles p
  WHERE LOWER(p.email) = LOWER(TRIM(p_email))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION check_login_email(text) TO anon, authenticated;
