# AI Daily Briefing — Phase 1 design

Date: 2026-07-14
Status: approved (design), pre-implementation

## Goal

Bring back the Home dashboard "AI brief" from the original mockup (shipped 2026-06-23
as a static placeholder, later removed by the command-center redesign) — but real this
time. A briefing card at the top of Home that tells the signed-in user what happened
since yesterday and what deserves attention today, written by an open-source LLM
(Llama 3.3 70B) served on Groq's free tier.

This is Phase 1 of a larger assistant program. The backend is deliberately shaped so
Phase 2 features (ask-your-tasks chat drawer, task-thread summaries, draft-a-task from
free text) plug into the same edge function without rework.

## Non-goals (Phase 1)

- No chat UI, no task summarization, no natural-language task creation (Phase 2).
- No AI writes to the database — ever. Phase 1 is read-only; Phase 2 drafting will
  still require explicit user confirmation through the normal `createTask` seam.
- No new database tables or migrations. Caching is client-side.
- No per-company or team-wide briefing — viewer-scoped only.

## Architecture

### Edge function: `ai-assistant`

One new Supabase Edge Function, slug `ai-assistant`, following the `notify-email`
conventions:

- **Auth**: requires the caller's JWT. Builds a Supabase client **with the caller's
  own JWT** so every query runs under RLS — the model can only ever see tasks the
  user can already see. Rejects callers without an approved profile.
- **Origins**: enforces `ALLOWED_ORIGINS` (must include the prod origin and localhost).
- **Secrets**: `GROQ_API_KEY` stored as a function secret. The client never sees it;
  `env.json` is unchanged.
- **Dispatch**: request body is `{ action, ...params }`. Phase 1 implements only
  `action: "briefing"`. Unknown actions → 400. Phase 2 adds `chat`, `summarize`,
  `draft_task` behind the same dispatch.
- **Provider seam**: provider base URL + model id live in one constant
  (`llama-3.3-70b-versatile` on Groq's OpenAI-compatible endpoint), so swapping to
  OpenRouter/Together/self-hosted later is a one-line change.

### `briefing` action

1. Under the caller's JWT, fetch:
   - open tasks assigned to the viewer: due today, overdue, on hold, and top Focus
     items (`focus_seq` order) — capped (e.g. 25 rows) to bound the prompt;
   - activity since the previous Phoenix calendar day: tasks the viewer touched or
     is assigned to that were completed, newly assigned to them, or received new
     comments (best-effort from existing columns; no schema changes).
2. Build a compact plain-text context (titles, companies, due states — no
   descriptions/comments bodies beyond short truncation) and call Groq.
3. Prompt contract: 2–4 sentences of narrative ("what happened / what's on deck"),
   then up to 3 focus bullets naming specific tasks. Plain text. No emojis. No
   invented tasks — the prompt instructs the model to only reference tasks present
   in the context.
4. Response: `{ ok, briefing: { text, bullets: [{ taskId, label }] }, generatedAt }`.
   Bullets carry task ids so the client can link them to Task Detail.
5. **Quota guard**: per-user daily generation cap (small, e.g. 10/day including
   refreshes) tracked in-function (best-effort) to protect the shared free tier.
   Over cap → 429 with a friendly message.

### Client

- **Placement**: new full-width briefing card in HomeView, under the greeting/top
  band, above "Your Work". Existing command-center card treatment and tokens only
  (surface, tinted icon chip, Hanken heading, `--amber` accent) — no new styles
  invented, light and dark both work.
- **Fetch + cache**: on Home render, check localStorage
  (`qhq.briefing.<userId>.<phoenixDate>`); hit → render instantly, miss → shimmer
  skeleton while calling the function, then cache. A small "refresh" control
  regenerates on demand (subject to the server cap). Phoenix date comes from the
  existing `App.timezone()` handling.
- **Failure posture**: any error (network, 429, provider down) → the card collapses
  quietly (or shows the cached previous briefing if present). Home never blocks on
  AI and never shows a broken card.
- **Motion**: joins the existing entrance cascade; reduced-motion-gated like the
  rest of Home. Bullets link to Task Detail.
- **Mobile**: card is a plain stacked block ≤720px; nothing overflows (grid
  `minmax(0,1fr)` rules already in place).

## Privacy note

Task titles/metadata for the viewer's own tasks are sent to Groq (US-hosted) for
generation. This is the accepted trade-off for the free hosted tier; revisit
(self-host or paid EU option) if requirements change.

## Failure handling summary

| Failure | Behavior |
|---|---|
| Groq rate limit / down | Function returns 502/429 with message; card collapses or shows yesterday's cached brief |
| Caller unapproved / bad origin | 403; card never rendered |
| Model returns malformed output | Function retries once, then falls back to a deterministic non-AI summary line built from the counts (still useful, clearly not narrative) |
| Over per-user daily cap | 429; client shows cached brief + disables refresh until tomorrow |

## Testing

- Unit (`npm run test:unit`, node --test): briefing context builder (task fixtures →
  expected compact context; caps respected; Phoenix day boundaries), response
  validator/shaper (malformed model output → fallback), localStorage cache key logic.
- Manual: curl the deployed function with a real JWT before any client merge; live
  QA desktop + mobile (≤720px) after deploy; verify reduced-motion and dark mode.

## Deploy order

1. Deploy `ai-assistant` function + set `GROQ_API_KEY` / confirm `ALLOWED_ORIGINS`
   on PROD (`qqvmcsvdxhgjooirznrj` — Quest HQ; do NOT touch `rqundirizvojpzhljtdn`).
2. Verify with curl (200 with JWT, 403 without, briefing shape correct).
3. Merge client to `main` → Vercel auto-deploy → live QA.

## Phase 2 (recorded, not in scope)

Assistant drawer (topbar button; bottom sheet on mobile) hosting ask-your-tasks chat,
task-thread summarize (entry from Task Detail), and draft-a-task from free text
(entry from New Task; AI drafts, user confirms, save goes through `createTask` so
auto-caps/notifications apply). Same edge function, new actions.
