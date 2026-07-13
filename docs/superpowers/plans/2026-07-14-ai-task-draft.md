# AI Natural-Language Task Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As the user types a task title on the New Task page, the AI fills the empty Assignee/Company/Priority/Due(+time) fields from that sentence (non-destructively) for the user to confirm before creating.

**Architecture:** A new `draft_task` action on the deployed `ai-assistant` edge function takes the sentence plus the client's roster/company lists, calls Llama for strict JSON, and returns validated fields (a pure `validateDraft` module rejects anything not on the sent lists). A browser-global `TaskDraftClient` provides pure gate/merge helpers plus a fetch wrapper; `NewTaskPageView` debounces calls on title input, tracks which fields the user/token-parser already set, applies the AI draft to only untouched fields, and marks them with an "✨ AI" affordance. Creation is unchanged (`controller.createTask`).

**Tech Stack:** Deno (edge function, TypeScript), pure ESM `.mjs` for shared server logic, browser-global vanilla JS client (zero-build), `node --test` unit tests, Supabase JS v2, Groq/Llama 3.3 70B.

## Global Constraints

- Zero-build static SPA — no framework/bundler. Client JS attaches to `window.App`, loaded via `<script defer>` in `app.html`.
- `App.supabase` is ready only after `await App.configReady`; never hardcode URL/key.
- The AI never writes to the DB and never auto-creates. It pre-fills; the user clicks Create; creation goes through the existing `controller.createTask` seam (auto-caps + notifications unchanged).
- Non-destructive: the AI fills a field ONLY if the user (or the `@name #company !pri` token parser) has not already set it. The AI never modifies the title input.
- No Type/Label mapping, no title rewriting, no changes to `js/views/newtask/tokenParser.js`.
- Reuse the provider seam already in `ai-assistant/index.ts` (`GROQ_ENDPOINT`, `GROQ_MODEL`). No new secrets.
- HQ "today" comes from `App.utils.todayISO(0)` (America/Phoenix).
- Unit tests: `npm run test:unit` → `node --test "tests/unit/*.test.mjs"`. Pure server modules live under the function dir as `.mjs` imported directly; client modules use the `global.window`/`global.App` stub + `require()` pattern (see `tests/unit/utils-upper.test.mjs`).
- Target Supabase project is PROD `qqvmcsvdxhgjooirznrj` (Quest HQ) — never `rqundirizvojpzhljtdn`.
- The function is deployed by a non-technical user via the dashboard single-file bundle `PASTE-INTO-SUPABASE-DASHBOARD.ts` (repo root). Any `index.ts` change must be mirrored into that bundle.

## Field key ↔ form-state map

The AI draft uses these five keys; the New Task page state (`this.S`) maps them:

| draft key | `this.S` field | default at render |
|---|---|---|
| `assignee` | `this.S.whos` (array; AI sets `[id]`) | `[currentUser]` |
| `company` | `this.S.company` | first/selected company |
| `priority` | `this.S.pri` | `'medium'` |
| `due` | `this.S.date` (`YYYY-MM-DD`) | `todayISO(1)` (tomorrow) |
| `dueTime` | `this.S.time` (`HH:mm` or `''`) | `''` |

"Untouched" is tracked by a `this._userSet` Set of these keys, added to whenever the user or the token parser sets a field. The AI fills a key only when it is NOT in `_userSet`. **The Set/marker keys are exactly the five draft keys — `assignee`, `company`, `priority`, `due`, `dueTime`** (note the time field's key is `dueTime`, not `time`, so it matches `mergeDraftIntoState`).

## File Structure

- `supabase/functions/ai-assistant/lib/draft.mjs` — **pure.** `validateDraft(raw, {team, companies})` → normalized `{assignee, company, priority, due, dueTime}` with only valid values, else null.
- `supabase/functions/ai-assistant/index.ts` — add `draft_task` dispatch branch (modify).
- `PASTE-INTO-SUPABASE-DASHBOARD.ts` — mirror the `draft_task` changes into the single-file bundle (modify).
- `js/services/TaskDraftClient.js` — browser-global `App.TaskDraftClient`: pure statics `shouldRequest`, `mergeDraftIntoState`; instance `fetchDraft`.
- `js/services/SupabaseDataStore.js` — add `draftTask()` (modify).
- `js/app.js` — preview-mode `draftTask` stub (modify).
- `app.html` — `<script defer src="js/services/TaskDraftClient.js">` (modify).
- `js/views/NewTaskPageView.js` — `_userSet` tracking + debounced draft call + apply + ✨ markers (modify).
- `css/newtask.css` — the `.nt-ai` marker style (modify).
- Tests: `tests/unit/draft-validate.test.mjs`, `tests/unit/taskdraft-client.test.mjs`.

---

## Task 1: Pure `validateDraft`

**Files:**
- Create: `supabase/functions/ai-assistant/lib/draft.mjs`
- Test: `tests/unit/draft-validate.test.mjs`

**Interfaces:**
- Produces: `validateDraft(raw, { team, companies }) -> { assignee, company, priority, due, dueTime }`
  - `raw`: the model's parsed JSON (untrusted).
  - `team`: `[{id,name}]`, `companies`: `[{id,label}]` — the allowed lists.
  - Returns a fully-shaped object; each field is the validated value or `null`:
    - `assignee`/`company` kept only if a string matching an `id` in the respective list.
    - `priority` kept only if in `{low,medium,high,critical}`.
    - `due` kept only if `YYYY-MM-DD` and a real date.
    - `dueTime` kept only if 24h `HH:mm`.
  - Unknown/missing/garbage → all nulls.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/draft-validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft } from '../../supabase/functions/ai-assistant/lib/draft.mjs';

const LISTS = {
  team: [{ id: 'josh', name: 'Josh' }, { id: 'shan', name: 'Shan' }],
  companies: [{ id: 'lumen', label: 'Lumen' }, { id: 'roofing', label: 'Quest Roofing' }],
};

test('keeps valid fields that match the allowed lists', () => {
  const out = validateDraft(
    { assignee: 'josh', company: 'lumen', priority: 'high', due: '2026-07-17', dueTime: '15:30' }, LISTS);
  assert.deepEqual(out, { assignee: 'josh', company: 'lumen', priority: 'high', due: '2026-07-17', dueTime: '15:30' });
});

test('nulls out assignee/company not on the list', () => {
  const out = validateDraft({ assignee: 'nobody', company: 'acme' }, LISTS);
  assert.equal(out.assignee, null);
  assert.equal(out.company, null);
});

test('nulls out bad priority, date, and time', () => {
  const out = validateDraft({ priority: 'HUGE', due: '07/17/2026', dueTime: '25:99' }, LISTS);
  assert.equal(out.priority, null);
  assert.equal(out.due, null);
  assert.equal(out.dueTime, null);
});

test('garbage / missing input yields all nulls, fully shaped', () => {
  const shape = { assignee: null, company: null, priority: null, due: null, dueTime: null };
  assert.deepEqual(validateDraft(null, LISTS), shape);
  assert.deepEqual(validateDraft('nope', LISTS), shape);
  assert.deepEqual(validateDraft({}, LISTS), shape);
});

test('ignores unknown keys', () => {
  const out = validateDraft({ assignee: 'shan', hacker: 'drop table' }, LISTS);
  assert.deepEqual(out, { assignee: 'shan', company: null, priority: null, due: null, dueTime: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/draft-validate.test.mjs`
Expected: FAIL — module not found / `validateDraft is not a function`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// supabase/functions/ai-assistant/lib/draft.mjs
// Pure: validate/normalize the model's task-draft JSON against the allowed
// people/company lists. No I/O, no globals. Anything unrecognized → null.
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateDraft(raw, opts) {
  const out = { assignee: null, company: null, priority: null, due: null, dueTime: null };
  if (!raw || typeof raw !== 'object') return out;
  const team = (opts && opts.team) || [];
  const companies = (opts && opts.companies) || [];
  const teamIds = new Set(team.map((t) => t && t.id).filter(Boolean));
  const compIds = new Set(companies.map((c) => c && c.id).filter(Boolean));

  if (typeof raw.assignee === 'string' && teamIds.has(raw.assignee)) out.assignee = raw.assignee;
  if (typeof raw.company === 'string' && compIds.has(raw.company)) out.company = raw.company;
  if (typeof raw.priority === 'string' && PRIORITIES.has(raw.priority)) out.priority = raw.priority;
  if (typeof raw.due === 'string' && DATE_RE.test(raw.due) && !Number.isNaN(Date.parse(raw.due))) out.due = raw.due;
  if (typeof raw.dueTime === 'string' && TIME_RE.test(raw.dueTime)) out.dueTime = raw.dueTime;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/draft-validate.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/lib/draft.mjs tests/unit/draft-validate.test.mjs
git commit -m "feat(ai): pure task-draft validator + tests"
```

---

## Task 2: `draft_task` action in the edge function

**Files:**
- Modify: `supabase/functions/ai-assistant/index.ts`
- Modify: `PASTE-INTO-SUPABASE-DASHBOARD.ts`

**Interfaces:**
- Consumes: `validateDraft` (Task 1) via relative import (index.ts) / inlined copy (bundle).
- Produces: `POST { action: "draft_task", text, team, companies, today }` →
  `200 { ok: true, draft: { assignee, company, priority, due, dueTime } }`. Same auth/errors as `briefing`; over-cap → `429`.

This is Deno — verified by curl in Task 5, not `node --test`.

- [ ] **Step 1: Add the import + draft usage counter to `index.ts`**

Below the existing `import { shapeBriefing, fallbackBriefing } from "./lib/shape.mjs";` line, add:

```typescript
import { validateDraft } from "./lib/draft.mjs";
```

Below the existing `const usage = new Map...` line, add:

```typescript
const MAX_DRAFT_TEXT = 500;
const DRAFT_DAILY_CAP = 60; // drafting fires more often than the briefing
const draftUsage = new Map<string, { day: string; n: number }>();
```

- [ ] **Step 2: Replace the single-action dispatch with a two-action branch**

In `index.ts`, the briefing path currently begins right after the JSON parse. Find:

```typescript
    if (payload.action !== "briefing") return json(req, { error: "Unknown action." }, 400);
```

Replace that line **and everything from there down to the `return json(req, { ok: true, briefing, generatedAt: new Date().toISOString() });`** with a dispatch that keeps the briefing body intact and adds the draft branch. Concretely, change the guard to:

```typescript
    const action = payload.action;
    if (action !== "briefing" && action !== "draft_task") {
      return json(req, { error: "Unknown action." }, 400);
    }

    // -------- draft_task: natural-language → validated task fields ----------
    if (action === "draft_task") {
      const day = new Date().toISOString().slice(0, 10);
      const du = draftUsage.get(uid);
      const dn = du && du.day === day ? du.n : 0;
      if (dn >= DRAFT_DAILY_CAP) return json(req, { error: "Daily draft limit reached." }, 429);
      draftUsage.set(uid, { day, n: dn + 1 });

      const p = payload as { text?: unknown; team?: unknown; companies?: unknown; today?: unknown };
      const text = (typeof p.text === "string" ? p.text : "").slice(0, MAX_DRAFT_TEXT).trim();
      const team = Array.isArray(p.team) ? p.team : [];
      const companies = Array.isArray(p.companies) ? p.companies : [];
      const today = typeof p.today === "string" ? p.today : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());
      const emptyDraft = { assignee: null, company: null, priority: null, due: null, dueTime: null };
      if (!text) return json(req, { ok: true, draft: emptyDraft });

      const names = team.map((t: any) => `${t.id} = ${t.name}`).join("; ");
      const comps = companies.map((c: any) => `${c.id} = ${c.label}`).join("; ");
      const sys = "You extract task fields from a short sentence. Respond ONLY with a JSON object with keys assignee, company, priority, due, dueTime. Use an id from the PEOPLE list for assignee, an id from the COMPANIES list for company, priority one of low|medium|high|critical, due as YYYY-MM-DD, dueTime as 24h HH:mm. Use null for anything not clearly present. Never invent ids.";
      const usr = `Today is ${today}.\nPEOPLE: ${names || "(none)"}\nCOMPANIES: ${comps || "(none)"}\nSENTENCE: ${text}`;

      let draft = emptyDraft;
      try {
        const res = await fetch(GROQ_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: GROQ_MODEL, temperature: 0, max_tokens: 200,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
          }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const content = data?.choices?.[0]?.message?.content ?? "{}";
          let parsed: unknown = {};
          try { parsed = JSON.parse(content); } catch { parsed = {}; }
          draft = validateDraft(parsed, { team, companies });
        } else {
          console.error("[ai-assistant] draft provider rejected", { status: res.status });
        }
      } catch (e) {
        console.error("[ai-assistant] draft fetch threw", e);
      }
      return json(req, { ok: true, draft });
    }

    // -------- briefing (existing) -----------------------------------------
```

Leave the existing briefing block (the per-user briefing cap, task fetch, Groq call, `shapeBriefing`, and its `return json(...briefing...)`) exactly as it is, immediately after that comment.

> Note: the briefing block currently increments the briefing `usage` cap right after the action guard. Ensure that cap logic now lives inside the briefing branch (after the `// briefing (existing)` comment), not before the `if (action === "draft_task")` check — otherwise a draft call would consume the briefing quota. If it sits above, move the four `usage`/`DAILY_CAP` lines down into the briefing branch.

- [ ] **Step 3: Mirror the change into the dashboard bundle**

Apply the same three edits to `PASTE-INTO-SUPABASE-DASHBOARD.ts`, except there are no imports — **inline** the `validateDraft` function (copy its body from `lib/draft.mjs`, converting `export function` to `function`) near the other inlined helpers (after `shapeBriefing`). Add the same `MAX_DRAFT_TEXT`/`DRAFT_DAILY_CAP`/`draftUsage` constants near the top, and the same dispatch branch.

- [ ] **Step 4: Sanity check both files parse**

Run: `node --check PASTE-INTO-SUPABASE-DASHBOARD.ts 2>/dev/null || echo "TS types are fine to node --check-fail; visually confirm braces match"`
(Node can't type-check TS; just confirm the edit didn't leave unbalanced braces by re-reading the dispatch block. The real gate is the curl test in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/index.ts PASTE-INTO-SUPABASE-DASHBOARD.ts
git commit -m "feat(ai): draft_task action (NL sentence -> validated task fields)"
```

---

## Task 3: `TaskDraftClient` + data-store wiring

**Files:**
- Create: `js/services/TaskDraftClient.js`
- Modify: `js/services/SupabaseDataStore.js`
- Modify: `js/app.js`
- Modify: `app.html`
- Test: `tests/unit/taskdraft-client.test.mjs`

**Interfaces:**
- Consumes: `dataStore.draftTask({ text, team, companies, today }) -> { ok, draft?, error? }`.
- Produces `App.TaskDraftClient`:
  - static `shouldRequest(text, lastText, opts) -> boolean` — true only if `text.trim().length >= (opts.minLen||12)`, word count `>= (opts.minWords||3)`, and `text !== lastText`.
  - static `mergeDraftIntoState(draft, locked) -> { apply, aiFilled }` — `apply` is an object holding only the draft keys whose value is non-null AND whose key is not in `locked` (a Set or array); `aiFilled` is the array of those keys.
  - instance `new App.TaskDraftClient({ dataStore })` with async `fetchDraft({ text, team, companies, today }) -> { draft } | { draft: null }` (never throws).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/taskdraft-client.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/services/TaskDraftClient.js');
const TDC = global.App.TaskDraftClient;

test('shouldRequest respects min length and word count', () => {
  assert.equal(TDC.shouldRequest('fix', null, {}), false);          // too short
  assert.equal(TDC.shouldRequest('fix the thing', null, {}), true); // >=12 chars, 3 words
  assert.equal(TDC.shouldRequest('a b c d e', null, {}), false);    // 9 chars < 12
});

test('shouldRequest dedups identical text', () => {
  const t = 'request report from josh';
  assert.equal(TDC.shouldRequest(t, t, {}), false);
  assert.equal(TDC.shouldRequest(t, 'something else', {}), true);
});

test('mergeDraftIntoState applies only non-null, unlocked keys', () => {
  const draft = { assignee: 'josh', company: 'lumen', priority: null, due: '2026-07-17', dueTime: null };
  const { apply, aiFilled } = TDC.mergeDraftIntoState(draft, new Set(['company']));
  assert.deepEqual(apply, { assignee: 'josh', due: '2026-07-17' }); // company locked, nulls skipped
  assert.deepEqual(aiFilled.sort(), ['assignee', 'due']);
});

test('mergeDraftIntoState with everything locked applies nothing', () => {
  const draft = { assignee: 'josh', company: 'lumen', priority: 'high', due: null, dueTime: null };
  const { apply, aiFilled } = TDC.mergeDraftIntoState(draft, ['assignee', 'company', 'priority', 'due', 'dueTime']);
  assert.deepEqual(apply, {});
  assert.deepEqual(aiFilled, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/taskdraft-client.test.mjs`
Expected: FAIL — `Cannot read properties of undefined (reading 'shouldRequest')`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// js/services/TaskDraftClient.js
// Client wrapper for the ai-assistant "draft_task" action: pure gate/merge
// helpers (unit-tested) + a fetch that never throws. Debounce lives in the view.
window.App = window.App || {};

App.TaskDraftClient = class TaskDraftClient {
  constructor({ dataStore }) { this.dataStore = dataStore; }

  static shouldRequest(text, lastText, opts) {
    const o = opts || {};
    const minLen = o.minLen || 12;
    const minWords = o.minWords || 3;
    const t = String(text || '').trim();
    if (t.length < minLen) return false;
    if (t.split(/\s+/).filter(Boolean).length < minWords) return false;
    if (t === String(lastText || '').trim()) return false;
    return true;
  }

  static mergeDraftIntoState(draft, locked) {
    const lockedSet = locked instanceof Set ? locked : new Set(locked || []);
    const keys = ['assignee', 'company', 'priority', 'due', 'dueTime'];
    const apply = {};
    const aiFilled = [];
    for (const k of keys) {
      if (draft && draft[k] != null && !lockedSet.has(k)) { apply[k] = draft[k]; aiFilled.push(k); }
    }
    return { apply, aiFilled };
  }

  // Never throws. Returns { draft } or { draft: null }.
  async fetchDraft({ text, team, companies, today }) {
    let res;
    try { res = await this.dataStore.draftTask({ text, team, companies, today }); }
    catch (_e) { return { draft: null }; }
    if (!res || !res.ok || !res.draft) return { draft: null };
    return { draft: res.draft };
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/taskdraft-client.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Add `draftTask` to SupabaseDataStore**

In `js/services/SupabaseDataStore.js`, immediately after the `getBriefing()` method (added in Phase 1), add:

```javascript
  /* Natural-language task draft via the ai-assistant Edge Function. Returns
     { ok, draft?, error? } and never throws so the New Task page degrades quietly. */
  async draftTask({ text, team, companies, today }) {
    try {
      const { data, error } = await this.supabase.functions.invoke('ai-assistant', {
        body: { action: 'draft_task', text, team, companies, today },
      });
      if (error) return { ok: false, error: (error && error.message) || 'AI unavailable.' };
      return { ok: true, draft: data && data.draft };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }
```

- [ ] **Step 6: Add the preview-mode stub**

In `js/app.js`, in the `App.previewMode` dataStore object, right after the `getBriefing:` stub line (Phase 1), add:

```javascript
        draftTask: async () => ({ ok: false, error: 'AI drafting is not available in preview mode.' }),
```

- [ ] **Step 7: Add the script tag**

In `app.html`, immediately after the `BriefingClient.js` tag (added in Phase 1), add:

```html
<script defer src="js/services/TaskDraftClient.js"></script>
```

- [ ] **Step 8: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS — prior suites plus the 2 new draft suites all green.

- [ ] **Step 9: Commit**

```bash
git add js/services/TaskDraftClient.js js/services/SupabaseDataStore.js js/app.js app.html tests/unit/taskdraft-client.test.mjs
git commit -m "feat(ai): TaskDraftClient + dataStore.draftTask + preview stub"
```

---

## Task 4: New Task page wiring (`_userSet` + debounced draft + ✨ markers)

**Files:**
- Modify: `js/views/NewTaskPageView.js`
- Modify: `css/newtask.css`

**Interfaces:**
- Consumes: `App.TaskDraftClient` (Task 3), `this._parseCtx()`, `this.S`, `this.sync()`.
- Produces: no new exports; behavior only.

- [ ] **Step 1: Initialize tracking state in `render()`**

In `js/views/NewTaskPageView.js`, in `render()` right after `this._calY = null; this._calM = null;`, add:

```javascript
    this._userSet = new Set();   // draft keys the user or token parser has set
    this._aiSet = new Set();     // draft keys the AI filled (for the ✨ marker)
    this._draftLast = '';        // last title text sent to the AI
    this._draftTimer = null;
    this._draftClient = App.TaskDraftClient ? new App.TaskDraftClient({ dataStore: this.controller.dataStore }) : null;
```

- [ ] **Step 2: Mark fields the token parser sets, in `_applyParse`**

In `_applyParse`, the block that applies `p.addWhos`, `p.company`, `p.pri`, `p.date`, `p.time` — mark each as user-set so the AI won't overwrite the token parser. Change:

```javascript
    if (p.addWhos) p.addWhos.forEach(id => { if (!this.S.whos.includes(id)) this.S.whos.push(id); });
    if (p.company) { this.S.company = p.company; this._afterCompany(); }
    if (p.pri) this.S.pri = p.pri;
    if (p.date) this.S.date = p.date;
    if (p.time) this.S.time = p.time;
```

to:

```javascript
    if (p.addWhos) { p.addWhos.forEach(id => { if (!this.S.whos.includes(id)) this.S.whos.push(id); }); this._userSet.add('assignee'); this._aiSet.delete('assignee'); }
    if (p.company) { this.S.company = p.company; this._afterCompany(); this._userSet.add('company'); this._aiSet.delete('company'); }
    if (p.pri) { this.S.pri = p.pri; this._userSet.add('priority'); this._aiSet.delete('priority'); }
    if (p.date) { this.S.date = p.date; this._userSet.add('due'); this._aiSet.delete('due'); }
    if (p.time) { this.S.time = p.time; this._userSet.add('dueTime'); this._aiSet.delete('dueTime'); }
```

- [ ] **Step 3: Mark fields the user sets via pickers**

In `bindEvents()`, update the five picker callbacks so a manual change locks that field. Change these lines:

```javascript
    this._bindPick('company', () => this._companyItems(), (v) => { this.S.company = v; this._afterCompany(); }, false);
    this._bindPick('assignee', () => this._assigneeItems(), (v) => { this._toggleWho(v); }, true);
```

to:

```javascript
    this._bindPick('company', () => this._companyItems(), (v) => { this.S.company = v; this._afterCompany(); this._lockField('company'); }, false);
    this._bindPick('assignee', () => this._assigneeItems(), (v) => { this._toggleWho(v); this._lockField('assignee'); }, true);
```

In `_setPri(p)`, after `this.S.pri = p;`, add `this._lockField('priority');`.
In the date-menu click handler, change `if (day) { this.S.date = day.dataset.day; this._closeMenus(); this.sync('due'); }` to also lock: `if (day) { this.S.date = day.dataset.day; this._lockField('due'); this._closeMenus(); this.sync('due'); }`.
In the time-menu click handler, change `if (t) { this.S.time = t.dataset.time; this._closeMenus(); this.sync('due'); }` to `if (t) { this.S.time = t.dataset.time; this._lockField('dueTime'); this._closeMenus(); this.sync('due'); }`.

- [ ] **Step 4: Add `_lockField` + the debounced AI trigger + apply**

Add these methods to the class (e.g. after `_applyParse`):

```javascript
  // A user/token change to a field: never let the AI touch it again, and drop
  // any ✨ marker it had.
  _lockField(key) { this._userSet.add(key); this._aiSet.delete(key); }

  // Debounced natural-language draft. Called on each title input; fires ~800ms
  // after typing stops, only when the sentence is substantial and changed.
  _scheduleDraft() {
    if (!this._draftClient) return;
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => {
      const el = document.getElementById('nt-title');
      const text = (el && el.value ? el.value : '').trim();
      if (!App.TaskDraftClient.shouldRequest(text, this._draftLast, {})) return;
      this._draftLast = text;
      const ctx = this._parseCtx(false);
      this._draftClient.fetchDraft({ text, team: ctx.team, companies: ctx.companies, today: ctx.today })
        .then(({ draft }) => { if (draft) this._applyAiDraft(draft); });
    }, 800);
  }

  // Apply the validated draft to fields the user/token parser hasn't set.
  _applyAiDraft(draft) {
    const { apply, aiFilled } = App.TaskDraftClient.mergeDraftIntoState(draft, this._userSet);
    if (!aiFilled.length) return;
    // Company first: it re-scopes the assignee roster.
    if ('company' in apply) { this.S.company = apply.company; this._afterCompany(); this._aiSet.add('company'); }
    if ('assignee' in apply) {
      const roster = new Set(this._peopleFor(this.S.company).map(p => p.id));
      if (roster.has(apply.assignee)) { this.S.whos = [apply.assignee]; this._aiSet.add('assignee'); }
    }
    if ('priority' in apply) { this.S.pri = apply.priority; this._aiSet.add('priority'); }
    if ('due' in apply) { this.S.date = apply.due; this._aiSet.add('due'); }
    if ('dueTime' in apply) { this.S.time = apply.dueTime; this._aiSet.add('dueTime'); }
    this.sync();
  }
```

Note the key mapping: the draft's `dueTime` writes `this.S.time` but the lock/marker key stays `dueTime` everywhere, matching `mergeDraftIntoState` and `_userSet`/`_aiSet`.

- [ ] **Step 5: Fire the debounced draft on title input**

In `bindEvents()`, change:

```javascript
    title.addEventListener('input', () => { this._applyParse(false); this.sync(); });
```

to:

```javascript
    title.addEventListener('input', () => { this._applyParse(false); this._scheduleDraft(); this.sync(); });
```

- [ ] **Step 6: Render the ✨ marker on AI-filled fields**

The preview/pickers re-render in `sync()`. Add a tiny helper and surface it on the picker labels. Add this method:

```javascript
  _aiTag(key) { return this._aiSet && this._aiSet.has(key) ? '<span class="nt-ai" title="Filled by AI — edit to override">AI</span>' : ''; }
```

Then, in the picker label renderers for company, assignee, priority, date, and time, append `${this._aiTag('<key>')}` to the field's label markup (keys: `company`, `assignee`, `priority`, `due`, `dueTime`). Locate each picker's current-value label in the render/`sync` path (search for where `this.S.company`, the assignee people label near line 695, the priority buttons, and the date/time labels are written) and append the tag span. Keep it visual-only; it must not change the click targets.

- [ ] **Step 7: Add the marker style**

Append to `css/newtask.css`:

```css
/* AI-filled field marker on the New Task page */
.nt-ai {
  display: inline-flex; align-items: center; margin-left: 6px; padding: 1px 6px;
  font-size: 9px; font-weight: 800; letter-spacing: .04em; line-height: 1.4;
  color: var(--amber); background: var(--amber-bg, rgba(237,78,13,.12));
  border-radius: 999px; vertical-align: middle;
}
```

- [ ] **Step 8: Syntax-check**

Run: `node --check js/views/NewTaskPageView.js && node --check js/services/TaskDraftClient.js && echo OK`
Expected: `OK`.

- [ ] **Step 9: Manual verification (preview)**

Run `npm run dev`; open the app in preview mode; open New Task. Type "request report from josh at lumen friday high priority". In preview the `draftTask` stub returns unavailable, so **no fields change and no errors appear** — confirm the page still parses tokens and creates normally, and the console is clean. (Real AI fill is verified live in Task 5, since preview has no function.)

- [ ] **Step 10: Commit**

```bash
git add js/views/NewTaskPageView.js css/newtask.css
git commit -m "feat(ai): New Task page NL draft — debounced fill of empty fields + AI markers"
```

---

## Task 5: Redeploy the function + live QA

**Files:** none (deploy + verification).

- [ ] **Step 1: Redeploy `ai-assistant`**

Non-technical path: open `PASTE-INTO-SUPABASE-DASHBOARD.ts`, copy all, Supabase dashboard → Edge Functions → `ai-assistant` → replace code → Deploy. (CLI path: `npx supabase functions deploy ai-assistant --project-ref qqvmcsvdxhgjooirznrj`.)

- [ ] **Step 2: Curl — unknown action still rejected, draft requires auth**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/ai-assistant" \
  -H "Content-Type: application/json" -H "apikey: <anon-key>" -d '{"action":"draft_task","text":"hi there team"}'
```

Expected: `401` (no user JWT) — confirms the gate applies to the new action too.

- [ ] **Step 3: Curl — signed-in draft returns a shaped draft**

With a real user access token (from the app's Supabase session):

```bash
curl -s -X POST "https://qqvmcsvdxhgjooirznrj.supabase.co/functions/v1/ai-assistant" \
  -H "Content-Type: application/json" -H "apikey: <anon-key>" -H "Authorization: Bearer <user-token>" \
  -d '{"action":"draft_task","text":"request report from josh friday high priority","team":[{"id":"josh","name":"Josh"}],"companies":[{"id":"lumen","label":"Lumen"}],"today":"2026-07-14"}'
```

Expected: `200 { "ok": true, "draft": { "assignee": "josh"|null, "company": ..., "priority": "high"|null, "due": "2026-07-17"|null, "dueTime": null } }`. `assignee` should be `josh` and `priority` `high`; `company` only if the model maps it (not in the sentence here, so likely null).

- [ ] **Step 4: Live QA on the app**

Merge client to `main` (Vercel auto-deploys). On the live app, open New Task and type a real sentence naming a real teammate + company + timing. Confirm: after ~1s the Assignee/Company/Priority/Due fields fill with an **AI** marker; the title is unchanged; manually changing a field clears its marker and a re-parse won't overwrite it; a `@name`/`#company` token is never overwritten; Create still works and notifies. Verify no console errors and no layout shift; check ≤720px.

- [ ] **Step 5: Done**

Record completion in the AI assistant program memory; note the live QA result. Optionally delete `PASTE-INTO-SUPABASE-DASHBOARD.ts` only once BOTH the briefing and draft are confirmed live (it's the redeploy artifact).

---

## Notes / rollback

- Fails safe: if the function's `draft_task` isn't deployed or errors, `draftTask` returns `{ ok:false }`, `fetchDraft` returns `{ draft:null }`, and the New Task page behaves exactly as today. Rollback = revert the `NewTaskPageView` input hook (or leave the function action unused).
- Privacy: the sentence + the viewer's own roster/company **names** are sent to Groq (US-hosted) — same trade-off recorded for Phase 1.
