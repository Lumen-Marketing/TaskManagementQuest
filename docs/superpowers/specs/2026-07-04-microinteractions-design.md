# Microinteractions Everywhere — Design Spec

**Date:** 2026-07-04
**Status:** Approved
**Goal:** Every interactive element in Quest HQ gives immediate, consistent tactile feedback, and six key moments get celebratory "hero" treatment. Personality: lively but restrained — snappy feedback everywhere, celebration only where it's earned.

## Constraints

- Zero-build vanilla SPA: no frameworks, no bundler, no new dependencies.
- Warm-flat panze design: feedback via color/contrast shifts and transform, never borders; blocks stay flat (no hover lifts/shadows).
- Mobile (≤720px) is the priority surface: every interaction must have a touch equivalent; hover-only effects must not leak to touch.
- All motion gated behind `prefers-reduced-motion`; transform/opacity only (compositor-friendly); no `transition: all`.

## 1. Motion foundation — `tokens.css`

The existing scale (`--ease-out`, `--ease-in`, `--ease-in-out`, `--dur-fast` 120ms, `--dur-short` 180ms, `--dur-mid` 260ms) stays the source of truth. Add exactly two tokens:

- `--ease-spring: cubic-bezier(.34, 1.56, .64, 1)` — overshoot ease for pops and celebrations.
- `--dur-slow: 400ms` — hero-moment duration.

Every interaction below uses only these tokens so the whole app shares one rhythm.

## 2. Global interaction layer — `taskmanagement.css`

One clearly-marked `/* === INTERACTIONS === */` section completing coverage for every interactive element class, extending the pattern `.btn` already establishes (hover bg shift, `:active { transform: scale(.97) }`):

- **Press feedback everywhere:** icon buttons, chips, tabs, sidebar nav items, toolbar controls, segmented switches, pickers — `:active` scale .97 + fast background shift on `--dur-fast`.
- **Menus/popovers unified:** generalize the existing `statusMenuIn` keyframe (opacity + scale .96→1, transform-origin aware) to all dropdowns, pickers, and toolbar menus on `--dur-short`.
- **Inputs:** focus transition on background and focus ring; field label tints toward accent on focus-within.
- **Rows and cards:** flat hover tint on desktop; `:active` tap flash on mobile. No lifts, no shadow changes.
- **Touch correctness:** hover-only effects wrapped in `@media (hover: hover)`; `:focus-visible` rings on all interactive elements.
- **View entrances:** a shared, subtle `view-enter` fade/rise (smaller distance than Home's `qhqRise`) applied when a main view renders.

## 3. JS moments helper — new `js/utils/motion.js`

~150 lines, Web Animations API, no dependencies. Public API:

- `Motion.pop(el)` — springy scale pop (badges, checkmarks, counters).
- `Motion.check(el)` — SVG check stroke-draw (task/project completion).
- `Motion.pulse(el)` — single soft success pulse (save landed, timer state change).
- `Motion.flip(container, mutate)` — FLIP transition so reorders/regroups glide instead of teleporting.
- `Motion.arrive(el)` — entrance rise + warm highlight tint fading over ~2s (just-created rows/cards).

Reduced-motion is checked once inside the helper; every method degrades to an instant state change. Views never branch on it.

## 4. Hero moments (six)

1. **Task completion** — checkbox pops (`--ease-spring`), check draws in via `Motion.check`, row settles into done style (fade + strike). Wired wherever completion toggles: TaskListView, TaskDetailView, board.
2. **Task created** — after save, the new task's row enters via `Motion.arrive` wherever it lands (list/board): spring rise + warm highlight tint fading over ~2s, so the eye is drawn to the created item — visible proof it exists. Paired with the existing success toast.
3. **Project created** — same `Motion.arrive` pattern on the new folder card in ProjectsView, plus toast.
4. **Project finished** — on `.pv-check` click: check pops and draws, the `pv-fill` progress bar sweeps to 100%, the row gives one restrained celebration pulse, then glides via `Motion.flip` into the collapsed Completed group. Message uses the existing `toast-celebrate` variant.
5. **Save/sync confirmation** — the task-detail save indicator pulses once via `Motion.pulse` when the debounced save promise resolves — confirming the sync landed, not the click.
6. **Timer start/stop** — timer chip pulses to life on start and settles on stop. No perpetual animation while running (battery, distraction).

Creation feedback (moments 2–3) is anchored to the actual new element appearing in place, not just a toast.

## 5. Guardrails

- Transform/opacity only; nothing that triggers layout or paint storms; no `transition: all`.
- One global `prefers-reduced-motion: reduce` gate in CSS + the single helper check in JS.
- No new dependencies, no build step.
- Mobile gets the full experience via `:active`/tap states — not a degraded one.

## 6. Testing

- Playwright smoke: task completion toggle works with animations enabled and with `reducedMotion: 'reduce'` emulated; focus reorder persists after the FLIP animation; created task/project appears and is interactive immediately.
- Manual mobile pass at ≤720px: tap feedback present, no horizontal overflow, no jank on low-end throttling.

## Rollout order (for the implementation plan)

1. Tokens + reduced-motion gate.
2. Global CSS interaction layer.
3. `motion.js` helper.
4. Hero moments wiring (completion → creation → project finish → save pulse → timer).
5. Mobile/touch verification pass + Playwright smoke.
