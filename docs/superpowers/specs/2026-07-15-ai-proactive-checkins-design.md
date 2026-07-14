# AI Proactive Check-ins — Design

Date: 2026-07-15
Status: Approved (brainstorm complete, ready for implementation plan)

## Summary

A **check-in engine**: a scheduled (pg_cron) edge function that periodically
wakes up, decides who to reach, has the AI write a short **one-way** message,
and delivers it to the in-app notification bell **and** by email — with a
dedupe log so no one gets the same nudge twice.

Three modes ride on the one engine:

1. **Morning recap + ask** — a daily "here's your day, what are you tackling?"
2. **End-of-day recap** — a daily "here's what you did, confirm what you finished."
3. **Stalled-task nudge** — "these tasks have gone quiet — still moving?"

The owner/admin turns each mode on or off for the whole team from a settings
page. There is no per-person opt-out in v1. The feature ships **dark**: nothing
fires for anyone until the function is deployed, its secret is set, the cron job
is created, and at least one mode is toggled on.

## Goals / Non-goals

**Goals**
- Reach people proactively (bell + email) on a schedule they didn't have to set.
- Reuse what already exists: the pure AI context-builders from `ai-assistant`,
  and the delivery pattern from `due-reminders`.
- Keep each mode a small, isolated delta on a shared engine.

**Non-goals (v1 — explicitly out)**
- No reply capture. Check-ins are one-way; the "answer" is the action the person
  takes in the app (comment, status change, completion).
- No phone push (sw.js is cache-only today) and no WhatsApp.
- No per-person opt-out or per-person scheduling.
- No inbound email parsing.

## Why a standalone function (Approach A)

`ai-assistant` runs only under the **caller's JWT**, so RLS scopes what the model
sees. A scheduled job has no user attached — it runs under the **service-role
key**, like `due-reminders`. So check-in generation cannot call the existing
`ai-assistant` HTTP endpoint; it talks to Groq directly. The *pure* content
logic (`buildBriefingContext`, `buildDigestContext`) is already extracted as
importable `.mjs`, so the interactive assistant and the scheduled engine share
it without sharing a security model.

Rejected alternatives:
- **B — service-role path inside `ai-assistant`**: muddies the one property that
  makes that function safe to reason about ("caller JWT, RLS-scoped, never
  trusts the client").
- **C — extend `due-reminders`**: overloads a function that is cleanly about
  task *due dates* with people-cadence + AI content, and it isn't even deployed.

## Architecture

New edge function `checkins`:
- Gated by a shared secret header `x-checkins-secret` (Verify JWT **off**).
- Runs under `SUPABASE_SERVICE_ROLE_KEY` (injected).
- Invoked by pg_cron via pg_net **every 30 minutes**.

Each run:
1. Load the single `checkin_settings` row (enabled modes + `stalled_days`).
2. For each enabled mode, test its HQ-time firing window.
3. Build the subject list (people, or people-with-stalled-tasks).
4. Per subject: claim the dedupe row → if fresh, generate content, deliver.
5. Return `{ ok, scanned, sent, errors[:20] }` for the function logs.

### Timing (HQ = America/Phoenix, fixed UTC-7, no DST)

Reuse the `hqMs()` helper from `due-reminders`.

| Mode        | Fires when HQ hour is | Frequency            | Dedupe key                 |
|-------------|-----------------------|----------------------|----------------------------|
| morning     | 08:00–08:59           | once/person/day      | `(morning, personId, date)`|
| end-of-day  | 16:00–16:59           | once/person/day      | `(eod, personId, date)`    |
| stalled     | 09:00–09:59 (scan)    | once/person/**week** | `(stalled, personId, week)`|

The firing window IS the bound: a mode fires on any cron tick whose HQ time
falls inside its hour band, and the dedupe log makes it exactly once per period.
With a 30-minute cron, ~2 ticks land in each hour band; the dedupe log collapses
them to one send. This replaces `due-reminders`' separate `CATCHUP_MS` guard,
which that function needs only because its windows are precise timestamps
(`due - 4h`) rather than hour bands. A cron gap that skips an entire hour band
means that period's message is simply missed (not deferred and blasted later) —
the safe direction.

`period` values: `date` = HQ calendar date `YYYY-MM-DD`; `week` = the HQ-Monday
of the current week as `YYYY-MM-DD`, computed with UTC math exactly like
`DigestClient`'s `weekKey`, so the stalled nudge re-arms once per calendar week.

### The three modes

- **Morning recap** — recipients: every approved person. Content: the daily
  briefing (`buildBriefingContext` + Groq) plus one appended line, "What are you
  tackling today?"
- **End-of-day recap** — recipients: every approved person. Content: a short
  "completed today / still open / slipped" recap ending with "confirm what you
  finished." (Reuses the digest-style partitioning, scoped to today.)
- **Stalled nudge** — a task is stalled if it is open (`status != done`) and
  `updated_at < now() - stalled_days`. **All of a person's stalled tasks are
  grouped into ONE message** (not one per task), listing them: "these have gone
  quiet — still moving?" Only people who actually have stalled tasks receive it.
  Stalled detection uses the multi-assignee seam (`isAssignee` / `assignee_ids`,
  migration 060), so a co-assignee's stalled task counts.

All AI wording has a deterministic template fallback (same pattern as
`fallbackBriefing`), so a Groq outage degrades wording but still sends.

## Delivery

Per message, two independent best-effort deliveries:
- **In-app bell**: insert one `notifications` row for the person.
- **Email**: one Resend send (reuse `team_members` id→email map + `EMAIL_FROM`).

If email fails, the bell row still lands; the error is logged. The dedupe row is
claimed **before** sending, so a mid-send crash cannot double-send on the next
tick — the safe failure direction (a rare lost message, never a duplicate) for
something that reaches out to people.

## Data model

**New table `checkin_settings`** (single config row):
- `morning_enabled boolean not null default false`
- `eod_enabled boolean not null default false`
- `stalled_enabled boolean not null default false`
- `stalled_days integer not null default 3`
- `updated_by text`, `updated_at timestamptz default now()`
- RLS: admins select + update; the cron reads via service role (bypasses RLS).

**New table `checkin_log`** (dedupe, mirrors `reminder_log`):
- `kind text`, `subject text`, `period text`, `created_at timestamptz default now()`
- unique `(kind, subject, period)`, claimed by upsert-and-select
  (`onConflict: 'kind,subject,period', ignoreDuplicates: true` then `.select()`;
  empty result = already sent → skip).

**Existing table `notifications` — one tweak:**
- Make `task_id` **nullable**. The two recaps aren't about a single task; a recap
  bell row carries a null task and opens Home. The stalled nudge can still link
  to a specific task. (Verify current nullability; add migration only if needed.)

## Settings surface

A new **Check-ins** admin panel, visible only to owner/admin (gated by
`App.can`, alongside the existing taxonomy admin `TaskSetupAdminView`):
- Three on/off toggles: Morning recap, End-of-day recap, Stalled nudge.
- One number field: stalled threshold in days (default 3).
- Writing a toggle updates the single `checkin_settings` row; the cron reads it
  on its next tick.

## Secrets / config

- Reused (already set on PROD): `GROQ_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-injected).
- New: `CHECKINS_SECRET` (the cron gate).
- Groq provider/model in one constant for swapability (match `ai-assistant`).

## Error handling summary

| Failure                         | Behavior                                        |
|---------------------------------|-------------------------------------------------|
| Groq down/slow                  | deterministic template wording; message sends   |
| Resend down                     | in-app bell only; error logged                  |
| cron gap / overlap / re-trigger | catch-up window + dedupe → no flood, no dupes    |
| no email on file                | bell only                                       |
| empty state (nobody stalled)    | no message rather than an empty one             |

## Testing

- **Pure `.mjs`, `node --test`** (as the briefing/digest suites): HQ-time window
  check; stalled-task filter (incl. the co-assignee `isAssignee` seam); dedupe
  key/period builder; content shapers + fallbacks.
- **Edge function**: curl smoke with the secret (gate + dry run).
- **Settings view**: small unit test + preview-harness screenshot (light/dark/
  mobile), matching how other UI has been verified here.

## Rollout

1. Migrations: `checkin_settings`, `checkin_log`, nullable `notifications.task_id`.
2. Deploy `checkins` from repo source via Supabase MCP (not a paste bundle).
3. Set `CHECKINS_SECRET`.
4. Create the pg_cron job (enable pg_cron + pg_net if needed) calling the
   function every 30 min with the secret header.
5. Ship the settings UI (Vercel) — everything still dark (all toggles default off).
6. Owner flips a mode on; verify one real send end-to-end; watch function logs.
