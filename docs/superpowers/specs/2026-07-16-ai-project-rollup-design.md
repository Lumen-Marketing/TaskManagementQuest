# AI Per-Project Rollup (AI Program — Phase 4b)

**Date:** 2026-07-16
**Status:** Approved (brainstorming), ready for implementation plan
**Branch:** `feat/ai-project-rollup` (worktree `.claude/worktrees/ai-project-rollup`)

## Summary

An on-demand, AI-generated summary of where a **single project** stands, surfaced
at the top of that folder's expanded task drawer in ProjectsView. It reuses the
proven weekly-digest architecture (pure context builder + shaper + deterministic
fallback + a per-feature client with a small cache), scoped to one project's tasks.

This is the last open piece of the AI briefing/digest series. Voice/speech input is
being handled in a **separate** session and is out of scope here.

## Goals

- Give a manager or worker a fast "where does this project stand?" read without
  scanning every task row.
- Cover **% complete** plus what got **done** recently, what has **slipped**, and
  what is **coming** — scoped to the one project.
- On-demand only (a button), cheap on the shared Groq free tier, and always shows
  *something* (deterministic fallback) even when the provider is down.

## Non-goals

- No localStorage persistence (session-only in-memory cache).
- No auto-generate on drawer expand — the user must click **Summarize**.
- No assignee/who's-working breakdown.
- No writes of any kind (AI never mutates the DB — consistent with the whole program).
- No new surface beyond the ProjectsView drawer (not the scoped task-list header).

## Architecture

Mirrors the existing `weekly_digest` feature end to end.

### 1. Backend — new `project_rollup` action on the `ai-assistant` edge fn

- Add a fifth action alongside `briefing / draft_task / chat / weekly_digest` in
  `supabase/functions/ai-assistant/index.ts`. Extend the action allow-list check.
- **Request body:** `{ action: "project_rollup", projectId, projectName, today }`.
- **RLS fetch (no client task snapshot):** fetch the project's tasks under the
  caller's JWT, exactly like `weekly_digest` does for the whole visible set:

  ```
  userClient.from("tasks")
    .select("id,title,company_id,due,status,priority,assignee_id,completed_at")
    .eq("project_id", projectId)
    .order("due", { ascending: true })
    .limit(200)
  ```

  RLS bounds which rows come back, so there is no assignee filter. The tasks
  column for project is `project_id` (client maps it to `task.project`).
- **Guard:** validate `projectId` against `/^[A-Za-z0-9_-]+$/` before using it in
  the `.eq()` (defensive, mirrors the briefing's `safeMember`). If it fails the
  guard, return an empty/fallback rollup rather than querying.
- **Cap:** `ROLLUP_DAILY_CAP = 30`, its own in-memory `rollupUsage` Map keyed by
  uid+UTC-day (best-effort soft guard, same pattern as the other actions).
- **Groq call:** `temperature 0.4`, `max_tokens 350`. On any non-ok response or
  thrown error, degrade to `fallbackRollup(ctx)` (NOT a 502 — the strip always
  renders text, like the briefing/digest, unlike chat).
- **Response:** `{ ok: true, rollup, generatedAt }`.

### 2. Pure module — `supabase/functions/ai-assistant/lib/rollup.mjs`

No I/O, no globals — imported by both the fn (Deno) and the node `--test` suite.
Modeled on `lib/digest.mjs`; reuse the same `isDone` / `shiftISO` / `trunc`
helpers (copied locally to keep the module self-contained, as digest does).

- **`buildRollupContext(tasks, opts)`** where `opts = { today, windowDays = 7, maxItems = 25 }`:
  - `total` = all tasks; `doneCount` = `isDone(t)`; `pct = total ? round(done/total*100) : 0`.
  - `done` = done with `completedAt` in `[today - windowDays, today]`.
  - `slipped` = open & `due` in `[today - windowDays, today)`.
  - `coming` = open & `due` in `[today, today + windowDays]`.
  - `openNoDate` = open & no `due` (so a project with zero dates still summarizes).
  - `lines`: SLIPPED first, then DUE (coming), then a few OPEN, then DONE — capped
    at `maxItems`, each `TYPE · title(≤80) · company · date`.
  - Returns `{ today, projectName, counts: { total, done, slipped, coming, open }, pct, lines }`.
- **`fallbackRollup(ctx)`** — deterministic sentence from the counts, e.g.
  `"{name}: {pct}% complete — {done} done this week, {slipped} slipped, {coming}
  coming up."`, degrading to a quiet-project line; up to 3 bullets from `ctx.lines`.
  Shape: `{ text, bullets: [{ taskId: null, label }], source: 'fallback' }`.
- **`shapeRollup(modelText, ctx)`** — parse narrative vs. bullet lines (reuse the
  digest's bullet regex), fall back to `fallbackRollup` on empty. Shape:
  `{ text, bullets, source: 'model' }`. Matches the digest/briefing return shape.

### 3. Client — `js/services/RollupClient.js`

- **Static in-memory cache:** `RollupClient.cache = new Map()` keyed by projectId,
  value `{ rollup, generatedAt }`. Static `get(id)` / `set(id, v)` / `clear(id)`.
  Session-only — no localStorage (projects change often; on-demand & rarely clicked).
- **Instance `fetch(projectId, projectName)`** → `dataStore.projectRollup({ projectId,
  projectName, today })`, returns `{ rollup, generatedAt }` or throws for the caller
  to show a fallback line.
- **`SupabaseDataStore.projectRollup(...)`** — POST to the `ai-assistant` fn with the
  caller's session token (same wiring as `getWeeklyDigest`).
- **Preview stub** in `app.js` (returns a canned fallback rollup so the preview
  harness degrades cleanly), and a **script tag** in `app.html` after
  `DigestClient.js`.

### 4. UI — rollup strip in the folder drawer (`js/views/ProjectsView.js`)

- In `_row(p)`, when `open` (drawer expanded), render a `.pv-rollup` strip **above**
  `.pv-tasks`.
- **Default (no cached rollup):** slim header + a **✨ Summarize** button.
- **On click:** show a skeleton, call the RollupClient, then render the AI narrative
  + up to 3 bullet lines, a **refresh** icon, and a muted `generatedAt` timestamp.
  Store the result in `RollupClient.cache` so re-expanding the same folder in the
  session shows it immediately (no re-fetch) until refresh is pressed.
- **Cached:** render the stored rollup immediately instead of the button.
- **Degrade:** if the fn is unavailable / fetch throws, render the deterministic
  fallback line (the fn itself already returns a fallback, so this covers only a
  hard network/transport failure).
- Wiring lives in `_renderBody`/drawer handlers with listeners attached like the
  other drawer controls; re-render must not thrash the cache.
- **CSS** appended to `taskmanagement.css`, reusing the `.qhq-brief` token family
  (`--ink / --ink-2 / --ink-3 / --bg-3 / --amber`). **No borders** — color + spacing
  only, per the project's design-taste rule. Must not introduce horizontal overflow
  at 390px (mobile).

## Data flow

```
User expands folder → clicks ✨ Summarize
  → ProjectsView → RollupClient.fetch(projectId, name)
    → SupabaseDataStore.projectRollup  (POST ai-assistant, caller JWT)
      → fn project_rollup: RLS fetch tasks WHERE project_id = X
        → buildRollupContext → Groq → shapeRollup (or fallbackRollup)
      ← { ok, rollup, generatedAt }
    ← cache.set(projectId, …)
  → render narrative + ≤3 bullets + refresh + timestamp
```

## Error handling

- Provider down / non-ok / thrown → fn returns `fallbackRollup` (200, `source:'fallback'`).
- Network/transport failure client-side → ProjectsView renders a muted fallback line
  and leaves the Summarize button available to retry.
- Daily cap hit → fn 429; client shows a muted "limit reached, try again tomorrow" line.
- Bad/empty `projectId` → guard returns an empty rollup; no query runs.

## Testing

New node `--test` suites (mirroring the digest suites, glob form on Windows):

- **`rollup-context`** — partition correctness, % math (incl. 0-task project),
  window boundaries, the `openNoDate` bucket, and the `projectId` guard behavior.
- **`rollup-shape`** — narrative vs. bullet parsing, empty-input → fallback,
  model-vs-fallback `source` tag.
- **`rollupclient`** — cache `get/set/clear`, hit vs. miss.

Target ≈ +12 unit tests. Plus preview-harness verification (Playwright) that the
strip renders, generates on click, degrades to a fallback line offline, and has no
mobile horizontal overflow.

## Deployment

- Client (RollupClient, SupabaseDataStore, ProjectsView, app.html, CSS) ships via
  the normal merge → Vercel auto-deploy path.
- **Fn must be redeployed from repo source via the Supabase MCP `deploy_edge_function`**
  (files `index.ts` + `lib/*.mjs`, entrypoint `index.ts`) — **never** a paste bundle
  (the paste bundle is dead and drift-prone). Fails safe until redeploy: the strip
  shows the client-side fallback line.

## Open questions

None — all three design decisions (drawer entry point, progress+done/slipped/coming
content, in-memory+refresh cache) were confirmed during brainstorming.
