-- 042: Repair profiles.company_ids so it is a real text[] (not jsonb).
--
-- Symptom: workers cannot create tasks — "new row violates row-level security
-- policy for table tasks" — even when assigning to themselves. Root cause: the
-- company gate in every non-developer RLS branch is `company_id = any(
-- current_company_ids())`, and current_company_ids() returns profiles.company_ids
-- typed as text[]. In this database the column is actually stored as JSONB (values
-- render like ["roofing","drafting"]). `= any(<jsonb>)` is not a valid array test,
-- so the company check fails closed for everyone except developers (who bypass the
-- gate). Migration 021 intended company_ids to be text[]; this realigns the live
-- column with that contract.
--
-- This converts the column in place, preserving the values, and rebuilds the two
-- objects that depend on it (the self-update policy from 021 and the GIN index) —
-- exactly the dance migration 021 had to do. The conversion reads the current
-- value via ::text::jsonb so it works whether the column is jsonb or a text string
-- holding JSON; if the column were ALREADY text[] this cast fails and the whole
-- transaction rolls back harmlessly (so it can't corrupt a correct column).
--
-- Transaction-wrapped.

begin;

-- 1. Drop the self-update policy that references company_ids in its WITH CHECK
--    (same reason 021 dropped it before touching the column).
drop policy if exists "users update own profile name" on public.profiles;

-- 2. Drop the GIN index on the column (its opclass is type-specific).
drop index if exists public.profiles_company_ids_idx;

-- 3. Convert jsonb / json-text -> text[], element by element. Empty/null -> {}.
alter table public.profiles
  alter column company_ids drop default;

alter table public.profiles
  alter column company_ids type text[]
  using coalesce(
    (
      select array_agg(elem)
      from jsonb_array_elements_text(
        case
          when company_ids is null            then '[]'::jsonb
          when company_ids::text = ''         then '[]'::jsonb
          else company_ids::text::jsonb
        end
      ) as elem
    ),
    '{}'::text[]
  );

alter table public.profiles
  alter column company_ids set default '{}'::text[];

alter table public.profiles
  alter column company_ids set not null;

-- 4. Recreate the GIN index for fast "members in company X" lookups.
create index if not exists profiles_company_ids_idx
  on public.profiles using gin (company_ids);

-- 5. Recreate the self-update policy verbatim from migration 021 so a user can
--    edit their own name but cannot self-grant role/approval/company/etc.
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

-- 6. Re-assert current_company_ids() now that the column is the right type, so its
--    body resolves against text[] (idempotent; matches migration 028).
create or replace function public.current_company_ids()
returns text[]
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce(
    (select p.company_ids from public.profiles p where p.id = auth.uid()),
    '{}'::text[]
  );
$$;

revoke all on function public.current_company_ids() from public, anon;
grant execute on function public.current_company_ids() to authenticated;

commit;

-- Verify: this should now run WITHOUT the "malformed array literal" error and
-- return true for an approved roofing member:
--   select 'roofing' = any(company_ids) from public.profiles
--   where lower(email) = 'oliviacolins07@gmail.com';
