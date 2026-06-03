-- Phase 2: stop search_users from leaking every user's email to any logged-in
-- user. Email is now returned ONLY when the search query is an exact email
-- match (the "is this exact address already a user?" invite flow), so a
-- substring search can no longer be used to harvest the user base.
CREATE OR REPLACE FUNCTION public.search_users(search_query text)
RETURNS TABLE(id uuid, username text, first_name text, last_name text, email text, city text, avatar_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
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
