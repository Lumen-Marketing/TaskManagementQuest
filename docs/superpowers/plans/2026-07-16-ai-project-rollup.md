# AI Per-Project Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand AI rollup that summarizes where a single project stands, surfaced in the ProjectsView folder drawer.

**Architecture:** Mirror the existing `weekly_digest` feature end to end — a pure `lib/rollup.mjs` (context + shape + fallback), a fifth `project_rollup` action on the `ai-assistant` edge fn that RLS-fetches one project's tasks, a `RollupClient` with a session-only in-memory cache, and a `.pv-rollup` strip in the ProjectsView drawer. AI never writes to the DB.

**Tech Stack:** Zero-build static SPA (vanilla JS, global `App` namespace, `window.App = window.App || {}`), Supabase Edge Function (Deno + esm.sh), Groq Llama 3.3 70B, node `--test` for unit tests, Playwright for preview verification.

**Spec:** `docs/superpowers/specs/2026-07-16-ai-project-rollup-design.md`

## Global Constraints

- Pure fn modules are `.mjs` under `supabase/functions/ai-assistant/lib/`, imported by BOTH the Deno fn and the node `--test` suite. No I/O, no globals in them.
- Client files are plain classes on the `App` global; start each with `window.App = window.App || {};`. NO ES module `export`/`import` in client `js/` files, NO static class fields — attach shared state after the class body (e.g. `App.RollupClient.cache = new Map();`).
- AI code path must **degrade, never throw** to the user: fn returns a deterministic fallback on any Groq failure; client returns `{ ok:false, error }` and never throws.
- Tasks column for project is `project_id`; for company is `company_id`; for the lead assignee is `assignee_id`. The client maps `project_id` → `task.project`.
- Design-taste rule: **NO borders** on the rollup UI — color + spacing only. Reuse the `--ink / --ink-2 / --ink-3 / --bg-3 / --amber` token family (there is NO `--ink-1`). Orange is `#ED4E0D`. No emojis. Must not cause horizontal overflow at 390px.
- Run the unit suite with the glob form on Windows: `npm run test:unit` (which is `node --test "tests/unit/*.test.mjs"`).
- Stage explicit paths on commit — NEVER `git add -A` or `git add .` in this checkout.
- Fn deploys from repo source via the Supabase MCP `deploy_edge_function` — NEVER a paste bundle (it is dead and drift-prone). Not part of these tasks; done at ship time.
- Work happens on branch `feat/ai-project-rollup` in worktree `.claude/worktrees/ai-project-rollup`. Verify the branch before each commit.

---

### Task 1: Pure `lib/rollup.mjs` — context + shape + fallback

**Files:**
- Create: `supabase/functions/ai-assistant/lib/rollup.mjs`
- Test: `tests/unit/rollup-context.test.mjs`
- Test: `tests/unit/rollup-shape.test.mjs`

**Interfaces:**
- Produces: `buildRollupContext(tasks, { today, projectName?, windowDays?, maxItems? }) → { today, projectName, counts: { total, done, slipped, coming, open }, pct, lines: string[] }`
- Produces: `fallbackRollup(ctx) → { text, bullets: [{ taskId: null, label }], source: 'fallback' }`
- Produces: `shapeRollup(modelText, ctx) → { text, bullets, source: 'model' | 'fallback' }`
- Each `tasks[]` item shape: `{ id, title, company, due, status, completedAt }` (mapped from DB rows by the fn).

- [ ] **Step 1: Write the failing tests** (`tests/unit/rollup-context.test.mjs`)

```javascript
// tests/unit/rollup-context.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRollupContext, fallbackRollup } from '../../supabase/functions/ai-assistant/lib/rollup.mjs';

const TODAY = '2026-07-15'; // window: 2026-07-08 .. 2026-07-22
const mk = (o) => ({ id: o.id || 't', title: o.title || 'T', company: o.company || 'Lumen', due: o.due ?? null, status: o.status || 'todo', completedAt: o.completedAt ?? null });

test('percent complete is done / total, rounded', () => {
  const ctx = buildRollupContext([
    mk({ status: 'done', completedAt: '2026-07-10' }),
    mk({ status: 'todo' }),
    mk({ status: 'todo' }),
  ], { today: TODAY });
  assert.equal(ctx.counts.total, 3);
  assert.equal(ctx.pct, 33); // 1/3
});

test('empty project → 0% and empty lines, no throw', () => {
  const ctx = buildRollupContext([], { today: TODAY, projectName: 'Empty' });
  assert.equal(ctx.pct, 0);
  assert.equal(ctx.counts.total, 0);
  assert.deepEqual(ctx.lines, []);
  assert.equal(ctx.projectName, 'Empty');
});

test('partitions done / slipped / coming / open within the window', () => {
  const ctx = buildRollupContext([
    mk({ title: 'done-in',  status: 'done', completedAt: '2026-07-10' }),
    mk({ title: 'done-out', status: 'done', completedAt: '2026-07-01' }), // >7d ago → not "done this week"
    mk({ title: 'slipped',  due: '2026-07-10' }),                          // open, due<today, within week
    mk({ title: 'today',    due: '2026-07-15' }),                          // open, due today → coming
    mk({ title: 'coming',   due: '2026-07-20' }),                          // open, within +7
    mk({ title: 'far',      due: '2026-07-30' }),                          // beyond +7 → excluded from lines
    mk({ title: 'nodate' }),                                               // open, no due → open bucket
  ], { today: TODAY });
  assert.deepEqual(ctx.counts, { total: 7, done: 1, slipped: 1, coming: 2, open: 1 });
});

test('lines ordered slipped, coming, open, done and labeled', () => {
  const ctx = buildRollupContext([
    mk({ title: 'D', status: 'done', completedAt: '2026-07-12' }),
    mk({ title: 'C', due: '2026-07-18' }),
    mk({ title: 'S', due: '2026-07-09' }),
    mk({ title: 'O' }),
  ], { today: TODAY });
  assert.equal(ctx.lines[0], 'SLIPPED · S · Lumen · was due 2026-07-09');
  assert.equal(ctx.lines[1], 'DUE 2026-07-18 · C · Lumen');
  assert.equal(ctx.lines[2], 'OPEN · O · Lumen');
  assert.equal(ctx.lines[3], 'DONE · D · Lumen');
});

test('fallbackRollup names the project and its percent', () => {
  const ctx = buildRollupContext([
    mk({ status: 'done', completedAt: '2026-07-10' }),
    mk({ due: '2026-07-09' }),
  ], { today: TODAY, projectName: 'Roof A' });
  const fb = fallbackRollup(ctx);
  assert.equal(fb.source, 'fallback');
  assert.match(fb.text, /^Roof A:/);
  assert.match(fb.text, /50% complete/);
});

test('fallbackRollup handles the empty project', () => {
  const ctx = buildRollupContext([], { today: TODAY, projectName: 'Empty' });
  const fb = fallbackRollup(ctx);
  assert.equal(fb.text, 'Empty has no tasks yet.');
  assert.deepEqual(fb.bullets, []);
});
```

Also (`tests/unit/rollup-shape.test.mjs`):

```javascript
// tests/unit/rollup-shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeRollup, fallbackRollup, buildRollupContext } from '../../supabase/functions/ai-assistant/lib/rollup.mjs';

const ctx = buildRollupContext([
  { id: 'a', title: 'A', company: 'Lumen', due: '2026-07-09', status: 'todo', completedAt: null },
], { today: '2026-07-15', projectName: 'P' });

test('splits narrative from bullet lines', () => {
  const out = shapeRollup('The project is halfway done.\n- Ship A\n- Fix B', ctx);
  assert.equal(out.source, 'model');
  assert.equal(out.text, 'The project is halfway done.');
  assert.deepEqual(out.bullets.map((b) => b.label), ['Ship A', 'Fix B']);
});

test('caps bullets at 3 and accepts *, •, numbered', () => {
  const out = shapeRollup('Summary.\n* one\n• two\n3) three\n- four', ctx);
  assert.equal(out.bullets.length, 3);
});

test('empty / whitespace model text → fallback', () => {
  assert.equal(shapeRollup('', ctx).source, 'fallback');
  assert.equal(shapeRollup('   \n  ', ctx).source, 'fallback');
  assert.equal(shapeRollup(null, ctx).source, 'fallback');
});

test('bullets-only model text uses first bullet as text', () => {
  const out = shapeRollup('- only a bullet', ctx);
  assert.equal(out.source, 'model');
  assert.equal(out.text, 'only a bullet');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- --test-name-pattern="rollup"` (or just `npm run test:unit`)
Expected: FAIL — `Cannot find module '.../lib/rollup.mjs'`.

- [ ] **Step 3: Write `supabase/functions/ai-assistant/lib/rollup.mjs`**

```javascript
// supabase/functions/ai-assistant/lib/rollup.mjs
// Pure: summarize ONE project's tasks into a "where does it stand" rollup
// context — percent complete plus a done/slipped/coming/open partition — with
// model-text shaping and a deterministic fallback. No I/O, no globals. Modeled
// on lib/digest.mjs; helpers are copied locally to keep the module self-contained.
const DONE = new Set(['done', 'complete', 'completed']);
const trunc = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) : t; };
const isDone = (t) => !!t.completedAt || DONE.has(String(t.status || '').toLowerCase());

// Shift a YYYY-MM-DD string by whole days using UTC math (no TZ drift).
function shiftISO(dateISO, days) {
  const [y, m, d] = String(dateISO).split('-').map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function buildRollupContext(tasks, opts) {
  const { today, projectName = '', windowDays = 7, maxItems = 25 } = opts || {};
  const weekAgo = shiftISO(today, -windowDays);
  const weekAhead = shiftISO(today, windowDays);
  const list = (tasks || []).filter(Boolean);

  const total = list.length;
  const doneAll = list.filter(isDone);
  const pct = total ? Math.round((doneAll.length / total) * 100) : 0;

  const done = doneAll.filter((t) => {
    if (!t.completedAt) return false;
    const d = String(t.completedAt).slice(0, 10);
    return d >= weekAgo && d <= today;
  });
  const slipped = list.filter((t) => !isDone(t) && t.due && t.due >= weekAgo && t.due < today);
  const coming = list.filter((t) => !isDone(t) && t.due && t.due >= today && t.due <= weekAhead);
  const openNoDate = list.filter((t) => !isDone(t) && !t.due);

  const counts = { total, done: done.length, slipped: slipped.length, coming: coming.length, open: openNoDate.length };

  const byDue = (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'));
  const lines = [];
  slipped.slice().sort(byDue).forEach((t) => lines.push(`SLIPPED · ${trunc(t.title, 80)} · ${t.company || '—'} · was due ${t.due}`));
  coming.slice().sort(byDue).forEach((t) => lines.push(`DUE ${t.due} · ${trunc(t.title, 80)} · ${t.company || '—'}`));
  openNoDate.slice().forEach((t) => lines.push(`OPEN · ${trunc(t.title, 80)} · ${t.company || '—'}`));
  done.slice().forEach((t) => lines.push(`DONE · ${trunc(t.title, 80)} · ${t.company || '—'}`));

  return { today, projectName, counts, pct, lines: lines.slice(0, maxItems) };
}

function pluralize(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

export function fallbackRollup(ctx) {
  const c = (ctx && ctx.counts) || { total: 0, done: 0, slipped: 0, coming: 0, open: 0 };
  const pct = (ctx && typeof ctx.pct === 'number') ? ctx.pct : 0;
  const name = (ctx && ctx.projectName) || 'This project';
  if (!c.total) return { text: `${name} has no tasks yet.`, bullets: [], source: 'fallback' };
  const parts = [`${pct}% complete`];
  if (c.done) parts.push(`${pluralize(c.done, 'task')} done this week`);
  if (c.slipped) parts.push(`${c.slipped} slipped`);
  if (c.coming) parts.push(`${c.coming} due in the next 7 days`);
  if (c.open) parts.push(`${c.open} open with no date`);
  const text = `${name}: ${parts.join(', ')}.`;
  const bullets = ((ctx && ctx.lines) || []).slice(0, 3).map((l) => ({ taskId: null, label: l }));
  return { text, bullets, source: 'fallback' };
}

export function shapeRollup(modelText, ctx) {
  if (typeof modelText !== 'string' || !modelText.trim()) return fallbackRollup(ctx);
  const lines = modelText.split('\n').map((l) => l.trim()).filter(Boolean);
  const isBullet = (l) => /^([-*•]|\d+[.)])\s+/.test(l);
  const bulletLines = lines.filter(isBullet).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ''));
  const narrative = lines.filter((l) => !isBullet(l)).join(' ').trim();
  if (!narrative && !bulletLines.length) return fallbackRollup(ctx);
  const bullets = bulletLines.slice(0, 3).map((label) => ({ taskId: null, label }));
  return { text: narrative || bulletLines[0], bullets, source: 'model' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS — all `rollup-context` and `rollup-shape` tests green, existing suite still green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/lib/rollup.mjs tests/unit/rollup-context.test.mjs tests/unit/rollup-shape.test.mjs
git commit -m "feat(rollup): pure lib for per-project AI rollup context + shape + fallback"
```

---

### Task 2: `project_rollup` action on the `ai-assistant` edge fn

**Files:**
- Modify: `supabase/functions/ai-assistant/index.ts` (add import, action allow-list, cap constant + usage map, and the action block)

**Interfaces:**
- Consumes: `buildRollupContext`, `shapeRollup`, `fallbackRollup` from `./lib/rollup.mjs` (Task 1).
- Produces (HTTP): request `{ action: "project_rollup", projectId, projectName, today }` → response `{ ok: true, rollup, generatedAt }` (200; `rollup` is the shape from Task 1). 429 on cap, 500 on DB error.

- [ ] **Step 1: Add the import** — after the existing `digest.mjs` import (around line 29):

```typescript
import { buildRollupContext, shapeRollup, fallbackRollup } from "./lib/rollup.mjs";
```

- [ ] **Step 2: Add the cap constant + usage map** — after the `digestUsage` declaration (around line 54):

```typescript
const ROLLUP_DAILY_CAP = 30; // on-demand, client-cached per session — real volume is small
const rollupUsage = new Map<string, { day: string; n: number }>();
```

- [ ] **Step 3: Extend the action allow-list** — replace the existing action check:

```typescript
    if (action !== "briefing" && action !== "draft_task" && action !== "chat" && action !== "weekly_digest" && action !== "project_rollup") {
      return json(req, { error: "Unknown action." }, 400);
    }
```

- [ ] **Step 4: Add the action block** — insert immediately AFTER the `weekly_digest` block's closing `}` (after its `return json(req, { ok: true, digest, ... })`) and BEFORE the `// -------- briefing (existing)` comment:

```typescript
    // -------- project_rollup: RLS-scoped one-project status summary ---------
    if (action === "project_rollup") {
      const rday = new Date().toISOString().slice(0, 10);
      const ru = rollupUsage.get(uid);
      const rn = ru && ru.day === rday ? ru.n : 0;
      if (rn >= ROLLUP_DAILY_CAP) return json(req, { error: "Daily rollup limit reached. Try again tomorrow." }, 429);
      rollupUsage.set(uid, { day: rday, n: rn + 1 });

      const rp = payload as { projectId?: unknown; projectName?: unknown; today?: unknown };
      const projectId = typeof rp.projectId === "string" ? rp.projectId : "";
      const projectName = (typeof rp.projectName === "string" ? rp.projectName : "").slice(0, 120);
      const today = typeof rp.today === "string" ? rp.today : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());
      // Guard the id before it goes into the .eq() filter (defensive; mirrors the
      // briefing's safeMember). A bad/empty id yields an empty fallback, no query.
      const safeProject = /^[A-Za-z0-9_-]+$/.test(projectId) ? projectId : null;
      if (!safeProject) {
        const emptyCtx = buildRollupContext([], { today, projectName });
        return json(req, { ok: true, rollup: fallbackRollup(emptyCtx), generatedAt: new Date().toISOString() });
      }

      // No assignee filter — RLS bounds the rows to what the caller may read.
      const { data: rrows, error: rErr } = await userClient
        .from("tasks")
        .select("id,title,company_id,due,status,priority,assignee_id,completed_at")
        .eq("project_id", safeProject)
        .order("due", { ascending: true })
        .limit(200);
      if (rErr) {
        console.error("[ai-assistant] rollup fetch failed", rErr);
        return json(req, { error: "Could not load project tasks." }, 500);
      }
      const rtasks = (rrows ?? []).map((r: any) => ({
        id: r.id, title: r.title, company: r.company_id, due: r.due,
        status: r.status, completedAt: r.completed_at,
      }));
      const rctx = buildRollupContext(rtasks, { today, projectName, windowDays: 7 });

      const rsys = "You are a concise task assistant writing a status rollup for a single project. In 2 to 4 sentences, say how far along the project is (use the percent complete), what got done recently, what has slipped, and what is coming up, then up to 3 short bullet lines each naming one specific task. Only reference tasks in the provided context. Plain text, no emojis, no markdown headings.";
      const rusr = `Today is ${today}.\nProject: ${projectName || "(unnamed)"}\nPercent complete: ${rctx.pct}%\nCounts: ${JSON.stringify(rctx.counts)}\nItems:\n${rctx.lines.join("\n") || "(none)"}`;

      let rollup;
      try {
        const res = await fetch(GROQ_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: GROQ_MODEL, temperature: 0.4, max_tokens: 350,
            messages: [{ role: "system", content: rsys }, { role: "user", content: rusr }],
          }),
        });
        if (!res.ok) {
          console.error("[ai-assistant] rollup provider rejected", { status: res.status });
          rollup = fallbackRollup(rctx);
        } else {
          const data = await res.json().catch(() => ({}));
          const text = data?.choices?.[0]?.message?.content ?? "";
          rollup = shapeRollup(text, rctx);
        }
      } catch (e) {
        console.error("[ai-assistant] rollup fetch threw", e);
        rollup = fallbackRollup(rctx);
      }
      return json(req, { ok: true, rollup, generatedAt: new Date().toISOString() });
    }
```

- [ ] **Step 5: Verify the wiring (no Deno/TS test harness exists for the fn — self-check by grep + re-run the lib suite)**

Run: `grep -n "project_rollup\|rollup.mjs\|ROLLUP_DAILY_CAP\|buildRollupContext" supabase/functions/ai-assistant/index.ts`
Expected: the import line, the allow-list entry, the cap constant, the `if (action === "project_rollup")` block, and the `buildRollupContext([]` guard branch all present.

Run: `npm run test:unit`
Expected: PASS — the lib suite proves the imported functions behave; nothing regressed.

> Real end-to-end verification is the deploy smoke test at ship time (POST with the ANON key as Bearer → expect the fn's own `{"error":"Not signed in."}` rather than a gateway/boot error, proving the module graph — including `rollup.mjs` — loaded). That is a deploy step, not part of this task.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ai-assistant/index.ts
git commit -m "feat(rollup): add project_rollup action to ai-assistant fn"
```

---

### Task 3: `RollupClient` + datastore method + preview stub + script tag

**Files:**
- Create: `js/services/RollupClient.js`
- Test: `tests/unit/rollupclient.test.mjs`
- Modify: `js/services/SupabaseDataStore.js` (add `projectRollup` after `getWeeklyDigest`, ~line 743)
- Modify: `js/app.js` (add preview stub after the `getWeeklyDigest` stub, ~line 57)
- Modify: `app.html` (add script tag after `ChatClient.js`, ~line 284)

**Interfaces:**
- Consumes: `dataStore.projectRollup({ projectId, projectName, today }) → { ok, rollup?, generatedAt?, error? }`.
- Produces: `App.RollupClient` class with static `get(id) / set(id, value) / clear(id) / guard(rollup)` and static `cache` (a `Map`); instance `fetch(projectId, projectName, { force }) → { rollup, generatedAt, fromCache } | { rollup: null, error }`. Cache entry value shape: `{ rollup, generatedAt }`.

- [ ] **Step 1: Write the failing test** (`tests/unit/rollupclient.test.mjs`)

```javascript
// tests/unit/rollupclient.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/services/RollupClient.js');
const RC = global.App.RollupClient;

test('guard rejects empty text / non-array bullets', () => {
  assert.equal(RC.guard(null), null);
  assert.equal(RC.guard({ text: '', bullets: [] }), null);
  assert.equal(RC.guard({ text: 'hi', bullets: 'no' }), null);
  assert.deepEqual(RC.guard({ text: 'hi', bullets: [] }), { text: 'hi', bullets: [] });
});

test('cache set / get / clear round-trips per project id', () => {
  RC.cache.clear();
  assert.equal(RC.get('proj-a'), null);
  const entry = { rollup: { text: 'x', bullets: [] }, generatedAt: '2026-07-16T00:00:00Z' };
  RC.set('proj-a', entry);
  assert.deepEqual(RC.get('proj-a'), entry);
  assert.equal(RC.get('proj-b'), null); // isolated per id
  RC.clear('proj-a');
  assert.equal(RC.get('proj-a'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../js/services/RollupClient.js'`.

- [ ] **Step 3: Write `js/services/RollupClient.js`**

```javascript
// js/services/RollupClient.js
// Client wrapper around the ai-assistant "project_rollup" action: a SESSION-ONLY
// in-memory cache keyed by project id (no localStorage — rollups are on-demand and
// projects change often) plus a defensive response guard. Statics are pure so they
// can be unit-tested under node.
window.App = window.App || {};

App.RollupClient = class RollupClient {
  constructor({ dataStore }) { this.dataStore = dataStore; }

  static get(id) { return RollupClient.cache.get(id) || null; }
  static set(id, value) { RollupClient.cache.set(id, value); }
  static clear(id) { RollupClient.cache.delete(id); }

  static guard(rollup) {
    if (!rollup || typeof rollup !== 'object') return null;
    if (typeof rollup.text !== 'string' || !rollup.text.trim()) return null;
    if (!Array.isArray(rollup.bullets)) return null;
    return rollup;
  }

  // Returns { rollup, generatedAt, fromCache } or { rollup: null, error }. Never throws.
  async fetch(projectId, projectName, { force = false } = {}) {
    if (!force) {
      const hit = RollupClient.get(projectId);
      if (hit && RollupClient.guard(hit.rollup)) return { ...hit, fromCache: true };
    }
    let res;
    try { res = await this.dataStore.projectRollup({ projectId, projectName, today: App.utils.todayISO(0) }); }
    catch (err) { return { rollup: null, error: (err && err.message) || String(err) }; }
    if (!res || !res.ok) return { rollup: null, error: (res && res.error) || 'AI unavailable.' };
    const rollup = RollupClient.guard(res.rollup);
    if (!rollup) return { rollup: null, error: 'AI returned nothing usable.' };
    const entry = { rollup, generatedAt: res.generatedAt || null };
    RollupClient.set(projectId, entry);
    return { ...entry, fromCache: false };
  }
};

// Session-lived cache (no static class fields in this zero-build SPA).
App.RollupClient.cache = new Map();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS — `rollupclient` tests green.

- [ ] **Step 5: Add `projectRollup` to `SupabaseDataStore.js`** — insert immediately after the `getWeeklyDigest()` method (after its closing `}`, ~line 743):

```javascript
  /* Per-project AI rollup via the ai-assistant Edge Function. Returns
     { ok, rollup?, generatedAt?, error? } and never throws so the Projects
     drawer degrades gracefully. */
  async projectRollup({ projectId, projectName, today }) {
    try {
      const { data, error } = await this.supabase.functions.invoke('ai-assistant', {
        body: { action: 'project_rollup', projectId, projectName, today },
      });
      if (error) {
        const status = (error.context && error.context.status) || null;
        let msg = (error && error.message) || 'AI unavailable.';
        try { const body = await error.context.json(); if (body && body.error) msg = body.error; }
        catch (_e) { /* body already consumed or not JSON */ }
        return { ok: false, status, error: msg };
      }
      return { ok: true, rollup: data && data.rollup, generatedAt: data && data.generatedAt };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }
```

- [ ] **Step 6: Add the preview stub to `js/app.js`** — after the `getWeeklyDigest` stub line:

```javascript
        projectRollup: async () => ({ ok: false, error: 'AI project rollup is not available in preview mode.' }),
```

- [ ] **Step 7: Add the script tag to `app.html`** — after the `ChatClient.js` tag:

```html
<script defer src="js/services/RollupClient.js"></script>
```

- [ ] **Step 8: Re-run the full suite**

Run: `npm run test:unit`
Expected: PASS — nothing regressed.

- [ ] **Step 9: Commit**

```bash
git add js/services/RollupClient.js tests/unit/rollupclient.test.mjs js/services/SupabaseDataStore.js js/app.js app.html
git commit -m "feat(rollup): RollupClient cache + datastore method + preview stub + script tag"
```

---

### Task 4: `.pv-rollup` strip in the ProjectsView drawer + CSS

**Files:**
- Modify: `js/views/ProjectsView.js` (constructor state; `_row` drawer; new `_rollupHtml`, `_fmtWhen`, `_generateRollup`; `_renderBody` handlers)
- Modify: `taskmanagement.css` (append `.pv-rollup*` rules)

**Interfaces:**
- Consumes: `App.RollupClient` (Task 3), `this.controller.dataStore`, `App.projects`.
- Produces: no external interface — internal view behavior only.

- [ ] **Step 1: Add rollup state to the constructor** — in `ProjectsView` constructor, after `this._seenDone = new Set();`:

```javascript
    this._rollupState = new Map(); // projectId → 'idle' | 'loading' | 'error'
    this._rollupErr = new Map();   // projectId → error string
    this._rollupClient = null;     // lazily created App.RollupClient
```

- [ ] **Step 2: Render the strip inside the open drawer** — in `_row(p)`, replace the `if (open) { ... }` drawer block with:

```javascript
    let drawer = '';
    if (open) {
      const tasks = this._folderTasks(p.id);
      drawer = this._rollupHtml(p) + `<div class="pv-tasks">${tasks.length
        ? tasks.map(t => this._taskRow(t)).join('')
        : '<div class="pv-noTasks">No tasks in this project yet.</div>'}</div>`;
    }
```

- [ ] **Step 3: Add `_rollupHtml`, `_fmtWhen`, `_generateRollup`** — add these methods to the class (e.g. after `_taskRow`):

```javascript
  // Rollup strip for an expanded folder. Reads live state + the session cache
  // so re-expanding a folder shows a prior summary immediately.
  _rollupHtml(p) {
    const esc = App.utils.escapeHtml;
    const state = this._rollupState.get(p.id) || 'idle';
    const cached = App.RollupClient && App.RollupClient.get(p.id);
    if (state === 'loading') {
      return `<div class="pv-rollup" data-rollup-for="${esc(p.id)}">
        <div class="pv-rollup-skel"></div><div class="pv-rollup-skel short"></div></div>`;
    }
    if (state === 'error') {
      const msg = this._rollupErr.get(p.id) || 'Summary unavailable.';
      return `<div class="pv-rollup" data-rollup-for="${esc(p.id)}">
        <div class="pv-rollup-line">${esc(msg)}</div>
        <button class="pv-rollup-btn" data-rollup="${esc(p.id)}" type="button"><i class="ti ti-sparkles"></i> Try again</button></div>`;
    }
    if (cached && cached.rollup) {
      const r = cached.rollup;
      const bullets = (r.bullets || []).slice(0, 3).map(b => `<li>${esc(b.label)}</li>`).join('');
      const when = cached.generatedAt ? this._fmtWhen(cached.generatedAt) : '';
      return `<div class="pv-rollup" data-rollup-for="${esc(p.id)}">
        <div class="pv-rollup-head">
          <span class="pv-rollup-eyebrow"><i class="ti ti-sparkles"></i> AI rollup</span>
          <button class="pv-rollup-refresh" data-rollup-refresh="${esc(p.id)}" type="button" aria-label="Refresh summary" title="Refresh"><i class="ti ti-refresh"></i></button>
        </div>
        <div class="pv-rollup-text">${esc(r.text)}</div>
        ${bullets ? `<ul class="pv-rollup-bullets">${bullets}</ul>` : ''}
        ${when ? `<div class="pv-rollup-when">${esc(when)}</div>` : ''}</div>`;
    }
    return `<div class="pv-rollup" data-rollup-for="${esc(p.id)}">
      <button class="pv-rollup-btn" data-rollup="${esc(p.id)}" type="button"><i class="ti ti-sparkles"></i> Summarize this project</button></div>`;
  }

  _fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return 'Updated ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // Fetch (or refresh) the rollup for one project, driving the strip through
  // loading → cached/error. Result lands in App.RollupClient.cache.
  _generateRollup(id, force = false) {
    if (!App.RollupClient || !this.controller.dataStore) {
      this._rollupState.set(id, 'error');
      this._rollupErr.set(id, 'AI is not available.');
      this._renderBody();
      return;
    }
    const p = (App.projects || {})[id];
    const name = (p && p.name) || '';
    this._rollupState.set(id, 'loading');
    this._renderBody();
    const client = this._rollupClient || (this._rollupClient = new App.RollupClient({ dataStore: this.controller.dataStore }));
    client.fetch(id, name, { force }).then((r) => {
      if (r.rollup) { this._rollupState.set(id, 'idle'); this._rollupErr.delete(id); }
      else { this._rollupState.set(id, 'error'); this._rollupErr.set(id, r.error || 'Summary unavailable.'); }
      if (this._visible()) this._renderBody();
    });
  }
```

- [ ] **Step 4: Wire the buttons in `_renderBody`** — add after the existing `host.querySelectorAll('.pv-chev')...` handler block:

```javascript
    host.querySelectorAll('[data-rollup]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._generateRollup(btn.dataset.rollup); }));
    host.querySelectorAll('[data-rollup-refresh]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._generateRollup(btn.dataset.rollupRefresh, true); }));
```

- [ ] **Step 5: Append CSS to `taskmanagement.css`**

```css
/* --- Projects: per-project AI rollup strip (drawer) --------------------- */
.pv-rollup { margin: 2px 0 8px; padding: 12px 14px; border-radius: 12px; background: var(--bg-3, rgba(0,0,0,.035)); }
.pv-rollup-btn { display: inline-flex; align-items: center; gap: 7px; font: inherit; font-weight: 600; font-size: 13px; color: var(--amber, #ED4E0D); background: none; border: 0; cursor: pointer; padding: 2px 0; }
.pv-rollup-btn i { font-size: 15px; }
.pv-rollup-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.pv-rollup-eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--amber, #ED4E0D); }
.pv-rollup-eyebrow i { font-size: 13px; }
.pv-rollup-refresh { margin-left: auto; background: none; border: 0; color: var(--ink-3, #8f867b); cursor: pointer; padding: 2px; line-height: 0; }
.pv-rollup-refresh:hover { color: var(--amber, #ED4E0D); }
.pv-rollup-text { font-size: 13px; line-height: 1.5; color: var(--ink, #2a2723); white-space: pre-wrap; }
.pv-rollup-bullets { margin: 6px 0 0; padding-left: 18px; }
.pv-rollup-bullets li { font-size: 12.5px; line-height: 1.45; color: var(--ink-2, #55504a); }
.pv-rollup-when { margin-top: 6px; font-size: 11px; color: var(--ink-3, #8f867b); }
.pv-rollup-line { font-size: 12.5px; color: var(--ink-3, #8f867b); margin-bottom: 6px; }
.pv-rollup-skel { height: 11px; border-radius: 6px; margin: 4px 0; background: linear-gradient(90deg, var(--bg-3, #ececec) 25%, rgba(0,0,0,.06) 37%, var(--bg-3, #ececec) 63%); background-size: 400% 100%; animation: pv-rollup-shimmer 1.2s ease infinite; }
.pv-rollup-skel.short { width: 60%; }
@keyframes pv-rollup-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) { .pv-rollup-skel { animation: none; } }
```

- [ ] **Step 6: Verify in the preview harness (Playwright)**

Render the app preview, navigate to Projects, expand a folder, and confirm the strip. Per the screenshot-harness reference: use the chromium-1223 executablePath. Steps to confirm:
  1. `App.controller.setView('projects')` renders the Projects page; dismiss `.tour-root` first if present (it intercepts clicks).
  2. Expand a folder (click its `.pv-chev`) → a `.pv-rollup` strip with a "Summarize this project" button appears above `.pv-tasks`.
  3. Click `[data-rollup]` → strip shows the skeleton, then (preview stub returns `ok:false`) the error line + a "Try again" button. This confirms the loading + degrade paths render.
  4. At 390px width there is no horizontal overflow; the strip has no border (color + spacing only).

Expected: strip renders, generate shows skeleton→degrade, no mobile overflow. (The success path — real AI text — cannot be exercised in preview because the stub is offline; that is verified live after fn deploy, exactly as the digest was.)

- [ ] **Step 7: Run the full unit suite once more**

Run: `npm run test:unit`
Expected: PASS — full suite green (≈ +12 tests from Tasks 1 & 3).

- [ ] **Step 8: Commit**

```bash
git add js/views/ProjectsView.js taskmanagement.css
git commit -m "feat(rollup): AI rollup strip in the ProjectsView folder drawer"
```

---

## Post-implementation (not tasks — ship-time notes)

- **Deploy the fn** from repo source via the Supabase MCP `deploy_edge_function` (files `index.ts` + `lib/*.mjs`, entrypoint `index.ts`, verify_jwt TRUE). Smoke-check by POSTing with the ANON key as Bearer → expect the fn's own `{"error":"Not signed in."}`. NEVER a paste bundle.
- **Client** ships via merge → Vercel auto-deploy. Fails safe until the fn is redeployed (the strip shows the client-side fallback/error line).
- **Live QA:** owner expands a project, clicks Summarize, sees a real AI rollup naming that project's tasks; refresh regenerates; a project with no dated tasks still summarizes (the `open` bucket).
- Update the `project_ai_assistant_program` memory: Phase 4b per-project rollup shipped.

## Self-Review notes

- **Spec coverage:** backend action (Task 2) ✓, pure `lib/rollup.mjs` with pct + openNoDate (Task 1) ✓, `RollupClient` session cache + datastore + stub + tag (Task 3) ✓, drawer UI strip + CSS reusing `.qhq-brief` tokens, no borders (Task 4) ✓, ~12 unit tests (Tasks 1 & 3) ✓, deploy-via-MCP note ✓. Non-goals respected: no localStorage, on-demand only, no assignee breakdown, no writes.
- **Type consistency:** rollup shape `{ text, bullets:[{taskId,label}], source }` and context `{ today, projectName, counts:{total,done,slipped,coming,open}, pct, lines }` used identically across fn (Task 2), client guard (Task 3), and UI (Task 4). Cache entry `{ rollup, generatedAt }` consistent between `RollupClient.fetch` and `_rollupHtml`. Method names `buildRollupContext/shapeRollup/fallbackRollup`, `projectRollup`, `_rollupHtml/_generateRollup/_fmtWhen` consistent throughout.
