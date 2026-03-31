-- Migration: Profiles table RLS policies
-- Requirements: 2.1, 2.2, 2.3, 2.4, 2.5

-- All authenticated users can read all profile rows.
-- Column-level restriction is handled via the public_profiles view (for other users)
-- and by client queries selecting specific columns.
CREATE POLICY "Authenticated users can read profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert their own profile row.
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Users can only update their own profile row.
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- No DELETE policy = deny by default (Requirement 2.5)

-- View for restricted column access to other users' profiles.
-- Exposes only public columns: id, username, first_name, last_name, city, avatar_url.
-- Clients should query this view when fetching other users' profiles.
CREATE OR REPLACE VIEW public_profiles AS
  SELECT id, username, first_name, last_name, city, avatar_url
  FROM profiles;
