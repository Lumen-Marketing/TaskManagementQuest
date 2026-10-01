-- LOCAL-ONLY: stands in for creating users through the Supabase Auth API. The
-- on_auth_user_created trigger (029) then creates each profile + team_member, as it
-- does on a hosted project.
insert into auth.users (id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-000000000001','abraham@quest.test','{"full_name":"Abraham Dev"}'),
 ('a0000000-0000-0000-0000-000000000002','sam@quest.test','{"full_name":"Sam Supervisor"}'),
 ('a0000000-0000-0000-0000-000000000003','wanda@quest.test','{"full_name":"Wanda Worker"}'),
 ('a0000000-0000-0000-0000-000000000004','sally@quest.test','{"full_name":"Sally Sales"}'),
 ('a0000000-0000-0000-0000-000000000005','bob@quest.test','{"full_name":"Bob Beta"}'),
 ('a0000000-0000-0000-0000-000000000006','dana@quest.test','{"full_name":"Dana Developer"}')
on conflict (id) do nothing;
