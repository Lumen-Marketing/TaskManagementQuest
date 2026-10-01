-- LOCAL-ONLY: stands in for creating users through the Supabase Auth admin API, AFTER
-- 072. The on_auth_user_created trigger (handle_new_user, 072 TASK 8) creates each
-- profile (+ team_members row when a tenant is supplied), exactly as on a hosted project.
--
--   five Lumen users  -> raw_app_meta_data.tenant_id = tenant 0   (the create-user path)
--   bob               -> no tenant                                (self-signup, pre-workspace)
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
 ('a0000000-0000-0000-0000-000000000001','abraham@quest.test','{"full_name":"Abraham Dev"}',      '{"tenant_id":"00000000-0000-0000-0000-000000000000"}'),
 ('a0000000-0000-0000-0000-000000000002','sam@quest.test',    '{"full_name":"Sam Supervisor"}',   '{"tenant_id":"00000000-0000-0000-0000-000000000000"}'),
 ('a0000000-0000-0000-0000-000000000003','wanda@quest.test',  '{"full_name":"Wanda Worker"}',     '{"tenant_id":"00000000-0000-0000-0000-000000000000"}'),
 ('a0000000-0000-0000-0000-000000000004','sally@quest.test',  '{"full_name":"Sally Sales"}',      '{"tenant_id":"00000000-0000-0000-0000-000000000000"}'),
 ('a0000000-0000-0000-0000-000000000006','dana@quest.test',   '{"full_name":"Dana Developer"}',   '{"tenant_id":"00000000-0000-0000-0000-000000000000"}'),
 ('a0000000-0000-0000-0000-000000000005','bob@quest.test',    '{"full_name":"Bob Beta"}',         '{}')
on conflict (id) do nothing;
