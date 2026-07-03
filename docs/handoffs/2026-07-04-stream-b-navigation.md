# Stream B — Navigation & history (P1)

Branch: `feat/p1-navigation-history` · Worktree: `.claude/worktrees/stream-b-navigation`
Read `2026-07-04-README.md` for the shared rules. Merge order: **after Stream A** —
when A merges, `git fetch && git rebase origin/main`.

## Mission

The boss's #2 stress point: the app fights his navigation habits. The browser
back button (mouse side-button and Edge toolbar) does nothing, there's no
always-available Home affordance, and clicks don't take him where he expects.
Mentioned four separate times: "It really irritates me. I can't go back on my
mouse."

## Priority 1 — real browser history

Every view change must push a history entry so browser/mouse back-forward
walks the user's actual path (Home → task → back lands on Home). Routing lives
in `js/controllers/AppController.js`. Likely hash-based routes; make sure:

- opening a task detail, a folder, a view switch → `pushState`/hash change;
- back button restores the previous view including selected folder/day;
- refresh on any route restores that route (deep-link safe);
- in-app "back"/cancel actions and browser back converge on the same stack —
  no double-entry loops (test: open task → back → forward).

Acceptance: from Home, open folder → task → mouse-back → folder, mouse-back →
Home. No dead back button anywhere, including the new-task page.

## Priority 2 — Home affordance everywhere

- Clicking the app logo / Q icon in the topbar always navigates Home —
  including from the new-task page (today the only exit is Cancel: "I want to
  go home, I can't go home, I have to cancel").
- Audit modal/full-page surfaces for other escape-hatch dead ends.

## Priority 3 — calendar day navigation

- Home calendar widget: clicking a **specific day** goes to that day's view
  ("If I click on the 17th, I only want to see the 17th"). Clicking the
  **month title** opens the full month calendar.
- Inside calendar view: clicking a day currently only preselects it — it must
  navigate to that day.

## Priority 4 — All Tasks view modes

- All Tasks always OPENS in table view, regardless of the last-used mode
  ("it should always by default at least go to table view").
- **Cards view is broken** — clicking Cards renders nothing usable. Fix the
  renderer in `js/views/TaskListView.js`.

## Owned files

- `js/controllers/AppController.js` (routing/navigation sections)
- `js/views/TopbarView.js`, `js/views/SidebarView.js`
- `js/views/HomeView.js` (calendar-widget click handling only — do NOT restyle;
  the Solar-duotone icon/motion design is settled)
- `js/views/TaskListView.js` (view-mode switching + cards renderer)
- `js/views/NewTaskPageView.js` (navigation escape only — not form fields)

## Hands-off

`js/views/TaskDetailView.js` and all pickers (Stream C), `js/models/*`,
`js/services/*`, `sw.js` (Stream A — treat as read-only). CSS: only what
cards-view rendering strictly needs, in a `/* === stream-b === */` block.

## Suggested skills

`superpowers:systematic-debugging`, `mobile-responsive-testing` (back/home
affordances at ≤720px), `superpowers:verification-before-completion`.

## Definition of done

History-stack navigation works with mouse back/forward across Home, folders,
tasks, calendar days, new-task; logo goes Home from everywhere; day click
lands on the day; All Tasks defaults to table; cards view renders; verified on
a PR preview at desktop and ≤720px; PR open against main.
