-- 029_lock_roulette_message_writes.sql
--
-- SECURITY FIX (HIGH): recipient could unilaterally deanonymize an anonymous sender.
--
-- Root cause: the `authenticated` (and `anon`) roles held a column-level UPDATE grant
-- on EVERY column of moon_roulette_messages, including `status`. Combined with the
-- recipient RLS UPDATE policy (USING recipient_id = auth.uid()), a recipient could run
--   UPDATE moon_roulette_messages SET status = 'revealed' WHERE id = <their msg>;
-- which is NOT blocked by any trigger. roulette_recipient_view exposes sender_id only
-- `WHEN status = 'revealed'`, so flipping status leaked the sender's identity with no
-- mutual-reveal and no sender consent. The same broad grant also let a recipient tamper
-- with message_text / photo_url / sender_city / sender_id on messages sent to them.
--
-- Fix: clients only ever write two columns directly (js/roulette.js):
--   - recipient_read_at  (recipient marks as read)
--   - sender_deleted_at  (sender soft-deletes)
-- Everything else (status, reveals, releases, deliveries) goes through edge functions
-- that use the service-role key and bypass these grants entirely. So we strip the broad
-- UPDATE grant and re-grant only those two columns. Row scoping stays enforced by the
-- existing RLS policies.

REVOKE UPDATE ON public.moon_roulette_messages FROM anon;
REVOKE UPDATE ON public.moon_roulette_messages FROM authenticated;

GRANT UPDATE (recipient_read_at, sender_deleted_at)
  ON public.moon_roulette_messages TO authenticated;
