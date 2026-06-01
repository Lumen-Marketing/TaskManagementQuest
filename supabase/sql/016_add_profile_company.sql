-- 015: Per-user company assignment
--
-- Lets admins/supervisors mark which Quest company each person belongs to
-- (Roofing / Drafting / Lumen). The existing "managers update profiles" policy
-- already covers this column, and "users update own profile name" preserves
-- self-updates without letting users change their own role/approved/company.

alter table public.profiles
  add column if not exists company_id text references public.companies(id);

create index if not exists profiles_company_idx on public.profiles(company_id);

-- Tighten the self-update policy so users can edit their own name but cannot
-- self-assign company or supervisor (managers control those).
drop policy if exists "users update own profile name" on public.profiles;
create policy "users update own profile name" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and role          = (select p.role          from public.profiles p where p.id = auth.uid())
  and approved      = (select p.approved      from public.profiles p where p.id = auth.uid())
  and supervisor_id is not distinct from (select p.supervisor_id from public.profiles p where p.id = auth.uid())
  and company_id    is not distinct from (select p.company_id    from public.profiles p where p.id = auth.uid())
);
