-- 073: Underwriting — estimate inputs, calculation snapshot, approval, and an
-- append-only Estimate History, linked 1:1 to Bid tasks.
--
-- Flow:  Project (job) -> Bid task -> Underwriting -> Estimate Breakdown -> Approval
--
-- ADDITIVE ONLY. Creates three tables, their triggers/policies, and three RPCs.
-- Does not alter any existing table, policy, function or migration, and does not
-- touch task_type_statuses (the Bid pipeline) or the wo_counters numbering.
--
--   underwritings               one estimate per Bid task: inputs + derived snapshot
--   underwriting_field_changes  APPEND-ONLY Estimate History (own table; NOT task_activity)
--   task_underwriting_links     Bid task <-> underwriting (1:1)
--
-- RUN ON A DEV COPY FIRST and pass supabase/sql/verify/073_underwriting_check.sql
-- before this goes anywhere near PROD (project qqvmcsvdxhgjooirznrj). Requires
-- 072 (tenants, current_tenant_id(), stamp_tenant_id()). Idempotent.
--
-- Design decisions (all enforced in the DATABASE, because the PostgREST client is
-- untrusted):
--   * Tenant wall: tenant_id + stamp trigger + RESTRICTIVE policy on every new
--     table, exactly as 072 does for the existing tables.
--   * Ids follow Quest, not the prototype: text ids for company/project/task,
--     the actor is a team member id (current_member_id()), not auth.uid().
--   * Client is NOT copied. It is read from projects.client (migration 055).
--   * project_id is nullable + ON DELETE SET NULL: deleting a project folder
--     unfiles its tasks today (055) and must keep working.
--   * Access: developer, admin, construction_supervisor, supervisor. Workers and
--     sales (which resolves to 'worker', migration 048) cannot read margins or
--     costs. Approval is admin/developer only. [Business decision — see report.]
--   * History is written by a SECURITY DEFINER trigger on underwritings, so it is
--     atomic with the save and cannot be skipped or forged. Clients get SELECT
--     only. The optional reason rides in a transaction-local setting that the
--     RPCs below set; a direct table update is still tracked, just reason-less.
--   * Derived columns are CHECK-constrained to the exact formulas, so a stored
--     figure can never disagree with its stored inputs.

begin;

------------------------------------------------------------------------
-- 1. underwritings
------------------------------------------------------------------------
create table if not exists public.underwritings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  company_id    text not null references public.companies(id),
  project_id    text references public.projects(id) on delete set null,

  status        text not null default 'draft',

  -- Inputs
  roof_area_sqft        numeric(10,2),
  waste_percent         numeric(6,2)  not null default 0,
  material_cost         numeric(12,2) not null default 0,
  labor_cost            numeric(12,2) not null default 0,
  other_cost            numeric(12,2) not null default 0,
  target_margin_percent numeric(6,2),

  -- Derived snapshot (written together with the inputs by save_underwriting_estimate)
  adjusted_roof_area_sqft numeric(10,2),
  squares                 numeric(10,2),
  total_estimated_cost    numeric(12,2) not null default 0,
  recommended_sale_price  numeric(12,2),

  -- NULL until a real calculation save. Lets the Breakdown tell "never entered"
  -- apart from an entered 0 (the column defaults above are not user input).
  calculated_at timestamptz,

  notes         text,
  created_by    text references public.team_members(id) on delete set null,
  approved_by   text references public.team_members(id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint underwritings_status_check
    check (status in ('draft','ready_for_review','approved','declined')),
  constraint underwritings_nonneg_check
    check ((roof_area_sqft is null or roof_area_sqft >= 0)
           and waste_percent >= 0 and material_cost >= 0
           and labor_cost >= 0 and other_cost >= 0),
  constraint underwritings_margin_check
    check (target_margin_percent is null
           or (target_margin_percent > 0 and target_margin_percent < 100)),
  constraint underwritings_total_cost_consistent
    check (total_estimated_cost = material_cost + labor_cost + other_cost),
  constraint underwritings_area_consistent
    check (
      (roof_area_sqft is null and adjusted_roof_area_sqft is null and squares is null)
      or (roof_area_sqft is not null
          and adjusted_roof_area_sqft = round(roof_area_sqft * (100 + waste_percent) / 100, 2)
          and squares                 = round(roof_area_sqft * (100 + waste_percent) / 10000, 2))
    ),
  constraint underwritings_price_consistent
    check (
      (recommended_sale_price is null and calculated_at is null)
      or (recommended_sale_price is not null and calculated_at is not null
          and target_margin_percent is not null
          and recommended_sale_price = round(total_estimated_cost * 100 / (100 - target_margin_percent), 2))
    )
);

create index if not exists underwritings_tenant_idx  on public.underwritings(tenant_id);
create index if not exists underwritings_company_idx on public.underwritings(company_id, status);
create index if not exists underwritings_project_idx on public.underwritings(project_id);

------------------------------------------------------------------------
-- 2. underwriting_field_changes — APPEND-ONLY Estimate History
------------------------------------------------------------------------
create table if not exists public.underwriting_field_changes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  company_id      text not null references public.companies(id),
  underwriting_id uuid not null references public.underwritings(id) on delete cascade,
  field_name      text not null,
  old_value       text,
  new_value       text,
  changed_by      text references public.team_members(id) on delete set null,
  reason          text,
  created_at      timestamptz not null default now(),
  constraint underwriting_field_changes_field_check
    check (field_name in ('roof_area_sqft','waste_percent','material_cost','labor_cost',
                          'other_cost','target_margin_percent','status'))
);

create index if not exists uw_changes_tenant_idx on public.underwriting_field_changes(tenant_id);
create index if not exists uw_changes_uw_idx
  on public.underwriting_field_changes(underwriting_id, created_at desc);

------------------------------------------------------------------------
-- 3. task_underwriting_links — Bid task <-> underwriting, 1:1
------------------------------------------------------------------------
create table if not exists public.task_underwriting_links (
  task_id         text primary key references public.tasks(id) on delete cascade,
  underwriting_id uuid not null unique references public.underwritings(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id),
  company_id      text not null references public.companies(id),
  created_by      text references public.team_members(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists task_uw_links_tenant_idx on public.task_underwriting_links(tenant_id);

-- A CHECK cannot see another table's row, so the Bid-only / same-company rules
-- live in a trigger.
create or replace function public.guard_task_underwriting_link()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  t_type text;
  t_company text;
  u_company text;
begin
  select type, company_id into t_type, t_company from public.tasks where id = new.task_id;
  if t_type is distinct from 'bid' then
    raise exception 'underwriting can only be linked to a Bid task (task % is type %)',
      new.task_id, coalesce(t_type, 'unknown');
  end if;
  select company_id into u_company from public.underwritings where id = new.underwriting_id;
  if u_company is distinct from t_company then
    raise exception 'underwriting and task belong to different companies';
  end if;
  new.company_id := t_company;
  return new;
end;
$$;

drop trigger if exists task_uw_links_guard on public.task_underwriting_links;
create trigger task_uw_links_guard
  before insert on public.task_underwriting_links
  for each row execute function public.guard_task_underwriting_link();

------------------------------------------------------------------------
-- 4. underwritings guard (BEFORE UPDATE): transitions, locking, approval
------------------------------------------------------------------------
create or replace function public.guard_underwriting_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  role_now text := public.current_profile_role();
begin
  -- created_by / approved_by may only be CLEARED (FK ON DELETE SET NULL when a
  -- team member is removed); approved_by is otherwise set by this trigger alone.
  if new.tenant_id is distinct from old.tenant_id
     or new.company_id is distinct from old.company_id
     or new.created_at is distinct from old.created_at
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
     or (new.approved_by is distinct from old.approved_by and new.approved_by is not null
         and not (old.status <> 'approved' and new.status = 'approved')) then
    raise exception 'underwriting identity fields are immutable';
  end if;
  -- project_id may only be cleared (the FK ON DELETE SET NULL); never re-pointed.
  if new.project_id is distinct from old.project_id and new.project_id is not null then
    raise exception 'underwriting project cannot be changed';
  end if;

  if old.status in ('approved','declined') then
    -- Reviewed numbers must not silently change under the decision.
    if row(new.roof_area_sqft, new.waste_percent, new.material_cost, new.labor_cost,
           new.other_cost, new.target_margin_percent, new.adjusted_roof_area_sqft,
           new.squares, new.total_estimated_cost, new.recommended_sale_price,
           new.calculated_at, new.notes, new.approved_at)
       is distinct from
       row(old.roof_area_sqft, old.waste_percent, old.material_cost, old.labor_cost,
           old.other_cost, old.target_margin_percent, old.adjusted_roof_area_sqft,
           old.squares, old.total_estimated_cost, old.recommended_sale_price,
           old.calculated_at, old.notes, old.approved_at) then
      raise exception 'a % underwriting is locked', old.status;
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'            and new.status = 'ready_for_review') or
      (old.status = 'ready_for_review' and new.status in ('approved','declined','draft')) or
      (old.status = 'declined'         and new.status = 'draft')
    ) then
      raise exception 'cannot move underwriting from % to %', old.status, new.status;
    end if;

    if new.status = 'ready_for_review' and new.recommended_sale_price is null then
      raise exception 'calculate the estimate before submitting it for review';
    end if;

    -- The decision (approve OR decline) is an admin/developer call, matching the
    -- client's 'underwriting.approve' permission.
    if new.status = 'declined' and role_now not in ('admin','developer') then
      raise exception 'only an admin can decline an estimate';
    end if;

    if new.status = 'approved' then
      if role_now not in ('admin','developer') then
        raise exception 'only an admin can approve an estimate';
      end if;
      if new.recommended_sale_price is null or new.recommended_sale_price <= 0 then
        raise exception 'approval requires a positive recommended sale price';
      end if;
      new.approved_by := public.current_member_id();
      new.approved_at := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists underwritings_guard on public.underwritings;
create trigger underwritings_guard
  before update on public.underwritings
  for each row execute function public.guard_underwriting_update();

------------------------------------------------------------------------
-- 5. Estimate History writer (AFTER INSERT/UPDATE, SECURITY DEFINER)
--    Fields tracked: roof area, waste, material, labor, other cost, margin, status.
--    On the first real calculation the "old" value of an input is NULL (it was a
--    column default, never entered) so history never invents a previous value.
------------------------------------------------------------------------
create or replace function public.log_underwriting_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor  text := public.current_member_id();
  why    text := nullif(btrim(coalesce(current_setting('app.uw_change_reason', true), '')), '');
  first_calc boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.underwriting_field_changes
      (tenant_id, company_id, underwriting_id, field_name, old_value, new_value, changed_by)
    values (new.tenant_id, new.company_id, new.id, 'status', null, new.status, actor);
    return null;
  end if;

  first_calc := old.calculated_at is null and new.calculated_at is not null;

  insert into public.underwriting_field_changes
    (tenant_id, company_id, underwriting_id, field_name, old_value, new_value, changed_by, reason)
  select new.tenant_id, new.company_id, new.id, f.field, f.old_v, f.new_v, actor, why
  from (values
    ('roof_area_sqft',        case when first_calc then null else old.roof_area_sqft::text end,        new.roof_area_sqft::text),
    ('waste_percent',         case when first_calc then null else old.waste_percent::text end,         new.waste_percent::text),
    ('material_cost',         case when first_calc then null else old.material_cost::text end,         new.material_cost::text),
    ('labor_cost',            case when first_calc then null else old.labor_cost::text end,            new.labor_cost::text),
    ('other_cost',            case when first_calc then null else old.other_cost::text end,            new.other_cost::text),
    ('target_margin_percent', old.target_margin_percent::text,                                         new.target_margin_percent::text),
    ('status',                old.status,                                                              new.status)
  ) as f(field, old_v, new_v)
  where f.old_v is distinct from f.new_v;

  return null;
end;
$$;

revoke all on function public.log_underwriting_changes() from public, anon, authenticated;

drop trigger if exists underwritings_log_ins on public.underwritings;
create trigger underwritings_log_ins
  after insert on public.underwritings
  for each row execute function public.log_underwriting_changes();

drop trigger if exists underwritings_log_upd on public.underwritings;
create trigger underwritings_log_upd
  after update on public.underwritings
  for each row execute function public.log_underwriting_changes();

------------------------------------------------------------------------
-- 6. Tenant wall (same pattern as 072) + permissive company/role policies
------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['underwritings','underwriting_field_changes','task_underwriting_links'] loop
    execute format('drop trigger if exists %I on public.%I', 'stamp_tenant_'||t, t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.stamp_tenant_id()',
      'stamp_tenant_'||t, t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'tenant_isolation_'||t, t);
    execute format($f$
      create policy %I on public.%I
      as restrictive for all to authenticated
      using (tenant_id = public.current_tenant_id())
      with check (tenant_id = public.current_tenant_id())
    $f$, 'tenant_isolation_'||t, t);
  end loop;
end $$;

-- Who may touch underwriting: developer, or an admin / construction supervisor /
-- supervisor inside one of their companies. 'sales' resolves to 'worker' in
-- current_profile_role() (048), so it is excluded along with workers.
drop policy if exists "underwriting staff can read underwritings"   on public.underwritings;
drop policy if exists "underwriting staff can insert underwritings" on public.underwritings;
drop policy if exists "underwriting staff can update underwritings" on public.underwritings;

create policy "underwriting staff can read underwritings" on public.underwritings
  for select to authenticated
  using (public.current_profile_role() = 'developer'
         or (company_id = any(public.current_company_ids())
             and public.current_profile_role() in ('admin','construction_supervisor','supervisor')));

create policy "underwriting staff can insert underwritings" on public.underwritings
  for insert to authenticated
  with check (public.current_profile_role() = 'developer'
              or (company_id = any(public.current_company_ids())
                  and public.current_profile_role() in ('admin','construction_supervisor','supervisor')));

create policy "underwriting staff can update underwritings" on public.underwritings
  for update to authenticated
  using (public.current_profile_role() = 'developer'
         or (company_id = any(public.current_company_ids())
             and public.current_profile_role() in ('admin','construction_supervisor','supervisor')))
  with check (public.current_profile_role() = 'developer'
              or (company_id = any(public.current_company_ids())
                  and public.current_profile_role() in ('admin','construction_supervisor','supervisor')));

drop policy if exists "underwriting staff can read history" on public.underwriting_field_changes;
create policy "underwriting staff can read history" on public.underwriting_field_changes
  for select to authenticated
  using (public.current_profile_role() = 'developer'
         or (company_id = any(public.current_company_ids())
             and public.current_profile_role() in ('admin','construction_supervisor','supervisor')));
-- No insert/update/delete policy on history: only the definer trigger writes it.

drop policy if exists "underwriting staff can read links"   on public.task_underwriting_links;
drop policy if exists "underwriting staff can insert links" on public.task_underwriting_links;
create policy "underwriting staff can read links" on public.task_underwriting_links
  for select to authenticated
  using (public.current_profile_role() = 'developer'
         or (company_id = any(public.current_company_ids())
             and public.current_profile_role() in ('admin','construction_supervisor','supervisor')));
create policy "underwriting staff can insert links" on public.task_underwriting_links
  for insert to authenticated
  with check (public.current_profile_role() = 'developer'
              or (company_id = any(public.current_company_ids())
                  and public.current_profile_role() in ('admin','construction_supervisor','supervisor')));

-- Grants. Supabase's default privileges hand ALL to authenticated, so revoke first.
revoke all on public.underwritings               from anon, authenticated;
revoke all on public.underwriting_field_changes  from anon, authenticated;
revoke all on public.task_underwriting_links     from anon, authenticated;
revoke truncate, references, trigger on public.underwritings, public.underwriting_field_changes,
  public.task_underwriting_links from public;

grant select, insert, update on public.underwritings              to authenticated;
grant select                 on public.underwriting_field_changes to authenticated;
grant select, insert         on public.task_underwriting_links    to authenticated;

------------------------------------------------------------------------
-- 7. RPCs (SECURITY INVOKER: every statement runs under the caller's RLS)
------------------------------------------------------------------------

-- Create (or return) the underwriting for a Bid task. Idempotent.
create or replace function public.create_underwriting_for_task(p_task_id text)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  t record;
  existing uuid;
  new_id uuid;
  me text := public.current_member_id();
begin
  select id, type, company_id, project_id into t from public.tasks where id = p_task_id;
  if not found then
    raise exception 'task not found';
  end if;
  if t.type is distinct from 'bid' then
    raise exception 'underwriting can only be created for a Bid task';
  end if;

  select underwriting_id into existing from public.task_underwriting_links where task_id = p_task_id;
  if existing is not null then
    return existing;
  end if;

  insert into public.underwritings (company_id, project_id, created_by)
  values (t.company_id, t.project_id, me)
  returning id into new_id;

  insert into public.task_underwriting_links (task_id, underwriting_id, created_by)
  values (p_task_id, new_id, me);

  return new_id;
end;
$$;

-- Save inputs + the derived snapshot in one statement. The CHECK constraints
-- above reject any derived figure that does not match the inputs.
create or replace function public.save_underwriting_estimate(
  p_id uuid,
  p_roof_area_sqft numeric,
  p_waste_percent numeric,
  p_material_cost numeric,
  p_labor_cost numeric,
  p_other_cost numeric,
  p_target_margin_percent numeric,
  p_adjusted_roof_area_sqft numeric,
  p_squares numeric,
  p_total_estimated_cost numeric,
  p_recommended_sale_price numeric,
  p_reason text default null
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.uw_change_reason', coalesce(p_reason, ''), true);
  update public.underwritings set
    roof_area_sqft          = p_roof_area_sqft,
    waste_percent           = p_waste_percent,
    material_cost           = p_material_cost,
    labor_cost              = p_labor_cost,
    other_cost              = p_other_cost,
    target_margin_percent   = p_target_margin_percent,
    adjusted_roof_area_sqft = p_adjusted_roof_area_sqft,
    squares                 = p_squares,
    total_estimated_cost    = p_total_estimated_cost,
    recommended_sale_price  = p_recommended_sale_price,
    calculated_at           = now()
  where id = p_id;
  if not found then
    raise exception 'underwriting not found';
  end if;
end;
$$;

create or replace function public.set_underwriting_status(
  p_id uuid, p_status text, p_reason text default null
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.uw_change_reason', coalesce(p_reason, ''), true);
  update public.underwritings set status = p_status where id = p_id;
  if not found then
    raise exception 'underwriting not found';
  end if;
end;
$$;

revoke all on function public.create_underwriting_for_task(text) from public, anon;
revoke all on function public.save_underwriting_estimate(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) from public, anon;
revoke all on function public.set_underwriting_status(uuid,text,text) from public, anon;
grant execute on function public.create_underwriting_for_task(text) to authenticated;
grant execute on function public.save_underwriting_estimate(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated;
grant execute on function public.set_underwriting_status(uuid,text,text) to authenticated;

commit;
