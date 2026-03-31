-- Migration: Reactions table RLS policies
-- Requirements: 7.1, 7.2, 7.3

-- Users can read reactions on messages they have access to:
--   1. Reactions on shared_sky posts (visible to all authenticated users)
--   2. Reactions on messages the user participates in (sender/recipient)
-- Reuses the user_participates_in_message() helper from 004_replies_policies.sql.
CREATE POLICY "Users can read reactions on accessible messages"
  ON reactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM shared_sky WHERE shared_sky.id = reactions.message_id
    )
    OR public.user_participates_in_message(message_id)
  );

-- Users can only insert reactions as themselves.
CREATE POLICY "Users can insert own reactions"
  ON reactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only delete their own reactions.
CREATE POLICY "Users can delete own reactions"
  ON reactions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE policy = deny by default
