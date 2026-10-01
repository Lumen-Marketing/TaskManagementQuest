#!/bin/bash
# PHASE 3 — seed fixtures and run every verify script against hosted DEV.
# Hosted Auth assigns its own UUIDs, so the fixed a0000000-…-00000000000N ids in the seed/verify
# scripts are substituted (in temp copies) from auth.users by email. Verify scripts roll back;
# only 001_dev_seed (tenant-0 project + 3 tasks) persists. Same ref guards as phase 1.
set -u
DEV_REF="ydrekmghdbpkothhmbut"; PROD_REF="qqvmcsvdxhgjooirznrj"
REPO="$(cd "$(dirname "$0")/.." && pwd)"; SQL="$REPO/supabase/sql"; BS="$SQL/bootstrap"
die() { echo "ABORT: $*" >&2; exit 1; }
case "${DEV_DB_URL:-}" in *"$PROD_REF"*) die "production ref";; *"$DEV_REF"*) ;; *) die "DEV_DB_URL must contain $DEV_REF";; esac
PSQL() { psql "$DEV_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
id() { PSQL -At -c "select id from auth.users where email='$1@quest.test'"; }
for n in abraham sam wanda sally bob dana; do
  v="$(id $n)"; [ -n "$v" ] || die "login $n@quest.test not found — run phase 2"
  eval "U_$n=\$v"        # plain variables: macOS ships bash 3.2 (no associative arrays)
done
SUBST=(-e "s/a0000000-0000-0000-0000-000000000001/$U_abraham/g" -e "s/a0000000-0000-0000-0000-000000000002/$U_sam/g"
       -e "s/a0000000-0000-0000-0000-000000000003/$U_wanda/g" -e "s/a0000000-0000-0000-0000-000000000004/$U_sally/g"
       -e "s/a0000000-0000-0000-0000-000000000005/$U_bob/g" -e "s/a0000000-0000-0000-0000-000000000006/$U_dana/g")
sub() { sed "${SUBST[@]}" "$1" > "$W/$(basename "$1")"; echo "$W/$(basename "$1")"; }
step() { # step <label> <file> <pass-marker|-> 
  PSQL -f "$2" > "$W/out" 2>&1 || { echo "FAILED: $1"; tail -15 "$W/out"; exit 1; }
  grep -qE "FAIL" "$W/out" && { echo "FAILED: $1"; tail -15 "$W/out"; exit 1; }
  [ "$3" = "-" ] || grep -q "$3" "$W/out" || { echo "FAILED: $1 (no pass marker)"; tail -15 "$W/out"; exit 1; }
  echo "ok   $1"; }

step "006 identity repair (idempotent)" "$BS/006_dev_identity_repair.sql" -
# Count the LINKED users (not "the unlinked ones"), so a missing/renamed user can never pass vacuously.
GOOD=$(PSQL -At -c "select count(*) from auth.users u join public.profiles p on p.id=u.id join public.team_members t on t.id=p.member_id and t.tenant_id=p.tenant_id where u.email in ('abraham@quest.test','sam@quest.test','wanda@quest.test','sally@quest.test','dana@quest.test')")
[ "$GOOD" = "5" ] || die "only $GOOD of 5 Lumen dev users are linked (profile + member_id + team_members + tenant) after repair"
echo "ok   five Lumen dev users have profile + member_id + team_members + tenant"
step "001_dev_seed (persists)" "$(sub "$BS/001_dev_seed.sql")" -
{ echo "begin;"; sed -e "s/<USER_A_UUID>/$U_abraham/g" -e "s/<USER_B_UUID>/$U_bob/g" "$SQL/verify/072_isolation_check.sql"; echo "rollback;"; } > "$W/v072.sql"
step "072 isolation check" "$W/v072.sql" -
sed -e "s/<ADMIN_UUID>/$U_abraham/g" -e "s/<SUPERVISOR_UUID>/$U_sam/g" -e "s/<WORKER_UUID>/$U_wanda/g" -e 's/<BID_TASK_ID>/dev-bid-1/g' -e 's/<NON_BID_TASK_ID>/dev-admin-1/g' "$SQL/verify/073_underwriting_check.sql" > "$W/v073.sql"
step "073 verify" "$W/v073.sql" "073 verify: ALL CHECKS PASSED"
step "073 extras" "$(sub "$BS/002_dev_underwriting_extras.sql")" "073 extras: ALL CHECKS PASSED"
step "PostgREST shape + SQLSTATE" "$(sub "$BS/004_dev_postgrest_shape_check.sql")" "postgrest-shape: ALL CHECKS PASSED"
step "074 proposals (18,571.43, repeat, roles, tenant)" "$(sub "$BS/005_dev_proposals_check.sql")" "074 proposals: ALL CHECKS PASSED"
echo "PHASE 3 COMPLETE — hosted DEV database layer verified. Next: browser pass with real logins (env.json -> DEV url + ANON key)."
