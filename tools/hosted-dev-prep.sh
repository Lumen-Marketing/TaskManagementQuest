#!/bin/bash
# Non-rebuild preparation for the ONE hosted DEV project, never production.
# Requires DEV_DB_URL privately set. Applies only 072's policy phase + final 073,
# then verifies without erasing the browser's saved proposals.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"; SQL="$REPO/supabase/sql"
: "${DEV_DB_URL:?Set the hosted DEV session/direct URL privately}"
QHQ_DB_URL="$DEV_DB_URL" python3 "$REPO/tools/assert-dev-db.py"
# This entry point requires the hosted DEV identity, not the local guard alternative.
QHQ_DB_URL="$DEV_DB_URL" python3 - <<'PY'
import os
from urllib.parse import urlsplit,unquote
u=urlsplit(os.environ['QHQ_DB_URL'])
ref='ydrekmghdbpkothhmbut'
assert u.hostname == f'db.{ref}.supabase.co' or (u.hostname.endswith('.pooler.supabase.com') and unquote(u.username or '')==f'postgres.{ref}'), 'hosted DEV endpoint required'
PY
export PGCONNECT_TIMEOUT=10
PSQL() { psql "$DEV_DB_URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
W=$(mktemp -d); RACE=''
cleanup() {
  rc=$?
  if [ -n "$RACE" ]; then
    PSQL -c "delete from public.tasks where id='$RACE'" >/dev/null || rc=1
  fi
  rm -rf "$W"
  exit "$rc"
}
trap cleanup EXIT
# Build canonical pre-072 task policies from their latest numbered definitions.
# All policy replacement + parity is atomic; no tenant columns/backfill/signup changes.
python3 - "$SQL" "$W/policies.sql" <<'PY'
import re,sys
from pathlib import Path
root=Path(sys.argv[1]); chunks=['begin;','set local lock_timeout=\'5s\';']
for num,verb in [('051','read'),('046','update'),('041','insert'),('044','delete')]:
    paths=list(root.glob(num+'_*.sql'))
    assert len(paths)==1
    name=f'role users can {verb} tasks'
    match=re.search(r'create policy "'+re.escape(name)+r'".*?;',paths[0].read_text(),re.S|re.I)
    assert match, name
    chunks += [f'drop policy "{name}" on public.tasks;', match.group()]
chunks += ["create table public._pre072_policies as select policyname, cmd, permissive, roles, qual, with_check from pg_policies where schemaname='public' and tablename='tasks' and policyname<>'tenant_isolation_tasks';"]
s=(root/'072_multitenant_foundation.sql').read_text()
a=s.index('drop policy if exists "role users can read tasks"')
b=s.index('\ncommit;',a)
chunks += [s[a:b],(root/'verify/072_policy_parity_check.sql').read_text(), 'drop table public._pre072_policies;', 'commit;']
Path(sys.argv[2]).write_text('\n'.join(chunks))
PY
PSQL -f "$W/policies.sql" > "$W/out" 2>&1 || { tail -15 "$W/out"; exit 1; }
echo 'ok   final 072 policies match canonical pre-072 policy bodies plus marker/tenant wall'
PSQL -f "$SQL/073_underwriting.sql" > "$W/out" 2>&1 || { tail -15 "$W/out"; exit 1; }
PSQL -f "$SQL/073_underwriting.sql" > "$W/out" 2>&1 || { tail -15 "$W/out"; exit 1; }
echo 'ok   final 073 applied twice'
# Each verification transaction starts from empty feature tables, then ROLLS BACK;
# existing browser proposals/numbering are preserved. No committed feature reset.
QHQ_VERIFY_ISOLATE_FEATURES=1 bash "$REPO/tools/hosted-dev-verify.sh"
ADMIN=$(PSQL -c "select id from auth.users where email='abraham@quest.test'")
[[ "$ADMIN" =~ ^[0-9a-f-]{36}$ ]] || { echo 'ABORT: missing DEV admin'; exit 1; }
RACE="zz-prep-race-$(python3 -c 'import uuid;print(uuid.uuid4())')"
PSQL -c "insert into public.tasks (id,title,description,company_id,creator_id,assignee_id,due,type,tenant_id) select '$RACE','Temporary concurrency verification','','roofing',member_id,member_id,current_date,'bid',tenant_id from public.profiles where id='$ADMIN'" >/dev/null
bash "$REPO/tools/concurrency-check.sh" "$DEV_DB_URL" "$ADMIN" "$RACE"
echo 'HOSTED DEV PREP SQL PASSED; browser retest still required'
