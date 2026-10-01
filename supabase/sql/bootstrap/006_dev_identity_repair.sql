-- DEV-ONLY, idempotent. Repairs dev identities whose signup trigger ran BEFORE
-- app_metadata.tenant_id was on the auth.users row.
--
-- Why: handle_new_user (072 TASK 8) is an AFTER INSERT trigger that reads
-- raw_app_meta_data->>'tenant_id'. If the Auth server writes app_metadata after the
-- INSERT, the trigger takes the tenant-less path: profile only, member_id NULL, no
-- team_members row — and the seed's tasks (creator_id NOT NULL) have no creator.
--
-- How: add the tenant to app_metadata for the five Lumen dev users that still have no
-- member_id, with a TEMPORARY trigger on that UPDATE that runs the real handle_new_user()
-- (so the repair is exactly the signup logic, not a copy of it; its upserts are idempotent).
-- bob (self-signup, no tenant) is deliberately left alone. Already-linked users are skipped.
begin;

create trigger tmp_dev_identity_repair
  after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_new_user();

update auth.users u
   set raw_app_meta_data = u.raw_app_meta_data
        || '{"tenant_id":"00000000-0000-0000-0000-000000000000"}'::jsonb
 where u.email in ('abraham@quest.test','sam@quest.test','wanda@quest.test','sally@quest.test','dana@quest.test')
   and exists (select 1 from public.profiles p where p.id = u.id and p.member_id is null);

drop trigger tmp_dev_identity_repair on auth.users;

commit;
