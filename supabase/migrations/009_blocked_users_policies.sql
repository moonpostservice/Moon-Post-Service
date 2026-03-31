-- Migration: Blocked Users table RLS policies
-- Requirements: 9.1, 9.2, 9.3

-- Users can only see their own block list.
CREATE POLICY "Users can read own blocked users"
  ON blocked_users FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

-- Users can only block as themselves.
CREATE POLICY "Users can insert own blocks"
  ON blocked_users FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid());

-- Users can only unblock their own blocks.
CREATE POLICY "Users can delete own blocks"
  ON blocked_users FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

-- No UPDATE policy = deny by default
