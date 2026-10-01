-- DEV-ONLY, idempotent. Links the five Lumen dev users to the roster (team_members +
-- profiles.member_id/tenant_id) when their signup left them as tenant-less profiles.
--
-- Why: handle_new_user (072 TASK 8) is an AFTER INSERT trigger that reads
-- raw_app_meta_data->>'tenant_id'. If the Auth server wrote app_metadata after the INSERT
-- the trigger took the tenant-less path: profile only, member_id NULL, no team_members row,
-- and the seed's tasks (creator_id NOT NULL) have no creator.
--
-- How: DIRECT writes, deliberately NOT a replay of the trigger (an earlier version re-fired
-- handle_new_user through a temporary UPDATE trigger; on hosted that did not link anyone).
-- The rules below are handle_new_user's TENANT path, step for step:
--   member id = slug of the email local part; if ANOTHER profile already uses it, or the
--   roster row belongs to another tenant, suffix with the first 8 chars of the auth uuid.
--   An existing roster row of the SAME tenant (e.g. the baseline 'abraham') is adopted.
-- Users that already have a member_id keep it (only their roster row / tenant are ensured).
-- Tenant = the baseline tenant 0. bob (self-signup, tenant-less) is deliberately untouched.
-- The real auth uuids are never changed.
begin;

do $$
declare
  tenant0 constant uuid := '00000000-0000-0000-0000-000000000000';
  u record;
  base text;
  mid text;
begin
  if not exists (select 1 from public.tenants where id = tenant0) then
    raise exception 'baseline tenant % does not exist (072 not applied?)', tenant0;
  end if;

  for u in
    select a.id, a.email, p.member_id,
           coalesce(nullif(a.raw_user_meta_data ->> 'full_name', ''), split_part(a.email, '@', 1)) as full_name
      from auth.users a
      join public.profiles p on p.id = a.id
     where a.email in ('abraham@quest.test','sam@quest.test','wanda@quest.test','sally@quest.test','dana@quest.test')
     order by a.email
  loop
    if u.member_id is not null then
      mid := u.member_id;
    else
      base := coalesce(nullif(public.slugify_member_id(split_part(u.email, '@', 1)), ''), 'member-' || left(u.id::text, 8));
      mid := base;
      if exists (select 1 from public.profiles q where q.member_id = base and q.id <> u.id)
         or exists (select 1 from public.team_members t where t.id = base and t.tenant_id is distinct from tenant0) then
        mid := base || '-' || left(u.id::text, 8);
      end if;
    end if;

    insert into public.team_members (id, name, full_name, email, color, tenant_id)
    values (mid, split_part(u.full_name, ' ', 1), u.full_name, u.email, '#' || substr(md5(u.email), 1, 6), tenant0)
    on conflict (id) do update set
      name = excluded.name, full_name = excluded.full_name, email = excluded.email
      where public.team_members.tenant_id = excluded.tenant_id;

    update public.profiles
       set member_id = mid, tenant_id = coalesce(tenant_id, tenant0)
     where id = u.id and (member_id is distinct from mid or tenant_id is null);
  end loop;

  -- keep app_metadata consistent with what the profiles now say (only where it is missing)
  update auth.users
     set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('tenant_id', tenant0::text)
   where email in ('abraham@quest.test','sam@quest.test','wanda@quest.test','sally@quest.test','dana@quest.test')
     and raw_app_meta_data ->> 'tenant_id' is distinct from tenant0::text;
end $$;

commit;
