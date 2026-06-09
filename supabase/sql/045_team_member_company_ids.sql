-- 045: Mirror each member's company_ids onto the team_members roster, so the
--      assignee/watcher pickers can be company-scoped for WORKERS too.
--
-- Background: pickers are built from App.PEOPLE, which a worker loads from
-- team_members (workers can't read public.profiles via RLS). team_members carried
-- no company, so utils.peopleInCompany() couldn't filter for a worker session and
-- fell back to the whole roster — a worker saw every company's people when
-- assigning, even though 041 only lets them assign within their own company.
--
-- Fix: add team_members.company_ids (text[]), backfill it from profiles, and
-- extend the existing profile->roster sync trigger (031) so company edits made via
-- the admin approval screen propagate to the roster automatically. The picker can
-- then read each person's company off the roster the worker already loads.
--
-- Note: 031's trigger was deliberately column-scoped to full_name/avatar_url so
-- company edits did NOT touch the roster. That tradeoff is now reversed — company
-- IS part of the roster's contract — so company_ids joins the trigger's column
-- list and its body. (This only mirrors data the member already owns; RLS on
-- team_members is unchanged, so it is not an authorization surface.)
--
-- Idempotent; transaction-wrapped.

begin;

------------------------------------------------------------------------
-- 1. Column (text[], same shape as profiles.company_ids after migration 042).
------------------------------------------------------------------------
alter table public.team_members
  add column if not exists company_ids text[] not null default '{}'::text[];

------------------------------------------------------------------------
-- 2. One-time backfill from profiles (identity map: profiles.member_id = team_members.id).
------------------------------------------------------------------------
update public.team_members tm
set company_ids = coalesce(p.company_ids, '{}'::text[])
from public.profiles p
where p.member_id = tm.id
  and tm.company_ids is distinct from coalesce(p.company_ids, '{}'::text[]);

------------------------------------------------------------------------
-- 3. Extend the going-forward sync trigger (031) to carry company_ids too.
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
    company_ids = coalesce(new.company_ids, '{}'::text[])
  where tm.id = new.member_id;
  return new;
end;
$$;

revoke execute on function public.sync_team_member_from_profile() from anon, authenticated, public;

-- Recreate the trigger with company_ids added to the watched column list.
drop trigger if exists sync_team_member_from_profile on public.profiles;
create trigger sync_team_member_from_profile
  after insert or update of full_name, avatar_url, company_ids on public.profiles
  for each row execute function public.sync_team_member_from_profile();

commit;

-- Verify (0 rows — every roster company list now matches the profile):
--   select tm.id, tm.company_ids, p.company_ids
--   from public.team_members tm join public.profiles p on p.member_id = tm.id
--   where tm.company_ids is distinct from coalesce(p.company_ids, '{}'::text[]);
