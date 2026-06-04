-- 033: Harden user identity + role integrity.
--
-- Depends on 032 (role retirement) and 030 (can_manage_roles includes
-- developer). Self-sufficient and idempotent — it re-asserts the retired-role
-- reassignment so it is safe even if 032 has not been applied yet.
--
-- Fixes three linked issues found in review:
--
--   A. member_id slug collision (CRITICAL). handle_new_user derives
--      member_id from slugify(email local-part). Two different emails can
--      slugify to the same value (a.b@x.com and ab@y.com -> "ab"). Because
--      team_members.id is the PK and profiles.member_id had no unique
--      constraint, the second signup overwrote the first user's roster row and
--      BOTH profiles pointed at one member_id -- merging their owner-scoped
--      rows (time_entries / active_timers / notifications) and task ownership,
--      i.e. an impersonation hole. Fix: (1) collision-proof derivation in
--      handle_new_user, (2) a unique index on profiles.member_id (added only
--      when no existing duplicates remain).
--
--   B. 031 sync trigger amplified A: a SECURITY DEFINER trigger updating
--      team_members by member_id let one user's profile rename clobber
--      another user's roster identity. Making member_id unique (this migration)
--      removes the shared-row hazard, so no trigger change is needed here.
--
--   C. Retired roles were still ASSIGNABLE. profiles_role_check (014) still
--      permitted member/sales/construction_supervisor, so a manager could
--      reassign someone to a retired role that several RLS policies still treat
--      as privileged -- a slow path back to privilege drift. Fix: after
--      reassigning everyone off the retired roles, tighten the CHECK to the
--      live four roles. The retired strings left inside RLS IN(...) lists then
--      become truly inert (no row can ever hold them again).

begin;

------------------------------------------------------------------------
-- A1. Collision-proof handle_new_user(). If the clean slug is already owned
--     by ANOTHER profile, append a uuid suffix so two real users never share
--     a member_id. A roster row with no backing profile (a seed) is still
--     claimable under the clean slug. Mirror of 032 with the collision guard.
------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text := coalesce(
    nullif(public.slugify_member_id(split_part(new.email, '@', 1)), ''),
    'member-' || left(new.id::text, 8)
  );
  v_member_id text := v_base;
  v_full_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(new.email, '@', 1)
  );
begin
  if exists (
    select 1 from public.profiles p
    where p.member_id = v_base and p.id <> new.id
  ) then
    v_member_id := v_base || '-' || left(new.id::text, 8);
  end if;

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

------------------------------------------------------------------------
-- A2. Unique index on profiles.member_id, but ONLY if the data is already
--     clean. If duplicates exist (from past collisions) we cannot safely
--     auto-rewrite them here -- reassigning a member_id orphans that user's
--     tasks (FK to team_members) -- so we report them and skip, leaving the
--     forward fix (A1) in place. Resolve the listed dupes manually, then
--     re-run this migration to add the constraint.
------------------------------------------------------------------------
do $$
declare
  dup_count int;
begin
  select count(*) into dup_count from (
    select member_id
    from public.profiles
    where member_id is not null
    group by member_id
    having count(*) > 1
  ) d;

  if dup_count = 0 then
    create unique index if not exists profiles_member_id_unique
      on public.profiles(member_id);
    raise notice 'profiles_member_id_unique is in place.';
  else
    raise notice 'SKIPPED unique index: % member_id value(s) are shared by multiple profiles. List them with:  select member_id, array_agg(id) from public.profiles where member_id is not null group by member_id having count(*) > 1;  Give each profile a distinct member_id (migrating tasks), then re-run 033.', dup_count;
  end if;
end $$;

------------------------------------------------------------------------
-- C. Reassign any lingering retired roles, then forbid them at the schema
--    level so they can never be assigned again (idempotent).
------------------------------------------------------------------------
update public.profiles set role = 'worker'     where role in ('member', 'sales');
update public.profiles set role = 'supervisor' where role = 'construction_supervisor';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('worker', 'supervisor', 'admin', 'developer'));

commit;

-- Verify:
--   select indexname from pg_indexes where tablename = 'profiles' and indexname = 'profiles_member_id_unique';
--   select role, count(*) from public.profiles group by role order by role;  -- only live roles
--   select member_id, count(*) from public.profiles where member_id is not null group by member_id having count(*) > 1;  -- 0 rows
