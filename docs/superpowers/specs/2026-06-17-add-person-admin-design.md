# Add Person (admin-created accounts) — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Problem

Today there is no way to add a person to Quest HQ by name and email. People
get in only by self-signing-up and then being approved. Admins want to create
the account *for* a person and hand them a known password to log in with.

## Goal

Let an authorized admin add a new person from the **User approvals** screen by
entering their name, email, role, and company. The system creates everything
needed for that person to log in and be assigned tasks immediately, sets their
password to a fixed default, and emails them their login details.

## Authority

Only callers who are **approved** AND hold a role with `roles.manage`
(**`admin`** or **`developer`**) may add people. This is exactly today's gate
on the User approvals screen (`App.can('roles.manage')` on the client) and the
`delete-user` function (`construction_supervisor` is kept inert for parity but
is a retired role no live user holds). **No permission/RLS changes are made** —
supervisors are intentionally NOT included.

## User experience

On the **User approvals** screen (`ApprovalView`), add a **"+ Add person"**
button next to the existing "Refresh" button. Clicking it opens a small modal
form:

- **Full name** — required
- **Email** — required, validated
- **Role** — dropdown from `App.ROLES`, defaults to Worker
- **Company** — checkboxes from `App.COMPANIES` (Roofing / Drafting / Lumen)
- **Reports to** — optional supervisor dropdown (reuses
  `ApprovalView.supervisorOptions()`)

On submit:

- The person is created **already approved** and ready to use.
- A success confirmation appears (toast + inline note) stating the account was
  created and the login details were emailed.
- The roster reloads so the new person appears as a row immediately.

Error cases surface as clear messages:

- Duplicate email → "That email already has an account."
- Email send failure → account still created; note "Account created, but the
  welcome email could not be sent — give them the default password directly."

## Password

A **single fixed default password** is used for every new account.

- Stored as a Supabase function secret (`DEFAULT_NEW_USER_PASSWORD`), NOT in
  client code, so it is never exposed in the website bundle and can be rotated
  without a code change.
- The `create-user` function sets each new auth user's password to this value
  with the email pre-confirmed, so the person can log in immediately.
- The person can change their password later from their profile (existing
  `AuthModel.updatePassword` flow). No forced change on first login (per
  decision).

**Security note (accepted tradeoff):** a shared default password is weaker than
a unique per-account password — anyone who knows it could attempt it on a freshly
created account before the person logs in. Accepted for operational simplicity
in a small internal tool. A future hardening step could move to unique random
passwords and/or force a change on first login.

## What happens under the hood

The browser cannot create auth logins (that needs the service-role key), so a
new **`create-user`** Supabase Edge Function is added, modeled directly on the
existing `delete-user` function (CORS allowlist, JWT verification, caller
approval + manager-role check, service-role client, payload size caps).

Order of operations inside `create-user`:

1. **Authorize caller** — verify JWT, load caller profile, require
   `approved === true` and role in {admin, construction_supervisor (inert),
   developer}. Supervisors are excluded, matching `delete-user`.
2. **Validate input** — full name, email (regex), role (must be a known role),
   company ids (subset of known companies), optional supervisor member id.
3. **Reject duplicate** — if an auth user / profile already exists for the
   email, return a clear 409-style error.
4. **Create auth login** — `admin.auth.admin.createUser({ email, password:
   DEFAULT_NEW_USER_PASSWORD, email_confirm: true, user_metadata: { full_name }})`.
5. **Create team_members row** — generate a member slug from the name
   (e.g. "John Smith" → `johnsmith`, de-duplicated if taken), assign an avatar
   color, set `company_ids`. This row is what makes the person appear in
   assignee pickers and gives them an avatar color.
6. **Create/upsert profile row** — id = new auth user id, email, full_name,
   role, `approved: true`, `member_id` = slug, `company_ids`, `supervisor_id`.
   (If a DB trigger auto-creates the profile on user creation, upsert the
   chosen fields onto it.)
7. **Email the person** — send login + default password via Resend, mirroring
   the `notify-email` function's Resend call (uses existing `RESEND_API_KEY` /
   `EMAIL_FROM` secrets). Email failure is non-fatal and reported back.
8. **Return** `{ ok: true, profileId, memberId, emailSent }`.

If any step after the auth user is created fails hard, the function attempts a
best-effort cleanup (delete the just-created auth user) so a half-created
account doesn't linger, then returns an error.

## Client wiring

- **`SupabaseDataStore`**: add `createUser({ fullName, email, role, companyIds,
  supervisorId })` that invokes the `create-user` function and returns its
  result (parallel to the existing `deleteProfile` → `delete-user`).
- **`ApprovalView`**: add the "+ Add person" button, the modal form, submit
  handler calling `dataStore.createUser(...)`, success/error toasts, and a
  roster reload (`reloadAndRender`) on success.
- **App offline shim** (`js/app.js` no-Supabase branch): add a stub
  `createUser` that returns a friendly "not available offline" error so the
  button degrades gracefully when Supabase isn't configured.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `create-user` edge function | Privileged creation of auth + team_member + profile, send welcome email | service-role key, Resend secrets |
| `SupabaseDataStore.createUser` | Thin client call into the function | supabase client |
| `ApprovalView` Add-person UI | Collect input, call data store, reflect result | `App.ROLES`, `App.COMPANIES`, supervisorOptions |

## Out of scope (YAGNI)

- Forced password change on first login.
- Unique per-account passwords.
- Bulk / CSV import.
- Editing name/email through this form after creation (role/company/approval
  stay editable in existing roster rows).

## Testing

- Edge function: caller authorization (unauthorized role rejected), duplicate
  email rejected, happy path creates all three records, email-failure path
  still returns `ok` with `emailSent: false`, half-create cleanup on hard error.
- Client: button hidden for non-managers, form validation, success reloads
  roster and shows new row, error surfaces a toast.
- Manual: create a person, confirm they receive the email, log in with the
  default password, and appear in an assignee dropdown.

## Deployment notes

- `supabase secrets set DEFAULT_NEW_USER_PASSWORD="<chosen default>"`
- `supabase secrets set` for `RESEND_API_KEY` / `EMAIL_FROM` / `ALLOWED_ORIGINS`
  already exist (used by notify-email / delete-user).
- `supabase functions deploy create-user`
