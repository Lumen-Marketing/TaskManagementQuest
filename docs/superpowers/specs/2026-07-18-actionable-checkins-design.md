# Actionable check-ins (deep-link CTAs) — Design

**Date:** 2026-07-18
**Status:** Approved, ready for implementation plan
**Author:** brainstorm session (info@lumenmarketingusa.com)

## Problem

The scheduled `checkins` edge function sends a morning / end-of-day / stalled
nudge to both the in-app bell and email. The AI copy ends by asking the worker a
question — *"What are you tackling first today?"* — but there is **no channel to
answer it**:

- The email is sent from `notifications@lumenmarketingusa.com` with no inbound
  handler; a reply goes nowhere.
- The bell notification is a read-only sanitized HTML blob — no input, no button.

So the check-in *sounds* interactive but is a one-way broadcast. This design
closes that gap the cheap way: replace the dead rhetorical question with a single
**deep-link call-to-action per mode**, in both surfaces, reusing screens that
already exist. (The richer "worker replies back to a manager" feature — per-task
chips, an inbound response path — is explicitly out of scope; see Non-goals.)

## Decisions locked in brainstorming

- **Interactivity tier:** deep-link buttons, NOT per-task chips. No structured
  task payload threaded into the notification.
- **Surfaces:** both email and the in-app bell get the CTA (the email is the
  thing the worker actually saw in the report that started this).
- **Morning target:** the execution-order focus list — add a new
  `#/tasks/execution` route (truest match to "set today's focus").
- **EOD target:** the task table, `#/tasks`.
- **Stalled target:** unchanged — the notification already carries the first
  stalled task's `task_id`; keep opening it, only relabel the CTA.
- **Bell detection:** parse the notification `meta` prefix (`Check-in ·`) and map
  the mode to `{label, route}`. No new notification column, no migration, no
  model/select changes — both the writer (edge fn `MODE_SUBJECT`) and the reader
  (client) live in this repo.

## Key technical constraint

`App.utils.sanitizeNotificationHtml` (js/utils.js:453) strips **every** tag
except `<strong>/<em>/<b>/<i>`. Anchors, buttons, and data attributes embedded in
the notification HTML by the edge function are dropped before the bell renders
them. Therefore:

- The **bell button must be rendered client-side**, not shipped inside the
  notification HTML.
- The **email button is built independently** in the edge function (email HTML is
  not sanitized by the client).

The two surfaces do not share button markup — they share only the intent table
(mode → label → route).

## CTA table (single source of intent)

| Mode    | CTA label                | Deep-link target        | Notes                                    |
|---------|--------------------------|-------------------------|------------------------------------------|
| morning | Set today's focus →      | `#/tasks/execution`     | new route                                |
| eod     | Review today →           | `#/tasks`               | existing route (table layout)            |
| stalled | Review stalled tasks →   | first task's detail     | existing behavior; `task_id` already set |

## Change-sites

### 1. New route `#/tasks/execution` (client)

**File:** js/controllers/AppController.js (`_routeFromState` ~line 342,
`_applyRoute` ~line 432)

- `execution` is already a registered layout in `App.TaskListLayouts`
  (js/views/tasklist/ExecutionLayout.js) but is only reachable today via the
  "Execution order" sort, and the route whitelist in `_applyRoute`
  (`['table','calendar','kanban','cards']`) excludes it.
- Add `'execution'` to that whitelist so `#/tasks/execution` calls
  `setLayout('execution')`.
- In `_routeFromState`, the existing branch `return ui.layout === 'table' ?
  '#/tasks' : '#/tasks/' + enc(ui.layout);` already emits `#/tasks/execution`
  when the layout is `execution`, so the URL round-trips once the whitelist
  accepts it. Verify no separate guard blocks it.
- Canonicalization (`_applyRoute` tail) already rewrites unknown routes; confirm
  `execution` now survives instead of being canonicalized away.

This route is generically useful (a shareable focus-list link), not just for
check-ins.

### 2. Bell CTA (client)

**Files:** js/views/TopbarView.js (`renderNotifs` ~line 360), js/controllers/AppController.js (new method)

- Add a small pure helper that maps a notification to a check-in CTA, e.g.
  `App.utils.checkinCta(meta)` returning `{ mode, label, route }` or `null`.
  Detection: `meta` starts with `Check-in ·`; map the trailing subject text
  (from `MODE_SUBJECT`) to the mode. Keep the subject→mode map in ONE place.
- In `renderNotifs`, when a notification is a check-in, render a styled CTA line
  (e.g. `.notif-cta`) beneath the body showing `label`. Non-check-in
  notifications render exactly as today.
- The existing whole-item click handler branches: for a check-in notification it
  calls a new `controller.openCheckin(notifId)` which marks the notification read,
  closes the panel, and routes to `route` (via `setView('all')` + `setLayout` /
  `selectedTaskId` as appropriate, mirroring how `openNotification` and
  `_applyRoute` mutate state). Non-check-in items keep calling
  `openNotification` unchanged.
- Styling: reuse existing button/pill tokens; no new hairline borders (house
  design rule). Mobile: the CTA line must not overflow the notif panel — verify
  the rendered control's right edge sits inside the panel width.

### 3. Email CTA + reworded copy (edge function)

**Files:** supabase/functions/checkins/index.ts,
supabase/functions/checkins/lib/content.mjs

- **App URL:** add an `APP_URL` secret (e.g. `https://<prod>/app.html`). The
  edge function builds the absolute button href as `${APP_URL}${routeForMode}`
  (e.g. `${APP_URL}#/tasks/execution`). If `APP_URL` is unset, omit the button
  (degrade to text) rather than shipping a broken link.
- **Email button:** in `deliver` (or the per-mode wording step), append a styled
  `<a>` button to the email HTML next to the existing
  `Quest HQ check-in` footer. The button is email-only; the bell ignores it
  (sanitizer strips it anyway).
- **Kill the rhetorical question** — the button is now the CTA:
  - index.ts morning system prompt: remove *"End by asking what they're tackling
    today."*; end on a plain statement of the day instead.
  - index.ts eod system prompt: remove *"then ask them to confirm what they
    finished."*; end on a statement.
  - content.mjs `fallbackMorning`: drop the trailing *"What are you tackling
    today?"*.
  - content.mjs `fallbackEod`: drop the trailing *"Confirm what you finished."*.
- Keep `MODE_SUBJECT` as the canonical mode→subject map; the bell's detection
  relies on these exact strings, so any wording change here is a coordinated
  change with the client map.

## Non-goals (explicitly out of scope)

- Per-task tappable chips / setting a specific task as #1 from the notification.
- Any inbound reply path (reply textarea, `checkin_responses` table, inbound
  email webhook, manager-facing responses view).
- New notification schema columns or changes to the notification load/merge path.
- Changing stalled-mode targeting beyond the relabel.

## Testing

Unit (`npm run test:unit`, glob form on Windows):

- **Route round-trip:** `_routeFromState`/`_applyRoute` accept and emit
  `#/tasks/execution` (mirror existing layout-route tests).
- **CTA mapping:** `checkinCta('Check-in · Your morning check-in')` →
  `{ mode:'morning', label:'Set today\'s focus', route:'#/tasks/execution' }`;
  eod and stalled likewise; a non-check-in meta → `null`.
- **Copy:** `fallbackMorning(...)` and `fallbackEod(...)` outputs contain no `?`.

Manual (the `checkins` function is live in PROD):

- Deploy the edge function from repo source via Supabase MCP `deploy_edge_function`
  (include every `./lib/*.mjs` the entrypoint imports — paste bundles are dead).
- Fire via the temp single-person test hook (secret-gated `{test:memberId}`),
  then REDEPLOY CLEAN.
- Confirm: bell shows the CTA line and clicking it routes to
  `#/tasks/execution`; email shows the button and it opens the app at
  `#/tasks/execution`; copy no longer asks a dead question.

## Rollout notes

- Client changes deploy via the normal Vercel auto-deploy from `main`.
- Edge-fn changes require a `deploy_edge_function` and the `APP_URL` secret set
  before the reworded copy/button go live; set the secret first.
- Stage explicit file paths on commit (never `git add -A` in this repo).
