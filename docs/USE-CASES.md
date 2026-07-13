# Quest HQ — Use-Case Catalog (by Role)

> Complete catalog of what each **role** can do in Quest HQ, derived from the actual
> permission matrix in [`js/constants.js`](../js/constants.js) (`App.ROLE_PERMISSIONS`),
> the route/action guards in [`js/controllers/AppController.js`](../js/controllers/AppController.js),
> and the per-view gating across [`js/views/`](../js/views/).
>
> Every use case lists its **actor(s)**, **precondition**, **trigger**, **main flow**, and
> the **permission gate** that enforces it. Use-case IDs are stable references (UC-###).

---

## 1. Actors (Roles)

Roles resolve through `App.effectiveRole()`. `sales` is an alias of `worker`
(migration 048 → `current_profile_role()`), so they share one permission set.
A **Developer** can "view as" any role via the view-as switcher; `App.realRole()`
always reflects the true account so the switcher never disappears.

| Role | Slug | Inherits | Distinct powers |
|------|------|----------|-----------------|
| **Worker** | `worker` | — | Own tasks, own time clock |
| **Sales** | `sales` | = Worker (alias) | Same as worker; distinct roster label only |
| **Supervisor** | `supervisor` | Worker + | Team time, team chart, reports, task-setup, approvals\* |
| **Construction Supervisor** | `construction_supervisor` | Supervisor | Same as supervisor (task-taxonomy editing per RLS) |
| **Admin** | `admin` | Supervisor + | Manage roles/approvals, clock dashboard |
| **Developer** | `developer` | Admin + | Debug access, problem-report triage, view-as any role |

**Non-role states that gate access:**
- **Pending / Unapproved** (`profiles.approved = false`) — blocked at the wall; sees only the approval-waiting state.
- **Member** (`member`) — default role with **no** permission entry → effectively locked out until assigned a real role.
- **Clock-only** — an account with `clock.use` but not `tasks.view` boots straight into the time screen.

### Permission matrix (`App.ROLE_PERMISSIONS`)

| Capability | Worker/Sales | Supervisor | Constr. Sup. | Admin | Developer |
|---|:--:|:--:|:--:|:--:|:--:|
| `app.use` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `home.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `tasks.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `tasks.write` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `clock.use` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `time.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `time.team` | — | ✅ | ✅ | ✅ | ✅ |
| `team.view` | — | ✅ | ✅ | ✅ | ✅ |
| `reports.view` | — | ✅ | ✅ | ✅ | ✅ |
| `task-setup.manage` | — | ✅ | ✅ | ✅ | ✅ |
| `roles.manage` | — | — | — | ✅ | ✅ |
| `clock.admin` | — | — | — | ✅ | ✅ |
| `bug-reports.manage` | — | — | — | — | ✅ |
| `debug.access` | — | — | — | — | ✅ |

> \* **Approvals** route is guarded by `roles.manage`, which only **Admin** and **Developer**
> hold — so although the Supervisor row appears in some UI, a supervisor cannot open the
> Approvals screen. Supervisors *can* reach Team workload, Team chart, Reports, and Task setup.

### Row-level visibility (who sees which tasks)

Enforced in [`TaskModel`](../js/models/TaskModel.js) and RLS:

- **Worker/Sales** → only tasks they are **assigned to** or **created**, plus the task they're clocked into.
- **Supervisor** → own + created + **all direct reports'** tasks (via `profiles.supervisor_id`) + unassigned pool.
- **Admin/Developer** → **all** tasks within the active **company scope** (`company_ids`).

The **company switcher** further narrows every screen to one company's data at a time.

---

## 2. Universal Use Cases (every approved role)

These require only `app.use` + `home.view` (all roles have them).

- **UC-001 — Sign in.** Actor: any user. Trigger: opens app. Flow: Supabase auth → profile loaded → routed to Home (or Time screen if clock-only). Gate: auth-guard.
- **UC-002 — View Home dashboard.** Actor: any approved role. Flow: greeting, status-mix donut, trend cards, mini-calendar, Up-Next, At-Risk, comments/mentions feed, recents. Gate: `home.view`.
- **UC-003 — Edit own profile.** Actor: any user. Flow: [`ProfileView`](../js/views/ProfileView.js) — change display name, job title, avatar (JPG/PNG ≤2MB), password (8+ chars, upper/lower/number/special). Gate: none (self only).
- **UC-004 — Report a problem.** Actor: any user. Flow: [`ReportProblemView`](../js/views/ReportProblemView.js) — pick type (bug/problem/suggestion), describe, auto-attach context (view/company/viewport/UA) → Edge Function stores report + emails developer. Gate: none.
- **UC-005 — Switch active company.** Actor: any user with >1 `company_ids`. Flow: sidebar company switcher re-scopes every view. Gate: none (limited by own `company_ids`).
- **UC-006 — Receive reminders & notifications.** Actor: any user. Flow: [`ReminderEngine`](../js/services/ReminderEngine.js) scans `reminderAt` every 60s and raises browser notifications; in-app notification queue for @mentions, assignments, nudges. Gate: none.
- **UC-007 — Log out.** Actor: any user. Flow: account menu → Logout → session cleared.
- **UC-008 — Complete onboarding tour.** Actor: first-time user (`profiles.onboarded=false`). Flow: [`TourView`](../js/views/TourView.js) walkthrough of features available to their role; Skip/Esc counts as seen.

---

## 3. Worker / Sales

Permissions: `app.use, clock.use, time.own, tasks.view, tasks.write, home.view`.
Sees **only own + created** tasks. **No** team, reports, admin, or setup surfaces.
Sales is identical — the only difference is the "Sales" roster label.

### Tasks
- **UC-101 — View my tasks.** Trigger: Tasks nav. Flow: worker sees the **time-grouped** list (Overdue / Today / Tomorrow / This week / Later / Done) of tasks assigned to or created by them. Note: layout switcher is hidden for workers (`isWorker` in [`app.js`](../js/app.js#L716)). Gate: `tasks.view`.
- **UC-102 — Create a task.** Trigger: New-task FAB / quick-add. Flow: [`NewTaskPageView`](../js/views/NewTaskPageView.js) — title parses `@assignee #company !priority tmrw 9:30a`; set company, assignees (same-company only, RLS mig 041), priority, type, status, label, project, due/time, reminder, description, subtasks, watchers → Create & dispatch. Gate: `tasks.write`.
- **UC-103 — Assign a task to a same-company teammate.** Flow: assignee picker reads `team_members` filtered by `active` (mig 039) & company (mig 045); worker may only assign inside their own company. Gate: `tasks.write` + RLS 041/043.
- **UC-104 — Open task detail.** Flow: [`TaskDetailView`](../js/views/TaskDetailView.js) read mode — brief, status/due/assignee/priority chips, details card, checklist, comments/activity/history tabs, watchers. Gate: `tasks.view`.
- **UC-105 — Inline-edit a task field.** Flow: click any Details value (status→menu, due→picker, assignee→multi-select) → auto-saves with optimistic version lock. Gate: `tasks.write`.
- **UC-106 — Mark task done / reopen.** Flow: card check / detail button toggles status to `done`. Gate: `tasks.write`.
- **UC-107 — Delete a task I created.** Flow: quick-actions → Delete; `canDeleteTask` allows a worker to delete **only tasks where `creator === me`** ([`AppController`](../js/controllers/AppController.js#L1325), RLS mig 044). Gate: `tasks.write` + creator check.
- **UC-108 — Manage subtasks / checklist.** Flow: add, reorder (drag), tick subtasks; progress bar updates. Gate: `tasks.write`.
- **UC-109 — Comment & @mention.** Flow: detail comment composer with @mentions → mentioned users notified/emailed. Gate: task viewer (comment allowed even without full write).
- **UC-110 — Flag "I'm stuck" / request help / nudge / log call.** Flow: quick actions set a blocker (reason + blocker person + days), send a nudge, request help, or record a call-log note. Gate: `tasks.write`.
- **UC-111 — Watch / unwatch a task.** Flow: detail watch toggle; watchers get notified on changes. Gate: `tasks.write`.
- **UC-112 — Duplicate a task.** Flow: quick-actions → Duplicate clones the work order. Gate: `tasks.write`.
- **UC-113 — Filter & sort my list.** Flow: [`FilterBarView`](../js/views/FilterBarView.js) multi-filter (assignee/priority/status/type/company/due-range); sort by priority/due/title/assignee/status/created/execution-order; saved/persisted filters. Gate: none.
- **UC-114 — Search tasks.** Flow: topbar search box filters my visible tasks. Gate: `tasks.view`.
- **UC-115 — Set execution / focus order.** Flow: drag tasks into #1/#2/#3 rank ([`FocusWidgetView`](../js/views/FocusWidgetView.js) + Sort "Execution order"); persists to `tasks.focus_seq` (mig 050). Gate: `tasks.write`.
- **UC-116 — Bulk actions on my tasks.** Flow: enter select mode → [`BulkActionsView`](../js/views/BulkActionsView.js) → complete all / add to Focus / delete / select-all. Gate: `tasks.write`.
- **UC-117 — Add task to a project folder.** Flow: project tag button on the row / project picker. Gate: `tasks.write`.

### Projects
- **UC-118 — Browse projects.** Flow: [`ProjectsView`](../js/views/ProjectsView.js) portfolio — per-company folders with completion bars, due dates; expand to see tasks (scoped to what the worker can see). Gate: `tasks.view`.
- **UC-119 — Create a project / add task to it / complete folder.** Gate: `tasks.write`.

### Time clock (own only)
- **UC-120 — Clock in / start a task timer.** Flow: timer button on any visible task, or Up-Next "Start"; snapshots `task_title`/`company` (mig 034) so the live board never shows "—". Gate: `clock.use`.
- **UC-121 — Clock out / pause to General shift.** Flow: toggle timer off → falls back to `general-shift`. Gate: `clock.use`.
- **UC-122 — View my time.** Flow: [`TimeView`](../js/views/TimeView.js) "My time" — today / last-7d / all-time hours, current timer, last 20 entries. Gate: `time.own`.

### Widgets
- **UC-123 — Up Next.** Single highest-priority task with Start button ([`UpNextWidgetView`](../js/views/UpNextWidgetView.js)).
- **UC-124 — Today's Progress ring.** Total/Completed/Pending for tasks due or finished today ([`ProgressWidgetView`](../js/views/ProgressWidgetView.js)).

---

## 4. Supervisor (and Construction Supervisor)

Adds: `time.team, team.view, reports.view, task-setup.manage`.
Sees own + created + **all direct reports'** tasks + unassigned pool.
Construction Supervisor is functionally identical here (its extra power is
task-taxonomy write per RLS on `task_types/statuses/labels`).

Inherits **all Worker use cases (UC-101…UC-124)**, scoped wider, **plus**:

- **UC-201 — Choose a task layout.** Flow: layout switcher (Table / Kanban / Cards / Calendar) — hidden for workers, available here. Gate: `tasks.view`.
- **UC-202 — View "Watching" dashboard.** Flow: tasks being watched + a direct-reports dashboard in [`TaskListView`](../js/views/TaskListView.js). Gate: `team.view`.
- **UC-203 — See team workload on Home.** Flow: manager roster block on Home (`App.can('reports.view')` in [`HomeView`](../js/views/HomeView.js#L193)) — per-person open count, overdue tally, priority dots. Gate: `reports.view`.
- **UC-204 — Open Reports / analytics.** Flow: [`ReportsView`](../js/views/ReportsView.js) — KPIs (Critical/High open, Overdue, Completed, On-time rate, Avg cycle time), throughput charts, throughput-by-person, open-work-by-status, range toggle W/M/Q. Company-scoped. Gate: `reports.view`.
- **UC-205 — View Team workload (time).** Flow: [`TimeView`](../js/views/TimeView.js) Team tab — roster of self + direct reports (or full company if no reports) with today / last-7d hours and clocked-in status; live timers highlighted. Gate: `time.team`.
- **UC-206 — View Team org chart.** Flow: [`HierarchyView`](../js/views/HierarchyView.js) — supervisor sees own direct reports + unassigned pool (managers see full tree). Gate: `team.view`.
- **UC-207 — Edit task taxonomy (Task Setup).** Flow: [`TaskSetupAdminView`](../js/views/TaskSetupAdminView.js) per-company — add/rename/recolor/reorder/remove Types, per-type Statuses (default/done toggles), Labels. Gate: `task-setup.manage`.
- **UC-208 — Open the office Wallboard.** Flow: [`WallboardView`](../js/views/WallboardView.js) full-screen auto-refresh board — live clock + team roster cards with each person's top tasks (blocked/overdue/due sorted); read-only. Gate: `home.view` (scoped to visible tasks).
- **UC-209 — Assign work to direct reports.** Flow: assignee pickers include the supervisor's reports; reassign from task detail. Gate: `tasks.write`.
- **UC-210 — Clock dashboard "New task setup" link.** Flow: `nt-setup-link` shown in New-task Routing header when `task-setup.manage`. Gate: `task-setup.manage`.

---

## 5. Admin

Adds: `roles.manage, clock.admin`. Sees **all** tasks in company scope; all admin surfaces except developer-only debug/bug-triage.

Inherits **all Supervisor use cases (UC-101…UC-210)**, **plus**:

- **UC-301 — Manage users & approvals.** Flow: [`ApprovalView`](../js/views/ApprovalView.js) table — set role, position, companies (multi-check `company_ids`), "Reports to", approve/pend toggle; Add person; Refresh; Save access; Delete user (not self). Gate: `roles.manage`.
- **UC-302 — Approve a pending signup.** Flow: flip Approved toggle → user gains access; must also have role + company to create tasks. Gate: `roles.manage`.
- **UC-303 — Assign / change a person's role.** Flow: role select (worker/sales/supervisor/construction_supervisor/admin/developer). Gate: `roles.manage`.
- **UC-304 — Set reporting lines.** Flow: "Reports to" select writes `supervisor_id`, driving row-visibility and team rosters. Gate: `roles.manage`.
- **UC-305 — Assign companies to a user.** Flow: company checkboxes write `company_ids` (mirrored onto `team_members`, mig 045). Gate: `roles.manage`.
- **UC-306 — Delete / offboard a user.** Flow: Delete action (blocked for self). Gate: `roles.manage`.
- **UC-307 — Open the live Clock Dashboard.** Flow: [`ClockDashboardView`](../js/views/ClockDashboardView.js) — "who's clocked in right now" live rows (person/task/project/started/elapsed, 1s tick), everyone roster with today/7d hours, KPIs (live count, team hours today/7d). Gate: `clock.admin`.

---

## 6. Developer

Adds: `debug.access, bug-reports.manage`, and the **view-as-any-role** switcher.
Superset of Admin.

Inherits **all Admin use cases (UC-101…UC-307)**, **plus**:

- **UC-401 — Triage problem reports.** Flow: [`ReportsAdminView`](../js/views/ReportsAdminView.js) — user-submitted bug/problem/suggestion list with reporter, timestamp, description, captured context; filter Open/Resolved/All; mark resolved / reopen. Gate: `bug-reports.manage`.
- **UC-402 — "View as" another role.** Flow: developer-only switcher sets `App.viewAsRole`; every `App.can` / row-scope check reads the effective role while `realRole()` stays `developer` so the switcher persists ([`AppController`](../js/controllers/AppController.js#L167), [`TopbarView`](../js/views/TopbarView.js#L415)). Gate: `App.realRole() === 'developer'`.
- **UC-403 — Access debug tooling.** Flow: `debug.access` unlocks developer diagnostics. Gate: `debug.access`.
- **UC-404 — Full taxonomy authority.** Flow: developer is in every RLS write policy for task types/statuses/labels. Gate: `task-setup.manage` + RLS.

---

## 7. Pending / Locked-out states

- **UC-501 — Blocked at the wall (unapproved).** Actor: `approved=false`. Flow: `AuthModel.isApproved()` false → app boots to a waiting/approval state; no task, time, or admin surfaces. Resolution: an Admin runs UC-302.
- **UC-502 — Member with no role.** Actor: `role='member'`. Flow: no `ROLE_PERMISSIONS` entry → `App.can` returns false for everything except what's universal; effectively read-locked until an Admin assigns a real role (UC-303). The boot guard in [`app.js`](../js/app.js#L12) requires at least one of `app.use` / `clock.use` / `roles.manage`.
- **UC-503 — Clock-only account.** Actor: has `clock.use` but not `tasks.view`. Flow: boots directly into the Time screen ([`app.js`](../js/app.js#L718)); can clock in/out and see own time only.

---

## 8. Cross-cutting rules (apply to every use case)

- **RLS is the real wall; `App.can` is only a UI hint.** Hidden buttons prevent accidents; the database policies enforce authorization regardless of client.
- **Company scope** narrows *every* read to the active company from the switcher (bounded by the user's `company_ids`).
- **Optimistic version locking** on every task write ([`SupabaseDataStore`](../js/services/SupabaseDataStore.js)) prevents concurrent-edit clobbering.
- **Notifications & email** (assignee + creator + watchers) fire automatically on assignment/changes via the `notify-email` Edge Function.
- **Shared timezone** (`America/Phoenix`) renders all clock instants identically for every viewer.

---

*Generated from a full scan of the Quest HQ codebase. Use-case IDs are stable; update this file when `App.ROLE_PERMISSIONS` or the route guards in `AppController.canAccess()` change.*
