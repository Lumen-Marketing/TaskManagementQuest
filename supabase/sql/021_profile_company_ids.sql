-- 021: Multi-company profile membership.
--
-- Replaces profiles.company_id (single FK) with profiles.company_ids
-- (text[]) so a person can belong to 0..N Quest companies — e.g.
-- someone who works both Roofing and Drafting jobs.
--
-- The single-FK column was added by migration 016 and locked by the
-- "users update own profile name" self-update policy in 017 (so a user
-- can't grant themselves a company). This migration preserves both
-- properties for the array column.

begin;

-- 1. Add the array column. NOT NULL with default '{}' so existing
--    rows pick up a valid empty array immediately (no NULL ambiguity
--    downstream in `is not distinct from` checks).
alter table public.profiles
  add column if not exists company_ids text[] not null default '{}';

-- 2. Backfill from the single column. A row with company_id = 'roofing'
--    becomes company_ids = '{"roofing"}'. NULL company_id stays as the
--    empty array default.
update public.profiles
set company_ids = array[company_id]
where company_id is not null
  and not (company_id = any(company_ids));

-- 3. Drop the dependent self-update policy first — it has a WITH CHECK
--    clause that references company_id, so dropping the column without
--    dropping the policy errors with "cannot drop columns referenced
--    by policy".
drop policy if exists "users update own profile name" on public.profiles;

-- Single-column index from 016, no longer needed.
drop index if exists public.profiles_company_idx;

alter table public.profiles drop column if exists company_id;

-- 4. Recreate the self-update policy with the same allow-list shape
--    as 017, just with company_ids replacing company_id. is-not-distinct
--    handles NULL/empty-array equality correctly and array equality is
--    element-wise, so a user can't quietly grant themselves another
--    company.
create policy "users update own profile name" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role          = (select p.role          from public.profiles p where p.id = auth.uid())
  and approved      = (select p.approved      from public.profiles p where p.id = auth.uid())
  and supervisor_id is not distinct from (select p.supervisor_id from public.profiles p where p.id = auth.uid())
  and company_ids   is not distinct from (select p.company_ids   from public.profiles p where p.id = auth.uid())
  and member_id     is not distinct from (select p.member_id     from public.profiles p where p.id = auth.uid())
  and email         is not distinct from (select p.email         from public.profiles p where p.id = auth.uid())
);

-- 5. GIN index for fast "find all profiles in company X" lookups via
--    the `?` / `&&` / `@>` array operators.
create index if not exists profiles_company_ids_idx
  on public.profiles using gin (company_ids);

commit;
