# Quest HQ — Premium New-Task Screen · Design Spec

*Date:* 2026-07-04
*Status:* Approved for planning
*Source of truth for behavior:* `quest-hq-premium-v2.html` prototype (the developer handoff). Where the prototype and this spec disagree on **styling**, this spec wins (app tokens, not prototype hexes). Where they disagree on **behavior**, the prototype wins.

---

## 1. Goal

Rebuild the existing full-page New-Task screen (`js/views/NewTaskPageView.js`) to match the premium "work-order" prototype in **structure, motion, and interaction**, while wearing the app's real skin (the locked `tokens.css` design system). Wire the backend to support the two capabilities the prototype introduces that the current schema lacks: **true ordered multi-assignee** and a **persisted per-tenant `QH-####` work-order number**.

The screen keeps its current EventBus lifecycle and save path untouched:
`AppController.openNewTaskPage(prefill)` → emits `newtask:changed` → view renders into `#newTaskWrap` → `submit()` → `AppController.createTask(payload)` → `saveNow()` → `_deliver()`.

## 2. Scope (approved decisions)

1. **Full premium port** — rebuild the view to prototype fidelity (custom pickers, live work-order rail, title token parser, custom calendar/time, readiness gating, WhatsApp priority-gate, keyboard map).
2. **True multi-assignee** — schema migration adding `tasks.assignee_ids text[]`; lead = index 0 stays in `assignee_id` for back-compat; RLS + notify fan-out updated.
3. **Real sequential `QH-####`** — migration adding a per-company counter + an atomic assign-on-insert RPC; number persisted on the task and shown on the ticket.
4. **Styling from app tokens only** — no prototype color/font literals; works in both light and dark themes.

## 3. Non-goals

- Real WhatsApp dispatch (stays a UI gate + queued toast, as today).
- Server-side reminder *firing* (deferred per prod-readiness backlog; this screen only **stores** the reminder).
- `LEAD` avatar tag styling on the first assignee (Joshua's "later" note).
- Bulk entry beyond the prototype's "Create another."
- Any refactor of unrelated views.

---

## 4. Architecture & files

Rebuild `NewTaskPageView.js` in place; split the new complexity into focused, independently-testable modules.

| File | Responsibility | Depends on |
|------|----------------|-----------|
| `js/views/NewTaskPageView.js` | View shell: `S` state object, render, inline custom pickers, keyboard map, `submit()`, wiring to controller | `App.taxonomy`, `App.PEOPLE`, `App.COMPANIES`, tokenParser, WorkOrderRail |
| `js/views/newtask/tokenParser.js` | **Pure function** `parseTitle(text, ctx) → { cleanTitle, patches, hits }`. Zero DOM. Unit-tested (TDD). | nothing (pure) |
| `js/views/newtask/WorkOrderRail.js` | Pure view of the dark ticket: `render(S, derived) → html`, `tickLine(key)`, `stamp()` | nothing (pure render) |
| `taskmanagement.css` (appended block) | Scoped premium styles under `#newTaskWrap.wo-mode …` so nothing leaks app-wide | `tokens.css` vars |

**Interfaces**

```js
// tokenParser.js — pure, no DOM, no App globals (ctx is injected)
parseTitle(text, {
  team,        // [{id, name, first}]  candidate assignees
  companies,   // [{id, label}]
  atEnd,       // bool — end-of-string also resolves (blur/create)
}) => {
  cleanTitle,  // string with resolved tokens removed
  patches,     // partial S: { addWhos:[id], company, pri, date, time }
  hits,        // [{kind:'assignee'|'company'|'pri'|'date'|'time', label, sectionNode}] for flash + glow
}

// WorkOrderRail.js — pure render of current state
render(S, derived) => htmlString    // derived = {companies, people, taxonomy labels, woNumber}
tickLine(key)                       // returns the data-k to re-highlight after a change
```

**Why the split:** the token parser has the fiddliest rules in the whole feature (unambiguous-prefix `@`, whitespace-vs-end resolution, multi-assignee *add*). Isolating it as a pure function makes it unit-testable against the §11 QA table without a browser. The rail is a pure projection of state, so it isolates cleanly too. Everything DOM/event-bound stays in the view shell.

---

## 5. State model

Single state object owned by the view, initialized from `prefill` (companies default to the user's first company; assignee defaults to the current user as lead):

```js
S = {
  company,                    // company_id (from App.COMPANIES)
  whos: [member_id, ...],     // ORDERED, multi; index 0 = accountable lead
  pri: 'low'|'med'|'high',
  status,                     // status_key from taxonomy.defaultStatus(company, type)
  type,                       // task_type_key from taxonomy.activeTypes(company)[default]
  label: key|null,
  project: project_id|null,
  remind: 'none'|'at'|'1h'|'1d'|'morn'|'custom',
  customN, customU,           // when remind==='custom'
  date: 'YYYY-MM-DD'|'',      // due date
  time: 'HH:MM'|'',           // 24h; '' = no time
  channels: { email:true, inapp:true, watchers:false, wa:false },
}
watchers = [member_id, ...]   // disjoint from whos (enforced on every sync)
subtasks = [{ t, d }, ...]
description = string
```

**Invariants enforced in `sync()`** (mirrors the prototype):
- **Status follows Type:** on any Type or Company change, re-scope Status options to `activeStatuses(company, type)` and reset `S.status` to `defaultStatus(company, type)` unless the current key survives under the new type.
- `watchers = watchers.filter(w => !whos.includes(w))` — assignees can't be watchers.
- Members in `whos` are disabled (labeled "assigned") in the watcher menu.
- WhatsApp channel: unlocked and auto-armed iff `pri === 'high'`; dropping below High disarms + relocks.
- Readiness: `title && whos.length>0 && date` → Create armed (armed pulse), else disabled. No popup validation.

---

## 6. Frontend behavior (fidelity)

### 6.1 Custom pickers (replace all native selects)
Generic button + absolutely-positioned menu; one open at a time; outside-click / Esc closes; menu clicks `stopPropagation`.

**Option sources & the two-tier taxonomy model.** Every option-bearing field draws from the customizable per-company taxonomy (tables 056–058, admin-managed via `TaskSetupAdminView`). They split into two tiers on *this* screen:

| Field | Options source | Inline "create" here? |
|-------|----------------|----------------------|
| Company | `App.COMPANIES` | No — pick only |
| Type | `taxonomy.activeTypes(company)` | No — admin-managed set |
| Status | `taxonomy.activeStatuses(company, type)` | No — admin-managed set (per-type) |
| Priority | fixed Low/Med/High | No |
| Reminder | fixed offsets | No |
| Label | `taxonomy.activeLabels(company)` | **Yes** → new company-scoped label into taxonomy |
| Project | `App.projects` | **Yes** → new row in `projects` |

- **Status is a function of (company, type), not global.** *Every* type carries its **own independently-customizable status ladder** — `bid`, `admin`, `lead`, `invoicing`, `ar`, `meeting`, `web-dev`, and any admin-added type each have a distinct set, edited separately per company in `TaskSetupAdminView`. There is no shared/global status list; a status only exists within a (company, type) pair, and each ladder carries its own `is_default` (starting status for a new task of that type) and `is_done` (what "complete" means for that type). The retired global `bid_status` column is folded into this per-type taxonomy. **Changing Type re-scopes the Status menu from `activeStatuses(company, type)` and resets `S.status` to `taxonomy.defaultStatus(company, type)`** (unless the current status key still exists under the new type, in which case it's kept). Changing Company re-scopes Type first, which cascades into Status.
  - *Edge case:* if a type's ladder is empty or has no `is_default` (misconfigured taxonomy), the Status picker falls back to the first active status for that type, or — if none — a neutral disabled "No statuses" state, and Create is still allowed (status may be null and backfilled by the admin). The screen never crashes on a type with no statuses.
- **Company** — options from `App.COMPANIES`; switching re-themes `--accent` and re-scopes Type → Status → Label → Assignee → Watcher options via `App.taxonomy`.
- **Assignee (multi)** — menu stays open; rows toggle ✓; button shows up to 3 stacked avatars + "Name +N"; adds to `whos` (never replaces); purges watchers of assignees on change.
- **Type** — pick-only; drives the Status set (above).
- **Status** — pick-only; options depend on the selected Type; carries `is_done`/`is_default` semantics, so no ad-hoc invention on this screen.
- **Label / Project** — menus end with an inline create row (text input + Create; Enter commits); new value appended, selected, confirmed via parse-flash line. Create-on-the-fly is **tenant/company-scoped**, **deduped case-insensitively**, and persists into the taxonomy (`task_labels`) / `projects` so it appears in the admin and on future tasks.
- **Priority** — segmented control (Low/Med/High), not a menu.
- **Reminder** — None / At due time / 1h before / 1d before / Morning of (7 AM) / Custom…; Custom reveals number + unit (minutes/hours/days before).

### 6.2 Custom calendar & time
Native popups can't be themed, so both are custom menus.
- **Calendar:** month header with ‹ › nav, S–S row, day grid; selected day = ink pill; **today = accent ring**; quick chips TODAY / TMRW / MON / FRI. "Today" derived from the real clock via `App.timezone()` (AZ, no DST) — **not** the prototype's hardcoded `2026-07-03`.
- **Time:** "No time" + 30-min slots 6:00 AM–7:30 PM, 12-hour labels, scrolls to selection on open; stored 24h `HH:MM`.

### 6.3 Title token parser (`tokenParser.js`)
Exact rules (see §11 QA table):
1. A token resolves only when **followed by whitespace** while typing; at blur/create, end-of-string also resolves (`atEnd=true`).
2. `@name` / `#company` resolve only on an **unambiguous prefix** (exactly one match across id + display name). `@a` (Abraham/Alkeith/Andres) does nothing until disambiguated.
3. `@name` **adds** to `whos` (multi) — never replaces.
4. `!high|med|medium|low` sets priority (first letter decides).
5. Date words: `tmrw|tomorrow|today|mon(day)|wed(nesday)|fri(day)` → `S.date`.
6. Time: `(\d{1,2})(:\d{2})?(a|am|p|pm)` → 24h `S.time` (`9:30a` → `09:30`).
7. On each hit: green flash line under the title, the target control glows `--amber`/accent ~1.3s, its section node lights, and the matching ticket line ticks.

### 6.4 Work-order rail (`WorkOrderRail.js`)
Dark ticket that live-mirrors: NO. (`QH-####`), title, line items (COMPANY / ASSIGNED / PRIORITY / DUE / REMINDER / LABEL / PROJECT / CHECKLIST / WATCHERS), dispatch-channel tags (EMAIL · IN-APP · CC WATCHERS · WHATSAPP), and the 3-item readiness checklist (dots flip green ✓ live). On create → `DISPATCHED` stamp (rotate −8°, spring in), content dims, footer swaps to Create-another / View task.

### 6.5 Dispatch rules
- Defaults: email + in-app ON.
- **WhatsApp priority-gated:** locked/dimmed/"HIGH ONLY" unless `pri==='high'`; High auto-arms it; dropping below High disarms + relocks. Hard rule.
- CC WATCHERS emails the watcher list; reflected in the dispatch toast.

### 6.6 Keyboard map
`C` company · `A` assignee · `P` cycle priority · `L` label · `D` calendar · `⌘/Ctrl+Enter` create · `Esc` close menu. Ignored while typing in an input/textarea. Legend in the footer.

### 6.7 Create flow
Required: title + ≥1 assignee + due date. `⌘/Ctrl+Enter` (or button) runs final `parseTitle(atEnd=true)`, builds payload, calls `createTask`, stamps DISPATCHED, toast `Task dispatched · <names joined with +> via <channels>`. **Create another** resets everything **except company** (sticky) and refocuses the title.

---

## 7. Styling (app tokens only)

- **Fonts:** `--font-display` / `--font-body` / `--font-mono` — never literal font-family strings.
- **Color / surface / border / shadow / radius / spacing / motion:** all from `tokens.css`. No hardcoded hex.
  - Page + cards → `--bg` / `--surface` / `--border` / `--shadow-*`; radius `--radius-md/-sm`; spacing `--space-*`.
  - Accent → **`--amber`** (armed button, focus ring, spine-node fill, parser glow). Prototype orange dropped.
  - Per-company `--accent` → pulled from each company's existing token/swatch (`App.COMPANIES` / taxonomy), not prototype hexes.
  - Priority → `--u-high` / `--u-medium` / `--u-low`; statuses/types/labels → taxonomy colors.
  - Green flash / readiness ✓ → `--green` / `--green-ink`.
  - Motion → `--ease-*` / `--dur-*`.
- **Dark rail:** built from the app's dark-theme charcoal surface/ink token scale so it reads as "the app's dark surface," not an arbitrary brown.
- **Themes:** all-token styling means the screen works in **both** light and dark automatically. Reduced-motion honored via the existing `tokens.css` block.
- Styles scoped under `#newTaskWrap.wo-mode` to prevent app-wide leakage.

---

## 8. Backend & migrations

Migrations are numbered from `060` (existing tree ends at two colliding `059_*` files). **Nothing is applied to PROD (`qqvmcsvdxhgjooirznrj`) until the user reviews the SQL; never auto-apply.** Run `get_advisors` after each.

### 8.1 `060_task_multi_assignee.sql`
- `alter table tasks add column assignee_ids text[] not null default '{}';`
- Backfill: `update tasks set assignee_ids = array[assignee_id] where assignee_id is not null;`
- **Contract:** app always writes `assignee_id = assignee_ids[0]` (the lead) so every existing RLS policy, notify path, and query keeps working unchanged.
- **RLS:** extend the worker/watcher **SELECT** policy lineage (043/051) so a non-lead assignee can read the task: add `OR <auth member id> = any(assignee_ids)`. Verify the worker-notify (040) and update (046) policies still behave with lead-in-`assignee_id`.
- Advisor pass after apply.

### 8.2 `061_wo_number.sql`
- `create table wo_counters (company_id text primary key, next_val int not null default 1);`
- `create function assign_wo_number(company text) returns int` — `security definer`, atomic `insert … on conflict do update set next_val = wo_counters.next_val + 1 returning`; returns the assigned value.
- `alter table tasks add column wo_number int;`
- App calls the RPC at insert and stores the result; ticket (and later detail/list) render `QH-` + zero-padded (`QH-0042`).

### 8.3 Reminder offset (small, same batch)
- `alter table tasks add column reminder_offset text;` — stores the chosen offset spec (`none|at|1h|1d|morn` or `custom:{n,unit}`) for a **future** server-side firing job. This screen still computes and writes the absolute `reminder_at` (as today, migration 037) client-side from due + offset in the tenant timezone.

### 8.4 Notify fan-out (`AppController.createTask` / `_deliver`)
- Loop **all** `assignee_ids` for in-app + email delivery (deduped against creator), replacing the single-assignee delivery. Watcher email logic unchanged. Save-first ordering (await `saveNow` before `_deliver`) preserved — it's required by the 040 RLS/ FK constraint.

### 8.5 Payload changes
- `createTask` payload gains `whos: []` (ordered) → maps to `assignee_ids` and `assignee` (= `whos[0]`).
- `SupabaseDataStore._taskRow` writes `assignee_ids`, `wo_number`, `reminder_offset`.

---

## 9. Data flow (create)

1. View `submit()` → `parseTitle(atEnd=true)` → assemble payload (`{ title, description, whos, company, type, status, label, project, due, dueTime, reminderAt, reminderOffset, priority, watchers, subtasks, notify }`).
2. `App.validate.newTask(payload)` (extend to require `whos.length>=1` instead of single `assignee`).
3. `AppController.createTask(payload)` → build in-memory task (`assignee_ids`, `assignee=whos[0]`), call `assign_wo_number(company)` RPC for `wo_number`, add to `TaskModel`.
4. `await saveNow()` → `_taskRow` insert (with `assignee_ids`, `wo_number`, `reminder_offset`).
5. `_deliver()` → in-app + email fan-out across all assignee_ids + watchers; WhatsApp queued if `pri==='high' && channels.wa`.
6. View stamps DISPATCHED + toast.

---

## 10. Testing

- **TDD — `tokenParser.js`** against the §11 table: `@alkeith ` adds Alkeith + strips token; `@a ` no-op; `tmrw 9:30a !high` sets date + `09:30` + high; end-of-string resolution on create; company/priority/date/time patches. Pure-function tests, no browser.
- **Playwright critical-path** (extend existing suite): open New Task → type a token string → readiness dots flip → Create → assert the Supabase row (`assignee_ids`, `wo_number`, `reminder_at`). Guard against the test Supabase project per e2e notes.
- **Manual/QA** — the full §11 checklist below, plus: light + dark theme render, reduced-motion, mobile ≤980px (rail stacks on top, form single column, footer sticky).
- **Advisor pass** after each migration on PROD.

## 11. QA checklist (from the prototype, must all pass)

- [ ] Create disabled until title + ≥1 assignee + due; readiness dots track live
- [ ] `@alkeith ` adds Alkeith; `@a ` does nothing; token text removed on resolve
- [ ] `tmrw 9:30a !high` fills date, time (`09:30`), priority; WhatsApp auto-arms
- [ ] Priority High→Med disarms + relocks WhatsApp
- [ ] Multi-assign: menu stays open, toggles, button shows stacked avatars "+N"
- [ ] Assigning a current watcher removes them from watchers; disabled in watcher menu
- [ ] Changing Type re-scopes Status options and resets to that type's default; a `bid` type shows bid statuses, an `admin` type shows admin statuses
- [ ] Label/Project "Create" adds, selects, prints on ticket; tenant-scoped, case-insensitive dedupe, persists into taxonomy
- [ ] Calendar month nav + quick chips work; selected day = ink pill; today ringed; "today" is the real date
- [ ] Time list scrolls to selection; "No time" clears
- [ ] Custom reminder shows N + unit; ticket prints "3 DAYS BEFORE" / "1 DAY BEFORE"
- [ ] Company switch re-themes accent everywhere incl. ticket swatch + spine nodes, using token colors
- [ ] ⌘↵ dispatch → stamp + toast with all names & channels; Create another resets, company sticky
- [ ] Multi-assignee persists: `assignee_ids` on row, all assignees notified, lead = `assignee_id`
- [ ] `QH-####` assigned server-side, sequential per company, shown on ticket
- [ ] Renders correctly in both light and dark theme; reduced-motion honored
- [ ] Mobile ≤980px: ticket stacks on top, form single column, footer sticky

---

## 12. Risk notes

- **RLS wall (migration 060):** the worker/watcher SELECT surface is the historically fragile area (migrations 040–048). Keeping `assignee_id = lead` preserves every existing policy; the only addition is a read grant for non-lead assignees. Verify with `get_advisors` and a worker-role read test before shipping to PROD.
- **Concurrent-session branch flips:** per the standing feedback note, isolate the implementation in a worktree and verify the branch on every commit; never `reset --hard` the shared checkout.
- **QH number races:** the counter increment must be atomic in a single statement (`on conflict do update … returning`) — no read-then-write.
