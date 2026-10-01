-- Snapshot BEFORE 072 in the same session or a rehearsal-only table:
-- create table public._pre072_policies as select policyname, cmd, permissive,
-- roles, qual, with_check from pg_policies where schemaname='public' and tablename='tasks';
-- Compare every policy attribute; permit only the shared-bucket substitution and
-- the new restrictive tenant wall. Reject an empty/incomplete baseline.
do $$
declare r record;
begin
  if (select count(*) from public._pre072_policies where policyname in
      ('role users can read tasks','role users can insert tasks',
       'role users can update tasks','role users can delete tasks')) <> 4 then
    raise exception 'FAIL: incomplete pre-072 task policy snapshot';
  end if;
  for r in
    select coalesce(b.policyname,a.policyname) as name,
      b.policyname as before_name, a.policyname as after_name,
      b.cmd as bc, a.cmd as ac, b.permissive as bp, a.permissive as ap,
      b.roles as br, a.roles as ar,
      regexp_replace(replace(coalesce(b.qual,''), '(id = ''general-shift''::text)', 'is_shared_bucket'), '\s+', ' ', 'g') as bq,
      regexp_replace(replace(coalesce(a.qual,''), '(id = ''general-shift''::text)', 'is_shared_bucket'), '\s+', ' ', 'g') as aq,
      regexp_replace(replace(coalesce(b.with_check,''), '(id = ''general-shift''::text)', 'is_shared_bucket'), '\s+', ' ', 'g') as bw,
      regexp_replace(replace(coalesce(a.with_check,''), '(id = ''general-shift''::text)', 'is_shared_bucket'), '\s+', ' ', 'g') as aw
    from public._pre072_policies b full join
      (select * from pg_policies where schemaname='public' and tablename='tasks'
       and policyname <> 'tenant_isolation_tasks') a using (policyname)
  loop
    if r.before_name is null or r.after_name is null or
       row(r.bc,r.bp,r.br,r.bq,r.bw) is distinct from row(r.ac,r.ap,r.ar,r.aq,r.aw) then
      raise exception 'FAIL: tasks policy "%" changed beyond the shared-bucket substitution', r.name;
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tasks'
      and policyname='tenant_isolation_tasks' and permissive='RESTRICTIVE' and cmd='ALL'
      and roles=array['authenticated']::name[]
      and qual='(tenant_id = current_tenant_id())' and with_check='(tenant_id = current_tenant_id())') then
    raise exception 'FAIL: tasks tenant wall missing or altered';
  end if;
  raise notice '072 policy parity: ALL CHECKS PASSED';
end $$;
