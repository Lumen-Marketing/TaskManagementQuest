-- 049: Clear a member's running timer when they're removed / deactivated.
--
-- Problem (the orphaned "Live" ghost)
-- -----------------------------------
-- Removing a user deletes their profile (delete-user edge function, the
-- app-side profile-only fallback, or an Auth-cascade) and migration 039's
-- trigger flips their team_members.active to false — but NOTHING clears their
-- public.active_timers row. A user who was clocked in at the moment they were
-- removed is left with a timer that "runs" forever: the clock dashboard's
-- "Active right now" board (and TimeView) unions in anyone with an active
-- timer, on-roster or not, so the deleted account lingers as a ghost row that
-- keeps ticking — e.g. "gabrielkillua9999 — Call Josh — 284h — Live", with the
-- raw username shown because no approved profile is left to resolve a name.
--
-- active_timers.user_id references team_members(id) with NO on-delete action,
-- and the team_members row is deliberately KEPT when it's still referenced by a
-- task (ON DELETE RESTRICT), so neither the profile delete nor the team_members
-- delete ever reaches the timer. The timer just leaks.
--
-- Fix
-- ---
--   1. One-time cleanup: delete active_timers rows for any member who is no
--      longer backed by an approved profile (clears the existing ghosts).
--   2. Extend migration 039's sync_team_member_active() trigger so that whenever
--      a member resolves to INACTIVE (profile deleted or un-approved) it also
--      deletes that member's active_timers row. The function is already
--      SECURITY DEFINER and already fires on every profiles insert/update/delete,
--      so this guarantees the timer is cleared on EVERY removal path — including
--      the app-side fallback and raw SQL — past the owner-only RLS on
--      active_timers (migration 036), which the calling admin couldn't satisfy.
--
-- "Inactive" mirrors 039's `active` semantics exactly: a member is active iff a
-- profile exists for them whose `approved` is not false. No profile, or an
-- unapproved signup, => inactive => any stray timer is dropped. (An unapproved
-- user can't clock in anyway, so this only ever removes timers that shouldn't
-- be running.) time_entries (historical hours) are untouched.
--
-- Depends on migration 039 (sync_team_member_active + its trigger on profiles).
-- Transaction-wrapped; idempotent / safe to re-run.

begin;

-- 1. One-time cleanup of existing orphaned timers (e.g. gabrielkillua9999).
delete from public.active_timers a
where not exists (
  select 1 from public.profiles p
  where p.member_id = a.user_id and p.approved is distinct from false
);

-- 2. Replace 039's trigger function so it ALSO clears the timer on deactivation.
--    (The trigger itself — trg_sync_team_member_active on public.profiles — is
--    unchanged and keeps pointing at this function.)
create or replace function public.sync_team_member_active()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids text[];
  mid text;
  is_active boolean;
begin
  ids := array_remove(array[
    case when tg_op in ('UPDATE', 'DELETE') then old.member_id end,
    case when tg_op in ('INSERT', 'UPDATE') then new.member_id end
  ], null);
  foreach mid in array ids loop
    is_active := exists (
      select 1 from public.profiles p
      where p.member_id = mid and p.approved is distinct from false
    );
    update public.team_members tm
    set active = is_active
    where tm.id = mid;
    -- Member no longer active (deleted or un-approved): drop any running timer
    -- so they don't linger forever on the live clock dashboard.
    if not is_active then
      delete from public.active_timers where user_id = mid;
    end if;
  end loop;
  return null; -- AFTER trigger; return value ignored
end;
$$;

revoke all on function public.sync_team_member_active() from anon, authenticated, public;

commit;

-- Verify:
--   -- No timer should belong to a member without an approved profile:
--   select a.user_id
--   from public.active_timers a
--   where not exists (
--     select 1 from public.profiles p
--     where p.member_id = a.user_id and p.approved is distinct from false
--   );
--   -- (expect 0 rows)
