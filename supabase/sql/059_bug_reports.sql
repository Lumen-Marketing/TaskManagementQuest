-- 059: Bug reports — "Report a problem" account-menu feature.
-- Stores user-submitted bug/problem/suggestion reports. Writes happen ONLY
-- through the report-problem edge function (service role bypasses RLS), so
-- there is deliberately NO insert policy: validation, caps, and the per-user
-- rate limit live in the function and cannot be sidestepped by a direct
-- client insert. Developers read/triage/delete.
begin;

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  -- Snapshot name/email at submit time so the report stays readable after
  -- the reporter's account is removed (same rationale as migration 034's
  -- active-timer task label snapshots).
  reporter_id uuid references public.profiles(id) on delete set null,
  reporter_name text,
  reporter_email text,
  type text not null default 'bug' check (type in ('bug', 'problem', 'suggestion')),
  description text not null check (length(btrim(description)) > 0),
  context jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- The function's "reports by this user in the last hour" rate-limit count
-- and the admin list's newest-first ordering.
create index if not exists bug_reports_reporter_created_idx
  on public.bug_reports (reporter_id, created_at desc);
create index if not exists bug_reports_created_idx
  on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;

create policy "developers can read bug reports" on public.bug_reports
  for select to authenticated
  using (public.current_profile_role() = 'developer');

create policy "developers can update bug reports" on public.bug_reports
  for update to authenticated
  using (public.current_profile_role() = 'developer')
  with check (public.current_profile_role() = 'developer');

create policy "developers can delete bug reports" on public.bug_reports
  for delete to authenticated
  using (public.current_profile_role() = 'developer');

commit;
