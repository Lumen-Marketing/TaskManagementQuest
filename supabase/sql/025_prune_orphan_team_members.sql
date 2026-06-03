-- 025: Prune orphan team_members so the assignee picker matches the
--      real, approved user list.
--
-- The "Assigned to" dropdown is built from public.team_members (App.PEOPLE),
-- while the Approvals screen is built from public.profiles. They drift apart
-- because team_members accumulates rows that no longer map to a login:
--   * leftover demo seeds from migration 003 (jesus, kristine, abraham, ...)
--     if migration 020 was never run, and
--   * members whose profile was deleted via the Approvals "Delete" button
--     (024) — that drops the profile but, by design, keeps the team_member
--     so historical tasks don't break, leaving a ghost in the picker.
--
-- This generalises migration 020: instead of targeting six hardcoded seed
-- ids, it removes EVERY team_member that has no backing profile AND is not
-- referenced anywhere (tasks creator/assignee/watchers, time_entries,
-- active_timers, notifications). The NOT EXISTS guards make it safe — a row
-- still load-bearing for real data is left intact rather than orphaning it
-- (the member-side FKs are ON DELETE RESTRICT, so an unguarded delete would
-- error anyway). Wrapped in a transaction; idempotent / no-op on re-run.

begin;

delete from public.team_members tm
where not exists (select 1 from public.profiles      p where p.member_id   = tm.id)
  and not exists (select 1 from public.tasks         t where t.assignee_id = tm.id or t.creator_id = tm.id or t.watchers ? tm.id)
  and not exists (select 1 from public.time_entries  e where e.user_id     = tm.id)
  and not exists (select 1 from public.active_timers a where a.user_id     = tm.id)
  and not exists (select 1 from public.notifications n where n.member_id   = tm.id);

commit;

-- Verify with:
--   select id, name, email from public.team_members order by id;
-- Every row left should be backed by a profile or referenced by real data.
