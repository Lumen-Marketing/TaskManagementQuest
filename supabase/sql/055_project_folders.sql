-- 055: Project Folders reconciliation.
-- Adds card fields (color, client), makes deleting a folder UNFILE its tasks,
-- and tightens mig-006's "any approved user" project policies to the same
-- company scope the tasks policies use (migration 028). "Anyone can do
-- anything" within their company window; developer = god mode.
begin;

alter table public.projects add column if not exists color text not null default '#8f867b';
alter table public.projects add column if not exists client text;

-- Re-point tasks.project_id -> ON DELETE SET NULL, name-agnostically.
do $$
declare fk text;
begin
  select conname into fk
  from pg_constraint
  where conrelid = 'public.tasks'::regclass
    and contype = 'f'
    and conkey = array[(
      select attnum from pg_attribute
      where attrelid = 'public.tasks'::regclass and attname = 'project_id'
    )];
  if fk is not null then
    execute format('alter table public.tasks drop constraint %I', fk);
  end if;
end $$;

alter table public.tasks
  add constraint tasks_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

-- Replace mig-006 project policies with company-scoped ones.
drop policy if exists "approved users can read projects"   on public.projects;
drop policy if exists "approved users can insert projects" on public.projects;
drop policy if exists "approved users can update projects" on public.projects;
drop policy if exists "approved users can delete projects" on public.projects;

create policy "company members can read projects" on public.projects
  for select to authenticated
  using (public.current_profile_role() = 'developer'
         or company_id = any(public.current_company_ids()));

create policy "company members can insert projects" on public.projects
  for insert to authenticated
  with check (public.current_profile_role() = 'developer'
              or company_id = any(public.current_company_ids()));

create policy "company members can update projects" on public.projects
  for update to authenticated
  using (public.current_profile_role() = 'developer'
         or company_id = any(public.current_company_ids()))
  with check (public.current_profile_role() = 'developer'
              or company_id = any(public.current_company_ids()));

create policy "company members can delete projects" on public.projects
  for delete to authenticated
  using (public.current_profile_role() = 'developer'
         or company_id = any(public.current_company_ids()));

commit;
