# Wave 2 backlog — parked from the 2026-07-04 boss walkthrough

Not assigned to any current stream. Do not start these in wave 1; they collide
with wave-1 files or need product decisions first.

## Home dashboard right column (needs design pass first)

Empty space right of the month widget. Boss floated: "Delegated to / Waiting
on" (tasks he assigned to others), "Who's on the clock", a live activity feed
("Christine commented on…", "Joshua completed…"), and the "slip count" idea
(he doesn't know what it means — explain or drop it). Blocked on: Stream B's
HomeView click-handling landing, plus a mockup/GRILL pass before building
(design-taste feedback memory applies).

## Folders / Projects polish

- Page header is embarrassing: shows "task managing quest vercel app" — needs
  the branded header treatment.
- New-folder flow: company field misbehaved, no clear created-confirmation.
- Naming decision: he leans "Folders" over "Projects" — needs confirmation,
  then a sweep of labels.
- Create-folder from inside a task when none exists.
- New-task form inside a folder says "Lead name / task" → should say "Task".

## Taxonomy (continues the customizable-taxonomy program, phases 2–4)

- "+ Add type" (and status/label) inline at the bottom of dropdowns on
  new-task — feeds into the existing per-company taxonomy work
  (see project_customizable_task_taxonomy memory / phase 4b just merged).
- Labels are confusing him (company vs type vs label) — needs an organizing
  decision before more UI.

## Multiple assignees

"Should be multiple assignees if we want" — schema + RLS + notify + pickers;
a real project, not a patch. Needs its own design spec.

## Misc

- Subtask rows: define whether they're clickable and what they open.
- Loading art: he likes it ("pretty badass") but flagged it as not a
  money-maker — leave as-is.
