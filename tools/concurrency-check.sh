#!/bin/bash
# Real two-session READ COMMITTED race. Verify B is blocked by A's advisory lock,
# then both return the same id and exactly one underwriting/link was added.
# Use an unused throwaway Bid task. Removes only the UUIDs returned by this run.
# Usage: tools/concurrency-check.sh "<local-or-DEV-db-url>" <admin-uuid> <bid-task-id>
set -euo pipefail
URL="${1:?db url}"; ADMIN="${2:?admin uuid}"; TASK="${3:?bid task id}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
QHQ_DB_URL="$URL" python3 "$REPO/tools/assert-dev-db.py"
[[ "$ADMIN" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || exit 1
[[ "$TASK" =~ ^[a-zA-Z0-9_.-]+$ ]] || exit 1
export PGCONNECT_TIMEOUT=10
PSQL() { psql "$URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
W="$(mktemp -d)"; TAG="qhq_race_$$"; A_PID=''; B_PID=''
ids() { grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' "$1" || true; }
cleanup() {
  rc=$?
  trap - EXIT
  [ -z "$A_PID" ] || wait "$A_PID" 2>/dev/null || true
  [ -z "$B_PID" ] || wait "$B_PID" 2>/dev/null || true
  for id in $( { ids "$W/a.out"; ids "$W/b.out"; } | sort -u ); do
    PSQL -c "delete from public.underwritings where id='$id' and id in (select underwriting_id from public.task_underwriting_links where task_id='$TASK')" >/dev/null || rc=1
  done
  if [ "$rc" != 0 ]; then cat "$W/a.err" "$W/b.err" >&2; fi
  rm -rf "$W"
  exit "$rc"
}
touch "$W/a.out" "$W/b.out" "$W/a.err" "$W/b.err"
trap cleanup EXIT
[ "$(PSQL -c "select count(*) from public.task_underwriting_links where task_id='$TASK'")" = 0 ] || { echo 'ABORT: task already has an underwriting'; exit 1; }
BEFORE=$(PSQL -c 'select count(*) from public.underwritings')
CLAIM="select set_config('request.jwt.claims', json_build_object('sub','$ADMIN')::text, true); set local role authenticated;"
PSQL >"$W/a.out" 2>"$W/a.err" <<SQL &
set application_name='$TAG-a';
begin isolation level read committed;
set local statement_timeout='15s';
$CLAIM
select public.create_underwriting_for_task('$TASK');
\echo READY
select pg_sleep(6);
commit;
SQL
A_PID=$!
ready=0
for ((i=0;i<100;i++)); do
  if grep -q READY "$W/a.out"; then ready=1; break; fi
  sleep 0.05
done
[ "$ready" = 1 ] || { echo 'FAIL: first session never acquired lock/created underwriting'; exit 1; }
PSQL -c "set application_name='$TAG-b'; begin isolation level read committed; set local statement_timeout='15s'; $CLAIM select public.create_underwriting_for_task('$TASK'); commit;" >"$W/b.out" 2>"$W/b.err" &
B_PID=$!
blocked=0
for ((i=0;i<60;i++)); do
  if [ "$(PSQL -c "select count(*) from pg_stat_activity b join pg_stat_activity a on a.pid=any(pg_blocking_pids(b.pid)) where b.application_name='$TAG-b' and a.application_name='$TAG-a' and b.wait_event='advisory'")" = 1 ]; then blocked=1; break; fi
  sleep 0.05
done
wait "$A_PID"; A_PID=''
wait "$B_PID"; B_PID=''
A=$(ids "$W/a.out"); B=$(ids "$W/b.out")
LINKS=$(PSQL -c "select count(*) from public.task_underwriting_links where task_id='$TASK' and underwriting_id='$A'")
AFTER=$(PSQL -c 'select count(*) from public.underwritings')
[ "$blocked" = 1 ] && [ -n "$A" ] && [ "$A" = "$B" ] && [ "$LINKS" = 1 ] && [ "$AFTER" = "$((BEFORE+1))" ] || { echo 'concurrency: FAILED'; exit 1; }
echo "A=$A B=$B blocked_on_A=1 links=1 underwriting_delta=1"
echo 'concurrency: ALL CHECKS PASSED'
