#!/bin/bash
# LOCAL ONLY; called by dev-rehearse.sh with schema snapshots and its disposable DB.
# Proves refusal with data, reverse-order removal, exact public-schema restoration,
# preservation of existing rows, and re-apply + behavioral verification.
set -euo pipefail
URL="${1:?local url}"; W="${2:?rehearsal work directory}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"; SQL="$REPO/supabase/sql"
QHQ_DB_URL="$URL" python3 "$REPO/tools/assert-dev-db.py" --local-only
PSQL() { psql "$URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
snapshot() { pg_dump "$URL" --schema-only --schema=public | sed '/^\\restrict /d; /^\\unrestrict /d'; }
# Fingerprint the FULL contents of preexisting public tables, not just counts.
fingerprint() {
  PSQL <<'SQL'
select format('select %L, md5(coalesce(string_agg(row_to_json(t)::text, chr(10) order by row_to_json(t)::text), %L)) from public.%I t;',
  tablename, '', tablename) from pg_tables where schemaname='public'
  and tablename not in ('underwritings','underwriting_field_changes','task_underwriting_links','proposals','proposal_counters') order by tablename
\gexec
SQL
}
refuse() {
  if PSQL -f "$1" > "$W/refusal.out" 2>&1; then echo 'FAIL: rollback should have refused'; exit 1; fi
  grep -q "$2" "$W/refusal.out" || { cat "$W/refusal.out"; exit 1; }
}
fingerprint > "$W/rows-before.txt"
refuse "$SQL/rollback/073_down.sql" 'roll back 074 first'
PSQL <<'SQL' > /dev/null
begin;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001"}',true);
set local role authenticated;
select public.create_underwriting_for_task('dev-bid-2') as uw \gset
select public.save_underwriting_estimate(:'uw',2000,10,8000,4000,1000,30,2200,22,13000,18571.43,null);
select public.set_underwriting_status(:'uw','ready_for_review');
select public.set_underwriting_status(:'uw','approved');
select public.create_proposal_for_underwriting(:'uw');
commit;
SQL
refuse "$SQL/rollback/074_down.sql" 'proposal data/counters exist'
[ "$(PSQL -c 'select count(*) from public.proposals')" = 1 ] || exit 1
PSQL -c "set quest.rollback_allow_data_loss='074'" -f "$SQL/rollback/074_down.sql" > /dev/null
snapshot > "$W/after074down.sql"
diff -u "$W/pre074.sql" "$W/after074down.sql"
refuse "$SQL/rollback/073_down.sql" 'underwriting data exists'
[ "$(PSQL -c 'select count(*) from public.underwritings')" = 1 ] || exit 1
PSQL -c "set quest.rollback_allow_data_loss='073'" -f "$SQL/rollback/073_down.sql" > /dev/null
snapshot > "$W/after073down.sql"
diff -u "$W/pre073.sql" "$W/after073down.sql"
fingerprint > "$W/rows-after.txt"
diff -u "$W/rows-before.txt" "$W/rows-after.txt"
PSQL -f "$SQL/073_underwriting.sql" >/dev/null
PSQL -f "$W/v073.sql" >/dev/null
PSQL -f "$SQL/074_proposals.sql" >/dev/null
PSQL -f "$SQL/bootstrap/005_dev_proposals_check.sql" >/dev/null
# Empty-table rollback path must also work without an override.
PSQL -f "$SQL/rollback/074_down.sql" >/dev/null
PSQL -f "$SQL/rollback/073_down.sql" >/dev/null
snapshot > "$W/empty-down.sql"
diff -u "$W/pre073.sql" "$W/empty-down.sql"
echo 'rollback: ALL CHECKS PASSED (refusal, data-loss opt-in, exact schema + existing data parity, re-apply, empty rollback)'
