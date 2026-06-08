-- 039: Hide deleted/unapproved accounts from the assignee & watcher pickers.
--
-- Problem: the pickers are built from public.team_members (App.PEOPLE). For
-- MANAGER sessions the client filters that roster down to approved profiles,
-- but workers can't read public.profiles (RLS), so the client falls back to
-- showing the ENTIRE team_members table — including ghosts of deleted accounts
-- (rows kept on purpose so old tasks still render a name) and not-yet-approved
-- signups. Result: a worker creating a task sees a pile of stale/test users.
--
-- Fix: give team_members an `active` flag that mirrors "is backed by an
-- approved profile". team_members is readable by every role, so the flag lets
-- the client filter the picker for workers too — without exposing profiles.
-- A deleted account's row stays (active = false) so historical task names are
-- preserved; it just stops being assignable.
--
-- `active` semantics (matches the manager-side activePeople() filter, which
-- keeps a profile unless approved is explicitly false):
--   active = there is a profile for this member whose approved is not false.
-- No profile at all  -> active = false (ghost of a deleted account).
-- Unapproved signup  -> active = false (pending; not assignable yet).
--
-- Wrapped in a transaction; idempotent / safe to re-run.

begin;

-- 0. Prune pure orphans first (no profile AND not referenced anywhere) — same
--    guard as migration 025, so a still-referenced row is never orphaned.
delete from public.team_members tm
where not exists (select 1 from public.profiles      p where p.member_id   = tm.id)
  and not exists (select 1 from public.tasks         t where t.assignee_id = tm.id or t.creator_id = tm.id or t.watchers ? tm.id)
  and not exists (select 1 from public.time_entries  e where e.user_id     = tm.id)
  and not exists (select 1 from public.active_timers a where a.user_id     = tm.id)
  and not exists (select 1 from public.notifications n where n.member_id   = tm.id);

-- 1. The flag. Defaults to true so brand-new rows are visible until the signup
--    trigger (below) recomputes them from the freshly inserted profile.
alter table public.team_members
  add column if not exists active boolean not null default true;

-- 2. Backfill from current profiles.
update public.team_members tm
set active = exists (
  select 1 from public.profiles p
  where p.member_id = tm.id and p.approved is distinct from false
);

-- 3. Keep it synced: whenever a profile is created, approved/unapproved, has its
--    member_id changed, or is deleted, recompute the flag for the member(s)
--    involved. SECURITY DEFINER so it can write team_members past RLS.
create or replace function public.sync_team_member_active()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids text[];
  mid text;
begin
  ids := array_remove(array[
    case when tg_op in ('UPDATE', 'DELETE') then old.member_id end,
    case when tg_op in ('INSERT', 'UPDATE') then new.member_id end
  ], null);
  foreach mid in array ids loop
    update public.team_members tm
    set active = exists (
      select 1 from public.profiles p
      where p.member_id = mid and p.approved is distinct from false
    )
    where tm.id = mid;
  end loop;
  return null; -- AFTER trigger; return value ignored
end;
$$;

revoke all on function public.sync_team_member_active() from anon, authenticated, public;

drop trigger if exists trg_sync_team_member_active on public.profiles;
create trigger trg_sync_team_member_active
after insert or update or delete on public.profiles
for each row execute function public.sync_team_member_active();

commit;

-- Verify with:
--   select tm.id, tm.name, tm.active,
--          exists(select 1 from public.profiles p where p.member_id = tm.id and p.approved is distinct from false) as should_be_active
--   from public.team_members tm order by tm.active, tm.id;
-- active should match should_be_active for every row.
