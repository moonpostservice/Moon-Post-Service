-- Migration: Contacts table RLS policies
-- Requirements: 5.1, 5.2, 5.3

-- Users can only read their own contacts.
CREATE POLICY "Users can read own contacts"
  ON contacts FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

-- Users can only insert contacts they own.
CREATE POLICY "Users can insert own contacts"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- Users can only update their own contacts.
CREATE POLICY "Users can update own contacts"
  ON contacts FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Users can only delete their own contacts.
CREATE POLICY "Users can delete own contacts"
  ON contacts FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());
