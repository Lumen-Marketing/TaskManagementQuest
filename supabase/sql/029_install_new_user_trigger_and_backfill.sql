-- 029: Install the missing auth.users -> profiles trigger, and backfill any
--      Auth users who already signed up without getting a profiles row.
--
-- Symptom this fixes: a brand-new signup lands on the "Awaiting approval"
-- screen (which is painted purely from the Supabase Auth user object and needs
-- no profile row) but NEVER appears in the admin Approvals list (which reads
-- from public.profiles). Root cause: public.handle_new_user() exists as a
-- function (migrations 006/007/032) but the trigger that invokes it on
-- auth.users insert was a manual dashboard step that may not be installed.
--
-- IMPORTANT — two SEPARATE transactions, on purpose:
--   * Step 1 (the BACKFILL) is the part that actually unblocks stranded
--     accounts. It commits ON ITS OWN.
--   * Step 2 (the TRIGGER) is DDL on auth.users, which is owned by
--     supabase_auth_admin. Depending on the role the SQL Editor / migration
--     runner uses, `create trigger ... on auth.users` can raise
--     "must be owner of relation users". If steps 1 and 2 shared one
--     transaction, that privilege error would roll the backfill back too,
--     leaving the stranded accounts unfixed even though it looked like it ran.
--     Splitting them means a trigger-permission failure cannot discard the
--     backfill. Step 2 is also wrapped so the error is reported clearly.
--
-- Idempotent / safe to re-run.

------------------------------------------------------------------------
-- STEP 1: Backfill any auth.users with no matching profiles row. Mirrors the
--         derivation inside handle_new_user() (member_id slug from the email
--         local-part; full_name from user metadata, falling back to local-part).
--         Commits on its own.
------------------------------------------------------------------------
begin;

with missing as (
  select
    u.id,
    u.email,
    coalesce(
      nullif(public.slugify_member_id(split_part(u.email, '@', 1)), ''),
      'member-' || left(u.id::text, 8)
    ) as member_id,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(u.email, '@', 1)
    ) as full_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
)
insert into public.team_members (id, name, full_name, email, color)
select m.member_id, split_part(m.full_name, ' ', 1), m.full_name, m.email,
       '#' || substr(md5(m.email), 1, 6)
from missing m
-- Only adopt a roster row that is NOT already owned by a different profile,
-- so a slug collision can't overwrite another real user's identity (see 033).
where not exists (
  select 1 from public.profiles p2 where p2.member_id = m.member_id
)
on conflict (id) do nothing;

with missing as (
  select
    u.id,
    u.email,
    coalesce(
      nullif(public.slugify_member_id(split_part(u.email, '@', 1)), ''),
      'member-' || left(u.id::text, 8)
    ) as base_member_id,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(u.email, '@', 1)
    ) as full_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
)
insert into public.profiles (id, email, full_name, approved, role, email_verified, member_id)
select
  m.id, m.email, m.full_name, false, 'worker', false,
  -- Disambiguate if the clean slug is already claimed by another profile.
  case
    when exists (select 1 from public.profiles p2 where p2.member_id = m.base_member_id)
      then m.base_member_id || '-' || left(m.id::text, 8)
    else m.base_member_id
  end
from missing m
on conflict (id) do nothing;

commit;

------------------------------------------------------------------------
-- STEP 2: Install the trigger that runs handle_new_user() for every new Auth
--         user, in its own transaction. If this role lacks ownership of
--         auth.users the DO block re-raises a clear, actionable error WITHOUT
--         having touched the backfill above.
------------------------------------------------------------------------
do $$
begin
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
exception
  when insufficient_privilege then
    raise notice 'Could not create on_auth_user_created on auth.users (insufficient privilege). The backfill in step 1 still committed. Re-run this trigger step as the table owner (e.g. in the Supabase SQL Editor as postgres).';
end $$;

-- Verify the trigger is attached:
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;
-- Verify nobody is left without a profile (should return 0 rows):
--   select u.id, u.email from auth.users u
--   left join public.profiles p on p.id = u.id where p.id is null;
