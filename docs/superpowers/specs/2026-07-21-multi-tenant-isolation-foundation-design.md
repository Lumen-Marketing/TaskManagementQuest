# Multi-Tenant Isolation Foundation — Design Spec

**Date:** 2026-07-21
**Status:** Approved (brainstorm) → ready for implementation plan
**Sub-project:** #1 of the "Quest HQ as multi-tenant SaaS" program (foundation; #2 self-serve onboarding, #3 tenant admin console, #4 billing come later)

---

## One-line summary (for the boss)

Right now the app was built for just us, so every business's data lives in one shared space. This builds a wall so every business that signs up sees **only its own stuff** — its own tasks, people, and settings — with no way to peek into anyone else's. It's the one thing we must do before we can safely take on paying customers.

## Problem

Quest HQ is **single-tenant** today. There is one org (Lumen). "Companies" (Roofing, Drafting, Lumen, …) are **workspaces inside that one org**, all in one shared `public.companies` table. The only thing separating data is the rule, everywhere:

> you can see a task if its `company_id` is in your `profiles.company_ids`
> (see `supabase/sql/028_company_scoping_rls.sql`)

There is **no tenant boundary**. Consequences that make onboarding an outside business unsafe today:

- The `developer` role is **god-mode across every company** — fine for us, fatal if an outside business shares the table.
- A single mis-set `company_ids` array, or a shared company id (`general-shift`, `overall`), would leak one business's data into another's.
- No signup that creates a business, no per-business admin walled off from the others.

The task-taxonomy setup screen (types/statuses/labels/SOPs) is **already per-company** — so the customization the boss originally pictured largely exists. The real gap is the isolation wall, which is what this spec delivers.

## Decisions (locked during brainstorm)

| Decision | Choice |
|---|---|
| Isolation approach | **A — explicit `tenant_id` on every tenant-scoped table** (not derived-via-join, not schema-per-tenant) |
| User ↔ tenant | **One account, one business, forever** |
| Cross-tenant super-admin login | **None** — support access is a separate, deliberate door (see Support Access) |
| Tenant creation in this piece | **Basic public "create your workspace" signup**, open to anyone (polished onboarding = #2) |
| Teammate join | **Admin email invite only** (invite carries the tenant) |
| Signup gating | **Open to anyone** (approval/billing deferred to #4) |
| `developer` god-mode | **Retired / re-scoped to its own tenant** |

## Approach A — why

Add an explicit `tenant_id` column to every table holding business data, and AND `tenant_id = current_tenant_id()` onto **every** RLS policy on top of the existing role/company logic.

- One cheap, indexed, unambiguous gate per row; **fails closed**.
- Defense-in-depth: a leak requires **two** independent bugs, not one.
- The entire existing company-scoping model stays exactly as-is — just nested **inside** a tenant.
- Standard Supabase multi-tenant pattern; auditable.

Rejected: **B (derive tenant from company via join)** — slower (subquery per RLS check), awkward for tables without a clean `company_id` (`notifications`, `time_entries`, `profiles`), larger failure surface. **C (schema-per-tenant / separate DBs)** — total rewrite for a zero-build static SPA on shared Supabase; every migration becomes N×; overkill.

## Design

### 1. Tenant model
- New `public.tenants` table: `id`, `name` (business name), `status`, `created_at`.
- Add `tenant_id` (FK → `tenants.id`) to: `profiles`, `companies`, `tasks`, `projects`, `team_members`, the taxonomy tables (types / statuses / labels / SOPs), `notifications`, `time_entries`, `active_timers`. (Confirm the full table list against the schema during planning — this is the working set.)
- A user's tenant lives on `profiles.tenant_id` and **cannot be self-changed** (extend the existing self-update lock that already protects `role` / `approved` / `company_id`).

### 2. The isolation wall
- Helper `public.current_tenant_id()` — SECURITY DEFINER, STABLE, locked `search_path`, coalesced to fail closed — reads the caller's `profiles.tenant_id` (mirrors `current_company_ids()` in migration 028).
- **Every** RLS policy on every tenant-scoped table gains `tenant_id = public.current_tenant_id()`, ANDed with the existing role/company logic.
- A `BEFORE INSERT` trigger auto-stamps `tenant_id = current_tenant_id()` on each tenant-scoped table so no app code can forget it, and rejects inserts that try to set a foreign tenant.

### 3. Account creation (basic create-tenant flow)
- Public **"Create your workspace"** page: business name, admin name, email, password. Open to anyone.
- On submit, one transaction (edge function / RPC with elevated rights) mints:
  1. the **tenant** row,
  2. the submitter's **profile as the first Admin** of that tenant,
  3. a **seeded default taxonomy** (sensible starter types/statuses/labels, e.g. Lead → Working → Done) so the app isn't empty on day one.
- User lands in their own empty HQ.
- Teammates join **only via Admin email invite**; the invite token carries the tenant, so a new teammate is stamped with the correct `tenant_id` and can never land in the wrong business.

### 4. Shared-row landmines (must defuse)
Two rows are currently carved out of RLS **globally**, which would leak across tenants:
- `general-shift` — shared clock-in bucket (carve-out `... or id = 'general-shift'` in migration 028).
- `overall` — the spans-all-companies pseudo-company (migration 067).

Fix: make **both per-tenant** (each business gets its own `general-shift` / `overall`), so the carve-out only ever matches the caller's own tenant's row. Update the carve-out predicates to be tenant-scoped.

### 5. Retire `developer` god-mode
- The `developer` role currently bypasses the company gate ("ALL tasks, ALL companies"). Re-scope it to its **own tenant** like every other role, or remove it.
- No in-app role may read across tenants.

### 6. Migrate Lumen into "tenant 0"
- In the same migration, create the Lumen tenant and backfill **every existing row** (85 tasks, all users, all companies) with that `tenant_id`.
- The app keeps working unchanged; Lumen simply becomes the first tenant.
- Backfill must run before the `NOT NULL` / trigger constraints are enforced, so no existing row is left tenantless.

### 7. Support / debug access (Layers 1 + 2)
Cross-tenant support is a **separate, deliberate door**, not a normal login:
- **Layer 1 — "Report a problem"** (already built, `bug_reports`): a business reports a bug with its context attached; developers fix most issues from the report alone, no data access needed.
- **Layer 2 — Supabase service role (back office)**: when deeper debugging is needed, developers read any tenant's rows through the Supabase service key — **outside the app**, not a customer-visible login, and logged. This keeps the app perfectly sealed while devs can always see and fix a bug in any business.
- **Layer 3 — in-app consent-based "support mode"** (time-boxed, business-toggled, logged): **out of scope here**, noted as a future option alongside the admin/billing sub-projects.

## Success criteria (part of the deliverable)
- Create two test tenants (A and B), seed tasks / projects / people / notifications / time entries in each.
- From Business A's login, verify Business B's rows are **completely invisible and unwritable** — confirmed at the **database (RLS)** level, not just the UI:
  - A cannot `select` any B row on any tenant-scoped table.
  - A cannot `insert`/`update` a row into B's tenant (trigger + WITH CHECK reject it).
  - A cannot move a row into B's tenant.
  - `general-shift` / `overall` visible to A are A's own, never B's.
- Existing Lumen (tenant 0) behavior is unchanged — the current company-scoping / role tests still pass.
- These tests ship with the migration.

## Out of scope (later sub-projects)
- Polished self-serve onboarding / trial UX (#2).
- Tenant admin console beyond the existing per-company setup screen (#3).
- Billing, plans, seats, approval-gated signup (#4).
- In-app support-mode impersonation (Layer 3).

## Risks & notes
- **Every** tenant-scoped table must be found and covered — a missed table is a silent leak. Enumerate the full schema during planning; the §1 list is the working set, not verified-complete.
- Backfill ordering (data before constraints) is critical; wrap the migration in a transaction and verify counts.
- Follow repo migration conventions (idempotent, transaction-wrapped, verify query at the bottom) as in migrations 028 / 067.
- Deploy to PROD (`qqvmcsvdxhgjooirznrj`) only after the two-tenant isolation test passes on a copy.
