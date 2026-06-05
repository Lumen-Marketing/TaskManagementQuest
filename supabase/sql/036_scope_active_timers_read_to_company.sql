-- 036: Company-scope active_timers reads so the task-label snapshot can't leak
--      cross-company task names. Also re-asserts owner-scoped writes.
--
-- Security finding (introduced by migration 034): active_timers now carries a
-- snapshot of the running task's title + company (task_title / task_company).
-- The tasks SELECT RLS (migration 028) is company-scoped — a non-developer can
-- only read tasks in their own profiles.company_ids — but the active_timers
-- SELECT policy is NOT. Migration 011 (the last to set it) opened active_timers
-- read to EVERY role with no owner/company predicate, so any authenticated user
-- can `select task_title, task_company from active_timers` and read the task
-- names + companies of EVERY other user, including companies they have no
-- membership in. The snapshot columns turned an over-broad timer read into a
-- cross-tenant task-name leak.
--
-- Fix: rewrite all four active_timers policies to a known-good state regardless
-- of which prior migration is currently live:
--   * SELECT  -> developer (god mode); OR your own row; OR a management role
--               AND the snapshot task_company is one of your companies. This
--               mirrors the company isolation the tasks policy already enforces.
--               Rows with a NULL task_company are visible only to their owner
--               (and developers) — safe by default; they repopulate on the next
--               clock-in. The board further narrows to direct reports in the UI.
--   * INSERT/UPDATE/DELETE -> only your own row (or developer). A user can only
--               start/stop their own timer; the app never mutates another
--               user's timer, and 011 had wrongly widened writes role-only.
--
-- Retired roles (construction_supervisor, sales) are kept in the management list
-- for parity with 017/028 — inert once no profile holds them, avoids lockout.
--
-- Depends on current_company_ids() (028) and current_member_id() (007).
-- Ensures the task_company column exists first so this is self-sufficient even
-- if run before 034's backfill. Transaction-wrapped; idempotent / safe to re-run.

begin;

-- Self-sufficiency: 034 adds these, but don't assume ordering.
alter table public.active_timers
  add column if not exists task_title   text,
  add column if not exists task_company text;

----------------------------------------------------------------
-- SELECT (company-scoped — closes the cross-company snapshot leak)
----------------------------------------------------------------
drop policy if exists "role users can read active_timers" on public.active_timers;
create policy "role users can read active_timers" on public.active_timers
for select to authenticated
using (
  public.current_profile_role() = 'developer'
  or user_id = public.current_member_id()
  or (
    public.current_profile_role() in
      ('admin', 'construction_supervisor', 'supervisor', 'sales')
    and task_company = any(public.current_company_ids())
  )
);

----------------------------------------------------------------
-- INSERT / UPDATE / DELETE (owner-scoped — you only touch your own timer)
----------------------------------------------------------------
drop policy if exists "role users can insert active_timers" on public.active_timers;
create policy "role users can insert active_timers" on public.active_timers
for insert to authenticated
with check (
  user_id = public.current_member_id()
  or public.current_profile_role() = 'developer'
);

drop policy if exists "role users can update active_timers" on public.active_timers;
create policy "role users can update active_timers" on public.active_timers
for update to authenticated
using (
  user_id = public.current_member_id()
  or public.current_profile_role() = 'developer'
)
with check (
  user_id = public.current_member_id()
  or public.current_profile_role() = 'developer'
);

drop policy if exists "role users can delete active_timers" on public.active_timers;
create policy "role users can delete active_timers" on public.active_timers
for delete to authenticated
using (
  user_id = public.current_member_id()
  or public.current_profile_role() = 'developer'
);

commit;

-- Verify (run as a company-scoped manager): should return ONLY your own timer
-- plus timers whose task_company is in your profiles.company_ids — never a row
-- from a company you don't belong to:
--   select user_id, task_title, task_company from public.active_timers;
