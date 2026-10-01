#!/bin/bash
# DEV-ONLY: rebuild Quest HQ on a THROWAWAY LOCAL Postgres and verify 072 + 073.
# Touches no hosted project: no network, unix socket only, data dir under $WORK,
# torn down on exit. The replay order below is explicit (not `sort`) — see the
# per-step comments for every skip and insertion.
#
# usage: tools/dev-rehearse.sh [workdir]        (needs postgres/initdb/psql/node on PATH)
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$REPO/supabase/sql"; BS="$SQL/bootstrap"
WORK="${1:-${TMPDIR:-/tmp}/questhq-rehearsal}"
SOCK="${PGSOCK:-/tmp/qhq-rehearsal-sock}"     # short path: unix sockets cap at ~100 bytes
D="$WORK/pgdata"; LOG="$WORK/replay.log"
rm -rf "$WORK" "$SOCK"; mkdir -p "$WORK" "$SOCK"
: > "$LOG"
say()  { echo "$@" | tee -a "$LOG"; }
fail() { say "FAILED at: $1"; say "--- last output ---"; tail -15 "$WORK/last.out" | tee -a "$LOG"; exit 1; }

initdb -D "$D" -U postgres --auth=trust >/dev/null 2>&1 || { echo "initdb failed"; exit 1; }
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

say "== 3. slot of the never-committed 069: task_label_sops (PROVISIONAL) =="
run "000b_dev_baseline_task_label_sops" "$BS/000b_dev_baseline_task_label_sops.sql"

say "== 4. 070, 071 =="
for b in 070_checkin_settings.sql 071_checkin_log.sql; do run "$b" "$SQL/$b"; done

say "== 5. every table 072 will wall must exist =="
PSQL -At -c "select t from unnest(array['profiles','companies','team_members','tasks','task_comments','comment_reactions','projects','schedules','time_entries','active_timers','notifications','reminder_log','task_types','task_type_statuses','task_labels','task_label_sops','bug_reports','checkin_settings','checkin_log','wo_counters']) t where to_regclass('public.'||t) is null" > "$WORK/last.out" 2>&1
[ -s "$WORK/last.out" ] && { say "missing tables:"; cat "$WORK/last.out" | tee -a "$LOG"; exit 1; }
say "ok   all 20 required pre-072 tables present (task_watchers, task_subtasks, task_activity were dropped by 013)"
for fn in current_profile_role current_member_id current_company_ids can_manage_roles assign_wo_number handle_new_user; do
  [ "$(PSQL -At -c "select count(*) from pg_proc where proname='$fn' and pronamespace='public'::regnamespace")" = "1" ] || { say "missing function $fn"; exit 1; }
done
say "ok   helper functions present"

say "== 6. 072 multitenant foundation =="
run "072_multitenant_foundation" "$SQL/072_multitenant_foundation.sql"

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

say "== 9. 073 underwriting =="
run "073_underwriting" "$SQL/073_underwriting.sql"
say "== 9b. 073 re-apply (idempotency) =="
run "073_underwriting (again)" "$SQL/073_underwriting.sql"

say "== 10. 073 verification (committed verify script) =="
sed -e 's/<ADMIN_UUID>/a0000000-0000-0000-0000-000000000001/g' -e 's/<SUPERVISOR_UUID>/a0000000-0000-0000-0000-000000000002/g' -e 's/<WORKER_UUID>/a0000000-0000-0000-0000-000000000003/g' -e 's/<BID_TASK_ID>/dev-bid-1/g' -e 's/<NON_BID_TASK_ID>/dev-admin-1/g' "$SQL/verify/073_underwriting_check.sql" > "$WORK/v073.sql"
PSQL -f "$WORK/v073.sql" > "$WORK/last.out" 2>&1 || fail "073 verify"
grep -q "073 verify: ALL CHECKS PASSED" "$WORK/last.out" || fail "073 verify (no pass marker)"
say "ok   073 verify: ALL CHECKS PASSED"

say "== 11. role / tenant / project-delete extras =="
PSQL -f "$BS/002_dev_underwriting_extras.sql" > "$WORK/last.out" 2>&1 || fail "073 extras"
grep -q "073 extras: ALL CHECKS PASSED" "$WORK/last.out" || fail "073 extras (no pass marker)"
say "ok   073 extras: ALL CHECKS PASSED"

say "== 12. JS engine <-> DB CHECK parity =="
node "$REPO/tools/gen-underwriting-parity.mjs" > "$WORK/parity.sql" || fail "parity generation"
PSQL -At -f "$WORK/parity.sql" > "$WORK/last.out" 2>&1 || fail "parity"
grep -E "^parity:" "$WORK/last.out" | tee -a "$LOG"

say "ALL STAGES PASSED"
