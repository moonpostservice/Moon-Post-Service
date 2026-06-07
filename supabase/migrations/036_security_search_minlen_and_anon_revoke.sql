-- 036_security_search_minlen_and_anon_revoke.sql
--
-- Launch security hardening (review findings F2 + F3). No UX change:
--   F2: search_users gets a server-side minimum query length (2), matching
--       the guard both client callers already enforce. Stops someone calling
--       the RPC directly from doing single-character user enumeration.
--   F3: the conversation_participants + circle_members RLS policies that call
--       SECURITY DEFINER helper functions are scoped from `public` to
--       `authenticated` (these are login-only features — DMs and the
--       MVP-removed circles — so anon never legitimately hits them), then
--       anon EXECUTE is revoked from the four helper functions. Flipping the
--       policies first means an anon query returns empty (RLS default-deny)
--       instead of erroring on a function anon can no longer execute.

------------------------------------------------------------------
-- F2: minimum search length in search_users (signature unchanged)
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_users(search_query text)
 RETURNS TABLE(id uuid, username text, first_name text, last_name text, email text, city text, avatar_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Defense-in-depth: refuse trivially short queries that would return a
    -- broad slice of the user base. Both client callers already require >= 2.
    IF length(trim(coalesce(search_query, ''))) < 2 THEN
        RETURN;
    END IF;

    RETURN QUERY
        SELECT p.id, p.username, p.first_name, p.last_name,
               CASE WHEN LOWER(p.email) = LOWER(TRIM(search_query)) THEN p.email ELSE NULL END AS email,
               p.city, p.avatar_url
        FROM public.profiles p
        WHERE (
            p.username   ILIKE '%' || search_query || '%'
            OR p.first_name ILIKE '%' || search_query || '%'
            OR p.last_name  ILIKE '%' || search_query || '%'
            OR LOWER(p.email) = LOWER(TRIM(search_query))
        )
        LIMIT 10;
END;
$function$;

------------------------------------------------------------------
-- F3: scope helper-backed policies to authenticated
------------------------------------------------------------------
-- circle_members (MVP-removed feature; login-only)
DROP POLICY IF EXISTS circle_members_select ON public.circle_members;
CREATE POLICY circle_members_select ON public.circle_members
  FOR SELECT TO authenticated
  USING ((user_id = (select auth.uid())) OR is_circle_member(circle_id));

-- conversation_participants (DM feature; login-only)
DROP POLICY IF EXISTS "Users can add participants to own conversations" ON public.conversation_participants;
CREATE POLICY "Users can add participants to own conversations" ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (can_add_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "Users can view participants of their conversations" ON public.conversation_participants;
CREATE POLICY "Users can view participants of their conversations" ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (is_conversation_member(conversation_id));

------------------------------------------------------------------
-- F3: remove anon EXECUTE on the RLS helper functions
------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.is_circle_member(uuid)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_add_conversation_participant(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_participates_in_roulette(uuid)    FROM anon;
