-- 031: Keep the team_members roster in sync with each user's chosen profile
--      identity (display name + avatar) — one-time backfill, then a trigger.
--
-- Symptom: a person who set a display name (profiles.full_name, e.g. "grid")
-- still shows under their signup name (team_members.name, e.g. "oliviacolins07")
-- for any viewer who can't load the full profiles list — i.e. workers. The task
-- list resolves assignee names/avatars from the team_members roster; the app
-- overlays the profile name+photo in memory (overlayProfilesOntoPeople), but
-- only for sessions that loaded that profile (managers via team.view /
-- roles.manage). Non-managers see the stale roster row, so the SAME assignee
-- appears under two different names depending on who is looking.
--
-- Root cause: handle_new_user() (migrations 026/029) seeds team_members from the
-- email / auth metadata at signup, and migration 011 lets a user update their
-- own team_members row — but nothing re-syncs an existing roster row when the
-- profile name/avatar is changed later, and the client-side sync in ProfileView
-- is best-effort (its error is swallowed). So the roster drifts.
--
-- Fix, in two parts:
--   1. Backfill: copy profiles.full_name + avatar_url onto the matching
--      team_members row wherever they diverge (repairs every existing user).
--   2. Trigger: on any later change to profiles.full_name / avatar_url,
--      propagate it to team_members automatically. SECURITY DEFINER so it
--      applies regardless of the caller's RLS write access — the roster can
--      never silently fall out of sync with the profile again.
--
-- Identity mapping: profiles.member_id -> team_members.id.
-- Wrapped in a transaction; idempotent / safe to re-run.

begin;

------------------------------------------------------------------------
-- 1. One-time backfill of existing rows.
------------------------------------------------------------------------
update public.team_members tm
set
  full_name  = coalesce(nullif(p.full_name, ''), tm.full_name),
  name       = coalesce(nullif(split_part(p.full_name, ' ', 1), ''), tm.name),
  avatar_url = coalesce(p.avatar_url, tm.avatar_url)
from public.profiles p
where p.member_id = tm.id
  and (
    (nullif(p.full_name, '') is not null and tm.full_name is distinct from p.full_name)
    or (nullif(p.full_name, '') is not null
        and tm.name is distinct from split_part(p.full_name, ' ', 1))
    or (p.avatar_url is not null and tm.avatar_url is distinct from p.avatar_url)
  );

------------------------------------------------------------------------
-- 2. Going-forward sync trigger. Fires only when the identity columns
--    actually change (column-scoped AFTER trigger), so role/approval/
--    company edits via updateProfileAccess never touch the roster.
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
    full_name  = coalesce(nullif(new.full_name, ''), tm.full_name),
    name       = coalesce(nullif(split_part(new.full_name, ' ', 1), ''), tm.name),
    avatar_url = coalesce(new.avatar_url, tm.avatar_url)
  where tm.id = new.member_id;
  return new;
end;
$$;

-- Trigger only — direct calls are never needed.
revoke execute on function public.sync_team_member_from_profile() from anon, authenticated, public;

drop trigger if exists sync_team_member_from_profile on public.profiles;
create trigger sync_team_member_from_profile
  after insert or update of full_name, avatar_url on public.profiles
  for each row execute function public.sync_team_member_from_profile();

commit;

-- Verify (should return 0 rows — every roster name now matches the profile):
--   select tm.id, tm.name, tm.full_name, p.full_name as profile_name
--   from public.team_members tm
--   join public.profiles p on p.member_id = tm.id
--   where nullif(p.full_name, '') is not null
--     and tm.full_name is distinct from p.full_name;
