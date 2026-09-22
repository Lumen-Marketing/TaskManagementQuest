# Mobile Quick Add v2 — design

**Status:** approved direction, not yet built
**Source of truth for look and interaction:** `quest-hq-mobile-handoff-v2/reference-app.html` (Abraham's approved handoff; a working single-file prototype)
**Owner:** Abraham · **Build:** this repo

## 1. Problem

Creating a task on a phone means scrolling the whole New Task page. Measured in the
real app at 390×844 with `?preview=1`: `#newTaskWrap` scrolls **2236px inside a 722px
window — 3.1 screens**. Abraham fills most fields on most tasks, so hiding fields is
not the fix. Density is.

The approved answer is a bottom sheet: title plus all seven core fields on one screen,
pickers in the thumb zone, rare fields behind one toggle, and smart tokens filling rows
live as he types (which is also how his voice-to-text entry lands).

The handoff also redesigns the task board itself. Both halves are in scope.

## 2. What already exists

This is not a greenfield mobile app. Below 720px the app already has:

- `BottomNavView.js` — a five-slot tab bar whose **raised orange ⊕ is the New Task
  entry point**. The floating FAB was deliberately hidden on phones to avoid having
  two buttons for one action.
- `css/mobile.css` (971 lines) — topbar, bottom nav, horizontally scrolling filter
  pills, header card, and a §4b block that folds the Table layout into stacked cards.
- `js/views/tasklist/*.js` — six layout adapters dispatched through
  `App.TaskListLayouts`, with a layout switcher reachable on phones.
- `js/views/newtask/tokenParser.js` — the token parser, already more capable than the
  handoff's table (it also handles `!urgent`, full day names, multi-`@`, and requires a
  trailing boundary before a token resolves).
- `App.utils.todayISO(offset)` — resolves "today" in the **HQ (Phoenix) timezone for
  every user**, not the device's local date.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | The v2 board is a **new layout adapter**, auto-selected on phones — not a replacement that deletes the old one | Abraham sees v2 every time he opens Tasks; grouping, drag order, bulk actions and the other layouts survive behind the switcher instead of being thrown away |
| 2 | Tapping a card opens the **edit sheet**, with an "Open full task" link to the detail page | Fast field edits in the thumb zone without amputating comments, watchers, time tracking and attachments, which the sheet has no room for |
| 3 | Pickers hydrate from the **app's real taxonomy**, not the handoff's word lists | `js/taxonomy.js` loads types and statuses from Supabase **per company and per type**. A fixed four-status list would offer statuses that do not exist for the selected type |
| 4 | **No FAB.** The bottom nav's ⊕ opens the sheet | The ⊕ already is that button. Adding the handoff's FAB puts two identical orange circles ~60px apart |
| 5 | The handoff's **checklist maps to the app's subtasks** | Steps added on the phone then appear on desktop and in the detail page, instead of becoming a parallel list |
| 6 | Dates go through `App.utils.todayISO` | See §7 |

### Deliberate deviations from the handoff

Only two, both recorded above: no FAB (decision 4), and real taxonomy wording rather
than the handoff's "locked" vocabulary (decision 3). Everything else — layout, colours,
type, radii, row anatomy, tray behaviour, footer, toasts, undo — follows
`reference-app.html`.

## 4. Architecture

Two new units on seams that already exist. Nothing on a desktop path changes.

### 4.1 `js/views/tasklist/QuickBoardLayout.js`

A layout adapter registered into `App.TaskListLayouts`, matching the shape of the six
already there (`mount` / `unmount` / `render`).

Renders the handoff's board: Open/Done/All segment, company filter chips, flat cards
sorted not-done → priority → due ascending, each with a complete-circle, priority-coloured
pill, company swatch, assignee, due pill, subtask progress bar, and a one-line detail
preview. Overdue due-pills turn red; done cards drop to 55% opacity with a struck title;
new cards pulse an orange border for 1.2s. Empty states for "no tasks" and "no matches".

It reads the task list the same way the other adapters do, so filtering, permissions and
per-person visibility keep working without special cases.

**Default vs. preference.** On a phone the quick layout is the default, not a lock: it is
chosen when the stored UI state names no layout, or names one the user last chose on a
wider screen. If the user explicitly picks another layout from the switcher while on a
phone, that choice persists and is honoured on the next visit — the default only applies
until he overrides it. Desktop default is unchanged.

### 4.2 `js/views/QuickSheetView.js`

The bottom sheet. One component, two modes (`NEW TASK` / `EDIT TASK`), matching §5 of
the handoff: grab handle → header → scrolling body → conditional picker tray → sticky
footer.

Body: title input with live token parsing → core field rows (COMPANY, ASSIGNEE,
PRIORITY, STATUS, TYPE, DUE, TIME) → collapsed `▸ REMINDER · LABEL · PROJECT` toggle →
DETAIL textarea → CHECKLIST builder.

Two helper modules keep it from becoming a second thousand-line view:

- `js/views/quicksheet/trays.js` — builds each picker tray, including the three special
  ones (priority segmented bar, due quick-picks, time quick-picks)
- `js/views/quicksheet/rows.js` — renders and updates a field row (label, value, swatch,
  caret, active state)

### 4.3 `css/quicksheet.css`

Sheet, rows, trays, footer, toast and the board cards. Scoped to the sheet and the new
layout so nothing else shifts. Tokens come from `tokens.css` where they already exist.

### 4.4 Controller wiring

Three small edits in `js/controllers/AppController.js`:

1. `openNewTaskPage(prefill)` — below 720px, open the sheet instead of the page. This is
   the single seam the ⊕, the keyboard shortcut and the deep-link route all already call,
   so one fork covers every entry point.
2. Line 254 currently forces `layout = 'table'` whenever the view becomes `all`. That
   would override the mobile default on every navigation to All tasks. The rule becomes:
   the force applies only when the current layout cannot render the `all` view — the
   quick layout can, so on a phone it is left alone. Desktop behaviour is unchanged
   because the quick layout is never the desktop default.
3. The route-param whitelist at line ~487 (`['table','calendar','kanban','cards']`) gains
   the new layout key so a deep link can name it.

### 4.5 Data flow

Save and edit go through the seams that already exist, so notifications, activity
entries and multi-assignee fan-out keep working:

- create → `controller.createTask(payload)`
- edit → `controller.updateTaskDetails(id, fields)` / `updateTaskField`
- complete-circle → the same completion path the other layouts use
- title tokens → `App.parseTaskTitle`
- pickers → `App.taxonomy` and the DB-hydrated `App.COMPANIES`
- toasts → `App.ToastView`

`SAVE + ANOTHER` keeps the routing fields, clears title/detail/checklist, and refocuses
the title.

## 5. Error handling

- Title required after token stripping. Failure focuses the input and swaps the
  placeholder — no alert dialogs, per the handoff.
- A save that rejects leaves the sheet open with its values intact and surfaces the
  error in the existing toast channel. The sheet never discards unsaved input on
  failure.
- Taxonomy not yet hydrated (offline boot): rows fall back to the `js/constants.js`
  values, which is what the rest of the app already does.
- Dismissing without saving discards the draft. No draft persistence in v1, per the
  handoff.

## 6. Testing

Unit tests (`npm run test:unit`, `node --test tests/unit/*.test.mjs`) for the pure logic:

- due quick-pick dates, including the timezone case in §7
- board sort order (not-done → priority → due), overdue detection
- the sheet's form → payload mapping, including token stripping and checklist → subtasks
- taxonomy-driven status options changing with company and type

Visual verification by headless Chrome against `?preview=1` at 390×844, which is how the
3.1-screen measurement in §1 was taken. The target to beat: the sheet shows title and all
seven rows without scrolling.

Baseline before any change: 241 unit tests passing.

## 7. The bug not to reproduce

`reference-app.html:252` computes dates as `d.toISOString().slice(0,10)` on a
local-midnight `Date`. In any UTC+ zone that returns the **previous day**: opened from
Manila the prototype's fresh sheet reads `DUE: Yesterday`, and its DUE tray shows "Today"
highlighted next to a date field one day behind. From Phoenix (UTC−7) it looks correct,
so the people reviewing the design may never see it.

Every date in this build goes through `App.utils.todayISO(offset)` instead, which is
both correct and stronger than a local-date fix: it pins "today" to the HQ timezone for
every user, so a task created from Manila and one created from Phoenix agree on what
"Today" means.

## 8. Out of scope for v1

Watchers in the sheet, drag-to-resize snap points, draft persistence, attachments, and
reminder delivery. Desktop is untouched throughout.
