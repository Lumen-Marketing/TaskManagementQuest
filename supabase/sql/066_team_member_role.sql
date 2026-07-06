-- 066: Mirror profiles.role onto team_members so the assignee picker can show
--      each person's role as a subtitle (workers can't read profiles directly).
--
-- Extends the sync trigger from 065 to carry role alongside position.
-- Idempotent; transaction-wrapped.

begin;

alter table public.team_members
  add column if not exists role text;

update public.team_members tm
set role = p.role
from public.profiles p
where p.member_id = tm.id
  and tm.role is distinct from p.role;

create or replace function public.sync_team_member_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.member_id is null then
    return new;
  end if;
  update public.team_members tm
  set
    full_name   = coalesce(nullif(new.full_name, ''), tm.full_name),
    name        = coalesce(nullif(split_part(new.full_name, ' ', 1), ''), tm.name),
    avatar_url  = coalesce(new.avatar_url, tm.avatar_url),
    company_ids = coalesce(new.company_ids, '{}'::text[]),
    position    = new.position,
    role        = new.role
  where tm.id = new.member_id;
  return new;
end;
$$;

revoke execute on function public.sync_team_member_from_profile() from anon, authenticated, public;

drop trigger if exists sync_team_member_from_profile on public.profiles;
create trigger sync_team_member_from_profile
  after insert or update of full_name, avatar_url, company_ids, position, role on public.profiles
  for each row execute function public.sync_team_member_from_profile();

commit;
