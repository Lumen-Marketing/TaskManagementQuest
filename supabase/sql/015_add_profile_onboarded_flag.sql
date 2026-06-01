-- 014: First-run onboarding flag
--
-- Tracks whether a user has seen the welcome tour, so it shows once per account
-- (not per device). Users can update their own flag under the existing
-- "users update own profile name" policy (it allows self-updates as long as
-- role/approved are unchanged).

alter table public.profiles
  add column if not exists onboarded boolean not null default false;

-- Existing accounts already know the app, so mark them all onboarded.
-- New signups go through handle_new_user(), which doesn't set this column, so
-- they pick up the default of false and see the welcome tour on first entry.
update public.profiles set onboarded = true where onboarded is false;
