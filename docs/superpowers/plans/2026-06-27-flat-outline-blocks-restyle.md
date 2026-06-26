# Flat-Outline Blocks Restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every screen of Quest HQ into "flat outline blocks" — crisp near-black hairline outlines, no resting shadows, sharper corners — while keeping the existing layout, the orange brand color, and the Inter font.

**Architecture:** Pure CSS, scoped entirely to `body.ui-command-center` in `taskmanagement.css`. Driven mostly by flattening two shadow tokens and adding two new "block" tokens, then pointing the existing block-surface rules at them. No JS, HTML, layout, palette, or font changes. `tokens.css` is NOT touched.

**Tech Stack:** Vanilla CSS custom properties; Playwright (`--project=local`) for computed-style guardrail assertions; manual visual verification in light + dark theme.

## Global Constraints

- Edit **only** `taskmanagement.css`, and only rules scoped under `body.ui-command-center` (token block begins at line 4306). Do NOT edit `tokens.css`. Do NOT touch other skins (`panze-*`, dark-theme-only blocks beyond their `ui-command-center` scope).
- Keep `--amber: #ED4E0D` and the Inter font stack unchanged.
- Outline color = `#16191D` (near-black), rendered at `1px`.
- Block corner radius = `8px`.
- Resting cards/buttons: no shadow. Overlays (menus, dropdowns, modals via `--shadow-lg`): keep their shadow.
- New test specs MUST be added to the `testMatch` array in `playwright.config.js:29`, or Playwright will not run them.
- Run tests with: `npx playwright test --project=local <file>` (the config auto-starts `node tools/dev-server.mjs`).

---

### Task 1: Add block tokens and flatten resting shadows

**Files:**
- Modify: `taskmanagement.css:4329-4331` (the `body.ui-command-center` token block)
- Test: `tests/restyle-blocks.spec.js` (create)
- Modify: `playwright.config.js:29` (add the new spec to `testMatch`)

**Interfaces:**
- Produces: CSS custom properties `--block-line: #16191D` and `--block-radius: 8px`, plus `--shadow-sm: none` / `--shadow-md: none`, all scoped to `body.ui-command-center`. Later tasks consume these tokens.

- [ ] **Step 1: Add the new spec to the Playwright allow-list**

In `playwright.config.js`, line 29, append `'restyle-blocks.spec.js'` to the `testMatch` array (inside the closing `]`):

```js
testMatch: ['auth.spec.js', 'tasks.spec.js', 'role-gate.spec.js', 'preview-bypass-dead.spec.js', 'add-person.spec.js', 'responsive.spec.js', 'focus-model.spec.js', 'focus-dragorder.spec.js', 'focus-e2e.spec.js', 'hq-time.spec.js', 'redesign-topbar.spec.js', 'home-reports.spec.js', 'mobile-quick-actions.spec.js', 'restyle-blocks.spec.js'],
```

- [ ] **Step 2: Write the failing test**

Create `tests/restyle-blocks.spec.js`:

```js
// @ts-check
import { test, expect } from './_fixtures.js';

// The restyle is CSS-only; preview mode boots the app with seed data and no backend.
async function boot(page, baseURL) {
  await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
  await page.waitForFunction(() => !!window.App && !!window.App.controller);
}

test.describe('flat-outline block restyle', () => {
  test('block tokens are defined and resting shadows are flattened', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return {
        line: cs.getPropertyValue('--block-line').trim().toLowerCase(),
        radius: cs.getPropertyValue('--block-radius').trim(),
        shadowSm: cs.getPropertyValue('--shadow-sm').trim().toLowerCase(),
        shadowMd: cs.getPropertyValue('--shadow-md').trim().toLowerCase(),
      };
    });
    expect(tokens.line).toBe('#16191d');
    expect(tokens.radius).toBe('8px');
    expect(tokens.shadowSm).toBe('none');
    expect(tokens.shadowMd).toBe('none');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx playwright test --project=local restyle-blocks.spec.js`
Expected: FAIL — `--block-line` is empty and `--shadow-sm` is the old shadow value, not `none`.

- [ ] **Step 4: Add the tokens / flatten shadows**

In `taskmanagement.css`, inside the `body.ui-command-center` declaration block, replace the existing shadow lines (currently `--shadow-sm` / `--shadow-md` near line 4329) and add the two block tokens immediately after them:

```css
  /* Flat-outline restyle (2026-06-27): kill resting elevation, add block tokens. */
  --shadow-sm: none;
  --shadow-md: none;
  /* --shadow-lg unchanged — overlays (menus, dropdowns, modals) still float. */
  --block-line: #16191D;   /* crisp near-black hairline for block outlines */
  --block-radius: 8px;     /* flat panels, not pills */
```

Leave the `--shadow-lg` line exactly as it was.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test --project=local restyle-blocks.spec.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add taskmanagement.css tests/restyle-blocks.spec.js playwright.config.js
git commit -m "feat(restyle): add flat-outline block tokens, flatten resting shadows"
```

---

### Task 2: Apply block treatment to Home surfaces

**Files:**
- Modify: `taskmanagement.css:5312-5348` (the existing `html:not([data-theme="dark"]) body.ui-command-center .qhq-card / .qhq-stat` block) and `taskmanagement.css:4917` (`.qhq-card` base)
- Test: `tests/restyle-blocks.spec.js` (extend)

**Interfaces:**
- Consumes: `--block-line`, `--block-radius` from Task 1.
- Produces: Home stat cards (`.qhq-stat`), panels/cards (`.qhq-card`) rendered as flat outline blocks.

- [ ] **Step 1: Write the failing test**

Append to `tests/restyle-blocks.spec.js` inside the `describe`:

```js
  test('Home cards are flat outline blocks (no shadow, 8px radius, near-black outline)', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('home'));
    const card = page.locator('#homeWrap .qhq-card').first();
    await expect(card).toBeVisible();
    const styles = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, borderColor: cs.borderTopColor };
    });
    expect(styles.shadow).toBe('none');
    expect(styles.radius).toBe('8px');
    // #16191D -> rgb(22, 25, 29)
    expect(styles.borderColor).toBe('rgb(22, 25, 29)');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=local restyle-blocks.spec.js -g "Home cards"`
Expected: FAIL — current `.qhq-card` has a 14px radius, a `--shadow-sm` shadow, and the faint `--border` color.

- [ ] **Step 3: Update the Home block rules**

In `taskmanagement.css`, change the base `.qhq-card` rule (line ~4917) to use the block tokens:

```css
.qhq-card { background: var(--surface); border: 1px solid var(--block-line, var(--border)); border-radius: var(--block-radius, 14px); box-shadow: none; }
```

Then, in the existing `html:not([data-theme="dark"]) body.ui-command-center .qhq-card, … .qhq-stat` block (lines 5312-5348), ensure the resting and hover states are flat. Set the resting rule body to:

```css
  border: 1px solid var(--block-line);
  border-radius: var(--block-radius);
  box-shadow: none;
```

and the `:hover` rule body (the one that currently applies a transform/shadow lift) to:

```css
  transform: none;
  box-shadow: none;
  border-color: var(--block-line);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test --project=local restyle-blocks.spec.js -g "Home cards"`
Expected: PASS.

- [ ] **Step 5: Visual check**

Run `npm run dev`, open `http://localhost:4173/app.html?preview=1&role=admin&member=abraham`, go to Home. Confirm: 4 stat cards + the two panels read as flat outlined blocks, no shadow, square-ish corners. Toggle dark theme (account menu / `[data-theme="dark"]`) and confirm the dark block block rules still look intentional (dark theme keeps its own border; outline override is light-theme scoped — acceptable per spec).

- [ ] **Step 6: Commit**

```bash
git add taskmanagement.css tests/restyle-blocks.spec.js
git commit -m "feat(restyle): flat-outline blocks on Home stat cards and panels"
```

---

### Task 3: Apply block treatment to Tasks List + Board + Table

**Files:**
- Modify: `taskmanagement.css` — the `.task-group` rule (line ~392/403), the `.kanban-col` and `.kanban-card` rules, and `.time-table` (line ~830)
- Test: `tests/restyle-blocks.spec.js` (extend)

**Interfaces:**
- Consumes: `--block-line`, `--block-radius`.
- Produces: list group cards, board columns/cards, and the table container rendered as flat outline blocks.

- [ ] **Step 1: Write the failing test**

Append to `tests/restyle-blocks.spec.js`:

```js
  test('Task list groups are flat outline blocks', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => window.App.controller.setView('all'));
    const group = page.locator('#taskViewWrap .task-group').first();
    await expect(group).toBeVisible();
    const styles = await group.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, borderColor: cs.borderTopColor };
    });
    expect(styles.shadow).toBe('none');
    expect(styles.radius).toBe('8px');
    expect(styles.borderColor).toBe('rgb(22, 25, 29)');
  });

  test('Board columns are flat outline blocks', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => { window.App.controller.setView('all'); window.App.controller.setLayout('kanban'); });
    const col = page.locator('#taskViewWrap .kanban-col').first();
    await expect(col).toBeVisible();
    const styles = await col.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, radius: cs.borderTopLeftRadius };
    });
    expect(styles.shadow).toBe('none');
    expect(styles.radius).toBe('8px');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=local restyle-blocks.spec.js -g "list groups|Board columns"`
Expected: FAIL — these surfaces use `--radius-lg` (20px) and `--shadow-sm`.

- [ ] **Step 3: Add scoped block overrides**

Append a new rule block to `taskmanagement.css` (after the existing list/board rules — search for the `.task-group {` and `.kanban-col {` rules; add an override block near them):

```css
/* Flat-outline restyle (2026-06-27) — list / board / table surfaces. */
body.ui-command-center .task-group,
body.ui-command-center .kanban-col,
body.ui-command-center .kanban-card,
body.ui-command-center .time-table {
  border: 1px solid var(--block-line);
  border-radius: var(--block-radius);
  box-shadow: none;
}
body.ui-command-center .task-group.collapsed,
body.ui-command-center .kanban-card:hover {
  box-shadow: none;
}
```

(If `.task-group` sets per-corner radii via `border-top-left-radius: var(--radius-lg)` etc. at lines 403-404, add `body.ui-command-center .task-group { border-top-left-radius: var(--block-radius); border-bottom-left-radius: var(--block-radius); }` to the override block so the left rail corners match.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test --project=local restyle-blocks.spec.js`
Expected: PASS (all cases, including Task 2's).

- [ ] **Step 5: Visual check**

In the dev server: open Tasks, switch List / Table / Board. Confirm every surface reads as a flat outlined block; the kanban cards inside columns are flat; the table container has a crisp outline.

- [ ] **Step 6: Commit**

```bash
git add taskmanagement.css tests/restyle-blocks.spec.js
git commit -m "feat(restyle): flat-outline blocks on task list, board, and table"
```

---

### Task 4: Centralize detail-page blocks + density pass + verification

**Files:**
- Modify: `taskmanagement.css` — the `.detail-card` rule and any recent hardcoded black-outline values on detail blocks (search `.detail-card`, `.detail-side`, the AI summary band class)
- Test: `tests/restyle-blocks.spec.js` (extend)

**Interfaces:**
- Consumes: `--block-line`, `--block-radius`.
- Produces: detail-page blocks pointing at the shared tokens (so they match every other screen); consistent ~16-18px block padding.

- [ ] **Step 1: Write the failing test**

Append to `tests/restyle-blocks.spec.js`:

```js
  test('Detail page cards are flat outline blocks on the shared tokens', async ({ page, baseURL }) => {
    await boot(page, baseURL);
    await page.evaluate(() => { window.App.controller.setView('all'); window.App.controller.selectTask('t1'); });
    const card = page.locator('.detail-card').first();
    await expect(card).toBeVisible();
    const styles = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, borderColor: cs.borderTopColor };
    });
    expect(styles.shadow).toBe('none');
    expect(styles.radius).toBe('8px');
    expect(styles.borderColor).toBe('rgb(22, 25, 29)');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test --project=local restyle-blocks.spec.js -g "Detail page"`
Expected: FAIL if detail blocks use a hardcoded outline/radius differing from the tokens.

- [ ] **Step 3: Point detail blocks at the shared tokens**

Append to `taskmanagement.css`:

```css
/* Flat-outline restyle (2026-06-27) — detail-page blocks share the block tokens. */
body.ui-command-center .detail-card {
  border: 1px solid var(--block-line);
  border-radius: var(--block-radius);
  box-shadow: none;
  padding: 16px;
}
```

If the AI summary band (the "Where this task stands" band) is a distinct class, add it to the selector list with the same three border/radius/shadow declarations (keep its accent background as-is).

- [ ] **Step 4: Run the full spec to verify it passes**

Run: `npx playwright test --project=local restyle-blocks.spec.js`
Expected: PASS (all tests).

- [ ] **Step 5: Full visual + overflow verification**

In the dev server, walk all five screens (Home, List, Table, Board, Detail) in **both** light and dark theme. Confirm:
- Every block is a flat outline block; no resting shadows anywhere on cards/buttons.
- Open a dropdown / status menu / a modal — confirm it STILL has a shadow (overlay `--shadow-lg` preserved).
- Resize to ≤720px (mobile) and confirm no new horizontal overflow from outline weight or padding.

- [ ] **Step 6: Commit**

```bash
git add taskmanagement.css tests/restyle-blocks.spec.js
git commit -m "feat(restyle): unify detail-page blocks on shared tokens + density pass"
```

---

## Self-Review

- **Spec coverage:** kill resting shadows (Task 1) ✓; strong hairline outline token (Task 1, applied Tasks 2-4) ✓; sharper corners token (Task 1, applied Tasks 2-4) ✓; Home surfaces (Task 2) ✓; List/Board/Table (Task 3) ✓; Detail blocks centralized (Task 4) ✓; density normalization (Task 4) ✓; overlays keep shadow (Task 1 leaves `--shadow-lg`; verified Task 4) ✓; light+dark + mobile overflow verification (Task 4) ✓; no `tokens.css` edits ✓.
- **Placeholder scan:** none — every step has concrete CSS and commands. The only conditional ("if the AI band is a distinct class") names the exact declarations to apply, so it is not a placeholder.
- **Type/selector consistency:** `--block-line` / `--block-radius` used identically across Tasks 1-4; `rgb(22, 25, 29)` is the consistent computed form of `#16191D`.
