# Anchored single-column redesign — new-task page + task detail

**Date:** 2026-07-02
**Status:** Approved (design); ready for implementation planning
**Part of:** Customizable-taxonomy project, **Phase 4a** (the layout redesign). Phase 4b
(taxonomy-driven per-type Status dropdowns + custom colours) follows on top of this.
**Base branch:** `feat/taxonomy-phase4`, stacked on `feat/taxonomy-phase3` (isolated worktree).

## Problem

The new-task page and the task-detail page share a **three-column** card grid
(`.tdp-grid` = left fields · center title/description · right watchers). Two thin
sidebars flanking the center, with no dominant element, is what the user described as
"no clear starting point / disconnected columns." The center title doesn't read as the
obvious place to begin, and the metadata is split across two disconnected rails.

The current 3-col layout came from a boss-supplied card mockup; this redesign keeps that
warm-flat card DNA but restructures it around a single clear anchor and top-to-bottom flow.

## Decision (chosen from 3 directions)

**Anchored single column.** One focused, centered column (~760px max-width) with:

1. A large **Title** field at the very top — the anchor / obvious starting point.
2. A compact **meta-bar** directly under the title: one connected band (wraps to ~2
   visual lines) holding all the classification/scheduling/people fields as compact
   controls — nothing hidden behind a "more" toggle.
3. **Description** (full-width) below the meta-bar.
4. **Subtasks**, then **Watchers** (moved inline — this removes the orphan right sidebar
   that caused the "disconnected" feel), plus the **Notify** toggle.
5. A **sticky action footer** (Cancel / Create task), separated from the content by a soft
   warm gradient rather than a hairline.

Chosen over "one main + one rail" (still two regions) and "guided labeled sections" (more
verbose/form-like) because it gives the strongest single starting point and is the best fit
for the standing **mobile-first** priority (one column stacks natively).

## New-task page structure

```
                     New task
    ┌─────────────────────────────────────────────┐
    │  Task title                                 │  ← big; the anchor
    └─────────────────────────────────────────────┘
    Company▾   ● Type▾   ● Status▾   ● Label▾   ⚑ Priority▾
    Assignee▾    Due     Time    Reminder    Project
    ┌─────────────────────────────────────────────┐
    │  Description…                               │
    └─────────────────────────────────────────────┘
    Subtasks            + add
    Watchers  ◍ ◍ ◍     + add                ☑ Notify
    ───────────────────────────────────────────────
         [ Cancel ]                 [ Create task ]   (sticky)
```

**Meta-bar field order (fixed, for the Phase-4b taxonomy dependency):**
`Company → Type → Status → Label → Priority`, then `Assignee → Due → Time → Reminder →
Project`. Company precedes Type (company scopes the type list) and Type precedes Status
(type scopes the status list) so the later wiring reads left-to-right. `●` marks the
controls that show a taxonomy colour dot (Type / Status / Label).

## Task-detail page structure

Same hierarchy; **read mode keeps the existing click-to-edit-inline** behaviour — the
meta-bar chips *are* the inline-editable fields (click a value → ✓/✗ editor, unchanged).

```
    ‹ Back                                      ⋯ actions
    Task title                                  ← anchor (big)
    ● Status▾   ⚑ Priority   ·   Assignee   ·   Due
    Company   ·   ● Type   ·   ● Label   ·   Reminder
    ────────────────────────────────────────────────
    Description…
    [ Activity | Comments | History ]   …feed…
    Subtasks  ▣▢▣      Watchers ◍ ◍
```

- The left **Details card** (a column today) becomes the horizontal meta-bar under the title.
- The existing header status chip / quick-status menu, stat strip, and the Activity /
  Comments / History tabs are **kept**, re-flowed beneath the anchor + meta-bar.
- **Edit mode** (already a single-column form) is aligned to the same order: title on top,
  then the same meta-bar of selects, then description, subtasks, watchers.

## Styling (warm-flat "panze")

- **No hairline borders.** Group the meta-bar by spacing + a faint warm background, not
  lines. The sticky footer is separated by a soft warm top-gradient, not a border.
- Big **borderless Title** input (display/Hanken weight); Description gets a subtle warm
  fill, no box outline until focus.
- **Colour dots** on Type / Status / Label controls (the dot colour is wired in Phase 4b;
  this phase can keep the current class-derived colours so nothing regresses).
- Centered narrow column creates built-in focus. Reuse existing `.tdp-*` / panze tokens
  where possible; introduce a small `.taf-*` (task-anchored-form) namespace for the new
  single-column structure so the old 3-col rules can be retired cleanly.
- Orange `#ED4E0D` accents on the primary action + active states.

## Scope / non-goals

- **Layout only.** Field *behaviour* is unchanged here: the Status control keeps its
  current options and the separate "Bid status" field still appears for `type === 'bid'`.
  Per-type Status dropdowns, company→type→status resets, retiring `bidStatus`, and custom
  taxonomy colours are **Phase 4b** (they slot into this new structure).
- No change to validation, submit payload, or the controller create/update paths.
- Mobile: the single column IS the mobile layout — verify the meta-bar wraps cleanly and
  the sticky footer stays reachable ≤720px.

## Testing

- New-task: create a task end-to-end; every field still reads/writes as before; the
  `bid` type still shows its bid-status field (unchanged this phase).
- Detail: inline-edit each meta value (✓/✗) still works; edit-mode round-trips; tabs,
  subtasks, watchers all render.
- Visual eyeball on a Vercel preview against the design taste (warm-flat, no stray
  borders, clear title anchor) — no local Chromium.
- Mobile check ≤720px: single column, wrapping meta-bar, reachable sticky footer.
