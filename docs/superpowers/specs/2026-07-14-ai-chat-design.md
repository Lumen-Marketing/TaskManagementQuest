# AI Ask-Your-Tasks Chat — Phase 3 design

Date: 2026-07-14
Status: approved (design), pre-implementation

## Goal

A slide-in chat drawer where the user asks plain-language questions about their own
tasks — "what's overdue for Skyline?", "what did we finish for Lumen last month?",
"who has the most on their plate?" — and the AI answers from their task data. The chat
is **read-only**: it answers and links nothing it changes. This is Phase 3 of the Quest
HQ AI program; it reuses the deployed `ai-assistant` edge function (Groq / Llama 3.3
70B) with a new `chat` action.

Phase 1 = Home daily briefing (shipped). Phase 2 = NL task draft on New Task (shipped).
Phase 4 (summaries & digests) remains.

## Non-goals (v1)

- **No actions.** The chat never creates, edits, completes, assigns, or deletes tasks.
  Answer-only, matching the read-only posture of Phases 1–2.
- **No clickable task links in answers.** Answers are plain text. Deep-linking a
  mentioned task to its detail view is deferred to a later pass.
- **No persisted history.** Conversation lives in memory while the drawer is open and
  is discarded on reload/navigation. No DB table, no localStorage transcript.
- **No server-side task fetch for chat.** The client already holds every task the user
  can see (RLS-scoped at load), with names/companies already resolved to labels — it
  builds the snapshot and sends it. The function does no DB round-trip for `chat`.
- **No streaming.** One request, one full answer (with a loading state). Streaming can
  come later if answers feel slow.

## Architecture

### Backend: `chat` action (in the existing `ai-assistant` function)

The function dispatches on `action`. Add `action: "chat"`.

- **Auth**: same gate as `briefing`/`draft_task` — valid JWT + approved profile.
- **Request body**: `{ action: "chat", question, history, tasks, today, truncated }` where
  - `question`: the user's latest message (string, capped, e.g. 500 chars).
  - `history`: prior turns this session, `[{ role: "user"|"assistant", content }]`,
    already trimmed by the client to the last ~6 turns.
  - `tasks`: the client-built snapshot — an array of compact one-line strings, one per
    task (already RLS-scoped and label-resolved; see snapshot format below).
  - `today`: `YYYY-MM-DD` (client's Phoenix date, for relative-time questions).
  - `truncated`: boolean — true if the client capped the snapshot (so the model can
    say it may not have seen everything).
- **Model call**: low temperature, plain-text response (NOT json_object — answers are
  prose). System prompt: answer ONLY from the provided task lines; if the answer isn't
  in the data, say so plainly; be concise; no markdown headings, no emojis; when the
  snapshot was truncated, note that the view may be partial. Messages sent to Groq:
  `[system, ...history, { role: "user", content: <question + task context block> }]`.
- **Response**: `{ ok: true, answer: <string> }`. On any provider error, the function
  returns `{ ok: false, error }` (there is no deterministic fallback for free-form Q&A,
  unlike the briefing — the client just shows a "couldn't answer" bubble).
- **Quota**: a separate in-memory daily counter (`CHAT_DAILY_CAP`, e.g. 100/user/day).
  Over cap → `429`.
- **Payload guard**: the existing `MAX_PAYLOAD_BYTES` (32 KB) covers the snapshot; the
  client cap (below) keeps requests well under it.

Provider/model constants stay shared. No new secrets.

### Snapshot builder (pure, shared module)

The snapshot is built on the **client** (only the client has the label-resolved task
data), but the pure logic is mirrored on the function side so it can be unit-tested with
`node --test`. This follows the Phase 2 pattern exactly: `validateDraft` lived function-
side while `TaskDraftClient` statics lived client-side — no shared runtime import across
the Deno / browser boundary, two copies kept deliberately in sync, each with its own test.

- `supabase/functions/ai-assistant/lib/chat.mjs` exports the canonical pure
  `buildChatSnapshot(tasks, { today, max })`, unit-tested with `node --test`.
- `ChatClient` (browser global, can't `import` the `.mjs`) carries the same logic as a
  static, covered by its own client-side unit test that asserts matching behavior.

`buildChatSnapshot(tasks, { today, max = 200 })` returns `{ lines, truncated }`:

- Maps each task to one line:
  `<STATUS> · <title> · <company> · <assignee> · <due-or-none> · <done-date-if-done>`
  e.g. `OVERDUE · Send Q3 deck · Skyline · abraham · due 2026-07-10`
  and `DONE · Kickoff call · Lumen · josh · completed 2026-06-28`.
- Status tag derived like the briefing: OVERDUE / DUE TODAY / ON HOLD / DONE / OPEN.
- Titles truncated (e.g. 80 chars). Company/assignee are the already-resolved labels
  the client holds (fall back to `—` when missing).
- Sorted deterministically: overdue → due-today → on-hold → other open (by due) → done
  (most recently completed first), so the most decision-relevant tasks survive the cap.
- Caps at `max` lines; sets `truncated: true` when it dropped any.

### Client: `ChatClient` (new)

`js/services/ChatClient.js`, browser-global `App.ChatClient`. Responsibilities:

- **Static `buildSnapshot(tasks, { today, max })`** — the client copy of the snapshot
  logic above (pure, unit-tested).
- **Static `trimHistory(messages, maxTurns = 6)`** — returns the last `maxTurns`
  `{ role, content }` pairs to send as context (pure, unit-tested).
- **Instance `ask({ question, history, tasks, today })`** — calls
  `dataStore.chat(...)`; never throws; returns `{ answer }` or `{ answer: null }` on any
  failure.

### Client: `SupabaseDataStore.chat` + preview stub

- `SupabaseDataStore.chat(payload)` invokes `ai-assistant` with
  `{ action: "chat", ...payload }`; returns `{ ok, answer?, error? }`, never throws
  (mirrors `getBriefing`/`draftTask`).
- Preview-mode stub in `js/app.js`: returns `{ ok: false }` so preview degrades quietly.

### Client: `ChatDrawerView` (new)

`js/views/ChatDrawerView.js`, opened from a new topbar button (a chat/sparkle icon).

- **Surface**: a right-side slide-in panel on desktop; a bottom sheet at ≤720px. A
  scrim behind it; Esc and a close button dismiss it. Reuses existing drawer/scrim
  chrome patterns already in the app where possible.
- **Contents**: a scrollable message list (user bubbles right, AI bubbles left), a
  loading indicator while awaiting an answer, and a text input with a send button.
- **Empty state**: 3–4 suggested starter chips ("What's overdue?", "What did I finish
  this week?", "Who's busiest right now?") that fill the input when tapped.
- **Send flow**: on send, push the user message, call
  `App.controller.chatClient.ask({ question, history: ChatClient.trimHistory(this.messages), tasks: ChatClient.buildSnapshot(App.tasks…, { today }), today })`,
  show a typing indicator, then push the AI message (or an error bubble).
- **History**: `this.messages` array, in memory only, cleared when the view is torn down.
- Sources the task list from the same place the Tasks views read (the loaded, RLS-scoped
  task collection), so the snapshot exactly matches what the user can see.

## Data flow

```
user opens chat drawer (topbar button)
  → types a question, hits send
  → ChatDrawerView pushes user msg
  → ChatClient.buildSnapshot(visible tasks) + ChatClient.trimHistory(messages)
  → chatClient.ask → dataStore.chat → ai-assistant chat action
      → Groq (system + history + question+task-context) → plain-text answer
  → ChatDrawerView pushes AI msg (or an error bubble on failure)
  → conversation stays in memory until the drawer/app is closed
```

Nothing is written back to the database at any point.

## Error handling

| Failure | Behavior |
|---|---|
| Network / function down / 5xx | `chat` returns `{ ok:false }`; drawer shows an inline "I couldn't answer that right now" bubble; history intact |
| Function not deployed yet | same as above — drawer works, every answer is the error bubble |
| Model returns empty / junk | answer bubble shows whatever text came back, or the error bubble if none |
| Over daily chat cap | `429`; drawer shows a "daily chat limit reached" bubble |
| Snapshot truncated (>max tasks) | `truncated:true` sent; model told its view may be partial; answer can caveat |
| Preview/offline mode | stub returns `{ ok:false }`; drawer opens, answers show the error bubble |

The feature is strictly additive: the rest of the app is unchanged whether or not the
`chat` action is live.

## Testing

- **Unit** (`npm run test:unit`, `node --test`):
  - `chat.mjs buildChatSnapshot` (function-side): maps fixtures to compact lines with
    correct status tags; sorts overdue→…→done; respects `max` and sets `truncated`;
    resolves `—` for missing company/assignee.
  - `ChatClient.buildSnapshot` (client-side): mirrors the function-side cases (keeps the
    two copies in sync).
  - `ChatClient.trimHistory`: returns the last N turns; passes through when under N;
    empty in → empty out.
- **Manual**: open the drawer on desktop and at ≤720px; confirm the empty-state chips
  fill the input; ask a real question and confirm a sensible answer scoped to the
  viewer's tasks; confirm an unanswerable question ("what's the weather?") gets a polite
  "I can only answer about your tasks"; kill the network and confirm the error bubble;
  confirm history persists across several turns and clears on close.

## Deploy order

1. Redeploy `ai-assistant` (now with `chat`) — same function, same secrets. For the
   non-technical path, update the single-file dashboard bundle (`PASTE-INTO-SUPABASE-
   DASHBOARD.ts`) and re-paste → Deploy.
2. Merge client changes to `main` (Vercel auto-deploys).
3. Client fails safe if the `chat` action isn't live yet (drawer opens, answers are the
   error bubble), so ordering isn't load-bearing — but function-first is cleaner.

## Phase 3 boundaries recap

In: a read-only slide-in chat drawer that answers plain-language questions from a
client-built, RLS-scoped snapshot of the viewer's visible tasks, via a new `chat` action;
in-memory multi-turn history; graceful degradation. Out: any task actions, clickable
task links in answers, persisted history, server-side task fetch, streaming.
