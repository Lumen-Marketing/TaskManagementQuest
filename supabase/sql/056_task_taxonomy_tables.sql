-- 056: Customizable per-company task taxonomy (Phase 1 of the taxonomy project).
-- Additive: creates task_types, task_type_statuses, task_labels with RLS. No existing
-- task row is touched here; seeding is in 057 and the CHECK drops are in 058.
-- Editable by developer/admin/construction_supervisor within their companies; read by
-- any company member. Colours are hex strings (rendered inline; custom rows can't have
-- predefined CSS classes). See docs/superpowers/specs/2026-07-02-customizable-task-taxonomy-design.md
-- Applied to production (project qqvmcsvdxhgjooirznrj) on 2026-07-02.

create table if not exists public.task_types (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  key text not null, label text not null,
  color text not null default '#8f867b',
  sort_order double precision not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, key)
);
create table if not exists public.task_type_statuses (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  type_key text not null, key text not null, label text not null,
  color text not null default '#8f867b',
  sort_order double precision not null default 0,
  is_done boolean not null default false,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, type_key, key)
);
create table if not exists public.task_labels (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id) on delete cascade,
  key text not null, label text not null,
  color text not null default '#8f867b',
  sort_order double precision not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, key)
);

create index if not exists task_types_company_idx on public.task_types (company_id);
create index if not exists task_type_statuses_company_type_idx on public.task_type_statuses (company_id, type_key);
create index if not exists task_labels_company_idx on public.task_labels (company_id);

-- At most one done / one default status per (company, type).
create unique index if not exists task_status_one_done on public.task_type_statuses (company_id, type_key) where is_done;
create unique index if not exists task_status_one_default on public.task_type_statuses (company_id, type_key) where is_default;

alter table public.task_types enable row level security;
alter table public.task_type_statuses enable row level security;
alter table public.task_labels enable row level security;

do $$
declare t text;
begin
  foreach t in array array['task_types','task_type_statuses','task_labels'] loop
    execute format($f$
      create policy "read %1$s" on public.%1$I for select to authenticated
        using (public.current_profile_role() = 'developer'
               or company_id = any(public.current_company_ids()));
      create policy "ins %1$s" on public.%1$I for insert to authenticated
        with check (public.current_profile_role() in ('developer','admin','construction_supervisor')
                    and (public.current_profile_role() = 'developer' or company_id = any(public.current_company_ids())));
      create policy "upd %1$s" on public.%1$I for update to authenticated
        using (public.current_profile_role() in ('developer','admin','construction_supervisor')
               and (public.current_profile_role() = 'developer' or company_id = any(public.current_company_ids())))
        with check (public.current_profile_role() in ('developer','admin','construction_supervisor')
                    and (public.current_profile_role() = 'developer' or company_id = any(public.current_company_ids())));
      create policy "del %1$s" on public.%1$I for delete to authenticated
        using (public.current_profile_role() in ('developer','admin','construction_supervisor')
               and (public.current_profile_role() = 'developer' or company_id = any(public.current_company_ids())));
    $f$, t);
  end loop;
end $$;
