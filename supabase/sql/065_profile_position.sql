-- 065: Add position (job title) to profiles and mirror it onto team_members.
--
-- Follows the same mirror pattern as 045 (company_ids): profiles is the source
-- of truth; a trigger keeps team_members.position in sync so workers, who
-- can't read profiles, still see each person's title in the assignee picker.
--
-- Idempotent; transaction-wrapped.

begin;

------------------------------------------------------------------------
-- 1. Columns (nullable text).
------------------------------------------------------------------------
alter table public.profiles
  add column if not exists position text;

alter table public.team_members
  add column if not exists position text;

------------------------------------------------------------------------
-- 2. One-time backfill (identity map: profiles.member_id = team_members.id).
------------------------------------------------------------------------
update public.team_members tm
set position = p.position
from public.profiles p
where p.member_id = tm.id
  and tm.position is distinct from p.position;

------------------------------------------------------------------------
-- 3. Extend the going-forward sync trigger (031, extended by 045) to
--    carry position too.
------------------------------------------------------------------------
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
    position    = new.position
  where tm.id = new.member_id;
  return new;
end;
$$;

revoke execute on function public.sync_team_member_from_profile() from anon, authenticated, public;

-- Recreate the trigger with position added to the watched column list.
drop trigger if exists sync_team_member_from_profile on public.profiles;
create trigger sync_team_member_from_profile
  after insert or update of full_name, avatar_url, company_ids, position on public.profiles
  for each row execute function public.sync_team_member_from_profile();

commit;

-- Verify (0 rows — every roster position now matches the profile):
--   select tm.id, tm.position, p.position
--   from public.team_members tm join public.profiles p on p.member_id = tm.id
--   where tm.position is distinct from p.position;
