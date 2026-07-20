-- Market-ready tenant foundation.
-- Additive only: the live company model remains authoritative until a later
-- runtime cutover. "Overall" intentionally remains an organization-wide view.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'pending_deletion')),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  icon text,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order double precision not null default 0,
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('workspace_admin', 'supervisor', 'member')),
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.legacy_company_workspace_map (
  company_id text primary key references public.companies(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function private.prevent_organization_membership_key_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.user_id is distinct from old.user_id then
    raise exception using
      errcode = '22023',
      message = 'organization membership identity cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_workspace_membership_key_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.user_id is distinct from old.user_id then
    raise exception using
      errcode = '22023',
      message = 'workspace membership identity cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_workspace_organization_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception using
      errcode = '22023',
      message = 'workspace organization cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_organization_membership_key_change()
  from public, anon, authenticated;
revoke all on function private.prevent_workspace_membership_key_change()
  from public, anon, authenticated;
revoke all on function private.prevent_workspace_organization_change()
  from public, anon, authenticated;

drop trigger if exists prevent_organization_membership_key_change
  on public.organization_memberships;
create trigger prevent_organization_membership_key_change
before update of organization_id, user_id on public.organization_memberships
for each row execute function private.prevent_organization_membership_key_change();

drop trigger if exists prevent_workspace_membership_key_change
  on public.workspace_memberships;
create trigger prevent_workspace_membership_key_change
before update of workspace_id, user_id on public.workspace_memberships
for each row execute function private.prevent_workspace_membership_key_change();

drop trigger if exists prevent_workspace_organization_change on public.workspaces;
create trigger prevent_workspace_organization_change
before update of organization_id on public.workspaces
for each row execute function private.prevent_workspace_organization_change();

create index if not exists organization_memberships_user_idx
  on public.organization_memberships (user_id, organization_id)
  where status = 'active';
create index if not exists workspaces_organization_idx
  on public.workspaces (organization_id, sort_order)
  where archived_at is null;
create index if not exists workspace_memberships_user_idx
  on public.workspace_memberships (user_id, workspace_id)
  where status = 'active';

do $$
declare
  legacy_owner uuid;
  legacy_org uuid;
begin
  select p.id
  into legacy_owner
  from public.profiles p
  where p.approved is distinct from false
  order by
    case
      when p.role = 'developer' then 0
      when p.role = 'admin' then 1
      else 2
    end,
    p.created_at nulls last,
    p.id
  limit 1;

  if legacy_owner is null then
    raise exception 'workspace foundation requires one approved legacy profile';
  end if;

  insert into public.organizations (name, slug, owner_user_id)
  values ('Quest Lumen', 'quest-lumen', legacy_owner)
  on conflict (slug) do update
    set name = excluded.name
  returning id into legacy_org;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    status
  )
  select
    legacy_org,
    p.id,
    case
      when p.id = legacy_owner then 'owner'
      when p.role in ('developer', 'admin') then 'admin'
      else 'member'
    end,
    'active'
  from public.profiles p
  where p.approved is distinct from false
  on conflict (organization_id, user_id) do update
    set role = excluded.role,
        status = excluded.status;

  insert into public.workspaces (
    organization_id,
    name,
    slug,
    sort_order
  )
  select
    legacy_org,
    c.label,
    c.id,
    row_number() over (order by c.created_at, c.id)::double precision
  from public.companies c
  where c.id <> 'overall'
  on conflict (organization_id, slug) do update
    set name = excluded.name;

  insert into public.legacy_company_workspace_map (
    company_id,
    organization_id,
    workspace_id
  )
  select c.id, legacy_org, w.id
  from public.companies c
  join public.workspaces w
    on w.organization_id = legacy_org
   and w.slug = c.id
  where c.id <> 'overall'
  on conflict (company_id) do update
    set organization_id = excluded.organization_id,
        workspace_id = excluded.workspace_id;

  insert into public.workspace_memberships (
    workspace_id,
    user_id,
    role,
    status
  )
  select
    m.workspace_id,
    p.id,
    case
      when p.role in ('developer', 'admin') then 'workspace_admin'
      when p.role in ('supervisor', 'construction_supervisor') then 'supervisor'
      else 'member'
    end,
    'active'
  from public.profiles p
  join public.legacy_company_workspace_map m
    on m.company_id = any(p.company_ids)
  where p.approved is distinct from false
  on conflict (workspace_id, user_id) do update
    set role = excluded.role,
        status = excluded.status;
end;
$$;

alter table public.tasks
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.projects
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.task_types
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.task_type_statuses
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.task_labels
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists workspace_id uuid references public.workspaces(id);

update public.tasks t
set organization_id = m.organization_id,
    workspace_id = m.workspace_id
from public.legacy_company_workspace_map m
where t.company_id = m.company_id;

update public.projects p
set organization_id = m.organization_id,
    workspace_id = m.workspace_id
from public.legacy_company_workspace_map m
where p.company_id = m.company_id;

update public.task_types x
set organization_id = m.organization_id,
    workspace_id = m.workspace_id
from public.legacy_company_workspace_map m
where x.company_id = m.company_id;

update public.task_type_statuses x
set organization_id = m.organization_id,
    workspace_id = m.workspace_id
from public.legacy_company_workspace_map m
where x.company_id = m.company_id;

update public.task_labels x
set organization_id = m.organization_id,
    workspace_id = m.workspace_id
from public.legacy_company_workspace_map m
where x.company_id = m.company_id;

create or replace function private.sync_legacy_company_tenant_ownership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.company_id = 'overall' then
    new.organization_id := null;
    new.workspace_id := null;
    return new;
  end if;

  select m.organization_id, m.workspace_id
  into new.organization_id, new.workspace_id
  from public.legacy_company_workspace_map m
  where m.company_id = new.company_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = format('company %s has no workspace mapping', new.company_id);
  end if;

  return new;
end;
$$;

revoke all on function private.sync_legacy_company_tenant_ownership()
  from public, anon, authenticated;

drop trigger if exists sync_tasks_legacy_tenant_ownership on public.tasks;
create trigger sync_tasks_legacy_tenant_ownership
before insert or update of company_id, organization_id, workspace_id on public.tasks
for each row execute function private.sync_legacy_company_tenant_ownership();

drop trigger if exists sync_projects_legacy_tenant_ownership on public.projects;
create trigger sync_projects_legacy_tenant_ownership
before insert or update of company_id, organization_id, workspace_id on public.projects
for each row execute function private.sync_legacy_company_tenant_ownership();

drop trigger if exists sync_task_types_legacy_tenant_ownership on public.task_types;
create trigger sync_task_types_legacy_tenant_ownership
before insert or update of company_id, organization_id, workspace_id on public.task_types
for each row execute function private.sync_legacy_company_tenant_ownership();

drop trigger if exists sync_task_type_statuses_legacy_tenant_ownership
  on public.task_type_statuses;
create trigger sync_task_type_statuses_legacy_tenant_ownership
before insert or update of company_id, organization_id, workspace_id on public.task_type_statuses
for each row execute function private.sync_legacy_company_tenant_ownership();

drop trigger if exists sync_task_labels_legacy_tenant_ownership on public.task_labels;
create trigger sync_task_labels_legacy_tenant_ownership
before insert or update of company_id, organization_id, workspace_id on public.task_labels
for each row execute function private.sync_legacy_company_tenant_ownership();

create index if not exists tasks_workspace_idx
  on public.tasks (workspace_id);
create index if not exists projects_workspace_idx
  on public.projects (workspace_id);
create index if not exists task_types_workspace_idx
  on public.task_types (workspace_id);
create index if not exists task_type_statuses_workspace_idx
  on public.task_type_statuses (workspace_id, type_key);
create index if not exists task_labels_workspace_idx
  on public.task_labels (workspace_id);

create or replace function private.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.organization_memberships om
       where om.organization_id = p_organization_id
         and om.user_id = (select auth.uid())
         and om.status = 'active'
     );
$$;

create or replace function private.is_organization_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.organization_memberships om
       where om.organization_id = p_organization_id
         and om.user_id = (select auth.uid())
         and om.status = 'active'
         and om.role in ('owner', 'admin')
     );
$$;

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.workspace_memberships wm
       join public.workspaces w on w.id = wm.workspace_id
       join public.organization_memberships om
         on om.organization_id = w.organization_id
        and om.user_id = wm.user_id
        and om.status = 'active'
       where wm.workspace_id = p_workspace_id
         and wm.user_id = (select auth.uid())
         and wm.status = 'active'
     );
$$;

create or replace function private.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.workspace_memberships wm
       join public.workspaces w on w.id = wm.workspace_id
       join public.organization_memberships om
         on om.organization_id = w.organization_id
        and om.user_id = wm.user_id
        and om.status = 'active'
       where wm.workspace_id = p_workspace_id
         and wm.user_id = (select auth.uid())
         and wm.status = 'active'
         and wm.role = 'workspace_admin'
     );
$$;

create or replace function private.user_is_organization_member(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.organization_memberships om
       where om.organization_id = p_organization_id
         and om.user_id = p_user_id
         and om.status = 'active'
     );
$$;

create or replace function private.is_organization_owner(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.organizations o
       where o.id = p_organization_id
         and o.owner_user_id = p_user_id
     );
$$;

revoke all on function private.is_organization_member(uuid)
  from public, anon, authenticated;
revoke all on function private.is_organization_admin(uuid)
  from public, anon, authenticated;
revoke all on function private.is_workspace_member(uuid)
  from public, anon, authenticated;
revoke all on function private.is_workspace_admin(uuid)
  from public, anon, authenticated;
revoke all on function private.user_is_organization_member(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.is_organization_owner(uuid, uuid)
  from public, anon, authenticated;

grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.is_organization_admin(uuid) to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;
grant execute on function private.user_is_organization_member(uuid, uuid) to authenticated;
grant execute on function private.is_organization_owner(uuid, uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.legacy_company_workspace_map enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select
on public.organizations
for select
to authenticated
using (private.is_organization_member(id));

drop policy if exists organization_memberships_select on public.organization_memberships;
create policy organization_memberships_select
on public.organization_memberships
for select
to authenticated
using (private.is_organization_member(organization_id));

drop policy if exists organization_memberships_insert on public.organization_memberships;
create policy organization_memberships_insert
on public.organization_memberships
for insert
to authenticated
with check (
  private.is_organization_admin(organization_id)
  and (
    role <> 'owner'
    or private.is_organization_owner(organization_id, user_id)
  )
);

drop policy if exists organization_memberships_update on public.organization_memberships;
create policy organization_memberships_update
on public.organization_memberships
for update
to authenticated
using (private.is_organization_admin(organization_id))
with check (
  private.is_organization_admin(organization_id)
  and (
    (
      private.is_organization_owner(organization_id, user_id)
      and role = 'owner'
      and status = 'active'
    )
    or (
      not private.is_organization_owner(organization_id, user_id)
      and role <> 'owner'
    )
  )
);

drop policy if exists organization_memberships_delete on public.organization_memberships;
create policy organization_memberships_delete
on public.organization_memberships
for delete
to authenticated
using (
  private.is_organization_admin(organization_id)
  and not private.is_organization_owner(organization_id, user_id)
);

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select
on public.workspaces
for select
to authenticated
using (
  private.is_organization_admin(organization_id)
  or (
    private.is_organization_member(organization_id)
    and private.is_workspace_member(id)
  )
);

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert
on public.workspaces
for insert
to authenticated
with check (private.is_organization_admin(organization_id));

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update
on public.workspaces
for update
to authenticated
using (private.is_organization_admin(organization_id))
with check (private.is_organization_admin(organization_id));

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete
on public.workspaces
for delete
to authenticated
using (private.is_organization_admin(organization_id));

drop policy if exists workspace_memberships_select on public.workspace_memberships;
create policy workspace_memberships_select
on public.workspace_memberships
for select
to authenticated
using (
  private.is_workspace_member(workspace_id)
  or exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and private.is_organization_admin(w.organization_id)
  )
);

drop policy if exists workspace_memberships_insert on public.workspace_memberships;
create policy workspace_memberships_insert
on public.workspace_memberships
for insert
to authenticated
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and (
        private.is_organization_admin(w.organization_id)
        or private.is_workspace_admin(workspace_id)
      )
      and private.user_is_organization_member(w.organization_id, user_id)
  )
);

drop policy if exists workspace_memberships_update on public.workspace_memberships;
create policy workspace_memberships_update
on public.workspace_memberships
for update
to authenticated
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and (
        private.is_organization_admin(w.organization_id)
        or private.is_workspace_admin(workspace_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and (
        private.is_organization_admin(w.organization_id)
        or private.is_workspace_admin(workspace_id)
      )
      and private.user_is_organization_member(w.organization_id, user_id)
  )
);

drop policy if exists workspace_memberships_delete on public.workspace_memberships;
create policy workspace_memberships_delete
on public.workspace_memberships
for delete
to authenticated
using (
  exists (
    select 1
    from public.workspaces w
    where w.id = workspace_id
      and (
        private.is_organization_admin(w.organization_id)
        or private.is_workspace_admin(workspace_id)
      )
  )
);

drop policy if exists legacy_company_workspace_map_select
  on public.legacy_company_workspace_map;
create policy legacy_company_workspace_map_select
on public.legacy_company_workspace_map
for select
to authenticated
using (private.is_organization_admin(organization_id));

grant select on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_memberships to authenticated;
grant select on public.legacy_company_workspace_map to authenticated;

revoke all on public.organizations from anon;
revoke all on public.organization_memberships from anon;
revoke all on public.workspaces from anon;
revoke all on public.workspace_memberships from anon;
revoke all on public.legacy_company_workspace_map from anon;

commit;
