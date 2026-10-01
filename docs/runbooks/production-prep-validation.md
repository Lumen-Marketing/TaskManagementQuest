# Production-prep validation — 2026-10-01

**Status: implementation prepared; database validation blocked, NOT release-ready.**

Starting branch: `feat/underwriting-integration`. Starting HEAD: `2e364e7`.
Inherited edits: 072, 073, 073 verification, local rehearsal; untracked policy parity,
concurrency test, production runbook/preflight, and hosted DEV diagnostic script.
The diagnostic script is unrelated inherited work and is left uncommitted.

## Observed in this Codex session

| Check | Result |
|---|---|
| 072 source-policy comparison | PASS: SELECT/UPDATE/INSERT/DELETE token-match 051/046/041/044 respectively, with only the shared-bucket substitution |
| 073 change scope | PASS: against `2e364e7`, only the new project guard, advisory lock, and header comment changed |
| Database target guard | PASS: 16 offline cases, including production, deceptive query-string refs, service/hostaddr overrides, wrong port, and local-only mode |
| Shell syntax | PASS: local rehearsal, concurrency, rollback, hosted prep, and hosted verifier |
| Whitespace/conflict-marker diff checks | PASS |
| Local PostgreSQL 17 rehearsal | BLOCKED at initdb: `could not create shared memory segment: Operation not permitted` (`shmget`) |
| 072 live policy parity / negative control | NOT RUN in this session; wired into rehearsal |
| 073 project/error/concurrency checks | NOT RUN in this session; wired into rehearsal |
| 074/073 rollback + re-apply | NOT RUN in this session; wired into rehearsal |
| Hosted DEV migration / Phase 3 | NOT RUN: no DEV database URL / .pgpass / service configuration available to the process |
| Browser retest of amended bytes | NOT RUN; required after hosted DEV SQL passes |
| Production connections / deployments / pushes | NONE |

The existing app config was checked without printing keys: its endpoint is exactly
hosted DEV and its public key is populated. DEV login credentials existing on disk
are not a database-owner connection. No secrets were printed or copied into tracked
files. The earlier hosted browser ALL PASS is handoff evidence for `2e364e7`, not a
new observation or a pass for this amended migration set.

## Implemented checks awaiting execution

- Catalog policy parity compares names, commands, roles, permissiveness, USING and
  WITH CHECK; rejects incomplete snapshots and an absent/altered tenant wall.
- Local rehearsal first applies old 072 from `2e364e7` and demands a parity failure,
  then applies corrected 072 and demands success.
- Project verification clears JWT claims for owner fixtures; compares complete
  SQLSTATE/message/detail/hint for foreign and missing projects; proves valid and
  unfiled inserts, visible other-company rejection, and update re-pointing rejection.
- Two concurrent READ COMMITTED sessions must show B blocked on A's advisory lock,
  return the same UUID, and create exactly one underwriting and link. Cleanup uses
  only UUIDs returned by the run and its specific throwaway task.
- Rollback rehearsal proves out-of-order refusal, populated-data refusal, explicit
  override, exact public-schema restoration, unchanged existing-row fingerprints,
  re-application/functional checks, and empty-table removal without override.
- Hosted preparation avoids 072's repeated tenant backfill, verifies the policy phase
  transactionally, applies 073 twice, preserves saved browser feature rows by rolling
  back temporary test resets, and creates/removes a dedicated race-test task.

## Remaining gates and risks

1. Run both local PostgreSQL 17 variants and resolve any runtime failures. No SQL
   runtime correctness or rollback safety is claimed until they pass.
2. Supply existing DEV owner credentials privately and run guarded hosted preparation,
   then repeat the real-login browser flow on the final bytes.
3. Confirm production's actual catalog, full policy bodies, users and signup trigger
   only after explicit first-connection approval. Earlier production assumptions may
   have drifted. Confirm production has never received 073 before folding it in.
4. Confirm deployed `create-user` tenant metadata and decide public-signup handling;
   no workspace-creation UI exists.
5. 072 commits in phases and backfills NULL tenants. Do not re-run it blindly after
   tenant-less signups exist. No deterministic generic 072_down is supplied: require
   a proven pre-change backup/PITR restore and clone rehearsal.
6. 073/074 down scripts delete feature data when explicitly overridden; they refuse
   populated tables by default and never use CASCADE. Preserve estimates/proposals
   and numbering before an approved rollback.
7. Preserve proposal-counter history during smoke cleanup. Customer-facing terms,
   company name and address still need business review before use.

Exact read-only production preflight and backup/migration/smoke procedures are in
`docs/runbooks/production-go-live.md`. Those are future operator instructions,
not authorization to connect to production now.
