-- 052: Revive a wiped conversation when a new message lands in it.
--
-- Background: a new-moon erasure (or an account deletion that empties the
-- shared thread) sets conversations.wiped_at and deletes the messages, but
-- leaves the conversation + participant rows so the thread still shows in the
-- inbox as "New moon erased this conversation". The client lets a user re-open
-- that thread and send again (js/chat.js sendFreshMessageIntoConversation),
-- which inserts a fresh top-level message. The conversation-assignment trigger
-- reuses the existing (wiped) conversation via find_or_create_conversation, but
-- it never cleared wiped_at — so the row stayed flagged as erased even though it
-- now has live content again.
--
-- Fix: when a message is attached to a conversation, clear wiped_at. The thread
-- is alive again, so it should no longer be treated as a new-moon ghost.

CREATE OR REPLACE FUNCTION public.assign_conversation_on_message_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.conversation_id IS NULL THEN
        NEW.conversation_id := find_or_create_conversation(
            NEW.sender_id,
            NEW.recipient_id,
            NEW.recipient_email
        );
    END IF;

    IF NEW.conversation_id IS NOT NULL THEN
        UPDATE conversations
        SET last_message_at = COALESCE(NEW.created_at, now()),
            last_message_preview = LEFT(COALESCE(NEW.message_text, NEW.lunar_note_text, 'Moon message'), 100),
            updated_at = now(),
            -- A new message revives a previously new-moon-erased thread.
            wiped_at = NULL
        WHERE id = NEW.conversation_id;
    END IF;

    RETURN NEW;
END;
$function$;
