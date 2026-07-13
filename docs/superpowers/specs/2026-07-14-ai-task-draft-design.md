# AI Natural-Language Task Draft — Phase 2 design

Date: 2026-07-14
Status: approved (design), pre-implementation

## Goal

On the New Task page, let the user write a plain sentence as the task title and have
the AI fill the surrounding fields — Assignee, Company, Priority, Due date/time — from
that sentence, for the user to review and confirm. Parsing is automatic and debounced
as the user types. This is Phase 2 of the Quest HQ AI program; it reuses the deployed
`ai-assistant` edge function (Groq / Llama 3.3 70B) with a new `draft_task` action.

Phase 1 was the Home daily briefing. Phase 3 (chat) and Phase 4 (summaries) remain.

## Non-goals (v1)

- **No Type / Label mapping.** Those are per-company taxonomy keys, harder to infer
  reliably; the token parser doesn't set them either. The user sets them manually.
- **No title rewriting.** The AI never modifies the title field — the user's sentence
  stays exactly as typed and becomes the task title. The AI only fills *other* fields.
- **No overwriting.** The AI only fills fields that are still empty/default. Anything
  the user set manually, or that the `@name #company !pri` token parser already filled,
  is left untouched.
- **No auto-create.** The AI pre-fills; the user still clicks Create. Creation always
  goes through the existing `controller.createTask` seam (auto-caps + notifications
  apply unchanged).
- **No changes to the existing token parser** (`js/views/newtask/tokenParser.js`). It
  keeps working alongside this.

## Architecture

### Backend: `draft_task` action (in the existing `ai-assistant` function)

The function already dispatches on `action`. Add `action: "draft_task"`.

- **Auth**: same gate as `briefing` — valid JWT + approved profile.
- **Request body**: `{ action: "draft_task", text, team, companies, today }` where
  - `text`: the sentence (string, capped length, e.g. 500 chars).
  - `team`: `[{ id, name }]` — the roster the client already shows (people the caller
    can assign to). Sent by the client, not re-queried; the caller can already see them.
  - `companies`: `[{ id, label }]` — the caller's workspaces as shown in the picker.
  - `today`: `YYYY-MM-DD` (client's Phoenix date, so relative dates resolve correctly).
- **Model call**: low temperature, JSON response format. System prompt instructs the
  model to extract fields ONLY from the provided lists, and to return `null` for
  anything not confidently present. Model returns:
  `{ assignee, company, priority, due, dueTime }`.
- **Validation (pure, shared module)**: `validateDraft(modelJson, { team, companies, today })`:
  - `assignee` → kept only if it exactly matches an `id` in `team`, else `null`.
  - `company` → kept only if it matches an `id` in `companies`, else `null`.
  - `priority` → kept only if in `{low, medium, high, critical}`, else `null`.
  - `due` → kept only if a valid `YYYY-MM-DD` on/after a sane floor, else `null`.
  - `dueTime` → kept only if `HH:mm` 24h, else `null`.
  - Unknown keys dropped. Result is always a fully-shaped object with null-or-valid values.
- **Response**: `{ ok: true, draft: { assignee, company, priority, due, dueTime } }`.
- **Quota**: a separate in-memory daily counter from the briefing (drafting fires more
  often); modest cap (e.g. 60/user/day). Over cap → `429` (client silently ignores).

The provider/model constants stay shared with `briefing`. No new secrets.

### Client: `TaskDraftClient` (new)

`js/services/TaskDraftClient.js`, browser-global `App.TaskDraftClient`. Responsibilities:

- **Debounce**: coalesce rapid keystrokes; only fire ~800ms after typing stops.
- **Guardrails**: skip if `text.trim().length < MIN_LEN` (e.g. 12) or fewer than ~3
  words; skip if `text` is identical to the last text already sent (cache last
  `text → draft`); skip if there are no empty target fields left to fill (caller passes
  a "still-needed" check).
- **Fetch**: calls `dataStore.draftTask({ text, team, companies, today })`; never throws.
- Returns `{ draft }` or `{ draft: null }` on any failure.

Pure, unit-tested helpers exposed as statics: `shouldRequest(text, lastText, minLen)`
and `mergeDraftIntoState(state, draft, emptiness)` — the latter returns the set of
fields to apply (only those still empty in `state`) plus the list of field keys that
were AI-filled (for the UI hint).

### Client: `SupabaseDataStore.draftTask` + preview stub

- `SupabaseDataStore.draftTask(payload)` invokes `ai-assistant` with
  `{ action: "draft_task", ...payload }`; returns `{ ok, draft?, error? }`, never throws
  (mirrors `getBriefing`).
- Preview-mode stub in `js/app.js`: returns `{ ok: false }` so preview degrades quietly.

### Client: `NewTaskPageView` wiring

- On title input, after the existing token parse, call the debounced
  `TaskDraftClient` with the current title + `this._peopleFor(this.S.company)` +
  `this._companyChoices()` + `App.utils.todayISO(0)`.
- When a draft arrives: for each of `{ assignee, company, priority, due, dueTime }`,
  apply it to `this.S` **only if that field is still empty/default** (assignee →
  `whos` empty; company → still the default; priority → unset/default; date/time →
  empty). Applying `company` first, then re-scope assignee against the new company's
  roster (reusing the existing company-change logic) so an AI-picked assignee is valid.
- Mark applied fields with an "✨ AI" affordance (a small pill/marker on the field),
  cleared when the user edits that field. Re-render the preview.
- Never modify the title input value.

## Data flow

```
user types title
  → tokenParser (existing, unchanged) fills explicit @ # ! tokens
  → TaskDraftClient (debounced) → dataStore.draftTask → ai-assistant draft_task
      → model → validateDraft → { assignee, company, priority, due, dueTime }
  → NewTaskPageView applies non-null values to EMPTY fields only, marks them ✨
  → user reviews, edits freely (clears ✨), clicks Create
  → controller.createTask (unchanged: auto-caps, notifications, RLS)
```

## Error handling

| Failure | Behavior |
|---|---|
| Network / function down / 5xx | `draftTask` returns `{ ok:false }`; form unchanged; no error shown |
| Model returns non-JSON / junk | function's `validateDraft` yields all-null; nothing applied |
| Model picks a name/company not on the list | that field validated to `null`; not applied |
| Over daily draft cap | `429`; client ignores; form unchanged |
| Preview/offline mode | stub returns `{ ok:false }`; token parser still works |

The feature is strictly additive: when it can't help, the New Task page behaves exactly
as it does today.

## Testing

- **Unit** (`npm run test:unit`, `node --test`):
  - `validateDraft`: valid fields pass; unknown assignee/company → null; bad
    priority/date/time → null; unknown keys dropped; all-null on empty/garbage input.
    (Pure module under the function dir, `.mjs`, imported directly.)
  - `TaskDraftClient.shouldRequest`: respects min length/word count, dedups identical
    text, skips when nothing to fill.
  - `TaskDraftClient.mergeDraftIntoState`: applies only to empty fields; returns correct
    AI-filled key list; never overwrites a set field.
- **Manual**: on the New Task page (preview + live), type sentences like
  "request report from josh at lumen friday high priority" and confirm Assignee/Company/
  Priority/Due fill without clobbering a manually-picked field or a `@`/`#` token; confirm
  the title is never altered; confirm Create still works and notifies.

## Deploy order

1. Redeploy `ai-assistant` (now with `draft_task`) — same function, same secrets. For
   the non-technical path, update the single-file dashboard bundle and re-paste.
2. Merge client changes to `main` (Vercel auto-deploys).
3. Client fails safe if the function's `draft_task` isn't live yet (form just doesn't
   auto-fill), so ordering isn't load-bearing — but function-first is cleaner.

## Phase 2 boundaries recap

In: automatic debounced NL fill of Assignee/Company/Priority/Due(+time), non-destructive,
AI-only via `draft_task`, confirm-before-create. Out: Type/Label, title rewriting, token
parser changes, any auto-create.
