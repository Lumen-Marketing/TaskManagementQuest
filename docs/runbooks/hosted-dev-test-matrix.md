# Hosted DEV test matrix (real Supabase)

Run **only** against the rebuilt DEV project (`ydrekmghdbpkothhmbut`) after
`hosted-dev-rebuild.md` §1–10. **Never** against production `qqvmcsvdxhgjooirznrj`.

Each row lists what is **already proven locally** (Postgres 15 rehearsal, `tools/dev-rehearse.sh`) and
what **only real Supabase can prove**. Tick the last column on the hosted run.

Legend — Local: ✅ proven by the named rehearsal stage · ➖ cannot be tested locally.

## A. Auth, signup and tenancy

| # | Scenario | How (hosted) | Expected | Local | Hosted ☐ |
|---|---|---|---|---|---|
| A1 | Signup with trusted tenant | Auth admin API `createUser` with `app_metadata.tenant_id = <tenant 0>` | profile + `team_members` row created **in that tenant**; `profiles.member_id` set | ✅ stage 7 (signup assertions) — emulated trigger only | ☐ |
| A2 | Tenant-less signup | `supabase.auth.signUp` (or admin create without app_metadata) | profile only: `tenant_id` NULL, `member_id` NULL, **no** `team_members` row | ✅ stage 7 | ☐ |
| A3 | Forged tenant in `user_metadata` | `signUp({options:{data:{tenant_id:"<tenant 0>"}}})` | ignored: profile stays tenant-less; no team member | ✅ stage 7 | ☐ |
| A4 | Malformed tenant | admin create with `app_metadata.tenant_id = "not-a-uuid"` | request **fails**; no profile left behind | ✅ stage 7 | ☐ |
| A5 | Unknown tenant | admin create with a random valid UUID | request **fails** (`tenant … does not exist`); no profile | ✅ stage 7 | ☐ |
| A6 | `create_workspace` | signed in as tenant-less user: `rpc('create_workspace', {business_name, full_name})` | returns a new tenant id; caller becomes `admin`, gets default company + `overall_…`, taxonomy, **and a `team_members` row + `member_id`** | ✅ stage 7 | ☐ |
| A7 | `create_workspace` twice | repeat A6 | error `account already belongs to a workspace` | ➖ (only mentioned in 072 verify comments) | ☐ |
| A8 | **Real** `on_auth_user_created` + Auth admin API | A1–A5 through real GoTrue (not `insert into auth.users`) | same as above; also: a failed trigger must abort the Auth request cleanly | ➖ | ☐ |
| A9 | `create-user` Edge Function | deploy **after** 072; as tenant-0 admin: invoke with name/email/role/companies | new user lands in the **caller's tenant** (check `profiles.tenant_id`, `team_members.tenant_id`); welcome email path non-fatal | ➖ (function not run locally) | ☐ |
| A10 | `create-user` before 072 (compat) | only if testing an old DB | still creates the user (tenant lookup tolerated) | ➖ | ☐ |
| A11 | `create-user` company list | pass a non-Lumen company id | **known limitation:** function hard-codes `roofing/drafting/lumen`; rejected | ➖ documented | ☐ |

## B. Isolation

| # | Scenario | Expected | Local | Hosted ☐ |
|---|---|---|---|---|
| B1 | Tenant A reads tenant B's companies/tasks/underwritings/history/links | 0 rows | ✅ 072 verify + extras | ☐ |
| B2 | Tenant B calls `create_underwriting_for_task('<tenant-0 bid>')` | error, nothing created | ✅ extras | ☐ |
| B3 | Tenant B calls `save_underwriting_estimate` on a tenant-0 id | error / 0 rows updated | ✅ extras | ☐ |
| B4 | Cross-tenant insert with explicit foreign `tenant_id` | rejected | ✅ 072 verify | ☐ |
| B5 | `developer` role is tenant-clamped | developer in tenant B sees no tenant-0 rows | ➖ (072 verify §4 is optional/commented) | ☐ |
| B6 | Underwriting pointed at another tenant's `project_id` via direct API | **today accepted** (FK ignores RLS) — see open items §2 | ✅ reproduced; patch validated | ☐ |

## C. Roles and margin visibility

| # | Role | Expected | Local | Hosted ☐ |
|---|---|---|---|---|
| C1 | worker | no underwritings/history/links visible; create fails; **no Underwriting tab** | ✅ extras (SQL); tab ➖ | ☐ |
| C2 | sales | same as worker (resolves to `worker`) | ✅ extras | ☐ |
| C3 | supervisor | reads company underwritings, edits, submits; **cannot approve or decline** (`P0001`) | ✅ extras + postgrest-shape | ☐ |
| C4 | supervisor on a Bid task they cannot see | cannot *create* (task invisible to RLS) but can read/edit existing | ✅ extras (documented behaviour) | ☐ |
| C5 | admin | create, edit, submit, approve, decline | ✅ 073 verify | ☐ |
| C6 | developer | same as admin | ✅ extras | ☐ |
| C7 | "View as" role switch (developer) | tab appears/disappears with the effective role | ➖ | ☐ |

## D. Bid ↔ underwriting

| # | Scenario | Expected | Local | Hosted ☐ |
|---|---|---|---|---|
| D1 | Bid task, project-filed | underwriting created; `project_id` carried; client shown from `projects.client` | ✅ | ☐ |
| D2 | Bid task, unfiled | created with `project_id` NULL | ✅ extras | ☐ |
| D3 | Non-Bid task | `P0001 underwriting can only be created for a Bid task`; tab not shown | ✅ (tab ➖) | ☐ |
| D4 | Create twice / double-click | same underwriting returned; one link | ✅ (sequential); client in-flight guard ✅ unit; **concurrent** race ✅ reproduced + patch validated | ☐ |
| D5 | Delete the project folder | task unfiled; underwriting (even approved) survives with NULL project | ✅ extras | ☐ |
| D6 | Delete the Bid task | link cascades; underwriting row remains (orphan, readable by staff) | ➖ not asserted | ☐ |

## E. Estimate, history, locking

| # | Scenario | Expected | Local | Hosted ☐ |
|---|---|---|---|---|
| E1 | First save | 6 history rows, `old_value` NULL ("Not entered"), reason recorded | ✅ | ☐ |
| E2 | Edit one input | exactly one history row, old→new, actor, timestamp | ✅ | ☐ |
| E3 | Save identical values | no history rows | ✅ | ☐ |
| E4 | Status change | history row with note | ✅ | ☐ |
| E5 | History is append-only | client `update/delete/insert` on history all denied | ✅ | ☐ |
| E6 | Approve | `approved_by/at` stamped; numbers lock; back-to-draft refused | ✅ | ☐ |
| E7 | Decline then reopen | only → draft allowed; edits refused while declined | ✅ | ☐ |
| E8 | Derived figure ≠ inputs (tampered) | `23514` check violation | ✅ | ☐ |
| E9 | Overflow input | blocked **client-side** with a clear message; DB would return `22003` | ✅ unit + sqlstate | ☐ |
| E10 | Calculation parity | 545/545 JS results accepted by DB CHECKs | ✅ stage 12 | ☐ |

## F. PostgREST (the thing local cannot reproduce)

| # | Scenario | Expected | Local | Hosted ☐ |
|---|---|---|---|---|
| F1 | `POST /rest/v1/rpc/save_underwriting_estimate` with **numeric strings** (`"8000.00"`) | 204; values stored exactly | ✅ `json_to_record` mechanism only | ☐ |
| F2 | Same with JSON numbers and `null` roof area | 204; null stored | ✅ mechanism only | ☐ |
| F3 | `P0001` surfaces | PostgREST returns `code:"P0001"` + the authored `message`; UI toast shows it | ✅ SQLSTATE; PostgREST mapping ➖ | ☐ |
| F4 | `23514`/`22003`/RLS | generic "Could not …"/permission message, no raw SQL leaked | ➖ | ☐ |
| F5 | `task_underwriting_links` embed `underwritings(*)` | returns the record as an object; hidden by RLS ⇒ `null` handled | ➖ | ☐ |
| F6 | After DDL | `notify pgrst, 'reload schema'` so new RPCs are visible | ➖ | ☐ |

curl shape (variable names only; get the user JWT by signing in with the **anon** key):

```bash
curl -s -X POST "$DEV_URL/rest/v1/rpc/save_underwriting_estimate" \
  -H "apikey: $DEV_ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"p_id":"<uuid>","p_roof_area_sqft":"2500.00","p_waste_percent":"10.00","p_material_cost":"8000.00",
       "p_labor_cost":"6000.00","p_other_cost":"1000.00","p_target_margin_percent":"35.00",
       "p_adjusted_roof_area_sqft":"2750.00","p_squares":"27.50","p_total_estimated_cost":"15000.00",
       "p_recommended_sale_price":"23076.92","p_reason":"hosted smoke"}'
```

## G. Browser workflow (sign in for real; `env.json` → DEV URL + anon key)

| # | Step | Expected | Hosted ☐ |
|---|---|---|---|
| G1 | Open a **non-Bid** task | no Underwriting tab | ☐ |
| G2 | Open a **Bid** task as admin | Underwriting tab → "Start underwriting" | ☐ |
| G3 | Start; type partial inputs; wait >30 s (poll) / trigger a task edit elsewhere | typed values and caret survive the re-render | ☐ |
| G4 | Save with a blank required field | field-level errors; focus not lost; `aria-invalid` set | ☐ |
| G5 | Save valid inputs | toast only **after** success; Breakdown shows inputs/formula/calculation/rounding/source for every figure; "Verified ✓" | ☐ |
| G6 | Enter key | saves only when something changed | ☐ |
| G7 | Double-click Save / Start / a decision button | one request, one history entry | ☐ |
| G8 | Submit for review → sign in as supervisor | sees Waiting-for-admin; no approve/decline buttons | ☐ |
| G9 | Admin approves | status chip + approver/time; inputs disabled; history row | ☐ |
| G10 | Worker/sales login on the same Bid task | no tab; no estimate numbers anywhere | ☐ |
| G11 | Phone width | grid collapses to 2 columns; no horizontal scroll | ☐ |
| G12 | Offline/failed load | "Couldn't load underwriting" + Retry (no render loop) | ☐ |
| G13 | Dark/light theme | tokens only; readable | ☐ |
