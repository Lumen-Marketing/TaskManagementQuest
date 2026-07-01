# Task Taxonomy — Phase 4a (Anchored single-column form redesign) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use
> checkbox (`- [ ]`). Zero-build vanilla-JS SPA, no unit runner, no Chromium — verification
> per task = `node --check` + logic review + the described manual preview check, then commit.

**Goal:** Restructure the **new-task page** and **task-detail page** from the 3-column
`.tdp-grid` into one focused, centered **anchored single column** — a big Title anchor, a
compact meta-bar of fields under it, then description → subtasks → watchers, with a sticky
action footer. Fixes the "no clear starting point / disconnected columns" complaint.

**Architecture:** New `.taf-*` (task-anchored-form) CSS namespace for the single-column
structure. `NewTaskPageView.template()` is rewritten to `.taf`; `TaskDetailView` read-mode
collapses `.tdp-grid`→single column with the left Details card re-flowed into a `.taf-meta`
bar (inline-edit preserved), and edit-mode fields reordered to the meta-bar order. **All
field element IDs, the `nt-*`/`edit-*` selectors, helper methods, validation, and the
create/update controller paths are unchanged** — this is layout only.

**Tech Stack:** Vanilla JS on `window.App`; CSS in `taskmanagement.css`. No new deps.

## Global Constraints

- **Base branch:** `feat/taxonomy-phase4` (isolated worktree, stacked on `feat/taxonomy-phase3`).
- **Layout only.** No change to field *behaviour*: the Status control keeps its current
  options; the separate "Bid status" field still shows for `type === 'bid'`. Per-type Status
  dropdowns + company/type resets + retiring `bidStatus` + custom colours are **Phase 4b**.
- **Keep every element ID + data-action + helper** so `bindEvents`, `_onCompanyChanged`,
  `updateBidStatusRow`, `App.validate.newTask`, the inline-edit `ev()`/`_openInlineEdit`, and
  the create/update paths keep working untouched. If a helper queries a structural class
  (e.g. `.tdp-col-*`), update the selector; prefer keeping IDs so it doesn't.
- **Design taste (strict):** warm-flat panze — NO hairline borders (group by spacing + faint
  warm fills), orange `#ED4E0D` on primary action/active, big borderless Title, colour dots
  on Type/Status/Label (colour source unchanged this phase — still class-derived). Centered
  ~760px column. Match Home/Reports/detail chrome. Mobile-first: single column IS the mobile
  layout — meta-bar wraps, sticky footer reachable ≤720px.
- Verify on a Vercel preview before merge (no local Chromium).

## Files

- **Modify** `js/views/NewTaskPageView.js` — rewrite `template()` to the `.taf` skeleton.
- **Modify** `js/views/TaskDetailView.js` — read-mode: collapse `.tdp-grid`, Details card →
  `.taf-meta`; edit-mode: reorder fields.
- **Modify** `taskmanagement.css` — add `.taf-*`; scope/retire the 3-col `.tdp-grid`/
  `.tdp-col-*`/`.tdp-form-grid` rules once nothing else uses them.

---

### Task 1: New-task page → anchored single column

**File:** `js/views/NewTaskPageView.js` — replace the body of `template()` (currently a
`.tdp-form` with `.tdp-grid.tdp-form-grid` + `.tdp-col-left/main/right`, lines ~113-215).

**Interfaces preserved:** element IDs `nt-title, nt-company, nt-type, nt-bid-status,
nt-status, nt-label, nt-priority, nt-assignee, nt-due, nt-time, nt-reminderAt, nt-project,
nt-desc, nt-subtask-input, nt-subtasks, nt-watchers, nt-watcher-dropdown, nt-notify-email,
nt-notify-inapp, nt-notify-watchers, nt-notify-whatsapp, nt-delegation-banner`; the wrapper
id `nt-bid-status-row` (so `updateBidStatusRow()` is unchanged); all `data-action` values
(`close`, `submit`, `add-subtask`). Keep the option-building expressions verbatim (same
`App.TASK_TYPES/BID_STATUSES/TASK_LABELS/PRIORITIES/COMPANIES` maps and defaults).

- [ ] **Step 1 — rewrite `template()`** to this skeleton (a compact `field(label, inner,
  id?)` helper builds each meta control; move the existing `<select>`/`<input>` markup for
  each field into it verbatim, only changing the wrapper):

```html
<div class="taf">
  <div class="taf-head">
    <button class="detail-back" data-action="close" type="button"><i class="ti ti-arrow-left"></i> Tasks</button>
    <span class="taf-eyebrow">New task</span>
    <span class="taf-createdby"><i class="ti ti-user"></i>Created by you (…)</span>
  </div>

  <input type="text" id="nt-title" class="taf-title-input" placeholder="Task title" aria-label="Task title" required autofocus />

  <div class="taf-meta">
    <!-- ORDER: Company → Type → (Bid status) → Status → Label → Priority → Assignee → Due → Time → Reminder → Project -->
    <label class="taf-field"><span class="taf-field-lbl">Company</span><select id="nt-company">…same options…</select></label>
    <label class="taf-field"><span class="taf-field-lbl">Type</span><select id="nt-type">…</select></label>
    <label class="taf-field hidden" id="nt-bid-status-row"><span class="taf-field-lbl">Bid status</span><select id="nt-bid-status">…</select></label>
    <label class="taf-field"><span class="taf-field-lbl">Status</span><select id="nt-status">…</select></label>
    <label class="taf-field"><span class="taf-field-lbl">Label</span><select id="nt-label">…</select></label>
    <label class="taf-field"><span class="taf-field-lbl">Priority</span><select id="nt-priority">…</select></label>
    <label class="taf-field"><span class="taf-field-lbl">Assignee</span><select id="nt-assignee">…</select></label>
    <label class="taf-field"><span class="taf-field-lbl">Due</span><input type="date" id="nt-due" class="picker-input" value="…" /></label>
    <label class="taf-field"><span class="taf-field-lbl">Time</span><input type="text" id="nt-time" placeholder="e.g. 9:30 AM" /></label>
    <label class="taf-field"><span class="taf-field-lbl">Reminder</span><input type="datetime-local" id="nt-reminderAt" class="picker-input" /></label>
    <div class="taf-field"><span class="taf-field-lbl">Project</span><button type="button" id="nt-project" class="projtag projtag-btn projtag-empty" data-current=""><i class="ti ti-folder-plus"></i>No project</button></div>
  </div>

  <div class="taf-section">
    <div class="taf-section-lbl">Description</div>
    <textarea id="nt-desc" class="taf-desc" placeholder="Add details, links, context…" rows="4"></textarea>
    <div id="nt-delegation-banner" class="delegation-banner hidden"><i class="ti ti-send"></i><span id="nt-delegation-text"></span></div>
  </div>

  <div class="taf-section">
    <div class="taf-section-lbl">Subtasks <span class="field-optional">Optional</span></div>
    <div class="subtask-add-row"><input type="text" id="nt-subtask-input" maxlength="200" placeholder="Add a step and press Enter" /><button class="btn btn-sm" type="button" data-action="add-subtask">Add</button></div>
    <div class="subtask-chip-list" id="nt-subtasks"></div>
  </div>

  <div class="taf-section">
    <div class="taf-section-lbl"><i class="ti ti-users"></i> Watchers</div>
    <div class="watcher-picker"><div class="watcher-tags" id="nt-watchers"></div><div class="watcher-dropdown hidden" id="nt-watcher-dropdown"></div></div>
  </div>

  <div class="taf-section">
    <div class="taf-section-lbl"><i class="ti ti-bell"></i> Notify on create</div>
    <div class="notify-box">…the 4 notify <label class="notify-option"> checkboxes verbatim…</div>
  </div>

  <div class="taf-foot">
    <span class="taf-hint">Press <kbd>Ctrl ↵</kbd> to create</span>
    <div class="taf-foot-btns"><button class="btn" data-action="close" type="button">Cancel</button><button class="btn btn-primary taf-create-btn" data-action="submit" type="button">Create &amp; notify</button></div>
  </div>
</div>
```

- [ ] **Step 2 — check `bindEvents()` + helpers for structural selectors.** Read
  `bindEvents`, `renderWatcherChips`, `renderSubtaskChips`, `updateBidStatusRow`,
  `updateDelegationBanner`. They key off the IDs above, so no change is expected. If any
  queries `.tdp-col-*`/`.tdp-card`/`.tdp-form-foot`, repoint it to the new `.taf-*` class.
  (The `data-action="close"/"submit"/"add-subtask"` handlers and the Ctrl+↵ keybinding stay.)

- [ ] **Step 3 — verify.** `node --check js/views/NewTaskPageView.js`. Manual (preview):
  open "New task" → single centered column, Title on top, meta-bar wraps under it in the
  order above, choosing `type=bid` still reveals the Bid-status field, subtasks/watchers/
  notify work, create succeeds. (Styling lands in Task 4 — structure first.)

- [ ] **Step 4 — commit.**
```bash
git add js/views/NewTaskPageView.js
git commit -m "feat(forms): new-task page → anchored single-column structure"
```

---

### Task 2: Detail read-mode → single column + meta-bar

**File:** `js/views/TaskDetailView.js` read-mode template (the `this.pane.innerHTML = …`
block, lines ~249-end-of-read-template). The `.tdp-head` (back, chiprow, title, actions,
meta) and `.tdp-stats` strip are **already an anchor** — keep them. The change is below them.

**Interfaces preserved:** the inline-edit contract — `ev(field, baseCls)` returns
`class="… tdp-editable" data-edit-field="…"`; keep it on every editable value so
`_openInlineEdit`/`_commitInlineEdit`/`_openStatusMenu` keep working. Keep `data-action`s
(`toggle-timer`, `open-project`, tab switches, `mark-complete`, etc.) and the tab ids.

- [ ] **Step 1 — collapse the grid.** Replace `<div class="tdp-grid"> … 3 columns …</div>`
  with a single `<div class="taf-detail">` flow. Move the timer/delegation banners +
  `.detail-actions-row` (Clock in) to the top of it, then the meta-bar, then Description,
  then the Activity/Comments/History tabs (from the old main column), then subtasks, then
  watchers (from the old right column). Do **not** drop any card — re-parent them.

- [ ] **Step 2 — Details card → `.taf-meta` bar.** Convert the `.tdp-card` "Details" block
  (the `<div class="detail-row"><span class="label">X</span><span ${ev('x')}>…</span></div>`
  list) into a horizontal `.taf-meta` of `.taf-field` items, **keeping the exact `ev(field)`
  attributes on each value** so click-to-edit is preserved. Order:
  `Status · Priority · Assignee · Due · Time · Reminder · Type · (Bid status) · Label ·
  Company · Project · Time spent`. Each item: `<div class="taf-field"><span
  class="taf-field-lbl">Status</span><span ${ev('status')}>…</span></div>`.

- [ ] **Step 3 — watchers inline.** Move the watchers card/`watcherChipsHtml` from the old
  right column into a `.taf-section` after subtasks. (Activity, if it was a separate right
  card, folds into the tabs — keep the tab content.)

- [ ] **Step 4 — verify.** `node --check js/views/TaskDetailView.js`. Manual (preview): open
  a task → anchored header unchanged; below it a single column with the meta-bar; click a
  meta value (Status/Priority/Assignee/Due/Type/Label/Company) → ✓/✗ inline editor still
  opens and saves; status chip menu works; tabs switch; subtasks + watchers render; Mark
  complete / Reopen works.

- [ ] **Step 5 — commit.**
```bash
git add js/views/TaskDetailView.js
git commit -m "feat(forms): task detail read-mode → single column + meta-bar (inline-edit kept)"
```

---

### Task 3: Detail edit-mode → aligned single column

**File:** `js/views/TaskDetailView.js` edit-mode template (lines ~860-961, the
`.detail-body` form with `edit-*` selects).

- [ ] **Step 1 — reorder the fields** into the meta-bar order (Company → Type → (Bid status)
  → Status → Label → Priority → Assignee → Due → Time → Reminder → Project), keeping every
  `edit-*` id, the `data-action="type-change"` on the Type select, and the option-building
  `opts(...)` expressions verbatim. Wrap them in the same `.taf-meta`/`.taf-field` structure
  as read-mode so edit + read look consistent, with Title on top and Description below.

- [ ] **Step 2 — keep the type-change rerender** (`typeSel.addEventListener('change',
  rerender)`) and the `_draftFromTask` / DOM-sync (`_syncDraftFromDom`) unchanged — they read
  by id. (Resetting status on type change is Phase 4b, not here.)

- [ ] **Step 3 — verify.** `node --check`. Manual (preview): Edit a task → single-column
  form in the new order; switching `type` to/from `bid` still toggles the Bid-status select;
  Save round-trips every field; Cancel discards.

- [ ] **Step 4 — commit.**
```bash
git add js/views/TaskDetailView.js
git commit -m "feat(forms): task detail edit-mode → aligned single-column order"
```

---

### Task 4: `.taf-*` panze styling + retire the 3-col rules

**File:** `taskmanagement.css`.

- [ ] **Step 1 — add `.taf-*` styles** (reuse existing tokens `--surface/--bg-2/--ink*/
  --amber/--radius-*`; NO hairline borders):
  - `.taf` / `.taf-detail`: `max-width: 760px; margin: 0 auto;` single column, vertical gap.
  - `.taf-head`: back link + `.taf-eyebrow` (small uppercase `--ink-3`) + optional created-by.
  - `.taf-title-input`: large (~24px, `--font-display`), borderless, transparent bg, full
    width; placeholder in `--ink-4`; focus = no box, subtle `--amber` caret only.
  - `.taf-meta`: `display:flex; flex-wrap:wrap; gap:10px 18px;` a faint warm band
    (`background:var(--bg-2)` or none) — grouped by spacing, no lines.
  - `.taf-field`: `display:flex; flex-direction:column; gap:3px; min-width:0;`
    `.taf-field-lbl` = 11px uppercase `--ink-3`; the `<select>/<input>/<button>` compact
    (`background:var(--bg-2); border:none; border-radius:8px; padding:7px 10px`).
  - `.taf-section` + `.taf-section-lbl` (small uppercase heading); `.taf-desc` = borderless
    textarea on `--bg-2`, focus outline `--amber`.
  - `.taf-foot`: sticky bottom, separated by a soft warm top-gradient (not a border);
    `.taf-create-btn` = `btn-primary` orange.
  - `@media (max-width:720px)`: `.taf/.taf-detail{max-width:none}`, meta-bar items grow to
    full width, sticky foot fixed + reachable.
  - Detail read-mode `.taf-meta .tdp-editable` keeps the existing inline-edit affordance
    (hover/`is-editing`) — reuse the current `#taskDetailWrap .tdp-editable` rules; scope any
    that assumed the old `.detail-row 84px 1fr` grid to still work inside `.taf-field`.

- [ ] **Step 2 — retire the old 3-col rules.** Grep `\.tdp-grid|\.tdp-col-left|\.tdp-col-right
  |\.tdp-form-grid` across `js/` + `css`. Once only these two views referenced them (now
  removed), delete/scope those CSS rules so the 3-col layout can't resurface. Keep `.tdp-head`,
  `.tdp-stats`, `.tdp-chip*`, `.tdp-card` (still used by the detail header + any remaining
  cards).

- [ ] **Step 3 — verify.** CSS brace-balanced (`{`/`}` counts match). Manual (preview):
  both screens read as warm-flat single columns, clear Title anchor, no stray borders, orange
  primary action; usable ≤720px. Eyeball against the design taste.

- [ ] **Step 4 — commit.**
```bash
git add taskmanagement.css
git commit -m "style(forms): .taf anchored single-column panze styling; retire 3-col grid"
```

---

## Testing (whole phase)

- New-task: full create round-trip; every field reads/writes as before; `type=bid` still
  shows Bid-status; Ctrl+↵ creates; validation errors still map to the right `nt-*` field.
- Detail read: inline-edit each meta value (✓/✗); status chip menu; tabs; subtasks; watchers;
  Mark complete/Reopen; timer clock-in.
- Detail edit: reordered single-column form; type→bid toggle; Save/Cancel round-trip.
- Mobile ≤720px: single column, wrapping meta-bar, reachable sticky footer, no clipped controls.
- Visual: warm-flat, borderless, clear Title anchor — eyeball on a Vercel preview.

## Deferred to Phase 4b (unchanged here)

Per-type Status dropdown (options = the selected type's statuses), company→type→status
resets, retiring the separate `bidStatus` field (generalized into per-type statuses), and
rendering Type/Status/Label colours from the taxonomy rows' hex `color` for custom entries.
