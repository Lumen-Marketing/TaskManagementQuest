-- 017: Close authz gaps surfaced by the security audit.
--
-- 1. notifications: write-time CHECK constraint blocks <script>, javascript:
--    URIs, and on*= event handlers from ever landing in the html column. This
--    is defense-in-depth — the render path is also patched to sanitize, but
--    the database is the last line so a future render-side regression cannot
--    re-expose stored XSS.            [audit: C-1, M-3]
--
-- 2. profiles self-update: lock member_id and email in addition to the
--    role/approved/supervisor_id/company_id columns that 015 already locked.
--    Without this, a signed-in user can repoint current_member_id() at any
--    team_member id and impersonate them across time_entries / active_timers /
--    notifications RLS predicates.            [audit: C-2]
--
-- 3. tasks: replace the legacy "approved users can …" policies (from migration
--    005, never role-gated by 007) with role-aware policies. Members get no
--    access; workers can read every task and update only tasks they are the
--    assignee of (or the shared general-shift bucket); admin / construction
--    supervisor / developer / supervisor / sales get full access. Re-establishes
--    the worker general-shift carve-out that migration 013_consolidate dropped
--    along with task_activity.            [audit: C-3, H-6]
--
-- 4. team_members.color: constrain to #RRGGBB so the value cannot break out
--    of style="background:<color>" attributes. Existing rows already match
--    this shape (seeded as #RRGGBB; handle_new_user derives it from md5()).
--    [audit: H-1]

------------------------------------------------------------------------
-- 1. notifications: write-time XSS defense (C-1, M-3)
------------------------------------------------------------------------
alter table public.notifications
  drop constraint if exists notifications_safe_html;
alter table public.notifications
  add constraint notifications_safe_html
  check (
    length(coalesce(html, '')) <= 4096
    and length(coalesce(meta, '')) <= 200
    and html !~* '<\s*script\b'
    and html !~* 'javascript\s*:'
    and html !~* '\son[a-z]+\s*='
  ) not valid;

------------------------------------------------------------------------
-- 2. profiles self-update lock (C-2)
------------------------------------------------------------------------
drop policy if exists "users update own profile name" on public.profiles;
create policy "users update own profile name" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role          = (select p.role          from public.profiles p where p.id = auth.uid())
  and approved      = (select p.approved      from public.profiles p where p.id = auth.uid())
  and supervisor_id is not distinct from (select p.supervisor_id from public.profiles p where p.id = auth.uid())
  and company_id    is not distinct from (select p.company_id    from public.profiles p where p.id = auth.uid())
  and member_id     is not distinct from (select p.member_id     from public.profiles p where p.id = auth.uid())
  and email         is not distinct from (select p.email         from public.profiles p where p.id = auth.uid())
);

------------------------------------------------------------------------
-- 3. tasks: role-gated RLS (C-3, H-6)
------------------------------------------------------------------------
drop policy if exists "approved users can read tasks"   on public.tasks;
drop policy if exists "approved users can insert tasks" on public.tasks;
drop policy if exists "approved users can update tasks" on public.tasks;
drop policy if exists "approved users can delete tasks" on public.tasks;
drop policy if exists "role users can read tasks"       on public.tasks;
drop policy if exists "role users can insert tasks"     on public.tasks;
drop policy if exists "role users can update tasks"     on public.tasks;
drop policy if exists "role users can delete tasks"     on public.tasks;
drop policy if exists "worker can read general shift task" on public.tasks;

create policy "role users can read tasks" on public.tasks
for select to authenticated
using (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales', 'worker')
);

create policy "role users can insert tasks" on public.tasks
for insert to authenticated
with check (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
);

-- Workers can UPDATE only the rows they own (assignee) or the shared
-- general-shift bucket. Higher roles get unconditional UPDATE.
create policy "role users can update tasks" on public.tasks
for update to authenticated
using (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
  or (
    public.current_profile_role() = 'worker'
    and (assignee_id = public.current_member_id() or id = 'general-shift')
  )
)
with check (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
  or (
    public.current_profile_role() = 'worker'
    and (assignee_id = public.current_member_id() or id = 'general-shift')
  )
);

create policy "role users can delete tasks" on public.tasks
for delete to authenticated
using (
  public.current_profile_role() in
    ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
);

------------------------------------------------------------------------
-- 4. team_members.color: strict hex format (H-1)
------------------------------------------------------------------------
alter table public.team_members
  drop constraint if exists team_members_color_format;
alter table public.team_members
  add constraint team_members_color_format
  check (color ~ '^#[0-9A-Fa-f]{6}$');
