#!/bin/bash
# PHASE 1 of 3 — reset + bootstrap the hosted DEV project (ydrekmghdbpkothhmbut) as Quest HQ DEV.
# DESTRUCTIVE to schema `public` and auth.users of THAT ONE project. Never for production.
#
#   Phase 1  tools/hosted-dev-rebuild.sh        reset public, apply baseline + 003..068 + 070/071 + 072 + 073 + 074
#   Phase 2  node tools/hosted-dev-users.mjs    create the six dev logins through the Auth admin API
#   Phase 3  tools/hosted-dev-verify.sh         seed fixtures + run every verify script (all roll back)
#
# Required env (in YOUR shell only; this script never prints them):
#   DEV_DB_URL            session-pooler/direct URL (port 5432) for ydrekmghdbpkothhmbut
#   CONFIRM_RESET         must equal the DEV ref: ydrekmghdbpkothhmbut
#   BACKUP_FILE           path to the verified pg_dump (must exist, >100 KB)
# Optional: REBUILD_AGAIN=1  allow a re-run when Quest HQ tables already exist (failed midway).
#
# Local validation note: the ref guard is a substring test on DEV_DB_URL, so the local
# rehearsal of this script passes it by adding ?application_name=<dev ref> to a unix-socket URL.
set -u
DEV_REF="ydrekmghdbpkothhmbut"; PROD_REF="qqvmcsvdxhgjooirznrj"
REPO="$(cd "$(dirname "$0")/.." && pwd)"; SQL="$REPO/supabase/sql"; BS="$SQL/bootstrap"
die() { echo "ABORT: $*" >&2; exit 1; }

# ---- guards (all before any connection) ----
[ -n "${DEV_DB_URL:-}" ] || die "DEV_DB_URL not set"
case "$DEV_DB_URL" in *"$PROD_REF"*) die "DEV_DB_URL contains the PRODUCTION ref";; esac
case "$DEV_DB_URL" in *"$DEV_REF"*) ;; *) die "DEV_DB_URL does not contain $DEV_REF";; esac
case "${DEV_SUPABASE_URL:-}" in *"$PROD_REF"*) die "DEV_SUPABASE_URL is production";; esac
[ "${CONFIRM_RESET:-}" = "$DEV_REF" ] || die "set CONFIRM_RESET=$DEV_REF to confirm you mean this project"
case "$DEV_DB_URL" in *:6543*) die "port 6543 is the transaction pooler; use the 5432 session pooler / direct URL";; esac
[ -f "${BACKUP_FILE:-}" ] && [ "$(wc -c < "$BACKUP_FILE")" -gt 100000 ] || die "BACKUP_FILE missing or <100 KB"
command -v pg_restore >/dev/null && pg_restore -l "$BACKUP_FILE" 2>/dev/null | grep -q "TABLE" || die "BACKUP_FILE is not a readable pg_dump"

PSQL() { psql "$DEV_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
LOG="${HOME}/questhq-dev-rebuild-$(date +%Y%m%d-%H%M%S).log"; : > "$LOG"; chmod 600 "$LOG"
say() { echo "$@" | tee -a "$LOG"; }
run() { PSQL -f "$2" >> "$LOG" 2>&1 || { say "FAILED at: $1 ($2)"; tail -12 "$LOG"; say "(full log: $LOG)"; exit 1; }; say "ok   $1"; }

say "== 1. fingerprint =="
FP=$(PSQL -At -c "select (to_regclass('public.work_items') is not null)::text || '|' || (to_regclass('public.tasks') is not null)::text") || die "cannot connect"
if [ "$FP" != "true|false" ]; then
  [ "$FP" = "false|true" ] && [ "${REBUILD_AGAIN:-0}" = "1" ] && say "re-run: Quest HQ tables exist, REBUILD_AGAIN=1 -> continuing" \
    || die "fingerprint is '$FP' (expected prototype 'true|false'); refusing"
else say "ok   prototype fingerprint (work_items present, tasks absent)"; fi

say "== 2. reset public + prototype auth users (approved, backup verified) =="
PSQL >> "$LOG" 2>&1 <<'SQL' || { say "FAILED at reset (transaction rolled back, nothing changed)"; tail -12 "$LOG"; exit 1; }
begin;
drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
commit;
SQL
N=$(PSQL -At -c "select count(*) from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal") ; [ "$N" = "0" ] || die "prototype trigger still on auth.users"
PSQL -c "delete from auth.users" >> "$LOG" 2>&1 || die "could not clear auth.users"
say "ok   public reset; auth.users cleared (dump: $BACKUP_FILE)"

say "== 3. baseline + canonical history =="
run "000_dev_baseline" "$BS/000_dev_baseline.sql"
for f in $(ls "$SQL"/[0-9]*.sql | sort); do
  b=$(basename "$f"); n=${b%%_*}
  [ "$n" -gt 068 ] && continue
  [ "$n" = "042" ] && { say "skip $b (production-only repair)"; continue; }
  run "$b" "$f"
done
say "(000b task_label_sops skipped: optional, absent in production)"
for b in 070_checkin_settings.sql 071_checkin_log.sql; do run "$b" "$SQL/$b"; done

say "== 4. 072 multitenant, 073 underwriting, 074 proposals (each twice = idempotency) =="
run "072_multitenant_foundation" "$SQL/072_multitenant_foundation.sql"
run "073_underwriting" "$SQL/073_underwriting.sql"; run "073_underwriting (again)" "$SQL/073_underwriting.sql"
run "074_proposals" "$SQL/074_proposals.sql";       run "074_proposals (again)" "$SQL/074_proposals.sql"

say "== 5. structure =="
OUT=$(PSQL -At -c "select string_agg(t || '=' || (to_regclass('public.'||t) is not null)::text, ' ') from unnest(array['tenants','tasks','underwritings','proposals','task_label_sops','work_items']) t")
say "$OUT"
echo "$OUT" | grep -q "tenants=true tasks=true underwritings=true proposals=true task_label_sops=false work_items=false" || die "unexpected structure: $OUT"
say "PHASE 1 COMPLETE. Next: node tools/hosted-dev-users.mjs   (log: $LOG)"
