#!/bin/bash
# DEV-ONLY: rebuild Quest HQ on a THROWAWAY LOCAL Postgres and verify 072 + 073.
# Touches no hosted project: no network, unix socket only, data dir under $WORK,
# torn down on exit. The replay order below is explicit (not `sort`) — see the
# per-step comments for every skip and insertion.
#
# usage: tools/dev-rehearse.sh [workdir]        (needs postgres/initdb/psql/node on PATH)
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$REPO/supabase/sql"; BS="$SQL/bootstrap"
WORK="${1:-$(mktemp -d "${TMPDIR:-/tmp}/questhq-rehearsal.XXXXXX")}"
SOCK="${PGSOCK:-$(mktemp -d /tmp/qhq-sock.XXXXXX)}"     # short path: unix sockets cap at ~100 bytes
D="$WORK/pgdata"; LOG="$WORK/replay.log"
# Never remove a caller-supplied directory or reuse another cluster's socket.
for dir in "$WORK" "$SOCK"; do
  if [ -L "$dir" ] || { [ -e "$dir" ] && { [ ! -d "$dir" ] || [ -n "$(ls -A "$dir")" ]; }; }; then
    echo "ABORT: rehearsal requires new or empty work/socket directories"; exit 1
  fi
done
mkdir -p "$WORK" "$SOCK"
: > "$LOG"
say()  { echo "$@" | tee -a "$LOG"; }
fail() { say "FAILED at: $1"; say "--- last output ---"; tail -15 "$WORK/last.out" | tee -a "$LOG"; exit 1; }

say "Rehearsal directory: $WORK"
initdb -D "$D" -U postgres --auth=trust > "$WORK/initdb.log" 2>&1 || { echo "initdb failed"; tail -12 "$WORK/initdb.log"; exit 1; }
pg_ctl -D "$D" -o "-c listen_addresses='' -c unix_socket_directories=$SOCK" -l "$WORK/pg.log" -w start >/dev/null 2>&1 \
  || { echo "pg start failed"; tail -5 "$WORK/pg.log"; exit 1; }
trap 'pg_ctl -D "$D" -m immediate stop >/dev/null 2>&1; rm -rf "$SOCK"; echo "[teardown] local cluster stopped" | tee -a "$LOG"' EXIT
PSQL() { psql -h "$SOCK" -U postgres -d quest -X -q -v ON_ERROR_STOP=1 "$@"; }
run()  { # run <label> <file> : stop at first error
  PSQL -f "$2" > "$WORK/last.out" 2>&1 || fail "$1 ($2)"
  grep -qE "^(psql:.*)?ERROR|FAIL" "$WORK/last.out" && fail "$1 ($2)"
  say "ok   $1"
}
psql -h "$SOCK" -U postgres -d postgres -X -q -c "create database quest" >/dev/null
say "Postgres: $(psql -h "$SOCK" -U postgres -d quest -Atc 'select version()')"

say "== 0. local Supabase shim (roles, auth, storage) =="
run "shim" "$BS/local_supabase_shim.sql"

say "== 1. baseline: profiles (predates 003, created in the dashboard) =="
run "000_dev_baseline" "$BS/000_dev_baseline.sql"

say "== 2. canonical numbered history 003..068 =="
# SKIPPED: 042 — production-only repair of profiles.company_ids (jsonb -> text[]).
#   On a clean DB 021 already creates text[], so 042's ::text::jsonb cast has nothing to repair.
#   (tools/test-db-setup.sql skips it for the same reason.)
# 004 + 020 (demo seed, then clear-seed) are a pair: both are run, in order.
# 059_bid_pipeline sorts before 059_bug_reports; the two are independent.
for f in $(ls "$SQL"/[0-9]*.sql | sort); do
  b=$(basename "$f")
  n=${b%%_*}
  [ "$n" -gt 068 ] && continue
  [ "$n" = "042" ] && { say "SKIP $b (production-only repair; see comment)"; continue; }
  run "$b" "$f"
done

say "== 3. task_label_sops is OPTIONAL (absent in production) =="
# Default: leave it ABSENT, as in production — 072 must succeed without it.
# WITH_TASK_LABEL_SOPS=1 installs the DEV-ONLY PROVISIONAL stand-in first, to prove
# 072 also walls the table safely where it does exist.
if [ "${WITH_TASK_LABEL_SOPS:-0}" = "1" ]; then
  run "000b_dev_baseline_task_label_sops (PROVISIONAL, opt-in)" "$BS/000b_dev_baseline_task_label_sops.sql"
else
  say "skip 000b (task_label_sops stays absent, like production)"
fi

say "== 4. 070, 071 =="
for b in 070_checkin_settings.sql 071_checkin_log.sql; do run "$b" "$SQL/$b"; done

say "== 5. every table 072 will wall must exist =="
PSQL -At -c "select t from unnest(array['profiles','companies','team_members','tasks','task_comments','comment_reactions','projects','schedules','time_entries','active_timers','notifications','reminder_log','task_types','task_type_statuses','task_labels','bug_reports','checkin_settings','checkin_log','wo_counters']) t where to_regclass('public.'||t) is null" > "$WORK/last.out" 2>&1
[ -s "$WORK/last.out" ] && { say "missing tables:"; cat "$WORK/last.out" | tee -a "$LOG"; exit 1; }
say "ok   all 19 required pre-072 tables present (task_watchers, task_subtasks, task_activity were dropped by 013)"
for fn in current_profile_role current_member_id current_company_ids can_manage_roles assign_wo_number handle_new_user; do
  [ "$(PSQL -At -c "select count(*) from pg_proc where proname='$fn' and pronamespace='public'::regnamespace")" = "1" ] || { say "missing function $fn"; exit 1; }
done
say "ok   helper functions present"

say "== 6. 072 multitenant foundation =="
PSQL -c "create table public._pre072_policies as select policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname='public' and tablename='tasks'" > "$WORK/last.out" 2>&1 || fail "policy snapshot"
# Negative control: the previous, regressing 072 MUST fail this same parity check.
git -C "$REPO" show 2e364e7:supabase/sql/072_multitenant_foundation.sql > "$WORK/old072.sql" || fail "old 072 control unavailable"
run "old 072 negative-control setup" "$WORK/old072.sql"
if PSQL -f "$SQL/verify/072_policy_parity_check.sql" > "$WORK/last.out" 2>&1; then
  fail "parity accepted the old regressing 072"
fi
grep -q 'changed beyond the shared-bucket substitution' "$WORK/last.out" || fail "negative control failed for unexpected reason"
say "ok   parity rejects old 072"
run "072_multitenant_foundation" "$SQL/072_multitenant_foundation.sql"
PSQL -f "$SQL/verify/072_policy_parity_check.sql" > "$WORK/last.out" 2>&1 || fail "072 policy parity"
grep -q "072 policy parity: ALL CHECKS PASSED" "$WORK/last.out" || fail "072 policy parity (no pass marker)"
PSQL -c "drop table public._pre072_policies" > /dev/null 2>&1
say "ok   072 policy parity: tasks policies unchanged except the shared-bucket marker (041/043/044/046/051 preserved)"
if [ "${WITH_TASK_LABEL_SOPS:-0}" = "1" ]; then
  [ "$(PSQL -At -c "select count(*) from pg_policies where tablename='task_label_sops' and policyname='tenant_isolation_task_label_sops' and permissive='RESTRICTIVE'")" = "1" ] \
    && [ "$(PSQL -At -c "select attnotnull from pg_attribute where attrelid='public.task_label_sops'::regclass and attname='tenant_id'")" = "t" ] \
    || { say "FAILED: present task_label_sops was not walled by 072"; exit 1; }
  say "ok   present task_label_sops: tenant_id NOT NULL + RESTRICTIVE wall + stamp trigger"
else
  [ "$(PSQL -At -c "select to_regclass('public.task_label_sops') is null")" = "t" ] || { say "FAILED: 072 created task_label_sops"; exit 1; }
  say "ok   absent task_label_sops: 072 succeeded and did not create it"
fi

say "== 7. dev identities AFTER 072, through BOTH signup paths (handle_new_user, 072 TASK 8) =="
run "local_seed_auth_users" "$BS/local_seed_auth_users.sql"
PSQL -f "$BS/003_dev_signup_assertions.sql" > "$WORK/last.out" 2>&1 || fail "signup assertions"
grep -q "signup assertions: ALL CHECKS PASSED" "$WORK/last.out" || fail "signup assertions (no pass marker)"
say "ok   signup assertions: ALL CHECKS PASSED (tenant path, tenant-less path, forged user_metadata ignored, bad/unknown tenant rejected, cross-tenant slug collision, create_workspace roster entry)"

say "== 7b. seed fixtures =="
run "001_dev_seed" "$BS/001_dev_seed.sql"

say "== 8. 072 isolation verification =="
sed -e 's/<USER_A_UUID>/a0000000-0000-0000-0000-000000000001/g' -e 's/<USER_B_UUID>/a0000000-0000-0000-0000-000000000005/g' "$SQL/verify/072_isolation_check.sql" > "$WORK/v072.sql"
{ echo "begin;"; cat "$WORK/v072.sql"; echo "rollback;"; } > "$WORK/v072_tx.sql"
PSQL -f "$WORK/v072_tx.sql" > "$WORK/v072.out" 2>&1 || { cp "$WORK/v072.out" "$WORK/last.out"; fail "072 verify"; }
cat "$WORK/v072.out" >> "$LOG"
grep -vE "^\s*$|^-+$|^\([0-9]+ rows?\)$" "$WORK/v072.out" | sed 's#psql:[^ ]*: ##' | tee -a "$LOG"
grep -qE "FAIL" "$WORK/v072.out" && { cp "$WORK/v072.out" "$WORK/last.out"; fail "072 verify reported FAIL"; }

# Catalog snapshots let rollback rehearsal prove exact restoration (including ACLs).
snapshot() { pg_dump -h "$SOCK" -U postgres -d quest --schema-only --schema=public | sed '/^\\restrict /d; /^\\unrestrict /d'; }
snapshot > "$WORK/pre073.sql" || fail "pre073 snapshot"
say "== 9. 073 underwriting =="
run "073_underwriting" "$SQL/073_underwriting.sql"
say "== 9b. 073 re-apply (idempotency) =="
run "073_underwriting (again)" "$SQL/073_underwriting.sql"

say "== 10. 073 verification (committed verify script) =="
sed -e 's/<ADMIN_UUID>/a0000000-0000-0000-0000-000000000001/g' -e 's/<SUPERVISOR_UUID>/a0000000-0000-0000-0000-000000000002/g' -e 's/<WORKER_UUID>/a0000000-0000-0000-0000-000000000003/g' -e 's/<BID_TASK_ID>/dev-bid-1/g' -e 's/<NON_BID_TASK_ID>/dev-admin-1/g' "$SQL/verify/073_underwriting_check.sql" > "$WORK/v073.sql"
PSQL -f "$WORK/v073.sql" > "$WORK/last.out" 2>&1 || fail "073 verify"
grep -q "073 verify: ALL CHECKS PASSED" "$WORK/last.out" || fail "073 verify (no pass marker)"
say "ok   073 verify: ALL CHECKS PASSED"

say "== 10b. REAL concurrent create (two sessions, advisory lock) =="
bash "$REPO/tools/concurrency-check.sh" "postgresql://postgres@/quest?host=$SOCK" a0000000-0000-0000-0000-000000000001 dev-bid-2 > "$WORK/last.out" 2>&1 || fail "concurrency check"
grep -q "concurrency: ALL CHECKS PASSED" "$WORK/last.out" || fail "concurrency check (no pass marker)"
say "ok   $(grep '^A=' "$WORK/last.out")"
say "ok   concurrency: second caller waited, got the SAME underwriting, one link"

say "== 11. role / tenant / project-delete extras =="
PSQL -f "$BS/002_dev_underwriting_extras.sql" > "$WORK/last.out" 2>&1 || fail "073 extras"
grep -q "073 extras: ALL CHECKS PASSED" "$WORK/last.out" || fail "073 extras (no pass marker)"
say "ok   073 extras: ALL CHECKS PASSED"

say "== 11b. PostgREST call shape (json_to_record numerics) + SQLSTATE contract =="
PSQL -f "$BS/004_dev_postgrest_shape_check.sql" > "$WORK/last.out" 2>&1 || fail "postgrest shape check"
grep -q "postgrest-shape: ALL CHECKS PASSED" "$WORK/last.out" || fail "postgrest shape check (no pass marker)"
say "ok   postgrest-shape: ALL CHECKS PASSED"

say "== 11c. 074 proposals (apply, re-apply, verify) =="
snapshot > "$WORK/pre074.sql" || fail "pre074 snapshot"
run "074_proposals" "$SQL/074_proposals.sql"
run "074_proposals (again)" "$SQL/074_proposals.sql"
PSQL -f "$BS/005_dev_proposals_check.sql" > "$WORK/last.out" 2>&1 || fail "074 proposals check"
grep -q "074 proposals: ALL CHECKS PASSED" "$WORK/last.out" || fail "074 proposals check (no pass marker)"
say "ok   074 proposals: ALL CHECKS PASSED"

say "== 12. JS engine <-> DB CHECK parity =="
node "$REPO/tools/gen-underwriting-parity.mjs" > "$WORK/parity.sql" || fail "parity generation"
PSQL -At -f "$WORK/parity.sql" > "$WORK/last.out" 2>&1 || fail "parity"
grep -E "^parity:" "$WORK/last.out" | tee -a "$LOG"

say "== 13. rollback refusal, down, catalog parity, and re-apply =="
bash "$REPO/tools/rollback-check.sh" "postgresql://postgres@/quest?host=$SOCK" "$WORK" > "$WORK/last.out" 2>&1 || fail "rollback rehearsal"
cat "$WORK/last.out" | tee -a "$LOG"
say "ALL STAGES PASSED"
