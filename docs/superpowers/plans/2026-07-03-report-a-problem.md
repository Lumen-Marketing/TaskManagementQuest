# Report a Problem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any approved user can send a bug/problem/suggestion report to the developer from the account dropdown; reports are stored in a `bug_reports` table and best-effort emailed to developer-role accounts; a developer-only "Problem reports" view triages them.

**Architecture:** Zero-build static SPA (no framework, plain `<script>` tags, `window.App` namespace). New `report-problem` Supabase Edge Function is the ONLY write path to `bug_reports` (service role; the table has no INSERT policy). Client adds one account-menu item, a modal view, a developer admin view rendered into the shared `#timeViewWrap`, and three data-store methods.

**Tech Stack:** Vanilla JS (ES2019-ish, `window.App` globals), Supabase (Postgres + RLS + Edge Functions/Deno), Resend email, Playwright e2e, Tabler icon font (`ti ti-*`).

**Spec:** `docs/superpowers/specs/2026-07-03-report-a-problem-design.md`

## Global Constraints

- **PROD Supabase project is `qqvmcsvdxhgjooirznrj`** (Quest HQ). NEVER target `rqundirizvojpzhljtdn` — that is a different product.
- **Rollout order is mandatory:** migration 059 applied to PROD and `report-problem` deployed BEFORE client code is pushed to `main` (Vercel auto-deploys `main`).
- Edge functions in this project deploy with **gateway verify-JWT OFF** and validate the caller JWT manually via `adminClient.auth.getUser(jwt)` (asymmetric signing keys break gateway verification — see `supabase/functions/notify-email/index.ts`).
- CORS: fail-closed `ALLOWED_ORIGINS` allowlist, same pattern as `notify-email`. Secrets `RESEND_API_KEY`, `EMAIL_FROM`, `ALLOWED_ORIGINS` are project-wide and already set — nothing new to configure.
- All user-visible strings are plain English, no emojis. HTML injected into templates goes through `App.utils.escapeHtml`.
- Design rules: warm-flat panze style — color + contrast, NO hairline borders on new cards; reuse existing tokens (`var(--surface)`, `var(--amber)`, `var(--ink-2)`, `var(--bg-2)`).
- Every new/modified JS file must pass `node --check <file>`.
- Playwright tests must `test.skip(...)` when their env (TEST_USERS) is absent, like the existing suites.
- Limits (shared client + server): description ≤ 2,000 chars; types `bug` / `problem` / `suggestion`; request body ≤ 64 KB; 5 reports per user per hour.

---

### Task 1: Migration 059 — `bug_reports` table + RLS

**Files:**
- Create: `supabase/sql/059_bug_reports.sql`

**Interfaces:**
- Consumes: `public.current_profile_role()` (exists since migration 011; resolves sales→worker since 048), `public.profiles(id)`.
- Produces: table `public.bug_reports(id, reporter_id, reporter_name, reporter_email, type, description, context, status, created_at, resolved_at)` used by Tasks 2, 3, 5. RLS: developer-only SELECT/UPDATE/DELETE, **no INSERT policy** (service role only).

- [ ] **Step 1: Write the migration**

```sql
-- 059: Bug reports — "Report a problem" account-menu feature.
-- Stores user-submitted bug/problem/suggestion reports. Writes happen ONLY
-- through the report-problem edge function (service role bypasses RLS), so
-- there is deliberately NO insert policy: validation, caps, and the per-user
-- rate limit live in the function and cannot be sidestepped by a direct
-- client insert. Developers read/triage/delete.
begin;

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  -- Snapshot name/email at submit time so the report stays readable after
  -- the reporter's account is removed (same rationale as migration 034's
  -- active-timer task label snapshots).
  reporter_id uuid references public.profiles(id) on delete set null,
  reporter_name text,
  reporter_email text,
  type text not null default 'bug' check (type in ('bug', 'problem', 'suggestion')),
  description text not null check (length(btrim(description)) > 0),
  context jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- The function's "reports by this user in the last hour" rate-limit count
-- and the admin list's newest-first ordering.
create index if not exists bug_reports_reporter_created_idx
  on public.bug_reports (reporter_id, created_at desc);
create index if not exists bug_reports_created_idx
  on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;

create policy "developers can read bug reports" on public.bug_reports
  for select to authenticated
  using (public.current_profile_role() = 'developer');

create policy "developers can update bug reports" on public.bug_reports
  for update to authenticated
  using (public.current_profile_role() = 'developer')
  with check (public.current_profile_role() = 'developer');

create policy "developers can delete bug reports" on public.bug_reports
  for delete to authenticated
  using (public.current_profile_role() = 'developer');

commit;
```

- [ ] **Step 2: Review against neighbors**

Read `supabase/sql/055_project_folders.sql` and confirm the new file matches house style (leading comment block, `begin;`/`commit;`, `current_profile_role()` policies). The migration is NOT applied here — Task 7 applies it to PROD.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/059_bug_reports.sql
git commit -m "feat(db): bug_reports table, developer-only RLS, function-only writes (mig 059)"
```

---

### Task 2: Edge function `report-problem`

**Files:**
- Create: `supabase/functions/report-problem/index.ts`

**Interfaces:**
- Consumes: table `public.bug_reports` (Task 1); env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `ALLOWED_ORIGINS`.
- Produces: `POST` endpoint invoked as `supabase.functions.invoke('report-problem', { body })`.
  - Request body: `{ type?: 'bug'|'problem'|'suggestion', description: string, context?: { view?, company?, userAgent?, viewport?, path? } }`
  - Success: `200 { ok: true, id: string, emailed: boolean }`
  - Errors: `400` invalid input · `401` no/bad JWT · `403` unapproved profile · `405` non-POST · `413` body > 64 KB · `429` rate-limited · `500` insert/internal failure.

**Design note (spec §3 refinement):** recipients are the emails of **approved `role='developer'` profiles**, taken directly from `profiles`. The spec's extra `team_members` intersection is dropped: recipients here are server-derived (never client input), so the intersection adds no security — but it CAN silently break delivery because the developer account is not reliably on `team_members` (see the roster comment in `js/views/ClockDashboardView.js`).

- [ ] **Step 1: Write the function**

```ts
// Supabase Edge Function: report-problem
// -----------------------------------------------------------------------------
// "Report a problem" from the account menu. Any APPROVED user of ANY role
// (workers/sales included — unlike notify-email) can submit a bug/problem/
// suggestion. The function is the ONLY write path to public.bug_reports
// (the table has no INSERT policy); it validates + caps input, rate-limits
// per user, inserts with the service key, then best-effort emails every
// approved developer-role profile via Resend. Email failure never fails the
// request — the table is the source of truth.
//
// DEPLOY: like notify-email — gateway verify-JWT OFF (asymmetric signing
// keys), caller JWT validated manually below. Reuses the project-wide
// secrets RESEND_API_KEY / EMAIL_FROM / ALLOWED_ORIGINS.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_DESCRIPTION = 2000;
const MAX_CONTEXT_VALUE = 300;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_REPORTS_PER_HOUR = 5;
const TYPES = new Set(["bug", "problem", "suggestion"]);
const CONTEXT_KEYS = ["view", "company", "userAgent", "viewport", "path"];

// CORS: strict allowlist, fails closed — same contract as notify-email.
function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const allowList = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowList.length === 0) {
    console.error("[report-problem] ALLOWED_ORIGINS is not set — refusing cross-origin responses.");
    return headers;
  }
  const origin = req.headers.get("Origin") ?? "";
  if (allowList.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json(req, { error: "Service credentials are not available." }, 503);
    }
    // Email is best-effort: a missing Resend key must not block report storage.
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const from = Deno.env.get("EMAIL_FROM") ?? "Quest HQ <onboarding@resend.dev>";

    // -------- caller authorization ---------------------------------------
    // Any APPROVED profile may report, regardless of role. This is a
    // feedback channel, not a mail cannon: recipients are derived
    // server-side (developer profiles only), so the caller can never choose
    // who gets emailed.
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!callerJwt) return json(req, { error: "Not signed in." }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerUser, error: callerErr } = await admin.auth.getUser(callerJwt);
    if (callerErr || !callerUser?.user) {
      return json(req, { error: "Not signed in." }, 401);
    }
    const uid = callerUser.user.id;
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("approved, role, full_name, email")
      .eq("id", uid)
      .single();
    if (profileErr || !profile || !profile.approved) {
      return json(req, { error: "Not authorized." }, 403);
    }

    // -------- input validation --------------------------------------------
    const lenHeader = req.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > MAX_PAYLOAD_BYTES) {
      return json(req, { error: "Payload too large." }, 413);
    }
    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return json(req, { error: "Payload too large." }, 413);
    }
    let payload: { type?: unknown; description?: unknown; context?: unknown };
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(req, { error: "Invalid JSON body." }, 400);
    }
    if (!payload || typeof payload !== "object") {
      return json(req, { error: "Invalid request body." }, 400);
    }

    const type = typeof payload.type === "string" && TYPES.has(payload.type)
      ? payload.type : "bug";
    const description = typeof payload.description === "string"
      ? payload.description.trim().slice(0, MAX_DESCRIPTION) : "";
    if (!description) {
      return json(req, { error: "Please describe the problem." }, 400);
    }
    // Context: only the expected keys, each value stringified + capped.
    const rawCtx = (payload.context && typeof payload.context === "object")
      ? payload.context as Record<string, unknown> : {};
    const context: Record<string, string> = {};
    for (const key of CONTEXT_KEYS) {
      const v = rawCtx[key];
      if (typeof v === "string" && v) context[key] = v.slice(0, MAX_CONTEXT_VALUE);
    }

    // -------- rate limit ---------------------------------------------------
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await admin
      .from("bug_reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter_id", uid)
      .gte("created_at", hourAgo);
    if (countErr) {
      console.error("[report-problem] rate-limit count failed", countErr);
      return json(req, { error: "Could not submit the report." }, 500);
    }
    if ((count ?? 0) >= MAX_REPORTS_PER_HOUR) {
      return json(req, { error: "You've sent several reports recently — please wait a bit." }, 429);
    }

    // -------- store (source of truth) --------------------------------------
    const reporterName = (profile.full_name ?? "").trim() || "Unknown";
    const reporterEmail = (profile.email ?? callerUser.user.email ?? "").trim();
    const { data: inserted, error: insertErr } = await admin
      .from("bug_reports")
      .insert({
        reporter_id: uid,
        reporter_name: reporterName,
        reporter_email: reporterEmail,
        type,
        description,
        context,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("[report-problem] insert failed", insertErr);
      return json(req, { error: "Could not submit the report." }, 500);
    }

    // -------- best-effort email to developers ------------------------------
    let emailed = false;
    try {
      const { data: devs, error: devErr } = await admin
        .from("profiles")
        .select("email")
        .eq("role", "developer")
        .eq("approved", true);
      const to = [...new Set((devs ?? [])
        .map((d: { email: string | null }) => (d.email ?? "").trim().toLowerCase())
        .filter(Boolean))];
      if (devErr) console.error("[report-problem] developer lookup failed", devErr);
      if (resendKey && to.length > 0) {
        const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
        const ctxRows = Object.entries(context).map(([k, v]) =>
          `<tr><td style="padding:2px 12px 2px 0;color:#666;">${escapeHtml(k)}</td>` +
          `<td style="padding:2px 0;">${escapeHtml(v)}</td></tr>`).join("");
        const html =
          `<h2 style="margin:0 0 4px;">${escapeHtml(typeLabel)} report</h2>` +
          `<p style="margin:0 0 12px;color:#666;">From ${escapeHtml(reporterName)}` +
          (reporterEmail ? ` &lt;${escapeHtml(reporterEmail)}&gt;` : "") + `</p>` +
          `<p style="white-space:pre-wrap;">${escapeHtml(description)}</p>` +
          (ctxRows ? `<table style="margin-top:12px;font-size:13px;">${ctxRows}</table>` : "");
        const res = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to,
            subject: `[Quest HQ] ${typeLabel} report from ${reporterName}`,
            html,
          }),
        });
        if (res.ok) {
          emailed = true;
        } else {
          console.error("[report-problem] provider rejected", { status: res.status });
        }
      }
    } catch (mailErr) {
      console.error("[report-problem] email send failed", mailErr);
    }

    return json(req, { ok: true, id: inserted.id, emailed });
  } catch (err) {
    console.error("[report-problem] uncaught", err);
    return json(req, { error: "Internal error." }, 500);
  }
});
```

- [ ] **Step 2: Review against `notify-email`**

Read `supabase/functions/notify-email/index.ts` side-by-side and confirm: same CORS helper, same `getUser(jwt)` auth shape, same "console.error, never leak internals" error style. Confirm the ONE intended difference: no role allowlist (approval only) and server-derived recipients.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/report-problem/index.ts
git commit -m "feat(functions): report-problem — store bug report, best-effort email developers"
```

---

### Task 3: Data-store methods

**Files:**
- Modify: `js/services/SupabaseDataStore.js` (insert the three methods directly below the existing `sendEmail` method, which ends near line 490)

**Interfaces:**
- Consumes: `this.supabase` client; edge function from Task 2; table from Task 1.
- Produces (used by Tasks 4 and 5):
  - `async submitBugReport({ type, description, context })` → `{ ok: true, emailed: boolean }` or `{ ok: false, status: number|null, error: string }`. **Never throws.**
  - `async listBugReports()` → array of raw `bug_reports` rows, newest first. Throws via `_throwIfError`.
  - `async setBugReportStatus(id, status)` → updated row. `status` is `'open'` or `'resolved'`; sets/clears `resolved_at`. Throws via `_throwIfError`.

- [ ] **Step 1: Add the methods**

Insert after the closing brace of `sendEmail(...)` (keep the house comment style):

```js
  /* "Report a problem" — submit via the report-problem Edge Function (the
     only write path to bug_reports). Returns { ok, emailed?, status?, error? }
     and never throws: the modal turns failures into inline errors. */
  async submitBugReport({ type, description, context }) {
    try {
      const { data, error } = await this.supabase.functions.invoke('report-problem', {
        body: { type, description, context },
      });
      if (error) {
        // Supabase wraps non-2xx as `error` with a `.context.status`.
        const status = (error.context && error.context.status) || null;
        let msg = (error && error.message) || 'Could not send the report.';
        try {
          const body = await error.context.json();
          if (body && body.error) msg = body.error;
        } catch (e) { /* body already consumed or not JSON */ }
        return { ok: false, status, error: msg };
      }
      return { ok: true, emailed: !!(data && data.emailed) };
    } catch (err) {
      return { ok: false, status: null, error: (err && err.message) || String(err) };
    }
  }

  /* Developer-only (RLS): every submitted report, newest first. */
  async listBugReports() {
    const res = await this.supabase
      .from('bug_reports')
      .select('*')
      .order('created_at', { ascending: false });
    this._throwIfError(res, 'loading bug reports');
    return res.data || [];
  }

  /* Developer-only (RLS): triage toggle. status is 'open' | 'resolved'. */
  async setBugReportStatus(id, status) {
    const res = await this.supabase
      .from('bug_reports')
      .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
      .eq('id', id)
      .select('*')
      .single();
    this._throwIfError(res, 'updating bug report');
    return res.data;
  }
```

- [ ] **Step 2: Syntax check**

Run: `node --check js/services/SupabaseDataStore.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add js/services/SupabaseDataStore.js
git commit -m "feat(data): submitBugReport / listBugReports / setBugReportStatus"
```

---

### Task 4: Report modal + account-menu item

**Files:**
- Create: `js/views/ReportProblemView.js`
- Modify: `js/views/TopbarView.js` (menu template ~line 459 + handler block ~line 480)
- Modify: `js/controllers/AppController.js:54-62` (`attachViews`, new `openReportProblem`)
- Modify: `js/app.js:162-163` (instantiate + attach)
- Modify: `app.html` (script tag, Views block ~line 277)
- Modify: `taskmanagement.css` (modal styles, append near `.profile-inline-error` ~line 4291)

**Interfaces:**
- Consumes: `dataStore.submitBugReport(...)` (Task 3), `App.utils.escapeHtml`, `controller.uiState`, existing `.modal-backdrop`/`.modal`/`.field`/`.btn`/`.theme-opt`/`.profile-inline-error` CSS.
- Produces: `App.ReportProblemView` class (constructor `{ controller, dataStore }`, method `open()`); `controller.openReportProblem()`; menu item `[data-action="report-problem"]`; modal root `#reportModal` with `#rp-desc` textarea and `[data-action="submit"]` button (Task 6's spec selects these).

- [ ] **Step 1: Create `js/views/ReportProblemView.js`**

```js
window.App = window.App || {};

/* ReportProblemView — "Report a problem" modal, opened from the account menu.
   Any role can submit. The description + a small auto-context bundle go to the
   report-problem Edge Function (via dataStore.submitBugReport), which stores
   the report and best-effort emails the developer. Identity is derived
   server-side from the JWT — nothing here names the reporter. */
App.ReportProblemView = class ReportProblemView {
  constructor({ controller, dataStore }) {
    this.controller = controller;
    this.dataStore = dataStore;
    this.modal = null;
    this.type = 'bug';
  }

  open() {
    if (this.modal) return;
    this.type = 'bug';
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    this.modal.id = 'reportModal';
    this.modal.innerHTML = this.template();
    document.body.appendChild(this.modal);
    this.bindEvents();
    setTimeout(() => {
      const input = document.getElementById('rp-desc');
      if (input) input.focus();
    }, 50);
  }

  close() {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
  }

  template() {
    const types = [['bug', 'Bug'], ['problem', 'Problem'], ['suggestion', 'Suggestion']];
    return `
      <div class="modal" data-stop>
        <div class="modal-head">
          <div class="modal-title">Report a problem</div>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label">What kind?</label>
            <div class="report-type-toggle" role="group" aria-label="Report type">
              ${types.map(([v, l]) => `
                <button type="button" class="theme-opt ${this.type === v ? 'active' : ''}"
                        data-report-type="${v}" aria-pressed="${this.type === v}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="field" style="margin-top:14px;">
            <label class="field-label" for="rp-desc">What happened?</label>
            <textarea id="rp-desc" maxlength="2000" rows="6"
              placeholder="What happened? What did you expect?"></textarea>
            <div class="rp-count" id="rp-count">0 / 2000</div>
          </div>
          <div class="rp-note">Your name, current page, and browser info are included automatically.</div>
          <div class="modal-actions">
            <button class="btn" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="submit">Send report</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
    this.modal.querySelectorAll('[data-action="close"]').forEach(el => {
      el.addEventListener('click', () => this.close());
    });
    this.modal.querySelector('[data-action="submit"]').addEventListener('click', () => this.submit());
    this.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      }
    });
    this.modal.querySelectorAll('[data-report-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.type = btn.dataset.reportType;
        this.modal.querySelectorAll('[data-report-type]').forEach(b => {
          const on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
      });
    });
    const desc = document.getElementById('rp-desc');
    desc.addEventListener('input', () => {
      const counter = document.getElementById('rp-count');
      if (counter) counter.textContent = `${desc.value.length} / 2000`;
    });
  }

  /* Diagnostics attached silently to every report (disclosed in the modal). */
  _context() {
    const ui = (this.controller && this.controller.uiState) || {};
    return {
      view: String(ui.view || ''),
      company: String(ui.currentCompany || ''),
      userAgent: String(navigator.userAgent || ''),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      path: String(window.location.pathname || ''),
    };
  }

  async submit() {
    const desc = document.getElementById('rp-desc');
    const description = (desc.value || '').trim();
    if (!description) {
      this._inlineError('Please describe the problem.');
      return;
    }

    const submitBtn = this.modal.querySelector('[data-action="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    const result = await this.dataStore.submitBugReport({
      type: this.type,
      description,
      context: this._context(),
    });

    if (!this.modal) return; // closed while in flight
    if (result.ok) {
      this.modal.querySelector('.modal-body').innerHTML = `
        <div class="rp-thanks">
          <i class="ti ti-circle-check"></i>
          <div class="rp-thanks-title">Thanks — your report was sent to the developer.</div>
        </div>
      `;
      setTimeout(() => this.close(), 1600);
      return;
    }

    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    this._inlineError(result.status === 429
      ? "You've sent several reports recently — please wait a bit."
      : (result.error || 'Could not send the report.'));
  }

  _inlineError(msg) {
    const existing = this.modal.querySelector('.profile-inline-error');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'profile-inline-error';
    div.textContent = msg;
    const actions = this.modal.querySelector('.modal-actions');
    actions.parentNode.insertBefore(div, actions);
    setTimeout(() => { if (div.parentNode) div.remove(); }, 4000);
  }
};
```

- [ ] **Step 2: Menu item in `js/views/TopbarView.js`**

In the account-menu template (currently lines 457–460), add the new item between "Show tour again" and "Sign out":

```js
      <div class="user-menu-item" data-action="scale"><i class="ti ti-zoom-scan"></i>Display size</div>
      <div class="user-menu-item" data-action="edit-profile"><i class="ti ti-user-edit"></i>Edit profile</div>
      <div class="user-menu-item" data-action="show-tour"><i class="ti ti-help"></i>Show tour again</div>
      <div class="user-menu-item" data-action="report-problem"><i class="ti ti-bug"></i>Report a problem</div>
      <div class="user-menu-item" data-action="sign-out"><i class="ti ti-logout"></i>Sign out</div>
```

Then, next to the existing `[data-action="show-tour"]` handler (~line 480), add:

```js
    menu.querySelector('[data-action="report-problem"]').addEventListener('click', () => {
      this.closeUserMenu();
      if (this.controller && this.controller.openReportProblem) this.controller.openReportProblem();
    });
```

- [ ] **Step 3: Controller wiring in `js/controllers/AppController.js`**

Replace lines 54–62:

```js
  attachViews({ toastView, newTaskPage, profileView }) {
    this.toastView = toastView;
    this.newTaskPage = newTaskPage;
    this.profileView = profileView;
  }

  openProfile() {
    if (this.profileView) this.profileView.open();
  }
```

with:

```js
  attachViews({ toastView, newTaskPage, profileView, reportProblemView }) {
    this.toastView = toastView;
    this.newTaskPage = newTaskPage;
    this.profileView = profileView;
    this.reportProblemView = reportProblemView;
  }

  openProfile() {
    if (this.profileView) this.profileView.open();
  }

  openReportProblem() {
    if (this.reportProblemView) this.reportProblemView.open();
  }
```

- [ ] **Step 4: Instantiate in `js/app.js`**

Replace lines 162–163:

```js
  const profileView = new App.ProfileView({ controller });
  controller.attachViews({ toastView, newTaskPage, profileView });
```

with:

```js
  const profileView = new App.ProfileView({ controller });
  const reportProblemView = new App.ReportProblemView({ controller, dataStore });
  controller.attachViews({ toastView, newTaskPage, profileView, reportProblemView });
```

(`dataStore` is already in scope in this function — it's passed to `ApprovalView` at line 212.)

- [ ] **Step 5: Script tag in `app.html`**

After `<script src="js/views/ProfileView.js"></script>` (line 277), add:

```html
<script src="js/views/ReportProblemView.js"></script>
```

- [ ] **Step 6: CSS in `taskmanagement.css`**

Append after the `.profile-inline-error` rule block (~line 4291):

```css
/* ---------- Report a problem modal ---------- */
.report-type-toggle { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#rp-desc { width: 100%; resize: vertical; }
.rp-count { font-size: 10.5px; color: var(--ink-3); text-align: right; margin-top: 4px; }
.rp-note { font-size: 11px; color: var(--ink-3); margin-top: 12px; }
.rp-thanks { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 8px; text-align: center; }
.rp-thanks i { font-size: 34px; color: var(--amber); }
.rp-thanks-title { font-weight: 600; }
```

- [ ] **Step 7: Syntax checks**

Run:
```bash
node --check js/views/ReportProblemView.js
node --check js/views/TopbarView.js
node --check js/controllers/AppController.js
node --check js/app.js
```
Expected: no output (exit 0) for all four.

- [ ] **Step 8: Commit**

```bash
git add js/views/ReportProblemView.js js/views/TopbarView.js js/controllers/AppController.js js/app.js app.html taskmanagement.css
git commit -m "feat(report): Report a problem menu item + modal for all roles"
```

---

### Task 5: Developer "Problem reports" view

**Files:**
- Create: `js/views/ReportsAdminView.js`
- Modify: `js/constants.js:101` (developer permission list)
- Modify: `js/controllers/AppController.js:97` (canView entry)
- Modify: `js/views/SidebarView.js:256` (Team section entry)
- Modify: `js/views/TopbarView.js` (TITLES map line 8–10 + Team dropdown items ~line 160)
- Modify: `js/views/TaskListView.js:226` (applyHeader map)
- Modify: `js/app.js:215` (instantiate)
- Modify: `app.html` (script tag)
- Modify: `taskmanagement.css` (list styles)

**Interfaces:**
- Consumes: `dataStore.listBugReports()` / `dataStore.setBugReportStatus(id, status)` (Task 3); shared `#timeViewWrap` container (any `admin:*` view renders there automatically — see `isTimeView` in `AppController.js:558`); `App.utils.escapeHtml`, `App.utils.formatInstant`.
- Produces: view key `admin:reports`; permission key `bug-reports.manage` (developer only); `App.ReportsAdminView` class (constructor `{ controller, dataStore }`).

- [ ] **Step 1: Permission key in `js/constants.js`**

In the `developer` array (line 101), add `'bug-reports.manage'` after `'task-setup.manage'`:

```js
  developer: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'roles.manage', 'clock.admin', 'team.view', 'home.view', 'reports.view', 'debug.access', 'task-setup.manage', 'bug-reports.manage'],
```

Do NOT add it to any other role (admin included): reports may contain cross-company details, so triage is developer-only, matching the RLS.

- [ ] **Step 2: `canView` in `js/controllers/AppController.js`**

After line 97 (`admin:task-setup`), add:

```js
    if (view === 'admin:reports') return App.can('bug-reports.manage');
```

- [ ] **Step 3: Create `js/views/ReportsAdminView.js`**

```js
window.App = window.App || {};

/* ReportsAdminView — developer-only "Problem reports" triage list. Renders
   into the shared #timeViewWrap like the other admin surfaces (ApprovalView /
   ClockDashboardView / TaskSetupAdminView), activated on the 'admin:reports'
   view. Reports are fetched on activation (not part of the main load());
   the Open⇄Resolved toggle persists through dataStore.setBugReportStatus. */
App.ReportsAdminView = class ReportsAdminView {
  constructor({ controller, dataStore }) {
    this.controller = controller;
    this.dataStore = dataStore;
    this.wrap = document.getElementById('timeViewWrap');
    this.reports = null;   // null = not loaded yet
    this.filter = 'open';  // 'open' | 'resolved' | 'all'

    App.EventBus.on('view:changed', (view) => { if (view === 'admin:reports') this.refresh(); });
  }

  visible() {
    return this.controller.uiState.view === 'admin:reports'
      && this.wrap && !this.wrap.classList.contains('hidden');
  }

  async refresh() {
    if (!this.wrap) this.wrap = document.getElementById('timeViewWrap');
    if (!this.wrap) return;
    if (!App.can('bug-reports.manage')) {
      this.wrap.innerHTML = `<div class="empty"><i class="ti ti-lock"></i><div class="empty-title">No access</div><div class="empty-sub">Only the developer can view problem reports.</div></div>`;
      return;
    }
    if (!this.reports) {
      this.wrap.innerHTML = `<div class="breports"><div class="empty-sub">Loading reports…</div></div>`;
    }
    try {
      this.reports = await this.dataStore.listBugReports();
    } catch (e) {
      this.wrap.innerHTML = `<div class="empty"><div class="empty-title">Couldn’t load reports</div><div class="empty-sub">${App.utils.escapeHtml((e && e.message) || '')}</div></div>`;
      return;
    }
    if (!this.visible()) return; // navigated away while loading
    this.render();
  }

  render() {
    const esc = App.utils.escapeHtml;
    const filtered = (this.reports || []).filter(r =>
      this.filter === 'all' ? true : r.status === this.filter);

    const tabs = [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, l]) => `
      <button type="button" class="theme-opt ${this.filter === v ? 'active' : ''}" data-filter="${v}">${l}</button>
    `).join('');

    const cards = filtered.map(r => {
      const ctx = r.context || {};
      const when = App.utils.formatInstant(new Date(r.created_at).getTime(), {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
      const ctxLine = [ctx.view, ctx.company, ctx.viewport]
        .filter(Boolean).map(esc).join(' · ');
      return `
        <div class="breport-card" data-id="${esc(r.id)}">
          <div class="breport-head">
            <span class="breport-type">${esc(r.type)}</span>
            <span class="breport-name">${esc(r.reporter_name || 'Unknown')}</span>
            <span class="breport-meta">${esc(r.reporter_email || '')}</span>
            <span class="breport-meta">${esc(when)}</span>
          </div>
          <div class="breport-desc">${esc(r.description)}</div>
          ${ctxLine ? `<div class="breport-meta" style="margin-top:6px;">${ctxLine}</div>` : ''}
          ${ctx.userAgent ? `<div class="breport-meta">${esc(ctx.userAgent)}</div>` : ''}
          <div class="breport-actions">
            <button type="button" class="btn" data-toggle-status>
              ${r.status === 'open' ? 'Mark resolved' : 'Reopen'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.wrap.innerHTML = `
      <div class="breports">
        <div class="breports-tabs" role="group" aria-label="Filter reports">${tabs}</div>
        ${cards || `<div class="empty"><i class="ti ti-bug-off"></i><div class="empty-title">No ${this.filter === 'all' ? '' : this.filter + ' '}reports</div></div>`}
      </div>
    `;
    this.bind();
  }

  bind() {
    this.wrap.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.filter;
        this.render();
      });
    });
    this.wrap.querySelectorAll('[data-toggle-status]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.breport-card');
        const report = (this.reports || []).find(r => r.id === card.dataset.id);
        if (!report) return;
        btn.disabled = true;
        try {
          const updated = await this.dataStore.setBugReportStatus(
            report.id, report.status === 'open' ? 'resolved' : 'open');
          Object.assign(report, updated);
          this.render();
        } catch (e) {
          btn.disabled = false;
          if (this.controller.toastView) {
            this.controller.toastView.show({ title: 'Could not update report', sub: (e && e.message) || '' });
          }
        }
      });
    });
  }
};
```

- [ ] **Step 4: Sidebar entry in `js/views/SidebarView.js`**

After line 256 (`admin:task-setup`), add:

```js
    if (App.can('bug-reports.manage')) teamItems.push({ view: 'admin:reports', label: 'Problem reports', icon: 'ti-bug' });
```

- [ ] **Step 5: Topbar wiring in `js/views/TopbarView.js`**

In the `TITLES` map (lines 4–11), add to the line containing `'admin:task-setup'`:

```js
  'admin:task-setup': 'Task setup', 'admin:reports': 'Problem reports',
```

In the Team dropdown items (~line 160, next to the `admin:clock` push), add:

```js
    if (App.can('bug-reports.manage')) teamItems.push({ view: 'admin:reports', label: 'Problem reports', icon: 'ti-bug' });
```

- [ ] **Step 6: Page header in `js/views/TaskListView.js`**

In the `titles` map inside `applyHeader` (line 216–228), after the `'admin:clock'` entry, add:

```js
      'admin:reports':  { eyebrow: 'Admin', title: 'Problem reports' },
```

- [ ] **Step 7: Instantiate in `js/app.js`**

After line 215 (`new App.TaskSetupAdminView({ controller });`), add:

```js
  new App.ReportsAdminView({ controller, dataStore });
```

- [ ] **Step 8: Script tag in `app.html`**

After `<script src="js/views/TaskSetupAdminView.js"></script>` (line 274), add:

```html
<script src="js/views/ReportsAdminView.js"></script>
```

- [ ] **Step 9: CSS in `taskmanagement.css`**

Append below the Report-a-problem modal block added in Task 4:

```css
/* ---------- Problem reports (developer triage) ---------- */
.breports { display: flex; flex-direction: column; gap: 10px; max-width: 860px; padding: 4px; }
.breports-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 92px)); gap: 6px; margin-bottom: 8px; }
.breport-card { background: var(--surface); border-radius: 12px; padding: 14px 16px; }
.breport-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.breport-type { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: var(--amber); }
.breport-name { font-weight: 600; }
.breport-meta { font-size: 11px; color: var(--ink-3); overflow-wrap: anywhere; }
.breport-desc { margin-top: 8px; font-size: 12.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.breport-actions { margin-top: 10px; display: flex; gap: 8px; }
```

- [ ] **Step 10: Syntax checks**

Run:
```bash
node --check js/views/ReportsAdminView.js
node --check js/constants.js
node --check js/controllers/AppController.js
node --check js/views/SidebarView.js
node --check js/views/TopbarView.js
node --check js/views/TaskListView.js
node --check js/app.js
```
Expected: no output (exit 0) for all.

- [ ] **Step 11: Commit**

```bash
git add js/views/ReportsAdminView.js js/constants.js js/controllers/AppController.js js/views/SidebarView.js js/views/TopbarView.js js/views/TaskListView.js js/app.js app.html taskmanagement.css
git commit -m "feat(report): developer-only Problem reports triage view (admin:reports)"
```

---

### Task 6: Tests

**Files:**
- Modify: `tests/role-gate.spec.js` (append one test inside the existing describe block)
- Create: `tests/report-problem.spec.js`
- Modify: `tests/manual-test-checklist.csv` (append rows 66–68)

**Interfaces:**
- Consumes: `test, expect, TEST_USERS` and the `signIn` fixture from `tests/_fixtures.js`; DOM contract from Task 4 (`#userChip` / `#userAvatar` chip, `[data-action="report-problem"]` menu item, `#reportModal`, `#rp-desc`, `[data-action="submit"]`).
- Produces: regression coverage; both specs skip cleanly when TEST_USERS env is absent.

- [ ] **Step 1: Write the role-gate test (function must NOT role-block workers)**

Append inside the `test.describe` block in `tests/role-gate.spec.js`, after the notify-email test:

```js
  test('worker invoking report-problem is NOT role-blocked', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);

    // Deliberate mirror of the notify-email 403 test above: report-problem is
    // open to EVERY approved role (it can only ever email developers), so a
    // worker must never see a role gate. 429 (rate limit) is acceptable.
    const result = await page.evaluate(async () => {
      const { data, error } = await window.App.supabase.functions.invoke('report-problem', {
        body: { type: 'bug', description: 'e2e role-gate probe', context: { view: 'e2e' } },
      });
      return {
        ok: !error,
        status: error?.context?.status ?? null,
        data: data || null,
      };
    });
    expect([401, 403]).not.toContain(result.status);
    if (result.ok) expect(result.data?.ok).toBe(true);
  });

  test('anonymous caller to report-problem gets a 401', async ({ page }) => {
    // Gateway verify-JWT is off, so the function itself must reject a missing
    // bearer token. Hit it raw from the (signed-out) login page.
    await page.goto('/');
    const status = await page.evaluate(async () => {
      await window.App.configReady;
      const res = await fetch(`${window.App.supabaseUrl}/functions/v1/report-problem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: window.App.supabaseAnonKey },
        body: JSON.stringify({ description: 'anon probe' }),
      });
      return res.status;
    });
    expect(status).toBe(401);
  });
```

- [ ] **Step 2: Run it to confirm behavior**

Run: `npx playwright test tests/role-gate.spec.js`
Expected: the new test SKIPS locally if TEST_WORKER_EMAIL is unset; if the test env is configured, it FAILS until the function is deployed to the test project (Task 7) — note the result and move on.

- [ ] **Step 3: Write the modal happy-path spec**

Create `tests/report-problem.spec.js`:

```js
// @ts-check
import { test, expect, TEST_USERS } from './_fixtures.js';

test.describe('report a problem · account menu modal', () => {
  test('worker opens the modal, sees counter, escape closes it', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);

    // The account chip opens the user menu; the menu is appended to <body>.
    await page.locator('#userChip, #userAvatar').first().click();
    await page.locator('.user-menu-item[data-action="report-problem"]').click();

    await expect(page.locator('#reportModal')).toBeVisible();
    await page.fill('#rp-desc', 'Test report from e2e');
    await expect(page.locator('#rp-count')).toHaveText('20 / 2000');
    await expect(page.locator('#reportModal [data-action="submit"]')).toBeEnabled();

    // No submit — this spec must not depend on the edge function.
    await page.keyboard.press('Escape');
    await expect(page.locator('#reportModal')).toHaveCount(0);
  });

  test('empty description shows inline error, modal stays open', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);

    await page.locator('#userChip, #userAvatar').first().click();
    await page.locator('.user-menu-item[data-action="report-problem"]').click();
    await page.locator('#reportModal [data-action="submit"]').click();

    await expect(page.locator('#reportModal .profile-inline-error'))
      .toHaveText('Please describe the problem.');
    await expect(page.locator('#reportModal')).toBeVisible();
  });
});
```

- [ ] **Step 4: Run the new spec**

Run: `npx playwright test tests/report-problem.spec.js`
Expected: SKIPPED locally without TEST_USERS env; PASSES against a configured test project.

- [ ] **Step 5: Append manual checklist rows**

Append to `tests/manual-test-checklist.csv` (IDs continue from 65):

```csv
66,Report,Worker submits a problem report,Worker,Account menu → Report a problem → describe → Send report,Success message; row appears in bug_reports; developer email arrives,Manual,,High,,
67,Report,Rate limit after 5 reports in an hour,Any,Submit 6 reports quickly,6th shows the friendly wait message (429); first 5 stored,Manual,,Medium,,
68,Report,Developer triages a report,Developer,Open Team → Problem reports → Mark resolved,Report moves out of Open tab; resolved_at set; Reopen works,Manual,,High,,
```

- [ ] **Step 6: Commit**

```bash
git add tests/role-gate.spec.js tests/report-problem.spec.js tests/manual-test-checklist.csv
git commit -m "test(report): role-gate + modal specs, manual checklist rows"
```

---

### Task 7: Deploy — DB first, function second, client last

**Files:** none (operational task)

**Interfaces:**
- Consumes: everything above, committed locally.
- Produces: live feature on PROD.

- [ ] **Step 1: Apply migration 059 to PROD**

Using the Supabase MCP tools against project `qqvmcsvdxhgjooirznrj` ONLY:
- `apply_migration` with name `bug_reports` and the exact contents of `supabase/sql/059_bug_reports.sql`.
- Verify with `list_tables`: `bug_reports` exists with RLS enabled.
- Run `get_advisors` (security) and confirm no new findings for `bug_reports`.

- [ ] **Step 2: Deploy the edge function**

- Deploy `report-problem` from `supabase/functions/report-problem/index.ts` via `deploy_edge_function` to `qqvmcsvdxhgjooirznrj`.
- **Verify-JWT must be OFF** (same as notify-email). If the deploy path can't set it, flip it in Dashboard → Edge Functions → report-problem → Details, and confirm.
- If the separate TEST Supabase project (used by Playwright) is configured, deploy the function + apply migration 059 there too so the Task 6 specs can run.

- [ ] **Step 3: Smoke-test the function directly (before any client ships)**

From a signed-in browser session on the current PROD app (DevTools console):

```js
const { data, error } = await App.supabase.functions.invoke('report-problem', {
  body: { type: 'bug', description: 'Deploy smoke test — please ignore.', context: { view: 'smoke' } },
});
console.log(data, error);
```
Expected: `{ ok: true, id: '…', emailed: true }`; a `[Quest HQ] Bug report from …` email arrives at the developer address; one row in `bug_reports` (verify via `execute_sql`: `select id, type, status, reporter_name from public.bug_reports order by created_at desc limit 3;`).

- [ ] **Step 4: Push client code**

```bash
git push origin main
```
Vercel auto-deploys. Watch the deployment (Vercel MCP `list_deployments` / `get_deployment`) until READY.

- [ ] **Step 5: End-to-end verification on PROD**

1. Sign in as the developer → account menu shows "Report a problem" → submit a real report → success message.
2. Email arrives; Team → Problem reports lists it under Open; Mark resolved moves it to Resolved (row's `resolved_at` set).
3. Sign in as (or View-as does NOT cover RLS — use a real) worker account: menu item present, submit succeeds; worker CANNOT see Problem reports in the sidebar.
4. Mark the smoke-test rows resolved or delete them (`execute_sql`: `delete from public.bug_reports where description like '%smoke test%';`).

- [ ] **Step 6: Wrap up**

Update the manual checklist Status column for rows 66–68 if verified, commit any doc touch-ups, and confirm the feature is live.
