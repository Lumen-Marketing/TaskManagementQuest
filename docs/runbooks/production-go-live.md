# Quest HQ production preparation: 072 → 073 → 074

**Preparation only. No production connection, deployment, or push is authorized.**
Production is `qqvmcsvdxhgjooirznrj`; hosted DEV is `ydrekmghdbpkothhmbut`.
Do not run the production examples below until Alexia explicitly authorizes the first
production connection and the subsequent rollout scope.

## Evidence and release gates

The handoff reports a complete hosted DEV browser pass at `2e364e7`, before these
hardening changes. That result does **not** certify the amended migration bytes.
See `production-prep-validation.md` for this session's actual results and blockers.

Required before release:

1. Local PostgreSQL 17 rehearsal, with optional `task_label_sops` both absent and present.
2. Fixed 072 passes policy parity; old 072 at `2e364e7` fails the same check.
3. 073 applies twice and passes roles, exact pricing, history, project guard, and the
   real two-session race; 074 still passes proposal verification.
4. 074/073 rollback rehearsal passes catalog and existing-row fingerprints, refusal
   with data, explicit data-loss override, re-apply, and empty rollback.
5. Re-apply the final 073 to hosted DEV, and update DEV's four 072 task policies.
   **Do not blindly re-run all of 072 on an already-used environment:** its backfill
   assigns every NULL tenant (including tenant-less signup profiles) to tenant 0.
   The guarded `tools/hosted-dev-prep.sh` updates only 072's task-policy phase, then
   applies 073. It does not rebuild DEV, deploy code, or apply rollbacks there.
6. Hosted Phase 3 checks and a new browser pass using the final 073. Browser retest
   is required because Start underwriting now locks concurrent requests and rejects
   invalid/invisible project references.
7. Following separate production authorization: preflight, verified backup, and a
   clone rehearsal with real catalog/data. Resolve drift before any production writes.

Local commands (from the repository, PostgreSQL 17 installed):

```bash
PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH bash tools/dev-rehearse.sh
PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH WITH_TASK_LABEL_SOPS=1 bash tools/dev-rehearse.sh
```

Hosted DEV command, only after local passes and credentials are available:
`PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH bash tools/hosted-dev-prep.sh`
(`DEV_DB_URL` must be set privately).

Each run uses a fresh disposable local cluster over a Unix socket and stops it on
exit. Logs and the data directory remain in the printed work directory. Supplied
work/socket directories must be empty; existing folders are never erased.

## What changed

072 recreates each task policy from its latest definition, preserving creator,
watcher, worker assignment/update/delete, and existing extra-assignee access:
SELECT from 051, UPDATE from 046, INSERT from 041, DELETE from 044. Only the
`general-shift` literal in the four replaced policies becomes `is_shared_bucket`.
The additive 060 policy remains unchanged. Parity compares policy names, roles,
commands, permissiveness, USING and WITH CHECK; only the restrictive tenant wall
and the documented marker substitution are allowed.

073 includes both fixes before its first production application. A transaction
advisory lock serializes creation for a Bid task; under READ COMMITTED the waiter
returns the committed underwriting ID. The primary/unique constraints remain.
Direct REST inserts must reference a caller-visible project with matching company
and tenant. Missing and foreign projects return identical SQLSTATE/message/detail/
hint. Existing update rules forbid re-pointing a project and still allow project
folder deletion to clear its reference. The race test checks the blocking relation
in `pg_stat_activity`, both successful results, one link, and one new underwriting.

Folding these fixes into 073 is appropriate only if preflight confirms production
never received it. If that assumption is wrong, stop and design an additive upgrade.

## Production assumptions to verify, not treat as current facts

Earlier evidence said `tenants`, `task_label_sops`, and `profiles.onboarded` were
absent. Re-check all three. `task_label_sops` is optional; `onboarded` drift is outside
this migration. Verify all 19 required tables and helper functions, including
`assignee_in_company`, and compare **full** task policy definitions with the local
pre-072 catalog (names alone cannot establish parity).

Inspect the deployed `create-user` source and `on_auth_user_created` trigger. Migration
029 can leave that trigger absent on insufficient privileges; 072 only replaces its
function. The repo's tenant-aware Edge Function does not prove the deployed version.
After 072, signup without trusted `app_metadata.tenant_id` creates a tenant-less
profile. There is no workspace-creation UI. Agree on signup handling and stage the
compatible Edge Function under separate deployment approval before 072.

Check all existing users' company/member/role mappings, dangling task companies and
projects, and cross-company project references. DEV seed data cannot establish how
production's real rows behave under the new RLS. Freeze app and signup writes for
backup, migration and verification; set a bounded lock timeout and stop on errors.

## Exact read-only preflight command — not executed during preparation

Obtain the **production direct/session URL** from the dashboard only after approval;
keep it in `PROD_DB_URL`, never paste it into logs. Do not use port 6543. Run from
the repository with a private output directory:

```bash
(
  set -euo pipefail
  : "${PROD_DB_URL:?Set the approved production session/direct URL privately}"
  case "$PROD_DB_URL" in *qqvmcsvdxhgjooirznrj*) ;; *) exit 1;; esac
  case "$PROD_DB_URL" in *ydrekmghdbpkothhmbut*|*:6543*) exit 1;; esac
  umask 077
  mkdir -p work/production-preflight
  PGOPTIONS='-c default_transaction_read_only=on' \
    /opt/homebrew/opt/postgresql@17/bin/psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 \
    -f tools/prod-catalog/go-live-preflight.sql \
    > work/production-preflight/before.txt
)
```

Confirm the URL's actual hostname/user identify production, rather than relying on
its substring guard alone. The SQL opens a REPEATABLE READ, READ ONLY transaction,
uses timeouts, emits catalog definitions and counts, and rolls back. It neither
validates deployed Edge Function code nor captures Auth dashboard configuration.

## PostgreSQL 17 backup and restore gate — after production approval

Use a private shell with `PROD_DB_URL` set and endpoint independently verified as
above. Record Auth settings and retain the currently deployed Edge Function source
separately: neither is protected by a database dump. A logical dump also does not
back up Storage object bytes or platform-managed role passwords.

```bash
(
  set -euo pipefail
  umask 077
  export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
  : "${PROD_DB_URL:?Approved production URL required}"
  case "$PROD_DB_URL" in *qqvmcsvdxhgjooirznrj*) ;; *) exit 1;; esac
  case "$PROD_DB_URL" in *ydrekmghdbpkothhmbut*|*:6543*) exit 1;; esac
  pg_dump --version | grep -E 'PostgreSQL\) 17\.'
  backup_dir="work/production-backups/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup_dir"
  pg_dump "$PROD_DB_URL" --format=custom --file="$backup_dir/database.dump"
  pg_dump "$PROD_DB_URL" --schema-only --file="$backup_dir/schema.sql"
  pg_restore --list "$backup_dir/database.dump" > "$backup_dir/contents.txt"
  test -s "$backup_dir/contents.txt"
  shasum -a 256 "$backup_dir/database.dump" "$backup_dir/schema.sql" > "$backup_dir/SHA256SUMS"
)
```

Confirm the dump includes `auth.users`, identities, all public tables/functions/
policies, and any required extension schemas. Have the operator validate platform
backup/PITR availability and its recovery timestamp. Rehearse restoration into an
isolated, compatible Supabase/local clone using `pg_restore --exit-on-error` and
appropriate roles/extensions. **Do not accept unexplained restore errors.** Compare
counts and visible records for representative admin, supervisor and worker accounts
before and after migrations on that clone. Record successful restoration before
approving Stage 1. Restoring to production itself needs separate approval.

## Rollout order, verification and rollback points

| Stage | Action after approval | Verification | Rollback point |
|---|---|---|---|
| 0 | Read-only preflight, compatible signup plan/Edge Function, write freeze, verified backup + clone rehearsal | Catalog, existing-user visibility, restored rows; auth configuration captured | No migration yet; revert separately deployed function if necessary |
| 1 | Apply final 072 once, with `ON_ERROR_STOP=1` | All scoped non-profile rows stamped; profile backfill accounted for; nullable signup state preserved; tenant walls/stamp triggers; policy parity; unchanged existing row counts and per-user visibility | Restore pre-072 backup/PITR; no generic 072 down script |
| 2 | Apply final 073 | Tables/grants/RLS/guard; controlled create idempotency and error contract; existing rows/visibility unchanged | 073_down, provided 074 absent; backup estimates first if any exist |
| 3 | Apply 074 | Column grants; staff-only access; counter inaccessible to clients; exact approved price; existing rows/visibility unchanged | 074_down, then optionally 073_down |
| 4 | Controlled browser smoke | Login → Bid → estimate → approve → proposal → edit → reload → print | Approved cleanup by exact fixture IDs; preserve numbering history |
| F | Frontend deployment, separately authorized | Production login and proposal flow | Redeploy previous frontend; DB rollback separately evaluated |

Migration command form (after target approval):
`PGOPTIONS='-c lock_timeout=5s' psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/sql/072_multitenant_foundation.sql`
Then use the same form with `073_underwriting.sql`, followed by `074_proposals.sql`.
Capture stdout/stderr privately and stop on nonzero exit. 072 has several committed
phases, so a later error leaves partial state; do not blindly retry. 073 and 074 each
run in one transaction. Re-application is tested on DEV, not required on production.

For existing-user visibility, run each UUID in a read-only transaction with trusted
JWT claims and `SET LOCAL ROLE authenticated`, then compare counts and IDs for
tasks/projects/companies/people/time entries/notifications before and after. Any
unexpected gain or loss is a stop condition. Tenant-less profiles are intentionally
nullable; do not require every future profile to have a tenant.

### Rollback constraints

`supabase/sql/rollback/074_down.sql` must precede `073_down.sql`. Each obtains exclusive
locks with a five-second timeout, runs transactionally, and uses no `CASCADE`.
Unexpected dependencies abort rather than removing unrelated objects. Populated
feature tables refuse removal by default, including proposal counters.

Only after backup and explicit approval of feature-data loss may an operator use:

```bash
psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 \
  -c "set quest.rollback_allow_data_loss='074'" -f supabase/sql/rollback/074_down.sql
psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 \
  -c "set quest.rollback_allow_data_loss='073'" -f supabase/sql/rollback/073_down.sql
```

Omit the `-c` override for empty tables. These scripts intentionally fail if the
migration is absent or partially applied. They are not a substitute for restoring
lost feature data. Re-application recreates empty feature tables.

A generic 072_down is intentionally omitted. 072 overwrites signup code, modifies
existing policies and backfills tenant ownership; without an exact pre-change
catalog/data snapshot, original state cannot be recovered deterministically. New
workspaces/signups make dropping tenant columns especially unsafe. Backup/PITR
restore must itself be rehearsed; writes since the recovery point may be lost.

## Controlled browser smoke — only after separate production approval

Use one throwaway Bid and project with captured UUID/text IDs and an existing admin.
Record existing data/visibility first. A temporary local app config may target
production only in this later, explicitly authorized stage; securely preserve and
restore the previous config. Never use a service-role key in the browser.

1. Confirm existing login and task/project visibility.
2. Create underwriting from the throwaway Bid; repeat from a second tab.
3. Enter `2000, 10, 8000, 4000, 1000, 30`; expect sale price `18571.43`, cost `13000.00`.
4. Submit, approve, generate exactly one proposal; no proposal before approval.
5. Check document text and HTML for internal amounts/fields. Ordinary scope wording
   such as “labor and materials” is allowed; internal labor costs are not.
6. Edit address/scope, save and reload; edits and price persist. Print contains only
   the customer document. Worker/sales cannot read estimates/proposals; supervisor
   cannot approve. Exercise cross-tenant cases on the clone, not with production fixtures.
7. Clean up only captured smoke IDs: proposal, underwriting, task, project. Verify
   counts return to baseline. **Do not reset proposal_counters**: accept the numbering
   gap to avoid colliding with legitimate concurrent or future proposals.

Abraham must review the default terms/payment placeholder, company display name,
and job address before customer use. AI drafting is outside this rollout.
