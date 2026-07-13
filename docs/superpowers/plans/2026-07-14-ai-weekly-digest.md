# AI Weekly Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Today | This week` toggle on the Home briefing card whose "This week" mode shows an AI weekly digest — what got done, what slipped, and what's coming over a 7-back/7-ahead window, scoped to everything the viewer can see.

**Architecture:** A new `weekly_digest` action on the deployed `ai-assistant` edge function fetches the caller's RLS-visible tasks (no assignee filter), a pure `buildDigestContext` module partitions them into done/slipped/coming, Groq writes a short recap, and a deterministic `fallbackDigest` covers any provider failure. A browser-global `DigestClient` caches the result per Phoenix week; `HomeView` renders it inside the existing `.qhq-brief` card behind a toggle. Read-only throughout.

**Tech Stack:** Deno (edge function, TypeScript), pure ESM `.mjs` for shared server logic, browser-global vanilla JS client (zero-build), `node --test` unit tests, Supabase JS v2, Groq/Llama 3.3 70B.

## Global Constraints

- Zero-build static SPA — no framework/bundler. Client JS attaches to `window.App`, loaded via `<script defer>` in `app.html`.
- `App.supabase` is ready only after `await App.configReady`; never hardcode URL/key.
- Read-only: the digest never writes to the DB. The only persistence is the client-side per-week localStorage cache.
- Scope is RLS-only: the `weekly_digest` fetch runs under the caller's JWT with NO `assignee_id` filter, so the rows returned are exactly what the caller may read (owner→company, worker→own).
- Window is fixed: 7 days back / 7 days ahead. `done` = `completedAt` in `[today-7, today]`; `slipped` = open & `due` in `[today-7, today)`; `coming` = open & `due` in `[today, today+7]`.
- Reuse the provider seam already in `ai-assistant/index.ts` (`GROQ_ENDPOINT`, `GROQ_MODEL`). No new secrets.
- HQ "today" comes from `App.utils.todayISO(0)` (America/Phoenix).
- The digest result shape MATCHES the briefing: `{ text: string, bullets: [{taskId, label}], source }`.
- Unit tests: `npm run test:unit` → `node --test "tests/unit/*.test.mjs"`. Pure server modules live under the function dir as `.mjs` imported directly; client modules use the `global.window`/`global.App` stub + `require()` pattern (see `tests/unit/briefing-cache.test.mjs`).
- Target Supabase project is PROD `qqvmcsvdxhgjooirznrj` (Quest HQ) — never `rqundirizvojpzhljtdn`.
- The function is deployed by a non-technical user via the dashboard single-file bundle `PASTE-INTO-SUPABASE-DASHBOARD.ts` (repo root). Any `index.ts` change must be mirrored into that bundle.
- NEVER `git add -A` / `git add .` in this checkout — stage only the explicit paths each task names.

## File Structure

- `supabase/functions/ai-assistant/lib/digest.mjs` — **pure.** `buildDigestContext`, `shapeDigest`, `fallbackDigest`.
- `supabase/functions/ai-assistant/index.ts` — add `weekly_digest` dispatch branch (modify).
- `PASTE-INTO-SUPABASE-DASHBOARD.ts` — mirror the branch + inline the three digest helpers (modify).
- `js/services/DigestClient.js` — browser-global `App.DigestClient`: `weekKey`/`cacheKey`/`readCache`/`writeCache`/`guard` statics + instance `get`.
- `js/services/SupabaseDataStore.js` — add `getWeeklyDigest()` (modify).
- `js/app.js` — preview-mode `getWeeklyDigest` stub (modify).
- `app.html` — `<script defer src="js/services/DigestClient.js">` (modify).
- `js/views/HomeView.js` — toggle in `_briefingCardHtml()` + `_fetchDigest` + bindings (modify).
- `taskmanagement.css` — `.qhq-brief-seg` toggle styles (modify).
- Tests: `tests/unit/digest-context.test.mjs`, `tests/unit/digest-client.test.mjs`.

---

## Task 1: Pure `digest.mjs` (context + shape + fallback)

**Files:**
- Create: `supabase/functions/ai-assistant/lib/digest.mjs`
- Test: `tests/unit/digest-context.test.mjs`

**Interfaces:**
- Produces:
  - `buildDigestContext(tasks, { today, windowDays = 7, maxItems = 25 }) -> { today, counts: { done, slipped, coming }, lines: string[] }`
  - `shapeDigest(modelText, ctx) -> { text, bullets: [{taskId, label}], source }`
  - `fallbackDigest(ctx) -> { text, bullets, source: 'fallback' }`
  - Task shape consumed: `{ id, title, company, due, status, completedAt }` (due/completedAt are `YYYY-MM-DD`(+time) strings or falsy).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/digest-context.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestContext, shapeDigest, fallbackDigest } from '../../supabase/functions/ai-assistant/lib/digest.mjs';

const TODAY = '2026-07-15'; // window: 2026-07-08 .. 2026-07-22
const mk = (o) => ({ id: o.id || 't', title: o.title || 'T', company: o.company || 'Lumen', due: o.due ?? null, status: o.status || 'todo', completedAt: o.completedAt ?? null });

test('partitions done / slipped / coming within the 7-day window', () => {
  const ctx = buildDigestContext([
    mk({ title: 'done-in',  status: 'done', completedAt: '2026-07-10' }),
    mk({ title: 'done-out', status: 'done', completedAt: '2026-07-01' }), // 14d ago → excluded
    mk({ title: 'slipped',  due: '2026-07-10' }),                          // open, due<today, within week
    mk({ title: 'today',    due: '2026-07-15' }),                          // open, due today → coming
    mk({ title: 'coming',   due: '2026-07-20' }),                          // open, within +7
    mk({ title: 'far',      due: '2026-07-30' }),                          // beyond +7 → excluded
  ], { today: TODAY });
  assert.deepEqual(ctx.counts, { done: 1, slipped: 1, coming: 2 });
});

test('lines are ordered slipped, coming, done and labeled', () => {
  const ctx = buildDigestContext([
    mk({ title: 'D', status: 'done', completedAt: '2026-07-12' }),
    mk({ title: 'C', due: '2026-07-18' }),
    mk({ title: 'S', due: '2026-07-09' }),
  ], { today: TODAY });
  assert.equal(ctx.lines[0], 'SLIPPED · S · Lumen · was due 2026-07-09');
  assert.equal(ctx.lines[1], 'DUE 2026-07-18 · C · Lumen');
  assert.equal(ctx.lines[2], 'DONE · D · Lumen');
});

test('a task with a completedAt is treated as done even if status lags', () => {
  const ctx = buildDigestContext([mk({ title: 'X', status: 'todo', completedAt: '2026-07-11', due: '2026-07-09' })], { today: TODAY });
  assert.deepEqual(ctx.counts, { done: 1, slipped: 0, coming: 0 }); // counted done, not slipped
});

test('fallbackDigest summarizes counts deterministically', () => {
  const out = fallbackDigest({ counts: { done: 3, slipped: 1, coming: 2 }, lines: ['SLIPPED · S · Lumen · was due 2026-07-09'] });
  assert.equal(out.source, 'fallback');
  assert.match(out.text, /3 tasks completed this week/);
  assert.match(out.text, /1 slipped/);
  assert.equal(out.bullets.length, 1);
});

test('shapeDigest splits narrative + bullets, falls back on empty', () => {
  const ctx = { counts: { done: 0, slipped: 0, coming: 0 }, lines: [] };
  const shaped = shapeDigest('A calm week overall.\n- Ship the deck\n- Call Eagle', ctx);
  assert.equal(shaped.source, 'model');
  assert.equal(shaped.text, 'A calm week overall.');
  assert.deepEqual(shaped.bullets, [{ taskId: null, label: 'Ship the deck' }, { taskId: null, label: 'Call Eagle' }]);
  assert.equal(shapeDigest('', ctx).source, 'fallback');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/digest-context.test.mjs`
Expected: FAIL — module not found / `buildDigestContext is not a function`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// supabase/functions/ai-assistant/lib/digest.mjs
// Pure: partition the viewer's tasks into a weekly done/slipped/coming digest
// context, plus model-text shaping and a deterministic fallback. No I/O, no
// globals. Mirrored (inlined) into PASTE-INTO-SUPABASE-DASHBOARD.ts.
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

export function buildDigestContext(tasks, opts) {
  const { today, windowDays = 7, maxItems = 25 } = opts || {};
  const weekAgo = shiftISO(today, -windowDays);
  const weekAhead = shiftISO(today, windowDays);
  const list = (tasks || []).filter(Boolean);

  const done = list.filter((t) => {
    if (!isDone(t) || !t.completedAt) return false;
    const d = String(t.completedAt).slice(0, 10);
    return d >= weekAgo && d <= today;
  });
  const slipped = list.filter((t) => !isDone(t) && t.due && t.due >= weekAgo && t.due < today);
  const coming = list.filter((t) => !isDone(t) && t.due && t.due >= today && t.due <= weekAhead);

  const counts = { done: done.length, slipped: slipped.length, coming: coming.length };

  const byDue = (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'));
  const lines = [];
  slipped.slice().sort(byDue).forEach((t) => lines.push(`SLIPPED · ${trunc(t.title, 80)} · ${t.company || '—'} · was due ${t.due}`));
  coming.slice().sort(byDue).forEach((t) => lines.push(`DUE ${t.due} · ${trunc(t.title, 80)} · ${t.company || '—'}`));
  done.slice().forEach((t) => lines.push(`DONE · ${trunc(t.title, 80)} · ${t.company || '—'}`));

  return { today, counts, lines: lines.slice(0, maxItems) };
}

function pluralize(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

export function fallbackDigest(ctx) {
  const c = (ctx && ctx.counts) || { done: 0, slipped: 0, coming: 0 };
  const parts = [];
  if (c.done) parts.push(`${pluralize(c.done, 'task')} completed this week`);
  if (c.slipped) parts.push(`${c.slipped} slipped`);
  if (c.coming) parts.push(`${c.coming} due in the next 7 days`);
  const text = parts.length ? parts.join(', ') + '.'
    : 'A quiet week — nothing completed, slipped, or due in the next 7 days.';
  const bullets = ((ctx && ctx.lines) || []).slice(0, 3).map((l) => ({ taskId: null, label: l }));
  return { text, bullets, source: 'fallback' };
}

export function shapeDigest(modelText, ctx) {
  if (typeof modelText !== 'string' || !modelText.trim()) return fallbackDigest(ctx);
  const lines = modelText.split('\n').map((l) => l.trim()).filter(Boolean);
  const isBullet = (l) => /^([-*•]|\d+[.)])\s+/.test(l);
  const bulletLines = lines.filter(isBullet).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ''));
  const narrative = lines.filter((l) => !isBullet(l)).join(' ').trim();
  if (!narrative && !bulletLines.length) return fallbackDigest(ctx);
  const bullets = bulletLines.slice(0, 3).map((label) => ({ taskId: null, label }));
  return { text: narrative || bulletLines[0], bullets, source: 'model' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/digest-context.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/lib/digest.mjs tests/unit/digest-context.test.mjs
git commit -m "feat(ai): pure weekly-digest context/shape/fallback + tests"
```

---

## Task 2: `weekly_digest` action in the edge function

**Files:**
- Modify: `supabase/functions/ai-assistant/index.ts`
- Modify: `PASTE-INTO-SUPABASE-DASHBOARD.ts`

**Interfaces:**
- Consumes: `buildDigestContext`, `shapeDigest`, `fallbackDigest` (Task 1) via relative import (index.ts) / inlined copies (bundle).
- Produces: `POST { action: "weekly_digest", today }` → `200 { ok: true, digest: { text, bullets, source }, generatedAt }`. Same auth as `briefing`; over-cap → `429`.

This is Deno — verified by curl in Task 5, not `node --test`.

- [ ] **Step 1: Add the import + digest cap to `index.ts`**

Below the existing `import { validateDraft } from "./lib/draft.mjs";` line, add:

```typescript
import { buildDigestContext, shapeDigest, fallbackDigest } from "./lib/digest.mjs";
```

Below the existing `const chatUsage = new Map...` line, add:

```typescript
const DIGEST_DAILY_CAP = 10; // client caches per week, so real volume is tiny
const digestUsage = new Map<string, { day: string; n: number }>();
```

- [ ] **Step 2: Extend the action guard**

Find:

```typescript
    if (action !== "briefing" && action !== "draft_task" && action !== "chat") {
      return json(req, { error: "Unknown action." }, 400);
    }
```

Replace with:

```typescript
    if (action !== "briefing" && action !== "draft_task" && action !== "chat" && action !== "weekly_digest") {
      return json(req, { error: "Unknown action." }, 400);
    }
```

- [ ] **Step 3: Add the `weekly_digest` branch**

Immediately BEFORE the `// -------- briefing (existing) -----------------------------------------` comment, insert:

```typescript
    // -------- weekly_digest: RLS-scoped done/slipped/coming recap -----------
    if (action === "weekly_digest") {
      const gday = new Date().toISOString().slice(0, 10);
      const gu = digestUsage.get(uid);
      const gn = gu && gu.day === gday ? gu.n : 0;
      if (gn >= DIGEST_DAILY_CAP) return json(req, { error: "Daily digest limit reached. Try again tomorrow." }, 429);
      digestUsage.set(uid, { day: gday, n: gn + 1 });

      const gp = payload as { today?: unknown };
      const today = typeof gp.today === "string" ? gp.today : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());

      // No assignee filter — RLS bounds the rows to what the caller may read.
      const { data: drows, error: dErr } = await userClient
        .from("tasks")
        .select("id,title,company_id,due,status,priority,assignee_id,completed_at")
        .order("due", { ascending: true })
        .limit(400);
      if (dErr) {
        console.error("[ai-assistant] digest fetch failed", dErr);
        return json(req, { error: "Could not load tasks." }, 500);
      }
      const dtasks = (drows ?? []).map((r: any) => ({
        id: r.id, title: r.title, company: r.company_id, due: r.due,
        status: r.status, completedAt: r.completed_at,
      }));
      const dctx = buildDigestContext(dtasks, { today, windowDays: 7 });

      const dsys = "You are a concise task assistant writing a weekly digest. In 2 to 4 sentences, recap what got done this past week, what slipped, and what is coming in the next 7 days, then up to 3 short bullet lines each naming one specific task. Only reference tasks in the provided context. Plain text, no emojis, no markdown headings.";
      const dusr = `Today is ${today}.\nCounts: ${JSON.stringify(dctx.counts)}\nItems:\n${dctx.lines.join("\n") || "(none)"}`;

      let digest;
      try {
        const res = await fetch(GROQ_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: GROQ_MODEL, temperature: 0.4, max_tokens: 350,
            messages: [{ role: "system", content: dsys }, { role: "user", content: dusr }],
          }),
        });
        if (!res.ok) {
          console.error("[ai-assistant] digest provider rejected", { status: res.status });
          digest = fallbackDigest(dctx);
        } else {
          const data = await res.json().catch(() => ({}));
          const text = data?.choices?.[0]?.message?.content ?? "";
          digest = shapeDigest(text, dctx);
        }
      } catch (e) {
        console.error("[ai-assistant] digest fetch threw", e);
        digest = fallbackDigest(dctx);
      }
      return json(req, { ok: true, digest, generatedAt: new Date().toISOString() });
    }

```

- [ ] **Step 4: Mirror into the dashboard bundle**

In `PASTE-INTO-SUPABASE-DASHBOARD.ts`: (a) inline the three digest helpers — copy `buildDigestContext`, `shapeDigest`, `fallbackDigest` **and their module-private helpers** (`shiftISO`, and a `trunc`/`pluralize`/`isDone`/`DONE` — note `trunc` and `pluralize` already exist in the bundle from the briefing inline, so DO NOT redeclare them; only add `shiftISO` and a `digestIsDone` + a `DIGEST_DONE` set to avoid clashing with the existing `DONE`/`isDone` used by `buildBriefingContext`). Concretely, paste this block after the existing `shapeBriefing` function:

```typescript
// ---- weekly digest (from lib/digest.mjs) ------------------------------------
const DIGEST_DONE = new Set(["done", "complete", "completed"]);
const digestIsDone = (t: any) => !!t.completedAt || DIGEST_DONE.has(String(t.status || "").toLowerCase());
function shiftISO(dateISO: string, days: number) {
  const [y, m, d] = String(dateISO).split("-").map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function buildDigestContext(tasks: any[], opts: any) {
  const { today, windowDays = 7, maxItems = 25 } = opts || {};
  const weekAgo = shiftISO(today, -windowDays);
  const weekAhead = shiftISO(today, windowDays);
  const list = (tasks || []).filter(Boolean);
  const done = list.filter((t) => { if (!digestIsDone(t) || !t.completedAt) return false; const d = String(t.completedAt).slice(0, 10); return d >= weekAgo && d <= today; });
  const slipped = list.filter((t) => !digestIsDone(t) && t.due && t.due >= weekAgo && t.due < today);
  const coming = list.filter((t) => !digestIsDone(t) && t.due && t.due >= today && t.due <= weekAhead);
  const counts = { done: done.length, slipped: slipped.length, coming: coming.length };
  const byDue = (a: any, b: any) => String(a.due || "9999").localeCompare(String(b.due || "9999"));
  const lines: string[] = [];
  slipped.slice().sort(byDue).forEach((t) => lines.push(`SLIPPED · ${trunc(t.title, 80)} · ${t.company || "—"} · was due ${t.due}`));
  coming.slice().sort(byDue).forEach((t) => lines.push(`DUE ${t.due} · ${trunc(t.title, 80)} · ${t.company || "—"}`));
  done.slice().forEach((t) => lines.push(`DONE · ${trunc(t.title, 80)} · ${t.company || "—"}`));
  return { today, counts, lines: lines.slice(0, maxItems) };
}
function fallbackDigest(ctx: any) {
  const c = (ctx && ctx.counts) || { done: 0, slipped: 0, coming: 0 };
  const parts: string[] = [];
  if (c.done) parts.push(`${pluralize(c.done, "task")} completed this week`);
  if (c.slipped) parts.push(`${c.slipped} slipped`);
  if (c.coming) parts.push(`${c.coming} due in the next 7 days`);
  const text = parts.length ? parts.join(", ") + "." : "A quiet week — nothing completed, slipped, or due in the next 7 days.";
  const bullets = ((ctx && ctx.lines) || []).slice(0, 3).map((l: string) => ({ taskId: null, label: l }));
  return { text, bullets, source: "fallback" };
}
function shapeDigest(modelText: unknown, ctx: any) {
  if (typeof modelText !== "string" || !modelText.trim()) return fallbackDigest(ctx);
  const lines = modelText.split("\n").map((l) => l.trim()).filter(Boolean);
  const isBullet = (l: string) => /^([-*•]|\d+[.)])\s+/.test(l);
  const bulletLines = lines.filter(isBullet).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ""));
  const narrative = lines.filter((l) => !isBullet(l)).join(" ").trim();
  if (!narrative && !bulletLines.length) return fallbackDigest(ctx);
  const bullets = bulletLines.slice(0, 3).map((label) => ({ taskId: null, label }));
  return { text: narrative || bulletLines[0], bullets, source: "model" };
}
```

Then (b) add the `DIGEST_DAILY_CAP`/`digestUsage` constants next to the chat constants, (c) extend the action guard to include `"weekly_digest"`, and (d) paste the same `weekly_digest` branch (from Step 3) before the briefing comment.

- [ ] **Step 5: Sanity check**

Re-read the inserted branch in both files; confirm the digest helpers are declared once (no `trunc`/`pluralize` redeclaration in the bundle), the guard lists all four actions, and braces balance. The real gate is the curl test in Task 5.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ai-assistant/index.ts PASTE-INTO-SUPABASE-DASHBOARD.ts
git commit -m "feat(ai): weekly_digest action (done/slipped/coming recap)"
```

---

## Task 3: `DigestClient` + data-store wiring

**Files:**
- Create: `js/services/DigestClient.js`
- Modify: `js/services/SupabaseDataStore.js`
- Modify: `js/app.js`
- Modify: `app.html`
- Test: `tests/unit/digest-client.test.mjs`

**Interfaces:**
- Consumes: `dataStore.getWeeklyDigest() -> { ok, digest?, error? }`; `App.utils.todayISO`.
- Produces `App.DigestClient`:
  - static `weekKey(dateISO) -> 'YYYY-MM-DD'` (the Monday of that week).
  - static `cacheKey(userId, weekISO)`, `readCache`, `writeCache`, `guard(digest)`.
  - instance `new App.DigestClient({ dataStore })` with async `get(userId, { force }) -> { digest, fromCache } | { digest: null, error }` (never throws).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/digest-client.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/services/DigestClient.js');
const DC = global.App.DigestClient;

test('weekKey returns the Monday of the week for any weekday', () => {
  assert.equal(DC.weekKey('2026-07-15'), '2026-07-13'); // Wed → Mon
  assert.equal(DC.weekKey('2026-07-13'), '2026-07-13'); // Mon → itself
  assert.equal(DC.weekKey('2026-07-19'), '2026-07-13'); // Sun → same Mon
  assert.equal(DC.weekKey('2026-07-20'), '2026-07-20'); // next Mon
});

test('guard rejects empty text / non-array bullets', () => {
  assert.equal(DC.guard(null), null);
  assert.equal(DC.guard({ text: '', bullets: [] }), null);
  assert.equal(DC.guard({ text: 'hi', bullets: 'no' }), null);
  assert.deepEqual(DC.guard({ text: 'hi', bullets: [] }), { text: 'hi', bullets: [] });
});

test('cacheKey namespaces per user per week', () => {
  assert.equal(DC.cacheKey('shan', '2026-07-13'), 'qhq.digest.shan.2026-07-13');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/digest-client.test.mjs`
Expected: FAIL — `Cannot read properties of undefined (reading 'weekKey')`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// js/services/DigestClient.js
// Client wrapper around the ai-assistant "weekly_digest" action: per-user,
// per-Phoenix-WEEK localStorage cache + a defensive response guard. Pure
// helpers are static so they can be unit-tested under node.
window.App = window.App || {};

App.DigestClient = class DigestClient {
  constructor({ dataStore }) { this.dataStore = dataStore; }

  // The Monday (UTC-computed, no TZ drift) of the week containing dateISO.
  static weekKey(dateISO) {
    const [y, m, d] = String(dateISO).split('-').map(Number);
    const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
    const dow = dt.getUTCDay();            // 0 Sun .. 6 Sat
    const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt.toISOString().slice(0, 10);
  }

  static cacheKey(userId, weekISO) { return `qhq.digest.${userId}.${weekISO}`; }

  static readCache(storage, userId, weekISO) {
    try {
      const raw = storage.getItem(DigestClient.cacheKey(userId, weekISO));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_e) { return null; }
  }

  static writeCache(storage, userId, weekISO, digest) {
    try { storage.setItem(DigestClient.cacheKey(userId, weekISO), JSON.stringify(digest)); }
    catch (_e) { /* private mode / quota — cache is best-effort */ }
  }

  static guard(digest) {
    if (!digest || typeof digest !== 'object') return null;
    if (typeof digest.text !== 'string' || !digest.text.trim()) return null;
    if (!Array.isArray(digest.bullets)) return null;
    return digest;
  }

  // Returns { digest, fromCache } or { digest: null, error }. Never throws.
  async get(userId, { force = false } = {}) {
    const week = DigestClient.weekKey(App.utils.todayISO(0));
    const storage = window.localStorage;
    if (!force) {
      const hit = DigestClient.guard(DigestClient.readCache(storage, userId, week));
      if (hit) return { digest: hit, fromCache: true };
    }
    let res;
    try { res = await this.dataStore.getWeeklyDigest(); }
    catch (err) { return { digest: null, error: (err && err.message) || String(err) }; }
    if (!res || !res.ok) return { digest: null, error: (res && res.error) || 'AI unavailable.' };
    const digest = DigestClient.guard(res.digest);
    if (!digest) return { digest: null, error: 'AI returned nothing usable.' };
    DigestClient.writeCache(storage, userId, week, digest);
    return { digest, fromCache: false };
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/digest-client.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `getWeeklyDigest` to SupabaseDataStore**

In `js/services/SupabaseDataStore.js`, immediately after the `getBriefing()` method (ends with its closing `}` before `draftTask`), add:

```javascript
  /* Weekly digest via the ai-assistant Edge Function. Returns { ok, digest?, error? }
     and never throws so Home degrades gracefully. */
  async getWeeklyDigest() {
    try {
      const { data, error } = await this.supabase.functions.invoke('ai-assistant', {
        body: { action: 'weekly_digest', today: App.utils.todayISO(0) },
      });
      if (error) {
        const status = (error.context && error.context.status) || null;
        let msg = (error && error.message) || 'AI unavailable.';
        try { const body = await error.context.json(); if (body && body.error) msg = body.error; }
        catch (_e) { /* body already consumed or not JSON */ }
        return { ok: false, status, error: msg };
      }
      return { ok: true, digest: data && data.digest };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }
```

- [ ] **Step 6: Add the preview-mode stub**

In `js/app.js`, in the `App.previewMode` dataStore object, right after the `getBriefing:` stub line, add:

```javascript
        getWeeklyDigest: async () => ({ ok: false, error: 'AI digest is not available in preview mode.' }),
```

- [ ] **Step 7: Add the script tag**

In `app.html`, immediately after the `BriefingClient.js` tag, add:

```html
<script defer src="js/services/DigestClient.js"></script>
```

- [ ] **Step 8: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS — all prior suites plus the 2 new digest suites green.

- [ ] **Step 9: Commit**

```bash
git add js/services/DigestClient.js js/services/SupabaseDataStore.js js/app.js app.html tests/unit/digest-client.test.mjs
git commit -m "feat(ai): DigestClient + dataStore.getWeeklyDigest + preview stub"
```

---

## Task 4: HomeView `Today | This week` toggle

**Files:**
- Modify: `js/views/HomeView.js`
- Modify: `taskmanagement.css`

**Interfaces:**
- Consumes: `App.DigestClient` (Task 3), the existing `_fetchBriefing`/`_briefing`/`_briefState` machinery.
- Produces: no new exports; behavior only.

- [ ] **Step 1: Replace `_briefingCardHtml` with a mode-aware version**

In `js/views/HomeView.js`, replace the entire `_briefingCardHtml()` method with:

```javascript
  // The AI card. Two modes behind a Today | This week toggle: "today" is the
  // daily briefing (unchanged); "week" is the weekly digest. Each renders its
  // own state (skeleton / narrative+bullets / muted-degrade) so Home never
  // shows a broken card.
  _briefingCardHtml() {
    const esc = App.utils.escapeHtml;
    const mode = (this._briefMode = this._briefMode || 'today');
    const isWeek = mode === 'week';
    const icon = `<svg class="qhq-ic" viewBox="0 0 24 24" aria-hidden="true">${HOME_ICONS.fire}</svg>`;
    const seg = `
      <div class="qhq-brief-seg" role="group" aria-label="Briefing range">
        <button type="button" class="qhq-seg-opt ${isWeek ? '' : 'on'}" data-brief-mode="today" aria-pressed="${!isWeek}">Today</button>
        <button type="button" class="qhq-seg-opt ${isWeek ? 'on' : ''}" data-brief-mode="week" aria-pressed="${isWeek}">This week</button>
      </div>`;
    const title = isWeek ? 'Weekly digest' : 'Daily briefing';
    const sub = isWeek ? 'this week in review' : 'your day at a glance';
    const head = `
      <div class="qhq-card-h">
        <span class="qhq-hicon tone-amber">${icon}</span>
        <span class="qhq-htext"><span class="ct">${title}</span><span class="meta">${sub}</span></span>
        ${seg}
        <button type="button" class="qhq-brief-refresh" data-brief="refresh" aria-label="Refresh" title="Refresh"><i class="ti ti-refresh"></i></button>
      </div>`;

    const state = isWeek ? this._digestState : this._briefState;
    const data = isWeek ? this._digest : this._briefing;
    let body;
    if (state === 'loading') {
      body = `<div class="qhq-brief-skel"><span></span><span></span><span></span></div>`;
    } else if (state === 'error' || !data) {
      body = `<div class="qhq-brief-muted">Your AI ${isWeek ? 'digest' : 'briefing'} isn't available right now.</div>`;
    } else {
      const bullets = (data.bullets || []).map((x) => `<li>${esc(x.label || '')}</li>`).join('');
      body = `
        <p class="qhq-brief-text">${esc(data.text)}</p>
        ${bullets ? `<ul class="qhq-brief-bullets">${bullets}</ul>` : ''}`;
    }
    return `<div class="qhq-card qhq-brief">${head}<div class="qhq-brief-body">${body}</div></div>`;
  }
```

- [ ] **Step 2: Add `_fetchDigest` next to `_fetchBriefing`**

In `js/views/HomeView.js`, immediately after the `_fetchBriefing({ force = false } = {}) { ... }` method, add:

```javascript
  _fetchDigest({ force = false } = {}) {
    if (!App.DigestClient || !this.controller.dataStore) { this._digestState = 'error'; return; }
    this._digestState = 'loading';
    const client = this._digestClient || (this._digestClient = new App.DigestClient({ dataStore: this.controller.dataStore }));
    client.get(this.controller.currentUser, { force }).then((r) => {
      if (r.digest) { this._digest = r.digest; this._digestState = 'ready'; }
      else { this._digestState = 'error'; }
      if (this.visible()) this.render();
    });
  }
```

- [ ] **Step 3: Wire the toggle + refresh bindings**

In `js/views/HomeView.js`, find the existing briefing binding block (inside the render/bind path):

```javascript
    if (!this._briefFetched) {
      this._briefFetched = true;
      this._fetchBriefing();
    }
    const refreshBtn = this.wrap.querySelector('[data-brief="refresh"]');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this._fetchBriefing({ force: true }));
```

Replace it with:

```javascript
    if (!this._briefFetched) {
      this._briefFetched = true;
      this._fetchBriefing();
    }
    const refreshBtn = this.wrap.querySelector('[data-brief="refresh"]');
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      if ((this._briefMode || 'today') === 'week') this._fetchDigest({ force: true });
      else this._fetchBriefing({ force: true });
    });
    this.wrap.querySelectorAll('[data-brief-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.briefMode;
        if (next === this._briefMode) return;
        this._briefMode = next;
        if (next === 'week' && !this._digestFetched) { this._digestFetched = true; this._fetchDigest(); }
        this.render();
      });
    });
```

- [ ] **Step 4: Add the toggle styles**

Append to `taskmanagement.css`:

```css
/* Today | This week toggle on the AI briefing card */
.qhq-brief-seg { display: inline-flex; gap: 2px; margin-left: auto; margin-right: 6px;
  background: var(--bg-3, rgba(0,0,0,.06)); border-radius: 999px; padding: 2px; }
.qhq-seg-opt { border: 0; background: transparent; cursor: pointer; padding: 4px 10px;
  border-radius: 999px; font-size: 12px; font-weight: 700; color: var(--ink-3); line-height: 1.4; }
.qhq-seg-opt.on { background: var(--bg-1, #fff); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
@media (max-width: 720px) {
  .qhq-brief-seg { margin-left: 0; }
  .qhq-card-h { flex-wrap: wrap; row-gap: 6px; }
}
```

- [ ] **Step 5: Syntax-check**

Run: `node --check js/views/HomeView.js && node --check js/services/DigestClient.js && echo OK`
Expected: `OK`.

- [ ] **Step 6: Manual verification (preview)**

Start the dev server on a free port (e.g. `PORT=4215 node tools/dev-server.mjs`) and open `app.html?preview=1`. On Home: confirm the AI card shows a `Today | This week` toggle; "Today" still renders the daily briefing (or its muted line in preview); clicking "This week" switches the header to "Weekly digest / this week in review" and — because the preview `getWeeklyDigest` stub returns `{ ok:false }` — shows the muted "digest isn't available right now" line with NO console errors; the refresh button re-fetches the active mode; toggling back to "Today" restores the briefing. Resize to ≤720px and confirm the toggle wraps without horizontal overflow. (Real digest text is verified live in Task 5.)

- [ ] **Step 7: Commit**

```bash
git add js/views/HomeView.js taskmanagement.css
git commit -m "feat(ai): Today | This week toggle on Home — weekly digest mode"
```

---

## Task 5: Redeploy the function + live QA

**Files:** none (deploy + verification).

- [ ] **Step 1: Redeploy `ai-assistant`**

Non-technical path: open `PASTE-INTO-SUPABASE-DASHBOARD.ts`, copy all, Supabase dashboard → Edge Functions → `ai-assistant` → replace code → Deploy. (CLI path: `npx supabase functions deploy ai-assistant --project-ref qqvmcsvdxhgjooirznrj`.)

- [ ] **Step 2: Curl — digest requires auth**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/ai-assistant" \
  -H "Content-Type: application/json" -H "apikey: <anon-key>" -d '{"action":"weekly_digest"}'
```

Expected: `401` (no user JWT) — confirms the gate covers the new action.

- [ ] **Step 3: Curl — signed-in digest returns a shaped digest**

With a real user access token (from the app's Supabase session):

```bash
curl -s -X POST "https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/ai-assistant" \
  -H "Content-Type: application/json" -H "apikey: <anon-key>" -H "Authorization: Bearer <user-token>" \
  -d '{"action":"weekly_digest","today":"2026-07-15"}'
```

Expected: `200 { "ok": true, "digest": { "text": "...", "bullets": [...], "source": "model"|"fallback" }, "generatedAt": "..." }`.

- [ ] **Step 4: Live QA on the app**

Merge client to `main` (Vercel auto-deploys). Hard-refresh the live app, go to Home, and click "This week". Confirm: a sensible recap scoped to what you can see (as an owner/admin, spanning the company; as a worker, just your own); the daily briefing still works under "Today"; the refresh button updates the active mode; muted degrade if the function errors. Verify no console errors and check light/dark + ≤720px (toggle wraps, no overflow).

- [ ] **Step 5: Done**

Update the AI assistant program memory (`project_ai_assistant_program.md` + `MEMORY.md` hook) with the Phase 4a ship state and the live QA result. Phase 4b (on-demand project rollup) is the remaining sub-feature.

---

## Notes / rollback

- Fails safe: if `weekly_digest` isn't deployed or errors, `getWeeklyDigest` returns `{ ok:false }`, `DigestClient.get` returns `{ digest:null }`, and the "This week" tab shows the muted line — the daily briefing and the rest of Home are unaffected. Rollback = revert the HomeView toggle (or leave the function action unused).
- Privacy: the digest sends the viewer's RLS-visible task titles/companies to Groq (US-hosted) — the same trade-off recorded for Phases 1–3. Task descriptions and comment bodies are NOT included.
- Keep the digest helpers in sync between `lib/digest.mjs` and the inlined bundle copies on any format/window change; the `digest-context` suite guards the module copy.
