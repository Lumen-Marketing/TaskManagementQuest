# Add Person (admin-created accounts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin or developer add a new person (name + email + role + company) from the User approvals screen; the system creates their login with a fixed default password, makes them immediately assignable, and emails them their credentials.

**Architecture:** A new admin-gated Supabase Edge Function (`create-user`) creates the auth login server-side (the browser can't). The existing `on_auth_user_created` DB trigger (`handle_new_user`) auto-creates the matching `profiles` + `team_members` rows; the function then updates that profile to approved + chosen role/company/supervisor, and emails the person via Resend. The client gets an "+ Add person" button + modal on `ApprovalView`, wired through a new `SupabaseDataStore.createUser`. **No permission or RLS changes** — the feature reuses today's `roles.manage` gate (admin/developer only).

**Tech Stack:** Zero-build static SPA (vanilla JS, `window.App.*` modules), Supabase (Postgres + RLS + Edge Functions on Deno), Resend for email, Playwright for tests.

## Global Constraints

- Runtime is a zero-build static site — no transpiler, no imports in client JS; everything hangs off `window.App`. Match the existing module style (`window.App.X = class …`).
- Edge functions are Deno + TypeScript, deployed with `supabase functions deploy <name>`. Model new functions on the existing `delete-user` / `notify-email` functions exactly (CORS allowlist, JWT-verified, caller approval+role gate, service-role client, payload caps).
- Allowed `profiles.role` values (DB CHECK, migration 048): `worker`, `sales`, `supervisor`, `admin`, `developer`. The Add-person role dropdown must offer only these (it reads `App.ROLES`, which already matches).
- Authority is unchanged from today: only roles with `roles.manage` — **`admin` and `developer`** — may add people. The `create-user` function mirrors `delete-user`'s gate (`admin`, `construction_supervisor` [retired/inert], `developer`). Supervisors are intentionally excluded. No changes to `js/constants.js` permissions or to `can_manage_roles()`.
- Known company ids (migration 027 removed website): `roofing`, `drafting`, `lumen` (`App.COMPANIES`).
- Default password is a server secret `DEFAULT_NEW_USER_PASSWORD` — never hardcoded in client JS or committed.
- HTML built from user input must be escaped (`App.utils.escapeHtml` on the client; the edge function composes from validated/escaped values).
- Never log or return the service-role key, Resend key, or the JWT.

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `supabase/functions/create-user/index.ts` | Privileged create: auth login → approve profile → email | Create |
| `js/services/SupabaseDataStore.js` | `createUser(...)` client call into the function | Modify (after `deleteProfile`, ~line 397) |
| `js/app.js` | Preview-mode stub `createUser` | Modify (preview `dataStore` literal, ~lines 21-43) |
| `js/views/ApprovalView.js` | "+ Add person" button + modal + submit handler | Modify |
| `css/app.css` (or the file holding `.modal`/`.company-multi` rules) | Reuse existing modal/field classes; add small result + header-actions styles | Modify |
| `tests/add-person.spec.js` | Playwright: worker blocked from `create-user`, preview add-person UI flow | Create |

---

## Task 1: `create-user` Edge Function

Server-side privileged creation of the login + approved profile + welcome email. Browser cannot create auth users (needs service-role key), so this mirrors `delete-user`.

**Files:**
- Create: `supabase/functions/create-user/index.ts`
- Test: `tests/add-person.spec.js` (worker-blocked case)

**Interfaces:**
- Consumes: caller JWT (Authorization header), JSON body `{ fullName: string, email: string, role: string, companyIds: string[], supervisorId?: string|null }`.
- Produces: JSON `{ ok: true, profileId: string, memberId: string|null, emailSent: boolean }` on success; `{ error: string }` with status 400/401/403/409/500/503 otherwise. Task 2 (`SupabaseDataStore.createUser`) consumes this contract.
- Relies on the existing `on_auth_user_created` trigger (`handle_new_user`, migrations 029/033) to create the `profiles` + `team_members` rows on auth-user insert. This trigger is a deployment prerequisite (production already has it — self-signup works).

- [ ] **Step 1: Write the function**

Create `supabase/functions/create-user/index.ts`:

```ts
// Supabase Edge Function: create-user
// -----------------------------------------------------------------------------
// Admin-created accounts. Creates an Auth login with a fixed default password,
// relies on the on_auth_user_created trigger (handle_new_user) to create the
// matching profiles + team_members rows, then approves the profile with the
// chosen role/company/supervisor and emails the person their credentials.
//
// The browser can't create Auth users (needs the service-role key), so this runs
// server-side. The Quest HQ client invokes it with
// supabase.functions.invoke('create-user').
//
// DEPLOY (one-time):
//   supabase secrets set DEFAULT_NEW_USER_PASSWORD="<your default>"
//   supabase secrets set APP_URL="https://your-app.vercel.app"      (for the email link)
//   (RESEND_API_KEY, EMAIL_FROM, ALLOWED_ORIGINS already set for notify-email/delete-user.
//    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//   supabase functions deploy create-user
//
// HARDENING (mirrors delete-user/notify-email):
//   - JWT verification on by default; caller must be approved AND a manager role
//     (admin / developer — construction_supervisor kept inert for parity).
//   - Service-role key, Resend key, and default password never leave the server.
//   - Payload size capped; inputs validated; duplicate email rejected.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_PAYLOAD_BYTES = 16 * 1024;
// Matches delete-user's gate and the client App.can('roles.manage') (admin/developer).
// construction_supervisor is retired (no live user holds it) but kept for parity.
const MANAGER_ROLES = new Set(["admin", "construction_supervisor", "developer"]);
const ASSIGNABLE_ROLES = new Set(["worker", "sales", "supervisor", "admin", "developer"]);
const KNOWN_COMPANIES = new Set(["roofing", "drafting", "lumen"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const allowList = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowList.length === 0) {
    console.error("[create-user] ALLOWED_ORIGINS is not set — refusing cross-origin responses.");
    return headers;
  }
  const origin = req.headers.get("Origin") ?? "";
  if (allowList.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface CreatePayload {
  fullName?: unknown;
  email?: unknown;
  role?: unknown;
  companyIds?: unknown;
  supervisorId?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const defaultPassword = Deno.env.get("DEFAULT_NEW_USER_PASSWORD");
    if (!supabaseUrl || !serviceKey) return json(req, { error: "Service credentials are not available." }, 503);
    if (!defaultPassword) return json(req, { error: "Default password is not configured." }, 503);

    // -------- caller authorization (robust to new JWT signing keys) ----------
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!callerJwt) return json(req, { error: "Missing authorization." }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerUser, error: callerErr } = await admin.auth.getUser(callerJwt);
    if (callerErr || !callerUser?.user) return json(req, { error: "Not signed in." }, 401);

    const { data: callerProfile, error: profErr } = await admin
      .from("profiles").select("approved, role").eq("id", callerUser.user.id).single();
    if (profErr || !callerProfile) return json(req, { error: "Not authorized." }, 403);
    const callerRole = typeof callerProfile.role === "string" ? callerProfile.role.trim() : "";
    if (!callerProfile.approved || !MANAGER_ROLES.has(callerRole)) {
      return json(req, { error: "Not authorized to add people." }, 403);
    }

    // -------- input ----------------------------------------------------------
    const lenHeader = req.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > MAX_PAYLOAD_BYTES) return json(req, { error: "Payload too large." }, 413);
    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) return json(req, { error: "Payload too large." }, 413);

    let payload: CreatePayload;
    try { payload = JSON.parse(raw); } catch { return json(req, { error: "Invalid JSON body." }, 400); }

    const fullName = typeof payload.fullName === "string" ? payload.fullName.trim() : "";
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const role = typeof payload.role === "string" ? payload.role.trim() : "";
    const supervisorId = typeof payload.supervisorId === "string" && payload.supervisorId.trim()
      ? payload.supervisorId.trim() : null;
    const companyIds = Array.isArray(payload.companyIds)
      ? [...new Set(payload.companyIds.filter((c): c is string => typeof c === "string"))]
          .filter((c) => KNOWN_COMPANIES.has(c))
      : [];

    if (!fullName || fullName.length > 80) return json(req, { error: "A full name is required." }, 400);
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) return json(req, { error: "A valid email is required." }, 400);
    if (!ASSIGNABLE_ROLES.has(role)) return json(req, { error: "Pick a valid role." }, 400);

    // -------- reject duplicate ----------------------------------------------
    const existing = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (existing.data) return json(req, { error: "That email already has an account." }, 409);

    // -------- create the Auth login (trigger creates profile + team_member) --
    const created = await admin.auth.admin.createUser({
      email,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (created.error || !created.data?.user) {
      const msg = (created.error?.message ?? "").toLowerCase();
      if (msg.includes("already") && msg.includes("registered")) {
        return json(req, { error: "That email already has an account." }, 409);
      }
      console.error("[create-user] createUser failed", created.error);
      return json(req, { error: "Could not create the login." }, 500);
    }
    const newId = created.data.user.id;

    // -------- approve + set role/company/supervisor on the profile -----------
    // handle_new_user() (the on_auth_user_created trigger) just inserted the
    // profile (approved=false, role='worker') and the team_members row. Promote
    // it; the sync triggers (045/039) propagate company_ids/full_name and flip
    // team_members.active to true.
    const updated = await admin.from("profiles")
      .update({ approved: true, role, full_name: fullName, company_ids: companyIds, supervisor_id: supervisorId })
      .eq("id", newId)
      .select("member_id")
      .maybeSingle();
    if (updated.error || !updated.data) {
      console.error("[create-user] profile promote failed", updated.error);
      // Best-effort cleanup so a half-created account doesn't linger.
      await admin.auth.admin.deleteUser(newId).catch(() => {});
      return json(req, { error: "Login created but could not be set up. Ensure the new-user trigger (migration 029) is installed." }, 500);
    }
    const memberId = (updated.data as { member_id: string | null }).member_id;

    // -------- welcome email (non-fatal) -------------------------------------
    let emailSent = false;
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("EMAIL_FROM") ?? "Quest HQ <onboarding@resend.dev>";
    const appUrl = Deno.env.get("APP_URL") ?? "";
    if (apiKey) {
      try {
        const linkLine = appUrl
          ? `<p>Sign in here: <a href="${esc(appUrl)}">${esc(appUrl)}</a></p>`
          : "";
        const html =
          `<p>Hi ${esc(fullName)},</p>` +
          `<p>An account has been created for you on Quest HQ.</p>` +
          `<p><strong>Email:</strong> ${esc(email)}<br/>` +
          `<strong>Temporary password:</strong> ${esc(defaultPassword)}</p>` +
          linkLine +
          `<p>Please change your password after signing in (Profile &rarr; New password).</p>`;
        const res = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [email], subject: "Your Quest HQ account", html }),
        });
        emailSent = res.ok;
        if (!res.ok) console.error("[create-user] email send rejected", res.status);
      } catch (e) {
        console.error("[create-user] email send threw", e);
      }
    }

    return json(req, { ok: true, profileId: newId, memberId, emailSent });
  } catch (err) {
    console.error("[create-user] uncaught", err);
    return json(req, { error: "Internal error." }, 500);
  }
});
```

- [ ] **Step 2: Type-check the function locally**

Run: `deno check supabase/functions/create-user/index.ts`
Expected: no type errors. (If `deno` isn't installed, skip and rely on deploy-time checks; note this in the commit.)

- [ ] **Step 3: Write the worker-blocked authorization test**

Create `tests/add-person.spec.js`:

```javascript
// @ts-check
import { test, expect, TEST_USERS } from './_fixtures.js';

test.describe('add person · create-user authorization', () => {
  test('worker invoking create-user gets a 401/403', async ({ page, signIn }) => {
    test.skip(!TEST_USERS.worker.email, 'TEST_WORKER_EMAIL not set');
    await signIn(TEST_USERS.worker);
    const result = await page.evaluate(async () => {
      const { data, error } = await window.App.supabase.functions.invoke('create-user', {
        body: { fullName: 'Probe Person', email: 'probe-unauthorized@noone.test', role: 'worker', companyIds: [] },
      });
      return { ok: !error, status: error?.context?.status ?? data?.status ?? null };
    });
    expect(result.ok).toBe(false);
    expect([401, 403]).toContain(result.status);
  });
});
```

- [ ] **Step 4: Deploy and run the authorization test**

```bash
supabase secrets set DEFAULT_NEW_USER_PASSWORD="<chosen default>"
supabase secrets set APP_URL="https://<your-app>.vercel.app"
supabase functions deploy create-user
```

Run: `npx playwright test tests/add-person.spec.js --project=local`
Expected: worker-blocked test PASSES (or SKIPPED if `TEST_WORKER_EMAIL` unset).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/create-user/index.ts tests/add-person.spec.js
git commit -m "feat: add create-user edge function for admin-created accounts"
```

---

## Task 2: `SupabaseDataStore.createUser` + preview stub

Thin client bridge to the function, plus an offline/preview stub so the button degrades gracefully.

**Files:**
- Modify: `js/services/SupabaseDataStore.js` (add `createUser` after `deleteProfile`, ~line 397)
- Modify: `js/app.js` (preview `dataStore` literal, ~lines 21-43)

**Interfaces:**
- Consumes: the `create-user` function contract from Task 1.
- Produces: `dataStore.createUser({ fullName, email, role, companyIds, supervisorId })` → resolves to `{ ok, profileId, memberId, emailSent }` or throws an `Error` whose `.message` is the function's `error` string. Task 3 (`ApprovalView`) consumes this.

- [ ] **Step 1: Add `createUser` to `SupabaseDataStore`**

In `js/services/SupabaseDataStore.js`, immediately after the `deleteProfile` method (closes at ~line 397), add:

```javascript
  /* Create a brand-new user (admin-created account). Invokes the create-user
     Edge Function, which makes the Auth login (the browser can't), approves the
     profile with the chosen role/company/supervisor, and emails the person their
     default password. Returns { ok, profileId, memberId, emailSent }. Throws an
     Error carrying the function's message on failure (e.g. duplicate email). */
  async createUser({ fullName, email, role, companyIds, supervisorId }) {
    const { data, error } = await this.supabase.functions.invoke('create-user', {
      body: {
        fullName,
        email,
        role,
        companyIds: Array.isArray(companyIds) ? companyIds : [],
        supervisorId: supervisorId || null,
      },
    });
    if (error) {
      // Supabase wraps a non-2xx as `error`; the JSON body (with our message)
      // is on error.context. Surface the function's message when we can read it.
      let message = error.message || 'Could not add the person.';
      try {
        const body = await error.context?.json?.();
        if (body && body.error) message = body.error;
      } catch { /* fall back to error.message */ }
      throw new Error(message);
    }
    if (!data || !data.ok) throw new Error((data && data.error) || 'Could not add the person.');
    return data;
  }
```

- [ ] **Step 2: Add the preview/offline stub**

In `js/app.js`, inside the `App.previewMode ? { … }` dataStore literal (after the `deleteProfile` stub, ~line 42), add:

```javascript
        createUser: async () => {
          throw new Error('Adding people is not available in preview/offline mode.');
        },
```

(The Task-3 preview test overrides this with a working stub inside the test's page context; the shipped offline stub stays a friendly error.)

- [ ] **Step 3: Sanity-load the app**

Run: `npm run dev` and open the app; confirm no console errors on load (the new method is inert until called). Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add js/services/SupabaseDataStore.js js/app.js
git commit -m "feat: SupabaseDataStore.createUser + preview stub"
```

---

## Task 3: "+ Add person" button, modal, and submit handler

The visible feature. Adds the button to the approvals header, a modal form modeled on `ProfileView`, and a submit that calls `dataStore.createUser`, shows the result, and reloads the roster.

**Files:**
- Modify: `js/views/ApprovalView.js`
- Modify: CSS file holding `.modal`/`.company-multi`
- Test: `tests/add-person.spec.js` (preview UI flow)

**Interfaces:**
- Consumes: `dataStore.createUser(...)` (Task 2); `App.ROLES`, `App.COMPANIES`, `this.supervisorOptions()`, `this.controller.toastView`, `this.reloadAndRender()` (existing).
- Produces: no new outward interface — terminal UI.

- [ ] **Step 1: Add the button to the approvals header**

In `js/views/ApprovalView.js`, in `render()`, change the `approval-head` block so the button sits next to Refresh:

```javascript
          <div class="approval-head">
            <div class="time-section-title">User approvals</div>
            <div class="approval-head-actions">
              <button class="btn btn-sm btn-primary" data-action="add-person"><i class="ti ti-user-plus"></i>Add person</button>
              <button class="btn btn-sm" data-action="refresh-profiles"><i class="ti ti-refresh"></i>Refresh</button>
            </div>
          </div>
```

- [ ] **Step 2: Add a method that builds + opens the modal**

Add this method to the `ApprovalView` class (e.g. after `bind()`):

```javascript
  openAddPerson() {
    if (this._addModal) return;
    const roles = Object.entries(App.ROLES)
      .map(([id, r]) => `<option value="${App.utils.escapeHtml(id)}" ${id === 'worker' ? 'selected' : ''}>${App.utils.escapeHtml(r.label)}</option>`)
      .join('');
    const companies = Object.values(App.COMPANIES).map(c => `
      <label class="company-chk">
        <input type="checkbox" value="${App.utils.escapeHtml(c.id)}" />
        <span>${App.utils.escapeHtml(c.label)}</span>
      </label>`).join('');
    const supervisors = ['<option value="">— None —</option>']
      .concat(this.supervisorOptions(null).map(s => `<option value="${App.utils.escapeHtml(s.id)}">${App.utils.escapeHtml(s.name)}</option>`))
      .join('');

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'addPersonModal';
    modal.innerHTML = `
      <div class="modal" data-stop>
        <div class="modal-head">
          <div class="modal-title">Add person</div>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="field"><label class="field-label" for="ap-name">Full name</label>
            <input type="text" id="ap-name" placeholder="First Last" maxlength="80" /></div>
          <div class="field" style="margin-top:12px;"><label class="field-label" for="ap-email">Email</label>
            <input type="email" id="ap-email" placeholder="name@company.com" maxlength="254" /></div>
          <div class="field" style="margin-top:12px;"><label class="field-label" for="ap-role">Role</label>
            <select id="ap-role">${roles}</select></div>
          <div class="field" style="margin-top:12px;"><label class="field-label">Company</label>
            <div class="company-multi" id="ap-companies">${companies}</div></div>
          <div class="field" style="margin-top:12px;"><label class="field-label" for="ap-supervisor">Reports to</label>
            <select id="ap-supervisor">${supervisors}</select></div>
          <div class="ap-result hidden" id="ap-result"></div>
          <div class="modal-actions">
            <button class="btn" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="submit">Create account</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    this._addModal = modal;

    const close = () => { modal.remove(); this._addModal = null; };
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', close));
    modal.querySelector('[data-action="submit"]').addEventListener('click', () => this.submitAddPerson(modal, close));
    setTimeout(() => { const n = modal.querySelector('#ap-name'); if (n) n.focus(); }, 50);
  }
```

- [ ] **Step 3: Add the submit handler**

Add this method to the class:

```javascript
  async submitAddPerson(modal, close) {
    const name = modal.querySelector('#ap-name').value.trim();
    const email = modal.querySelector('#ap-email').value.trim();
    const role = modal.querySelector('#ap-role').value;
    const supervisorId = modal.querySelector('#ap-supervisor').value || null;
    const companyIds = Array.from(modal.querySelectorAll('#ap-companies input[type="checkbox"]:checked')).map(el => el.value);
    const result = modal.querySelector('#ap-result');

    if (!name) { result.className = 'ap-result error'; result.textContent = 'Enter a full name.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { result.className = 'ap-result error'; result.textContent = 'Enter a valid email.'; return; }

    const btn = modal.querySelector('[data-action="submit"]');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const res = await this.dataStore.createUser({ fullName: name, email, role, companyIds, supervisorId });
      this.controller.toastView.show({
        title: 'Person added',
        sub: res.emailSent ? 'Account created and emailed.' : 'Account created — email could not be sent.',
      });
      close();
      await this.reloadAndRender();
    } catch (err) {
      result.className = 'ap-result error';
      result.textContent = (err && err.message) || 'Could not add the person.';
      btn.disabled = false; btn.textContent = 'Create account';
    }
  }
```

- [ ] **Step 4: Wire the button in `bind()`**

In `bind()`, add (near the refresh handler):

```javascript
    const addBtn = this.wrap.querySelector('[data-action="add-person"]');
    if (addBtn) addBtn.addEventListener('click', () => this.openAddPerson());
```

- [ ] **Step 5: Add minimal styles**

In the CSS file that defines `.modal` / `.company-multi` (search for `.company-multi`), add:

```css
.approval-head-actions { display: flex; gap: 8px; align-items: center; }
.ap-result { margin-top: 12px; font-size: 12px; }
.ap-result.error { color: var(--danger, #c0392b); }
.ap-result.hidden { display: none; }
```

- [ ] **Step 6: Write the preview UI test**

Append to `tests/add-person.spec.js`. This drives preview mode (`?preview=1&role=admin`) and overrides `dataStore.createUser` with a local stub so the flow runs without a live backend:

```javascript
test.describe('add person · UI flow (preview)', () => {
  test('admin can open the form, submit, and see a success toast', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/app.html?preview=1&role=admin&member=abraham`);
    await page.waitForFunction(() => !!window.App && !!window.App.controller);
    // Stub createUser so no backend is needed; simulate a new profile being added.
    await page.evaluate(() => {
      window.App.dataStore.createUser = async ({ fullName, email }) => {
        const id = 'preview-new-' + Math.random().toString(16).slice(2, 8);
        window.App.PROFILES = (window.App.PROFILES || []).concat([
          { id, email, full_name: fullName, approved: true, role: 'worker', member_id: id, company_ids: [] },
        ]);
        return { ok: true, profileId: id, memberId: id, emailSent: true };
      };
      window.App.EventBus.emit('view:changed', 'approvals');
    });
    await page.click('[data-action="add-person"]');
    await page.fill('#ap-name', 'Taylor Tester');
    await page.fill('#ap-email', 'taylor.tester@example.com');
    await page.click('#addPersonModal [data-action="submit"]');
    await expect(page.locator('#toastContainer')).toContainText(/Person added/i, { timeout: 5_000 });
    await expect(page.locator('#timeViewWrap')).toContainText('Taylor Tester', { timeout: 5_000 });
  });
});
```

Confirm the preview-mode route + params match how other preview tests navigate (check `tests/preview-bypass-dead.spec.js` / `tests/_fixtures.js`); adjust the URL/params to match the repo's actual preview entry.

- [ ] **Step 7: Run the UI test**

Run: `npx playwright test tests/add-person.spec.js --project=local`
Expected: the preview UI test PASSES. (Run `npm run dev` in another terminal first if the local project expects a running server — check `playwright.config` `webServer`.)

- [ ] **Step 8: Manual end-to-end verification**

With the function deployed and `DEFAULT_NEW_USER_PASSWORD` set: sign in as an admin, open User approvals, click **Add person**, create a real test person, confirm (a) success toast, (b) the new row appears, (c) the person receives the email, (d) they can sign in with the default password, and (e) they appear in a New-task assignee dropdown.

- [ ] **Step 9: Commit**

```bash
git add js/views/ApprovalView.js css/ tests/add-person.spec.js
git commit -m "feat: Add person button + modal on the approvals screen"
```

---

## Self-Review Notes

- **Spec coverage:** Add-person button + form (Task 3) ✓; create-user function with admin/developer auth gate, duplicate rejection, fixed default password, welcome email, cleanup-on-failure (Task 1) ✓; client wiring + preview stub (Task 2) ✓; default password as server secret (Task 1 deploy) ✓; no constants.js editing for new people (relies on triggers, Task 1) ✓; authority unchanged — supervisors excluded ✓.
- **Out of scope (per spec):** forced password change on first login, unique per-account passwords, CSV import, post-creation name/email editing, any permission/RLS change — none included. ✓
- **Type/contract consistency:** `createUser({ fullName, email, role, companyIds, supervisorId })` and return `{ ok, profileId, memberId, emailSent }` are identical across function (Task 1), data store (Task 2), and view (Task 3). ✓
- **Permission consistency:** `create-user` `MANAGER_ROLES` = {admin, construction_supervisor (inert), developer}, matching `delete-user` and the client `roles.manage` gate (admin/developer). No new permission grants anywhere. ✓
```
