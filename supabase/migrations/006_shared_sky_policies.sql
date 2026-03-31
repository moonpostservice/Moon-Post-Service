-- Migration: Shared Sky table RLS policies
-- Requirements: 6.1, 6.2, 6.3

-- All authenticated users can read all Shared Sky posts (public space).
CREATE POLICY "Authenticated users can read shared sky"
  ON shared_sky FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert posts as themselves.
CREATE POLICY "Users can insert own shared sky posts"
  ON shared_sky FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only update their own posts.
CREATE POLICY "Users can update own shared sky posts"
  ON shared_sky FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can only delete their own posts.
CREATE POLICY "Users can delete own shared sky posts"
  ON shared_sky FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
