-- 046: Test accounts must never mix with real users in Moon Roulette.
--
-- Bug: seeded test accounts (test-recipient@, test-third@) had
-- receive_moon_roulette = true, so they sat in the live matching pool and
-- swallowed real users' roulette messages. The mirror bug also existed:
-- the e2e test-sender drew from the same pool and could have messaged a
-- real user.
--
-- Fix: flag test accounts explicitly, and guard at the DB so a roulette
-- message can never pair a test account with a real one regardless of
-- which code path inserts it. The matching edge function filters the
-- candidate pool by this flag (sender and recipient must match).

alter table public.profiles
  add column if not exists is_test_account boolean not null default false;

update public.profiles
set is_test_account = true
where email like 'test-%@moonpostservice.com'
   or email = 'test@example.com';

create or replace function public.enforce_roulette_test_isolation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_is_test boolean;
  recipient_is_test boolean;
begin
  select is_test_account into sender_is_test
    from public.profiles where id = new.sender_id;
  select is_test_account into recipient_is_test
    from public.profiles where id = new.recipient_id;

  if coalesce(sender_is_test, false) is distinct from coalesce(recipient_is_test, false) then
    raise exception 'roulette message cannot pair a test account with a real account';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_roulette_test_isolation on public.moon_roulette_messages;
create trigger trg_roulette_test_isolation
  before insert on public.moon_roulette_messages
  for each row execute function public.enforce_roulette_test_isolation();
