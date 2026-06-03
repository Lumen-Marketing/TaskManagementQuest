-- 020: Clear placeholder seed data so the live app shows only the data
--      real signed-up users have created.
--
-- WHAT GETS REMOVED
--   * The 15 demo tasks (t1..t15) from migration 004, along with their
--     watchers / subtasks / activity / time_entries / active_timers /
--     notifications (those cascade via the ON DELETE CASCADE FKs on
--     task_id defined in migration 003).
--   * The 6 hardcoded team_members from migration 003
--     (abraham, alkeith, kristine, jesus, andres, adrian).
--
-- WHAT IS KEPT
--   * Any task, time entry, watcher, notification, etc. that was NOT
--     part of the original seed — i.e. anything created in the live
--     app by real signups.
--   * Any team_members row that is backed by a real `profiles` row
--     (a seeded id like 'abraham' that a real user actually claimed
--     via signup is preserved).
--
-- SAFETY
--   * Wrapped in a transaction — commits only if every step succeeds.
--   * Team_members deletion is guarded by NOT EXISTS on every table
--     that references team_members.id, so a seeded row that is still
--     load-bearing for real data is left intact rather than orphaning
--     it. The query is a no-op on re-run.

begin;

-- 1. Drop the demo tasks. ON DELETE CASCADE on every task_id FK takes
--    out task_watchers, task_subtasks, task_activity, time_entries,
--    active_timers, and notifications addressed to those tasks.
delete from public.tasks
where id in ('t1','t2','t3','t4','t5','t6','t7','t8','t9','t10',
             't11','t12','t13','t14','t15');

-- Belt + suspenders: the seeded time_entries (e1..e7) were keyed to
-- demo tasks and so already went via the cascade. This catch-all
-- removes them if any were manually re-pointed at a real task before
-- the cleanup ran.
delete from public.time_entries
where id in ('e1','e2','e3','e4','e5','e6','e7');

-- 2. Drop the seeded team_members. The ON DELETE behaviour for the
--    member-side FKs is RESTRICT, so each NOT EXISTS check is required:
--    without them a seeded member that a real task still references
--    would block the whole transaction.
delete from public.team_members tm
where tm.id in ('abraham','alkeith','kristine','jesus','andres','adrian')
  and not exists (select 1 from public.profiles      p where p.member_id   = tm.id)
  and not exists (select 1 from public.tasks         t where t.assignee_id = tm.id or t.creator_id = tm.id)
  and not exists (select 1 from public.task_watchers w where w.member_id   = tm.id)
  and not exists (select 1 from public.time_entries  e where e.user_id     = tm.id)
  and not exists (select 1 from public.active_timers a where a.user_id     = tm.id)
  and not exists (select 1 from public.notifications n where n.member_id   = tm.id);

commit;

-- After running, verify with:
--   select id, name, email from public.team_members order by id;
--   select count(*) from public.tasks;
-- The team_members list should contain only profile-backed users.
