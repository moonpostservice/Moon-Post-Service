-- Migration: Replies table RLS policies
-- Requirements: 4.1, 4.2, 4.3

-- Helper function: check if the current user participates in a message.
-- Used by replies policies to gate access based on parent message participation.
-- SECURITY DEFINER ensures the function can read messages regardless of the caller's RLS context.
CREATE OR REPLACE FUNCTION public.user_participates_in_message(msg_id uuid)
RETURNS boolean AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM messages
    WHERE id = msg_id
      AND (
        sender_id = auth.uid()
        OR recipient_id = auth.uid()
        OR recipient_email = (auth.jwt() ->> 'email')
      )
  );
$fn$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Users can read replies only on messages they participate in.
CREATE POLICY "Users can read replies on own messages"
  ON replies FOR SELECT
  TO authenticated
  USING (public.user_participates_in_message(message_id));

-- Users can insert replies only if they are the sender AND participate in the parent message.
CREATE POLICY "Users can insert replies on own messages"
  ON replies FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.user_participates_in_message(message_id)
  );

-- Users can update replies only on messages they participate in (e.g., release status).
CREATE POLICY "Users can update replies on own messages"
  ON replies FOR UPDATE
  TO authenticated
  USING (public.user_participates_in_message(message_id));

-- No DELETE policy = deny by default
