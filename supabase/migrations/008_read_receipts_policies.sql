-- Migration: Read Receipts table RLS policies
-- Requirements: 8.1, 8.2

-- Users can read their own read receipts, or receipts for conversations they participate in.
-- A user participates in a conversation if they are the sender or recipient of any message
-- in that conversation.
CREATE POLICY "Users can read own or participant read receipts"
  ON read_receipts FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM messages
      WHERE messages.id = read_receipts.conversation_id
        AND (
          messages.sender_id = auth.uid()
          OR messages.recipient_id = auth.uid()
          OR messages.recipient_email = (auth.jwt() ->> 'email')
        )
    )
  );

-- Users can only insert read receipts for themselves.
CREATE POLICY "Users can insert own read receipts"
  ON read_receipts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only update their own read receipts.
CREATE POLICY "Users can update own read receipts"
  ON read_receipts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No DELETE policy = deny by default
