-- 026: Fully retire the Member, Sales and Construction supervisor roles.
--
-- These three roles were removed from the app's role list (App.ROLES) and from
-- the Approvals role picker. This migration brings the database in line:
--
--   1. Reassign every existing user off a retired role:
--        member, sales            -> worker
--        construction_supervisor  -> supervisor   (per request — team oversight
--                                                   without user/role management)
--   2. New signups default to 'worker' instead of 'member'. Access is still
--      gated by profiles.approved = false until an admin approves them, so this
--      does not grant access early — it only changes the *label* a pending user
--      carries from the retired "member" to the live "worker".
--   3. Recreate handle_new_user() to insert 'worker' (mirror of migration 007,
--      one line changed).
--
-- NOTE: Existing RLS policies (migrations 007/008/011) list 'sales' and
-- 'construction_supervisor' inside `role in (...)` checks. Once no profile holds
-- those roles those entries are inert, so they are intentionally left untouched
-- rather than rewriting every policy. There is no CHECK constraint on
-- profiles.role, so nothing else needs altering.
--
-- Wrapped in a transaction; idempotent / safe to re-run.

begin;

-- 1. Reassign existing users.
update public.profiles set role = 'worker'     where role in ('member', 'sales');
update public.profiles set role = 'supervisor' where role = 'construction_supervisor';

-- 2. Default for brand-new rows.
alter table public.profiles alter column role set default 'worker';

-- 3. Signup trigger now stamps 'worker' (still approved = false).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_id text := coalesce(nullif(public.slugify_member_id(split_part(new.email, '@', 1)), ''), 'member-' || left(new.id::text, 8));
  v_full_name text := coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1));
begin
  insert into public.team_members (id, name, full_name, email, color)
  values (v_member_id, split_part(v_full_name, ' ', 1), v_full_name, new.email, '#' || substr(md5(new.email), 1, 6))
  on conflict (id) do update set
    name = excluded.name,
    full_name = excluded.full_name,
    email = excluded.email;

  insert into public.profiles (id, email, full_name, approved, role, email_verified, member_id)
  values (new.id, new.email, v_full_name, false, 'worker', false, v_member_id)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    member_id = excluded.member_id;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;

commit;

-- Verify with:
--   select role, count(*) from public.profiles group by role order by role;
-- No row should report member / sales / construction_supervisor.
