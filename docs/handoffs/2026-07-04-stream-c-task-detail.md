# Stream C — Task detail UX (P1)

Branch: `feat/p1-task-detail-ux` · Worktree: `.claude/worktrees/stream-c-task-detail`
Read `2026-07-04-README.md` for the shared rules. Merge order: **last (A → B → C)** —
rebase onto origin/main after each merge ahead of you. You own the largest CSS
diff; keep it inside task-detail selectors.

## Mission

The boss's recurring theme on the task-detail page: "remove the most amount of
steps that we can possible." Every field edit today needs an extra confirm
click, pickers can't take keyboard input, and the layout doesn't match the
mockup he sent (description buried, metadata front-and-center).

## Priority 1 — auto-save, kill every confirm step

On the detail page these must save on selection/blur with NO checkbox/X
confirm and NO Save button:

- **Priority**: click "urgent" → saved instantly.
- **Assignee**: pick a person → saved when the picker closes/blurs.
- **Status**: choose → saved on click-away ("I gotta click save, that's
  annoying").
- **Time spent**: entry saves on blur.

Debounce/queue through the existing save pipeline — Stream A is hardening it
(single-flight lock); build on their semantics, don't reimplement saving.
Show a quiet saved-tick or toast so silent saves are still trustworthy.

## Priority 2 — pickers take keyboard input

- Reminder/due time: typing "10:30" or "9" must work — today it's
  click-hunting through a list ("that's gross, can't type out my keyboard").
- Fix the reminder-picker rendering bug: date numbers overlap/impinge the
  calendar grid.
- Same picker component is used on the new-task page — fixing it there too is
  in scope (component only; the rest of NewTaskPageView belongs to Stream B).

## Priority 3 — layout to the boss's mockup

Reference the mockup image he sent (ask the user to drop it in the chat if
you don't have it). Known deltas from the transcript:

- **Description front-and-center** in the main column — it's currently buried
  ("this is like front and center, the description").
- **Created date**: de-emphasize (down/left in meta), and make it READ-ONLY —
  it is editable today, which is wrong.
- **Watchers**: move down near history — not prominent mid-rail.
- Center column ordering: description → comments/activity → history.
- Inline **pencil to edit just the description** without entering full edit
  mode.

Design language per README rule 9 (warm flat, #ED4E0D, no hairline borders).
Recent detail-page work used content+rail cards (`fix/detail-content-rail`,
commit 21e6242 style) — extend that pattern, don't invent a new one.

## Priority 4 — comment composer, Podio-style

- Enter posts the comment; @mention + Enter selects the mention and stays in
  the composer (second Enter posts) — mirror Podio's flow he demoed.
- Activity entries must be specific: "changed priority to urgent",
  "changed status Working on it → Stuck".
- Duplicate action: add feedback (toast + navigate or highlight) so accidental
  duplicates can't happen silently. Stream A adds the activity row on the data
  side; you render it and add the UI feedback.

## Owned files

- `js/views/TaskDetailView.js`
- The shared date/time/reminder picker component (wherever it lives — likely
  in `js/utils.js` or inside the views; claim it and note it in your PR)
- `taskmanagement.css` — task-detail sections only, plus one appended
  `/* === stream-c: task-detail === */` block

## Hands-off

`js/controllers/AppController.js`, `js/views/TaskListView.js`, `TopbarView`,
`SidebarView`, `HomeView` (Stream B). `js/models/*`, `js/services/*`, `sw.js`
(Stream A). If auto-save needs a tiny model hook, keep it additive and flag it
in the PR.

## Suggested skills

`design-taste-frontend` (project-local), `mobile-responsive-testing` (detail
page at ≤720px is heavily used), `superpowers:verification-before-completion`.

## Definition of done

Zero confirm-click saves on the detail page with visible saved feedback;
keyboard time entry works; reminder-picker overlap fixed; layout matches the
mockup (description centered, created read-only + de-emphasized, watchers by
history); Enter posts comments; specific activity messages; duplicate has
feedback; verified on PR preview at desktop + ≤720px; PR open against main.
