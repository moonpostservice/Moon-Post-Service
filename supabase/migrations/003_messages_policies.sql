-- Migration: Messages table RLS policies
-- Requirements: 3.1, 3.2, 3.3, 3.4

-- Users can read messages where they are the sender, recipient, or recipient by email.
CREATE POLICY "Users can read own messages"
  ON messages FOR SELECT
  TO authenticated
  USING (
    sender_id = auth.uid()
    OR recipient_id = auth.uid()
    OR recipient_email = (auth.jwt() ->> 'email')
  );

-- Users can only insert messages as themselves (sender_id must match auth.uid()).
CREATE POLICY "Users can insert as sender"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid());

-- Only the recipient can update a message (e.g., to change release status).
CREATE POLICY "Recipients can update messages"
  ON messages FOR UPDATE
  TO authenticated
  USING (
    recipient_id = auth.uid()
    OR recipient_email = (auth.jwt() ->> 'email')
  );

-- No DELETE policy = deny by default (Requirement 3.4)
