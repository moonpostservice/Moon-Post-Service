-- 042_contact_messages.sql
--
-- Server-side contact form. Previously the "Contact Us" form built a mailto:
-- link and opened the visitor's own email client — exposing our inbox address
-- and giving a poor, app-leaving experience. Now submissions go through the
-- submit-contact-message edge function, which stores them here and notifies the
-- team by email. The admin backstage reads them via get_admin_contact_messages().
--
-- The submitter is frequently logged out, so the edge function runs with
-- verify_jwt OFF and writes with the service role. This table therefore has RLS
-- ON with NO policies — neither anon nor authenticated can read or write it
-- directly; only the service role (which bypasses RLS) and the admin RPCs below
-- can touch it. Same pattern as rate_limit_events (033).

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  name        text        NOT NULL,
  email       text        NOT NULL,
  subject     text        NOT NULL,
  message     text        NOT NULL,
  user_id     uuid,                                  -- set if the submitter was logged in
  status      text        NOT NULL DEFAULT 'new',    -- new | read | archived
  ip_hash     text,                                  -- hashed IP (abuse tracing); never the raw IP
  user_agent  text
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_created
  ON public.contact_messages (created_at DESC);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_messages FROM anon, authenticated;

-- Admin reader — gated by is_admin() (fails CLOSED for anon; see 031/036).
CREATE OR REPLACE FUNCTION public.get_admin_contact_messages()
  RETURNS TABLE(id uuid, created_at timestamptz, name text, email text, subject text, message text, user_id uuid, status text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT c.id, c.created_at, c.name, c.email, c.subject, c.message, c.user_id, c.status
  FROM contact_messages c
  ORDER BY c.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_contact_messages() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_contact_messages() TO authenticated;

-- Admin status update (mark read / archived / back to new) — gated by is_admin().
CREATE OR REPLACE FUNCTION public.set_contact_message_status(p_id uuid, p_status text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_status NOT IN ('new', 'read', 'archived') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  UPDATE contact_messages SET status = p_status WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_contact_message_status(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_contact_message_status(uuid, text) TO authenticated;
