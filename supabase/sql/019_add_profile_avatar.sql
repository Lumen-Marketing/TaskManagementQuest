-- 019: Self-serve profile editing — display name + uploaded avatar.
--
-- 1. profiles.avatar_url
--    Source-of-truth URL for a user's uploaded photo. The existing
--    "users update own profile name" policy (017) allow-lists self-edits
--    by locking sensitive columns (role / approved / supervisor / company /
--    member_id / email). avatar_url is not in the locked list, so users
--    can self-update it through that same policy without further changes.
--
-- 2. team_members.avatar_url
--    Mirror column so the photo also shows in task lists, assignee picker,
--    watcher chips, etc. (those views read from team_members via
--    App.PEOPLE). The "users update own team_member name" policy (011)
--    already allows the row owner to update any column of their own row.
--
-- 3. Storage bucket "avatars"
--    Public-read bucket. RLS on storage.objects scopes writes to
--    <auth.uid()>/* so a user can only manage files under their own
--    folder. Reads are open to any authenticated user — once a user
--    chooses to upload an avatar they're opting into in-app visibility.

alter table public.profiles
  add column if not exists avatar_url text;

alter table public.team_members
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "users can upload own avatar" on storage.objects;
create policy "users can upload own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can update own avatar" on storage.objects;
create policy "users can update own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can delete own avatar" on storage.objects;
create policy "users can delete own avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "authenticated users can view avatars" on storage.objects;
create policy "authenticated users can view avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');
