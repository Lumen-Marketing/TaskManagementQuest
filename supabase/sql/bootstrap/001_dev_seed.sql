-- DEV-ONLY SEED — test identities and fixtures for verifying 072 and 073.
-- Run AFTER 072 and AFTER the six auth users below exist (created post-072 through the
-- two signup paths: five with app_metadata.tenant_id = tenant 0, bob with none).
--
-- On a HOSTED dev project create the auth users through the dashboard / Auth admin
-- API (never by inserting into auth.users) with these fixed ids or substitute them.
-- The local rehearsal inserts them via local_seed_auth_users.sql.
--
--   a0000000-...-001  abraham   admin       Lumen / roofing
--   a0000000-...-002  sam       supervisor  Lumen / roofing
--   a0000000-...-003  wanda     worker      Lumen / roofing
--   a0000000-...-004  sally     sales       Lumen / roofing   (resolves to worker)
--   a0000000-...-005  bob       (no tenant yet; calls create_workspace) — the 072 "userB"
--   a0000000-...-006  dana      developer   Lumen / roofing
--
-- Emails use the reserved .test TLD. No passwords are set here.

begin;

-- The tasks below need a REAL creator (tasks.creator_id is NOT NULL): the admin's roster id.
do $$ begin
  if (select member_id from public.profiles where id = 'a0000000-0000-0000-0000-000000000001') is null then
    raise exception 'seed: the admin has no member_id (signup ran without app_metadata.tenant_id) — run bootstrap/006_dev_identity_repair.sql first';
  end if;
end $$;

update public.profiles set approved = true, role = 'admin',      company_ids = '{roofing}', tenant_id = '00000000-0000-0000-0000-000000000000' where id = 'a0000000-0000-0000-0000-000000000001';
update public.profiles set approved = true, role = 'supervisor', company_ids = '{roofing}', tenant_id = '00000000-0000-0000-0000-000000000000' where id = 'a0000000-0000-0000-0000-000000000002';
update public.profiles set approved = true, role = 'worker',     company_ids = '{roofing}', tenant_id = '00000000-0000-0000-0000-000000000000' where id = 'a0000000-0000-0000-0000-000000000003';
update public.profiles set approved = true, role = 'sales',      company_ids = '{roofing}', tenant_id = '00000000-0000-0000-0000-000000000000' where id = 'a0000000-0000-0000-0000-000000000004';
update public.profiles set approved = true, role = 'developer',  company_ids = '{roofing}', tenant_id = '00000000-0000-0000-0000-000000000000' where id = 'a0000000-0000-0000-0000-000000000006';
-- bob (…005): approved, role member, tenant_id NULL — exactly the pre-workspace signup state.
update public.profiles set approved = true where id = 'a0000000-0000-0000-0000-000000000005';

insert into public.projects (id, company_id, name, client, tenant_id)
values ('dev-proj-1', 'roofing', 'Paradise Valley re-roof', 'CNL Properties', '00000000-0000-0000-0000-000000000000')
on conflict (id) do nothing;

-- Two Bid tasks (one filed under the project, one unfiled) and one non-Bid task.
insert into public.tasks (id, title, description, company_id, creator_id, assignee_id, due, type, project_id, tenant_id)
select v.id, v.title, '', 'roofing', p.member_id, p.member_id, current_date, v.type, v.project_id, '00000000-0000-0000-0000-000000000000'
from (values
  ('dev-bid-1',   'Bid: Paradise Valley', 'bid',   'dev-proj-1'),
  ('dev-bid-2',   'Bid: unfiled',         'bid',   null),
  ('dev-admin-1', 'File lien paperwork',  'admin', 'dev-proj-1')
) as v(id, title, type, project_id)
cross join (select member_id from public.profiles where id = 'a0000000-0000-0000-0000-000000000001') p
on conflict (id) do nothing;

commit;
