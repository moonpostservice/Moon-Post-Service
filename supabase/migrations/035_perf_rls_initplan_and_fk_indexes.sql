-- 035_perf_rls_initplan_and_fk_indexes.sql
--
-- Performance hygiene flagged by the Supabase advisors. NO behavior change:
--   (a) Wrap auth.uid() in (select auth.uid()) so Postgres evaluates it ONCE
--       per query instead of once per row (the "auth_rls_initplan" warnings).
--       RLS semantics are byte-identical to before.
--   (b) Add covering indexes for foreign keys that lacked them, so FK lookups
--       and cascade checks stay fast as these tables grow.
--
-- Invisible at current row counts; matters once tables reach 10k+ rows.

------------------------------------------------------------------
-- (a) RLS initplan fixes  (select auth.uid())
------------------------------------------------------------------

-- blocked_users (role: public)
DROP POLICY IF EXISTS "Users can view their own blocks" ON public.blocked_users;
CREATE POLICY "Users can view their own blocks" ON public.blocked_users
  FOR SELECT USING ((select auth.uid()) = blocker_id);

DROP POLICY IF EXISTS "Users can insert their own blocks" ON public.blocked_users;
CREATE POLICY "Users can insert their own blocks" ON public.blocked_users
  FOR INSERT WITH CHECK ((select auth.uid()) = blocker_id);

DROP POLICY IF EXISTS "Users can delete their own blocks" ON public.blocked_users;
CREATE POLICY "Users can delete their own blocks" ON public.blocked_users
  FOR DELETE USING ((select auth.uid()) = blocker_id);

-- circle_members (role: public)
DROP POLICY IF EXISTS circle_members_select ON public.circle_members;
CREATE POLICY circle_members_select ON public.circle_members
  FOR SELECT USING ((user_id = (select auth.uid())) OR is_circle_member(circle_id));

DROP POLICY IF EXISTS circle_members_insert ON public.circle_members;
CREATE POLICY circle_members_insert ON public.circle_members
  FOR INSERT WITH CHECK (
    (user_id = (select auth.uid()))
    AND (
      (circle_id IN ( SELECT moon_circles.id FROM moon_circles
                       WHERE (moon_circles.creator_id = (select auth.uid()))))
      OR (circle_id IN ( SELECT moon_circles.id FROM moon_circles))
    )
  );

-- circle_nights (role: public)
DROP POLICY IF EXISTS circle_nights_insert ON public.circle_nights;
CREATE POLICY circle_nights_insert ON public.circle_nights
  FOR INSERT WITH CHECK (
    circle_id IN ( SELECT circle_members.circle_id FROM circle_members
                   WHERE (circle_members.user_id = (select auth.uid())))
  );

-- admin_actions (role: authenticated)
DROP POLICY IF EXISTS admins_read_audit ON public.admin_actions;
CREATE POLICY admins_read_audit ON public.admin_actions
  FOR SELECT TO authenticated
  USING (
    ( SELECT profiles.email FROM profiles WHERE (profiles.id = (select auth.uid())) )
      = ANY (ARRAY['mymanko@gmail.com'::text, 'yoashf@gmail.com'::text])
  );

-- moon_roulette_messages (role: authenticated)
DROP POLICY IF EXISTS "Sender reads own roulette messages" ON public.moon_roulette_messages;
CREATE POLICY "Sender reads own roulette messages" ON public.moon_roulette_messages
  FOR SELECT TO authenticated
  USING ((sender_id = (select auth.uid())) AND (sender_deleted_at IS NULL));

DROP POLICY IF EXISTS "Sender can soft-delete own roulette message" ON public.moon_roulette_messages;
CREATE POLICY "Sender can soft-delete own roulette message" ON public.moon_roulette_messages
  FOR UPDATE TO authenticated
  USING (sender_id = (select auth.uid()))
  WITH CHECK (sender_id = (select auth.uid()));

DROP POLICY IF EXISTS "Recipient can mark roulette message as read" ON public.moon_roulette_messages;
CREATE POLICY "Recipient can mark roulette message as read" ON public.moon_roulette_messages
  FOR UPDATE TO authenticated
  USING ((recipient_id = (select auth.uid()))
         AND (status = ANY (ARRAY['delivered'::roulette_status, 'revealed'::roulette_status])))
  WITH CHECK (recipient_id = (select auth.uid()));

-- moon_roulette_reveals (role: authenticated)
DROP POLICY IF EXISTS "User reads own reveal row" ON public.moon_roulette_reveals;
CREATE POLICY "User reads own reveal row" ON public.moon_roulette_reveals
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "User inserts own reveal" ON public.moon_roulette_reveals;
CREATE POLICY "User inserts own reveal" ON public.moon_roulette_reveals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

------------------------------------------------------------------
-- (b) Covering indexes for unindexed foreign keys
------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id
  ON public.admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_message_id
  ON public.admin_actions(target_message_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_user_id
  ON public.admin_actions(target_user_id);
CREATE INDEX IF NOT EXISTS idx_mrm_admin_deleted_by
  ON public.moon_roulette_messages(admin_deleted_by);
CREATE INDEX IF NOT EXISTS idx_mrm_parent_id
  ON public.moon_roulette_messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_mrr_user_id
  ON public.moon_roulette_reveals(user_id);
