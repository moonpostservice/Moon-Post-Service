-- 032_lock_conversation_inserts.sql
--
-- SECURITY HARDENING (Low): the conversations table had an INSERT policy
-- `Authenticated users can create conversations` with `WITH CHECK (true)`,
-- letting any authenticated user directly INSERT arbitrary conversation rows
-- (orphan rows with no participants — mild spam / DB-bloat vector).
--
-- The conversations table has no owner column, so it cannot be meaningfully
-- row-scoped on INSERT. In practice conversations are ONLY created via
-- find_or_create_conversation() — a SECURITY DEFINER function that runs as the
-- owner (bypassing RLS) and enforces that a caller can only open a conversation
-- as themselves. So no client needs direct INSERT. Removing the policy (RLS stays
-- enabled with no INSERT policy => direct inserts denied) closes the vector while
-- the RPC path keeps working untouched.

DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;
