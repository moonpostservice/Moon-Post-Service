-- 039_delete_account.sql
-- Real, irreversible account deletion.
--
-- Before this migration the client-side "Delete my account" only signed the
-- user out and cleared localStorage — nothing was removed from the database,
-- so the user could log straight back in and all their data (incl. email/PII)
-- persisted. This adds an atomic server-side erase.
--
-- profiles has NO fk to auth.users and every user-data table references
-- profiles(id) with NO ACTION (not CASCADE), so deletion must be explicit and
-- correctly ordered. Everything tied to the user is hard-deleted: their chat
-- threads (for both parties), roulette messages they sent or received, contacts
-- (theirs and others' that point at them), photos in storage, their profile,
-- and finally the auth row (which cascades sessions / refresh tokens so the
-- session is killed immediately and login is impossible).
--
-- SECURITY DEFINER + owned by postgres so it can reach auth.* and storage.*.
-- Runs in a single transaction => all-or-nothing.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_conv  uuid[];
  v_msg   uuid[];
  v_rmsg  uuid[];
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select lower(email) into v_email from public.profiles where id = v_uid;

  -- Conversations the user participates in or has any message in.
  select coalesce(array_agg(distinct cid), '{}') into v_conv from (
    select conversation_id as cid
      from public.conversation_participants
     where profile_id = v_uid
        or (v_email is not null and lower(email) = v_email)
    union
    select conversation_id
      from public.messages
     where conversation_id is not null
       and (sender_id = v_uid
            or recipient_id = v_uid
            or (v_email is not null and lower(recipient_email) = v_email))
  ) t;

  -- Every message that will be removed: those in the above threads plus any the
  -- user sent / received outside a thread.
  select coalesce(array_agg(id), '{}') into v_msg from public.messages
   where conversation_id = any(v_conv)
      or sender_id = v_uid
      or recipient_id = v_uid
      or (v_email is not null and lower(recipient_email) = v_email);

  -- Roulette messages involving the user (1:1 threads => sender/recipient
  -- captures the whole exchange).
  select coalesce(array_agg(id), '{}') into v_rmsg from public.moon_roulette_messages
   where sender_id = v_uid or recipient_id = v_uid;

  -- ===== Chat threads =====
  delete from public.reactions
   where user_id = v_uid or message_id = any(v_msg);

  delete from public.replies
   where sender_id = v_uid or message_id = any(v_msg);

  delete from public.read_receipts
   where user_id = v_uid
      or conversation_id = any(v_conv)
      or last_read_message_id = any(v_msg);

  delete from public.messages where id = any(v_msg);

  delete from public.conversation_participants
   where conversation_id = any(v_conv)
      or profile_id = v_uid
      or (v_email is not null and lower(email) = v_email);

  delete from public.conversations where id = any(v_conv);

  -- ===== Moon Roulette =====
  -- Keep the moderation audit log, but drop its fk reference to the messages
  -- we're about to delete.
  update public.admin_actions set target_message_id = null
   where target_message_id = any(v_rmsg);

  delete from public.moon_roulette_reveals
   where user_id = v_uid or roulette_message_id = any(v_rmsg);

  -- Break the self-referential parent_id fk before deleting the thread.
  update public.moon_roulette_messages set parent_id = null
   where parent_id = any(v_rmsg);

  delete from public.moon_roulette_messages where id = any(v_rmsg);

  -- ===== Contacts (theirs + others' address books pointing at them) =====
  delete from public.contacts
   where owner_id = v_uid
      or linked_profile_id = v_uid
      or (v_email is not null and lower(email) = v_email);

  -- ===== Other user-owned rows =====
  delete from public.shared_sky        where user_id = v_uid;
  delete from public.push_subscriptions where user_id = v_uid;
  delete from public.rate_limit_events  where user_id = v_uid;
  delete from public.blocked_users
   where blocker_id = v_uid
      or blocked_id = v_uid
      or (v_email is not null and lower(blocked_email) = v_email);

  -- ===== Circles (feature shelved for MVP; tables intact) =====
  delete from public.circle_contributions where user_id = v_uid;
  delete from public.circle_members       where user_id = v_uid;
  delete from public.moon_circles         where creator_id = v_uid; -- cascades nights/members/contributions

  -- ===== Storage (avatar + shared-sky / message photos) =====
  -- storage.objects has a BEFORE DELETE trigger (protect_delete) that blocks
  -- direct SQL deletes unless this GUC is set — the same escape the Storage API
  -- uses internally. Set it transaction-locally so the erase stays atomic.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where owner = v_uid;

  -- ===== Profile =====
  delete from public.profiles where id = v_uid;

  -- ===== Auth row (cascades sessions / identities / refresh tokens) =====
  delete from auth.users where id = v_uid;
end;
$$;

-- Lock it down: anon must never call (revoke from PUBLIC, not just anon —
-- anon-only revoke is a no-op). Only a logged-in user may erase themselves.
revoke all on function public.delete_my_account() from public;
-- Supabase's default privileges grant EXECUTE to anon explicitly, which a
-- PUBLIC revoke does not touch — strip it directly (the null-uid guard already
-- makes anon calls inert, this is defense in depth).
revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;
