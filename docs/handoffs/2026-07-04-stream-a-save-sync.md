# Stream A — Save & sync reliability (P0)

Branch: `fix/p0-save-sync-reliability` · Worktree: `.claude/worktrees/stream-a-save-sync`
Read `2026-07-04-README.md` for the shared rules. Merge order: **you land first.**

## Mission

The boss created a task and it vanished — All Tasks was empty while the badge
said "7 urgent"; everything reappeared only after Ctrl+F5. That is the single
most trust-destroying bug in the app ("Holy shit. That is disgusting. It didn't
get saved."). Kill every path where data is written but not visible, or
visible-but-stale, without a hard refresh.

## Priority 0 — land the three pending fix branches

Fixes for much of this ALREADY EXIST, unmerged, one commit each. They predate
the taxonomy-phase4b merge (which touched `SupabaseDataStore.js`,
`TaskModel.js`, `TaskListView.js`, `TaskDetailView.js`), so expect conflicts.
Merge them into your branch one at a time, resolve, and re-verify each fix
still does what its message says:

1. `fix/save-pipeline-reliability` (631642c) — single-flight save lock,
   durable exit, notification merge, conflict field-merge, pagination.
2. `fix/client-hardening-crashes-injection` (8e4cef9) — roster-drift deref
   guards, avatar color sanitizing, **build-stamped SW cache version** (prime
   suspect for the Ctrl+F5 staleness).
3. `fix/lower-severity-correctness` (960895d) — lower-severity correctness batch.

Use the `resolving-merge-conflicts` skill. If a hunk conflicts with taxonomy
phase-4b semantics (per-type statuses, `is_done` flags), phase-4b wins — adapt
the fix to it, not the other way around.

## Priority 1 — tasks invisible until hard refresh

Reproduce, then fix root cause(s). Two distinct suspects; treat both:

- **Service-worker staleness:** `sw.js` claims network-first, but the boss
  needed Ctrl+F5. Confirm the build-stamp fix from branch #2 actually rotates
  the cache on deploy, and that `js/register-sw.js` + `js/views/UpdateWatcher.js`
  activate a new SW promptly (skipWaiting/clients.claim or an update toast).
- **In-memory state:** after `createTask`, do list views re-query or receive
  the new row via the model/EventBus? Counters ("7 urgent") disagreed with the
  list — find where the two read different sources and unify.

Acceptance: create a task on a PR preview → it appears in All Tasks and in
folder views immediately; badge counts always match visible rows; a deploy
never requires Ctrl+F5 to show current data.

## Priority 2 — duplicate-task data layer

Duplicating a task produced no activity entry and no feedback, so the boss
duplicated one by accident. Your half: the write path — duplication must write
an activity/history row ("duplicated from <task>"). The UI half (toast +
button placement) belongs to Stream C; leave `TaskDetailView.js` alone.

## Owned files

- `js/services/SupabaseDataStore.js`, `js/services/ReminderEngine.js`
- `js/models/*.js`
- `sw.js`, `js/register-sw.js`, `js/views/UpdateWatcher.js`
- `js/app.js` (boot/data wiring only)

## Hands-off

`js/views/*` (except UpdateWatcher), `js/controllers/AppController.js` routing
sections (Stream B), `taskmanagement.css` (you should not need CSS). The
merged fix branches may themselves touch views — that's fine, those are
pre-existing commits; just don't add NEW hand-edits there.

## Suggested skills

`superpowers:systematic-debugging` (before any fix), `resolving-merge-conflicts`,
`superpowers:verification-before-completion`, `review` before the PR.

## Definition of done

Three fix branches merged and re-verified; staleness bug reproduced and fixed
at root cause (not a cache-bust band-aid); duplicate writes an activity row;
PR open against main with preview-deploy verification notes.
