# AI Weekly Digest — Phase 4a design

Date: 2026-07-14
Status: approved (design), pre-implementation

## Goal

A weekly recap on the Home dashboard: what got **done** in the last 7 days, what
**slipped** (was due this past week and still isn't done), and what's **coming** in
the next 7 days — written in a couple of plain-language sentences plus a few bullets.
It lives inside the existing daily-briefing card behind a small `Today | This week`
toggle. This is Phase 4a of the Quest HQ AI program; it reuses the deployed
`ai-assistant` edge function (Groq / Llama 3.3 70B) with a new `weekly_digest` action.

Phases 1–3 shipped: daily briefing (1), NL task draft (2), ask-your-tasks chat (3).
Phase 4b (on-demand project rollup) follows this one.

## Non-goals (v1)

- **No separate card.** The digest reuses the Phase 1 `.qhq-brief` card via a toggle —
  no second AI card on Home. (Chosen over a standalone card to avoid Home clutter.)
- **No email/push digest.** On-screen only. A scheduled email digest is out of scope.
- **No configurable window.** Fixed at 7 days back / 7 days ahead.
- **No writes.** Read-only, like every other AI surface. Nothing is persisted except the
  client-side per-week cache.
- **No new taxonomy/role logic.** Scope is whatever RLS already allows the caller to read.

## Scope (whose tasks)

RLS-scoped — **everything the viewer can see**, exactly like the chat snapshot. The
`weekly_digest` fetch runs under the caller's JWT with NO `assignee_id` filter, so:
owner/admin → whole company; supervisor → team + own; worker → own. Role behavior falls
out of RLS with zero extra code.

## Architecture

### Backend: `weekly_digest` action (in the existing `ai-assistant` function)

Add `action: "weekly_digest"`. Same JWT + approved-profile gate as `briefing`.

- **Request body**: `{ action: "weekly_digest", today }` — `today` is the client's Phoenix
  date (`YYYY-MM-DD`); if absent the function derives it (America/Phoenix), same as the
  other actions.
- **Fetch (RLS, all visible)**:
  ```
  userClient.from("tasks")
    .select("id,title,company_id,due,status,priority,assignee_id,completed_at")
    .order("due", { ascending: true })
    .limit(400)
  ```
  No assignee filter — RLS bounds it to the caller's readable rows. Mapped to the task
  shape `{ id, title, company, due, status, priority, assignee, completedAt }`.
- **Context (pure, shared module)** `buildDigestContext(tasks, { today, windowDays = 7 })`
  → `{ today, counts, lines }`:
  - `done` = tasks marked done whose `completedAt` date is within `[today - windowDays, today]`.
  - `slipped` = open (not done) tasks with a `due` in `[today - windowDays, today)` — i.e.
    was due this past week and still isn't done.
  - `coming` = open tasks with a `due` in `[today, today + windowDays]`.
  - `counts = { done, slipped, coming }`.
  - `lines` = up to `MAX_CONTEXT_ITEMS` labeled one-liners
    (`DONE · <title> · <company>`, `SLIPPED · <title> · <company> · was due <date>`,
    `DUE <date> · <title> · <company>`), ordered slipped → coming → done.
- **Model call**: temperature ~0.4, ~350 tokens, plain text. System prompt: write a 2–4
  sentence weekly recap covering what got done, what slipped, and what's coming, then up
  to 3 short bullets naming specific tasks; only reference provided tasks; no emojis, no
  markdown headings.
- **Shaping / fallback (pure)**: `shapeDigest(modelText, ctx)` splits the reply into a
  narrative + up to 3 bullets (same parsing shape as `shapeBriefing`); `fallbackDigest(ctx)`
  produces a deterministic count-based recap when the model output is empty/unusable or the
  provider errors. Result shape matches the briefing: `{ text, bullets: [{taskId,label}], source }`.
- **Response**: `{ ok: true, digest: { text, bullets, source }, generatedAt }`.
- **Quota**: its own in-memory per-day counter (`DIGEST_DAILY_CAP`, e.g. 10) — the client
  caches per week so real volume is tiny.

Provider/model constants stay shared. No new secrets. The action is mirrored into
`PASTE-INTO-SUPABASE-DASHBOARD.ts` for the dashboard redeploy.

### Client: `DigestClient` (new)

`js/services/DigestClient.js`, browser-global `App.DigestClient`. Mirrors `BriefingClient`
but keyed per Phoenix **week**:

- static `weekKey(dateISO)` — returns the ISO date (`YYYY-MM-DD`) of the **Monday** of the
  week containing `dateISO` (pure, unit-tested; the cache bucket id).
- static `cacheKey(userId, weekISO)` → `qhq.digest.<userId>.<weekISO>`.
- static `readCache` / `writeCache` / `guard` — same as `BriefingClient` (guard requires a
  non-empty `text` string and an array `bullets`).
- instance `get(userId, { force }) -> { digest, fromCache } | { digest: null, error }` —
  cache-first (unless `force`), calls `dataStore.getWeeklyDigest()`, guards, caches, never
  throws.

### Client: `SupabaseDataStore.getWeeklyDigest` + preview stub

- `getWeeklyDigest()` invokes `ai-assistant` with `{ action: 'weekly_digest', today }`;
  returns `{ ok, digest?, error? }`, never throws (mirrors `getBriefing`).
- Preview-mode stub in `js/app.js`: returns `{ ok: false }` so preview degrades quietly.

### Client: HomeView toggle

The existing `_briefingCardHtml()` gains a `Today | This week` segmented control in the card
head. New view state:

- `this._briefMode` — `'today'` (default) or `'week'`.
- `this._digest` / `this._digestState` (`'idle'|'loading'|'ready'|'error'`) — parallel to
  `_briefing` / `_briefState`.
- The card head title/subtitle reflect the mode (`Daily briefing / your day at a glance`
  vs `Weekly digest / this week in review`). The body renders the active mode's state
  (skeleton / narrative+bullets / muted-degrade line — identical treatment to the briefing).
- Switching to `'week'` the first time lazily calls `_fetchDigest()` (cache-first via
  `DigestClient`); the refresh button refreshes whichever mode is active.
- `_fetchDigest({ force })` mirrors `_fetchBriefing`: guards on `App.DigestClient` +
  dataStore, sets loading, re-renders on resolve. Degrades to the muted line on any failure.

No change to the daily-briefing behavior — `'today'` is exactly what ships now.

## Data flow

```
Home renders the brief card (mode = today | week)
  switch to "This week" (first time)
    → HomeView._fetchDigest → DigestClient.get (cache-first, per Phoenix week)
        → dataStore.getWeeklyDigest → ai-assistant weekly_digest
            → RLS fetch (all visible tasks) → buildDigestContext (done/slipped/coming)
            → Groq → shapeDigest  (or fallbackDigest on any failure)
        → { text, bullets, source } cached per week
    → card body shows the weekly recap; refresh re-fetches (force)
```

Nothing is written to the database.

## Error handling

| Failure | Behavior |
|---|---|
| Network / function down / 5xx | `getWeeklyDigest` returns `{ ok:false }`; card shows the muted "isn't available right now" line |
| Function not deployed yet | same muted line; the `Today` mode is unaffected |
| Model returns junk / empty | `shapeDigest` → `fallbackDigest` (deterministic count recap) |
| Provider error server-side | function returns `fallbackDigest` in `digest` (still `ok:true`) |
| Over daily digest cap | `429`; client shows the muted line; cache untouched |
| Preview/offline mode | stub returns `{ ok:false }`; `Today` toggle still works |

The feature is additive: if the digest can't load, Home shows the daily briefing exactly as
today.

## Testing

- **Unit** (`npm run test:unit`, `node --test`):
  - `buildDigestContext` (function-dir `.mjs`): partitions done/slipped/coming correctly;
    respects the 7-day window bounds (a task due 8 days out is excluded; one due today is
    "coming"; a done task completed 6 days ago counts, 8 days ago doesn't); counts match;
    `lines` capped and ordered slipped → coming → done.
  - `fallbackDigest` / `shapeDigest`: model text → narrative + ≤3 bullets; empty/garbage →
    deterministic fallback with the right counts.
  - `DigestClient.weekKey`: returns the Monday for any weekday; stable across a week; rolls
    to the next Monday correctly. `DigestClient.guard`: rejects empty text / non-array bullets.
- **Manual**: on Home, toggle `This week`; confirm a sensible recap scoped to what the viewer
  can see; confirm the daily briefing still works; confirm muted degrade when the function is
  unavailable; check light/dark and ≤720px (toggle wraps cleanly, no overflow).

## Deploy order

1. Redeploy `ai-assistant` (now with `weekly_digest`) via the dashboard paste bundle.
2. Merge client changes to `main` (Vercel auto-deploys).
3. Client fails safe if the action isn't live yet (the `This week` toggle just shows the
   muted line), so ordering isn't load-bearing — but function-first is cleaner.

## Phase 4a boundaries recap

In: a `Today | This week` toggle on the Home briefing card; a new `weekly_digest` action
returning a done/slipped/coming recap over a fixed 7-back/7-ahead window, RLS-scoped to what
the viewer can see; per-Phoenix-week client cache; deterministic fallback; unit tests for the
pure context/shape/week-key helpers. Out: separate card, email/push, configurable window,
any writes, project rollup (that's Phase 4b).
