-- 033_rate_limiting.sql
--
-- Durable, cross-isolate rate limiting for edge functions. The previous limiter in
-- send-roulette-message lived in a single Deno isolate's memory, so it reset on cold
-- start and didn't apply across concurrent isolates. send-email had none, leaving the
-- invite path as a domain-reputation spam vector.
--
-- This adds a shared events table + a SECURITY DEFINER consume_rate_limit() RPC that
-- edge functions call with the SERVICE ROLE key (the RPC is revoked from anon /
-- authenticated so clients can't call it directly or spoof another user's counter).

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid        NOT NULL,
  action     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON public.rate_limit_events (user_id, action, created_at);

-- RLS on with no policies => no direct access for anon/authenticated; only the
-- service role (which bypasses RLS) touches this table via the RPC below.
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_events FROM anon, authenticated;

-- Returns true if the action is allowed (and records it), false if over the limit.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_user_id uuid, p_action text, p_limit integer, p_window_seconds integer
) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Serialize per (user, action) so two concurrent isolates can't both slip under
  -- the limit between the count and the insert.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_action, 0));

  SELECT count(*) INTO v_count
  FROM rate_limit_events
  WHERE user_id = p_user_id
    AND action = p_action
    AND created_at > now() - make_interval(secs => p_window_seconds);

  IF v_count >= p_limit THEN
    RETURN false;
  END IF;

  INSERT INTO rate_limit_events (user_id, action) VALUES (p_user_id, p_action);

  -- Opportunistic cleanup of stale rows for this key (bounded work per call).
  DELETE FROM rate_limit_events
  WHERE user_id = p_user_id AND action = p_action
    AND created_at < now() - make_interval(secs => p_window_seconds * 4);

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_rate_limit(uuid, text, integer, integer) TO service_role;
