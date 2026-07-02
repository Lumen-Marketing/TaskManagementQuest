# Report a Problem — Design

**Date:** 2026-07-03
**Status:** Approved for planning

## Purpose

Let any signed-in, approved Quest HQ user send a bug/problem/suggestion report to
the developer straight from the account dropdown. Reports are stored durably in
the database and emailed to every developer-role account, so nothing depends on
an inbox being watched.

## Decisions made during brainstorming

- **Delivery:** email + in-app record (table is the source of truth; email is
  best-effort convenience).
- **Form:** free-text description + optional type picker; diagnostics attached
  automatically. No structured repro fields.
- **Screenshots:** out of scope for v1 (no Storage bucket).
- **Review UI:** a minimal developer-only "Problem reports" page ships in v1.
- **Email path:** a new dedicated `report-problem` edge function
  (approach A). Reusing `notify-email` was rejected because its worker-blocking
  role gate is a deliberate, test-enforced security control
  (`tests/role-gate.spec.js`); a pg_net DB trigger was rejected as operationally
  heavier than anything else in this stack.

## 1. User-facing flow

- New account-menu item **"Report a problem"** (`ti ti-bug`) in
  `js/views/TopbarView.js`, between "Show tour again" and "Sign out".
  Visible to **all roles** — no `canView` gate.
- Clicking closes the menu and opens a modal using the existing
  `modal-backdrop` / `modal` pattern (see `js/views/ProfileView.js`).
- Modal contents:
  - Type picker: three pill buttons **Bug / Problem / Suggestion**, default
    Bug (styled like the theme toggle in the account menu).
  - Required description textarea, placeholder "What happened? What did you
    expect?", max 2,000 characters with a live counter.
  - Note: "Your name, current page, and browser info are included
    automatically."
  - Cancel + **Send report** buttons.
- Submit → busy state on the button → success swaps the modal body to
  "Thanks — your report was sent to the developer" and closes shortly after.
  Failure keeps the modal open, shows an inline error, and preserves the
  typed text.
- Auto-context gathered client-side at submit: current view key, active
  company selection, `navigator.userAgent`, viewport size, and current
  URL/path. Reporter identity is **never** taken from the client — the server
  derives it from the JWT.

## 2. Data model — migration `supabase/sql/059_bug_reports.sql`

Table `public.bug_reports`:

| column           | type        | notes                                              |
| ---------------- | ----------- | -------------------------------------------------- |
| `id`             | uuid PK     | `gen_random_uuid()`                                |
| `reporter_id`    | uuid null   | FK → `profiles(id)` `on delete set null`           |
| `reporter_name`  | text        | snapshot at submit time                            |
| `reporter_email` | text        | snapshot at submit time                            |
| `type`           | text        | `bug` / `problem` / `suggestion`; default `bug`    |
| `description`    | text        | required, non-empty                                |
| `context`        | jsonb       | `{ view, company, userAgent, viewport, path }`     |
| `status`         | text        | `open` / `resolved`; default `open`                |
| `created_at`     | timestamptz | default `now()`                                    |
| `resolved_at`    | timestamptz | null until resolved                                |

Name/email snapshots keep a report readable after the reporter's account is
removed (same rationale as the active-timer snapshots in migration 034).

**RLS posture:** enable RLS; SELECT / UPDATE / DELETE policies for
`current_profile_role() = 'developer'` only. **No INSERT policy at all** — the
edge function (service role, bypasses RLS) is the single write path, so
validation, caps, and rate limits cannot be sidestepped by a direct client
insert, and no worker SELECT-after-INSERT policy is ever needed (avoids the
migration-043 class of bug).

## 3. Edge function `supabase/functions/report-problem/index.ts`

Deployed like `notify-email`: gateway verify-JWT **off**, manual JWT
validation inside via the service client's `getUser(jwt)` (required for this
project's asymmetric signing keys). Same fail-closed `ALLOWED_ORIGINS` CORS
allowlist. Reuses the existing project-wide secrets (`RESEND_API_KEY`,
`EMAIL_FROM`) — nothing new to configure.

Request flow:

1. **Auth:** validate caller JWT; load profile with the service key; require
   `approved = true` and **any role** (workers and sales included — this is a
   feedback channel, not a mail cannon; it can only ever email developers).
2. **Validate:** `type` from the allowlist (default `bug`); `description`
   trimmed, non-empty, ≤ 2,000 chars; `context` restricted to the five
   expected keys with per-value length caps; total request body capped at
   64 KB (rejected with 413 above that).
3. **Rate limit:** count the caller's `bug_reports` rows in the last hour;
   more than 5 → 429.
4. **Insert** the report with the service key, snapshotting the caller's
   profile name/email. Insert failure → error response (user retries).
5. **Email:** recipients = emails of all `role = 'developer'` profiles,
   intersected with `team_members` emails (same allowlist idea as
   `notify-email`). One Resend send: subject
   `[Quest HQ] <Type> report from <name>`, HTML-escaped description plus a
   context table.
6. Email failure → still `200 { ok: true, emailed: false }`; the report is
   stored, the provider error is logged to function logs.

Client side: a small method (e.g. on the existing data-store/service layer)
wraps `supabase.functions.invoke('report-problem', …)`.

## 4. Developer review view

- New view key `admin:reports`, title **"Problem reports"**, gated in
  `AppController.canView` via a new permission key (e.g. `bug-reports.manage`)
  granted **only** to the developer role in the `App.can` permission map, the
  same mechanism `admin:clock`/`clock.admin` uses;
  sidebar entry in the admin group; `TITLES` entry in `TopbarView`.
- Lists reports newest-first: reporter, type pill, description, context line
  (view · company · browser), created date; **Open / Resolved / All** filter
  tabs; per-report Open⇄Resolved toggle (uses the developer UPDATE policy and
  sets/clears `resolved_at`).
- Reports are fetched when the view renders (direct Supabase select under the
  developer RLS read policy) — not part of the main app `load()` payload.
- Styling follows the existing admin pages and the warm-flat panze rules
  (color + contrast, no hairline borders).

## 5. Error handling

- Network/server failure: modal stays open, inline error, text preserved.
- 429: "You've sent several reports recently — please wait a bit."
- Unapproved callers get 403 from the function (they can't reach the app UI
  anyway).
- Email provider failure is invisible to the reporter; the report row exists
  and the error is in Supabase function logs.
- Client-side errors flow to Sentry via the existing observability setup.

## 6. Testing

- **role-gate.spec.js:** worker calling `report-problem` succeeds (mirror of
  the existing "worker invoking notify-email gets a 403" test); anonymous
  caller gets 401.
- **E2E happy path:** open account menu → Report a problem → type description
  → submit → success confirmation.
- **Manual checklist rows:** submit as worker; verify developer email
  arrives; toggle a report to Resolved in the developer view.

## 7. Rollout order

1. Apply migration 059 to PROD (`qqvmcsvdxhgjooirznrj`).
2. Deploy the `report-problem` function (verify-JWT off).
3. Merge client changes to main → Vercel auto-deploy.

Client code must not land on main before steps 1–2 (standing rule: schema and
functions hit Supabase before the UI that depends on them deploys).

## Out of scope (v1)

- Screenshot/file attachments (would need a Storage bucket + policies).
- Bell (in-app) notification to the developer — the email covers alerting.
- Reporter-visible history of their own submitted reports.
- Comment threads / replies on reports.
