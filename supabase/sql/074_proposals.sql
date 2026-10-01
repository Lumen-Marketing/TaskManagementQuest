-- 074: Proposals — the customer-facing document generated from an APPROVED
-- underwriting. One proposal per underwriting; editable title / scope / terms.
--
-- Flow:  Bid task -> Underwriting (approved) -> Proposal -> Print / Save PDF
--
-- LOCAL / DEV-REHEARSAL ONLY until Alexia decides. ADDITIVE ONLY: two new tables,
-- their triggers/policies and one RPC. Touches no existing table or migration.
-- Requires 072 (tenants, stamp_tenant_id()) and 073 (underwritings, links). Idempotent.
--
-- Design (all enforced in the DATABASE; the PostgREST client is untrusted):
--   * The proposal row has NO cost / margin columns. The customer document renders
--     from this row alone, so internal numbers cannot leak through it.
--   * Every derived field (company, project, task, total, number, snapshots) is
--     set by a BEFORE INSERT trigger from the caller-visible APPROVED underwriting —
--     never from caller input — so a direct REST insert is exactly as safe as the RPC.
--   * total = underwritings.recommended_sale_price at generation (approved estimates
--     are locked by 073, so it cannot drift). Immutable afterwards.
--   * Number: per-company counter, one atomic upsert (same pattern as 061
--     assign_wo_number). NOT max+1. Assigned only after every check passed.
--   * Clients may UPDATE only title, scope_of_work, terms, client_name, job_address
--     (column grant + immutability guard trigger).
--   * Access: same staff roles as underwriting (developer, admin, construction
--     supervisor, supervisor). Workers / sales get nothing.

begin;

------------------------------------------------------------------------
-- 1. proposal_counters — per-company sequence; no client access at all
------------------------------------------------------------------------
create table if not exists public.proposal_counters (
  company_id text primary key references public.companies(id),
  tenant_id  uuid not null references public.tenants(id),
  next_val   int not null default 1
);
alter table public.proposal_counters enable row level security;
revoke all on public.proposal_counters from anon, authenticated;

drop policy if exists tenant_isolation_proposal_counters on public.proposal_counters;
create policy tenant_isolation_proposal_counters on public.proposal_counters
  as restrictive for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- SECURITY DEFINER so staff can advance the counter without table grants. Not
-- callable by clients directly: only the BEFORE INSERT trigger below calls it.
create or replace function public.assign_proposal_number(p_company text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  assigned int;
begin
  insert into public.proposal_counters as c (company_id, tenant_id, next_val)
    values (p_company, (select tenant_id from public.companies where id = p_company), 2)
  on conflict (company_id)
    do update set next_val = c.next_val + 1
    returning (c.next_val - 1) into assigned;
  return coalesce(assigned, 1);   -- first insert has no conflict -> RETURNING is null
end;
$$;
revoke all on function public.assign_proposal_number(text) from public, anon, authenticated;

------------------------------------------------------------------------
-- 2. proposals
------------------------------------------------------------------------
create table if not exists public.proposals (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  company_id      text not null references public.companies(id),
  underwriting_id uuid not null unique references public.underwritings(id) on delete restrict,
  task_id         text references public.tasks(id) on delete set null,
  project_id      text references public.projects(id) on delete set null,
  proposal_number int  not null,   -- set by proposals_assign_number

  -- Snapshots taken at generation (the customer document must not shift if the
  -- project is renamed later). client_name / job_address stay editable.
  company_name    text not null default '',
  project_name    text not null default '',
  client_name     text not null default '',
  job_address     text not null default '',

  title           text not null default '',
  scope_of_work   text not null default '',
  terms           text not null default '',
  total           numeric(12,2) not null,

  created_by      text references public.team_members(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint proposals_total_positive check (total > 0),
  constraint proposals_number_unique unique (company_id, proposal_number)
);
create index if not exists proposals_tenant_idx  on public.proposals(tenant_id);
create index if not exists proposals_company_idx on public.proposals(company_id);
create index if not exists proposals_task_idx    on public.proposals(task_id);

------------------------------------------------------------------------
-- 3. BEFORE INSERT: derive everything from the approved underwriting
--    (runs as the caller, so RLS on underwritings/projects/links applies)
------------------------------------------------------------------------
create or replace function public.guard_proposal_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  u record;
  proj record;
  co_label text;
  addr text;
begin
  select id, company_id, project_id, status, recommended_sale_price
    into u from public.underwritings where id = new.underwriting_id;
  if not found then
    raise exception 'underwriting not found';
  end if;
  if u.status is distinct from 'approved' then
    raise exception 'a proposal can only be generated from an approved underwriting (this one is %)', u.status;
  end if;
  if u.recommended_sale_price is null or u.recommended_sale_price <= 0 then
    raise exception 'the approved underwriting has no positive sale price';
  end if;

  new.company_id := u.company_id;
  new.project_id := u.project_id;
  new.total      := u.recommended_sale_price;
  select task_id into new.task_id from public.task_underwriting_links where underwriting_id = u.id;
  select label into co_label from public.companies where id = u.company_id;
  new.company_name := coalesce(co_label, '');

  if u.project_id is not null then
    select name, client, address into proj from public.projects where id = u.project_id;
    new.project_name := coalesce(proj.name, '');
    new.client_name  := coalesce(proj.client, '');
    addr             := coalesce(proj.address, '');
  end if;
  new.job_address := coalesce(addr, '');

  if btrim(coalesce(new.title, '')) = '' then
    new.title := case when new.project_name <> '' then 'Proposal — ' || new.project_name else 'Proposal' end;
  end if;
  if btrim(coalesce(new.scope_of_work, '')) = '' then
    new.scope_of_work := 'Furnish all labor and materials for ' ||
      case when new.project_name <> '' then new.project_name else 'the work' end ||
      case when new.job_address <> '' then ' at ' || new.job_address else '' end ||
      E', as described below.\n\n[Describe the scope of work here.]';
  end if;
  if btrim(coalesce(new.terms, '')) = '' then
    new.terms := E'1. This proposal is valid for 30 days from the date issued.\n'
              || E'2. Payment terms: [enter payment schedule].\n'
              || E'3. Work not described in the scope above requires a written change order.';
  end if;

  new.created_by      := public.current_member_id();
  new.created_at      := now();
  new.updated_at      := now();
  return new;
end;
$$;

-- Numbering is a separate SECURITY DEFINER trigger so the invoker-side guard above
-- never needs rights on the counter. Fires after the guard (alphabetical order), so
-- a rejected insert never gets, or burns, a number; and the counter bump rolls back
-- with the statement if anything later fails.
create or replace function public.proposals_assign_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.proposal_number := public.assign_proposal_number(new.company_id);
  return new;
end;
$$;
revoke all on function public.proposals_assign_number() from public, anon, authenticated;

drop trigger if exists proposals_number_insert on public.proposals;
create trigger proposals_number_insert
  before insert on public.proposals
  for each row execute function public.proposals_assign_number();

drop trigger if exists proposals_guard_insert on public.proposals;
create trigger proposals_guard_insert
  before insert on public.proposals
  for each row execute function public.guard_proposal_insert();

------------------------------------------------------------------------
-- 4. BEFORE UPDATE: only the editable columns may change
------------------------------------------------------------------------
create or replace function public.guard_proposal_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- created_by / task_id / project_id may only be CLEARED (their FK ON DELETE SET NULL).
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.company_id <> old.company_id
     or new.underwriting_id <> old.underwriting_id or new.proposal_number <> old.proposal_number
     or new.company_name <> old.company_name or new.project_name <> old.project_name
     or new.total <> old.total or new.created_at <> old.created_at
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
     or (new.task_id is distinct from old.task_id and new.task_id is not null)
     or (new.project_id is distinct from old.project_id and new.project_id is not null) then
    raise exception 'proposal number, total and source are immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists proposals_guard_update on public.proposals;
create trigger proposals_guard_update
  before update on public.proposals
  for each row execute function public.guard_proposal_update();

------------------------------------------------------------------------
-- 5. Tenant wall (same pattern as 072/073) + staff policies
------------------------------------------------------------------------
drop trigger if exists stamp_tenant_proposals on public.proposals;
create trigger stamp_tenant_proposals
  before insert on public.proposals
  for each row execute function public.stamp_tenant_id();

alter table public.proposals enable row level security;
drop policy if exists tenant_isolation_proposals on public.proposals;
create policy tenant_isolation_proposals on public.proposals
  as restrictive for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "proposal staff can read"   on public.proposals;
drop policy if exists "proposal staff can insert" on public.proposals;
drop policy if exists "proposal staff can update" on public.proposals;

create policy "proposal staff can read" on public.proposals
  for select to authenticated
  using (public.current_profile_role() = 'developer'
         or (company_id = any(public.current_company_ids())
             and public.current_profile_role() in ('admin','construction_supervisor','supervisor')));

-- company_id here is the caller's INPUT (the guard trigger overwrites it from the
-- underwriting, but the policy check runs on the final row, so it is the real one).
create policy "proposal staff can insert" on public.proposals
  for insert to authenticated
  with check (public.current_profile_role() = 'developer'
              or (company_id = any(public.current_company_ids())
                  and public.current_profile_role() in ('admin','construction_supervisor','supervisor')));

create policy "proposal staff can update" on public.proposals
  for update to authenticated
  using (public.current_profile_role() = 'developer'
         or (company_id = any(public.current_company_ids())
             and public.current_profile_role() in ('admin','construction_supervisor','supervisor')))
  with check (public.current_profile_role() = 'developer'
              or (company_id = any(public.current_company_ids())
                  and public.current_profile_role() in ('admin','construction_supervisor','supervisor')));

-- Grants: Supabase default privileges hand ALL to authenticated, so revoke first.
revoke all on public.proposals from anon, authenticated;
revoke truncate, references, trigger on public.proposals from public;
grant select on public.proposals to authenticated;
-- insert is limited to the identifying column + optional text; everything else is
-- derived by the guard trigger.
grant insert (underwriting_id, title, scope_of_work, terms) on public.proposals to authenticated;
grant update (title, scope_of_work, terms, client_name, job_address) on public.proposals to authenticated;

------------------------------------------------------------------------
-- 6. RPC (SECURITY INVOKER): generate — or return — the proposal. Idempotent.
------------------------------------------------------------------------
create or replace function public.create_proposal_for_underwriting(p_underwriting_id uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  existing uuid;
  new_id uuid;
begin
  -- Two clicks / two tabs: the second waits, then sees the first one's row.
  perform pg_advisory_xact_lock(hashtextextended('proposal:' || p_underwriting_id::text, 0));

  select id into existing from public.proposals where underwriting_id = p_underwriting_id;
  if existing is not null then
    return existing;
  end if;

  insert into public.proposals (underwriting_id) values (p_underwriting_id)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.create_proposal_for_underwriting(uuid) from public, anon;
grant execute on function public.create_proposal_for_underwriting(uuid) to authenticated;

commit;
