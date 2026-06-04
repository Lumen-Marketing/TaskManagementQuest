-- 035: Give every approved profile a backing team_members row.
--
-- Symptom this fixes: approved users are missing from the time boards and the
-- assignment pickers (and silently can't be assigned tasks or clock in). Root
-- cause is member_id drift: handle_new_user() (migration 029) derives a
-- profile's member_id from the sign-up email local-part and creates a matching
-- team_members row — but several existing profiles ended up pointing at a slug
-- whose roster row was pruned (025/033) or never created, e.g.
--
--     profiles.full_name 'Abraham Maldonado'  member_id 'info'   -> no team_members row
--     profiles.full_name 'grid'               member_id 'oliviacolins07' -> no row
--
-- The boards/pickers list team_members backed by an approved profile, and the
-- task/timer FKs (tasks.assignee_id, time_entries.user_id, active_timers.user_id)
-- all reference team_members(id) — so a profile with no matching roster row is
-- invisible AND non-functional.
--
-- Fix: for each approved profile lacking a roster row, INSERT one keyed to its
-- member_id, derived from the profile (matching the handle_new_user() shape:
-- name = first word of full_name, color = email-hash). We DON'T repoint or
-- delete anything — leftover demo rows (abraham, grid, ...) are left alone; they
-- can be pruned separately once confirmed unused. Mirrors the team_members
-- insert in migration 029.
--
-- Idempotent / safe to re-run.

begin;

insert into public.team_members (id, name, full_name, email, color, avatar_url)
select
  p.member_id,
  split_part(coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)), ' ', 1),
  coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)),
  p.email,
  '#' || substr(md5(coalesce(nullif(p.email, ''), p.member_id)), 1, 6),
  p.avatar_url
from public.profiles p
where p.approved is true
  and p.member_id is not null
  and not exists (
    select 1 from public.team_members tm where tm.id = p.member_id
  )
on conflict (id) do nothing;

commit;

-- Verify (should return 0 rows — every approved profile now has a roster row):
--   select p.full_name, p.member_id
--   from public.profiles p
--   left join public.team_members tm on tm.id = p.member_id
--   where p.approved is true and tm.id is null;
