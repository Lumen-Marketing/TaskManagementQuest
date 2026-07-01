# Task Taxonomy — Phase 1 (Database) Implementation Plan

> **For agentic workers:** Applied via the Supabase MCP tooling against project
> `qqvmcsvdxhgjooirznrj` ("ShanIngrid1207's Project" — Quest HQ production). Steps use
> checkbox (`- [ ]`) syntax. This phase is DB-only; no app code ships until Phase 2.

**Goal:** Create the per-company taxonomy tables (`task_types`, `task_type_statuses`,
`task_labels`), seed every existing company from today's constants, and drop the fixed
CHECK constraints on `tasks` — **additively, with no existing task row rewritten.**

**Architecture:** Keyed tables scoped by `company_id`; tasks keep their text
`type`/`status`/`label` columns. Seeding makes every currently-used key valid in the new
tables, so tasks stay valid once the CHECKs are dropped. A `backup.tasks_20260702`
snapshot is taken first for instant rollback.

**Tech Stack:** Postgres 17 (Supabase), RLS via `current_profile_role()` +
`current_company_ids()`.

## Global Constraints

- Target project: `qqvmcsvdxhgjooirznrj` (production) — verify before every write.
- Additive only: **no `UPDATE`/`DELETE` on existing `tasks` rows** in this phase.
- Editable-by roles: `developer`, `admin`, `construction_supervisor`. Read: company members.
- Companies seeded from `public.companies` (currently roofing, drafting, lumen).
- Seed values copied verbatim from `js/constants.js` (types, statuses, labels).
- Leave the `tasks` priority/urgency/due_time/reminder_at CHECKs intact.

---

### Task 1: Snapshot (rollback safety net)

- [ ] **Step 1 — take the backup** (via `execute_sql`), in a non-API-exposed schema:

```sql
create schema if not exists backup;
create table if not exists backup.tasks_20260702 as select * from public.tasks;
```

- [ ] **Step 2 — verify it matches** (expect the same count, currently 85):

```sql
select (select count(*) from public.tasks) live,
       (select count(*) from backup.tasks_20260702) snap;
```
Expected: `live == snap`.

### Task 2: Create tables + indexes + RLS + invariants

Apply as migration `056_task_taxonomy_tables` (`apply_migration`). Single transaction.

- [ ] **Step 1 — tables + indexes + one-done/one-default partial unique indexes:**

```sql
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
-- Invariants: at most one done / one default per (company, type).
create unique index if not exists task_status_one_done on public.task_type_statuses (company_id, type_key) where is_done;
create unique index if not exists task_status_one_default on public.task_type_statuses (company_id, type_key) where is_default;
```

- [ ] **Step 2 — RLS (read = company members/dev; write = admin/constr-sup/dev in-company):**

```sql
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
```

### Task 3: Seed every company from the current constants

Apply as migration `057_task_taxonomy_seed`. Cross-joins `public.companies` so it seeds
whatever companies exist; `on conflict do nothing` makes it idempotent.

- [ ] **Step 1 — types (7 per company):**

```sql
insert into public.task_types (company_id, key, label, sort_order)
select c.id, t.key, t.label, t.ord
from public.companies c
cross join (values
  ('lead','Lead',0),('bid','Bid / Estimate',1),('admin','Admin',2),
  ('invoicing','Invoicing',3),('ar','AR',4),('meeting','Meeting',5),
  ('web_dev','Web development',6)
) t(key,label,ord)
on conflict (company_id, key) do nothing;
```

- [ ] **Step 2 — statuses (5 per type, every type): todo=default, done=is_done:**

```sql
insert into public.task_type_statuses (company_id, type_key, key, label, color, sort_order, is_done, is_default)
select c.id, ty.key, s.key, s.label, s.color, s.ord, s.is_done, s.is_default
from public.companies c
cross join (values ('lead'),('bid'),('admin'),('invoicing'),('ar'),('meeting'),('web_dev')) ty(key)
cross join (values
  ('todo','Working on it','#3E7BF2',0,false,true),
  ('pending','Pending','#8F867B',1,false,false),
  ('hold','Stuck','#E0484D',2,false,false),
  ('review','In review','#ED9A3A',3,false,false),
  ('done','Done','#2E9E6B',4,true,false)
) s(key,label,color,ord,is_done,is_default)
on conflict (company_id, type_key, key) do nothing;
```

- [ ] **Step 3 — labels (3 per company):**

```sql
insert into public.task_labels (company_id, key, label, sort_order)
select c.id, l.key, l.label, l.ord
from public.companies c
cross join (values ('roof','Roof',0),('roof_framing','Roof & Framing',1),('framing','Framing',2)) l(key,label,ord)
on conflict (company_id, key) do nothing;
```

### Task 4: Drop the fixed CHECK constraints, then verify

Apply as migration `058_task_taxonomy_drop_checks`.

- [ ] **Step 1 — drop type/status/label/bid_status CHECKs (keep the others):**

```sql
alter table public.tasks drop constraint if exists tasks_type_check;
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks drop constraint if exists tasks_label_check;
alter table public.tasks drop constraint if exists tasks_bid_status_check;
```

- [ ] **Step 2 — verify every existing task resolves + counts unchanged** (`execute_sql`):

```sql
select
  (select count(*) from public.tasks t
     left join public.task_types tt on tt.company_id=t.company_id and tt.key=t.type
   where tt.id is null) as unresolved_types,
  (select count(*) from public.tasks t
     left join public.task_type_statuses s on s.company_id=t.company_id and s.type_key=t.type and s.key=t.status
   where s.id is null) as unresolved_statuses,
  (select count(*) from public.tasks t
     left join public.task_labels l on l.company_id=t.company_id and l.key=t.label
   where t.label is not null and l.id is null) as unresolved_labels,
  (select count(*) from public.task_types) as types,
  (select count(*) from public.task_type_statuses) as statuses,
  (select count(*) from public.task_labels) as labels,
  (select count(*) from public.tasks) as tasks;
```
Expected: `unresolved_* = 0`; `types=21`, `statuses=105`, `labels=9`, `tasks=85` (unchanged).

- [ ] **Step 3 — advisors check:** run `get_advisors` (security) and confirm no new
  ERROR-level findings on the three new tables (RLS is enabled).

## Rollback (if verification fails)

```sql
drop table if exists public.task_types, public.task_type_statuses, public.task_labels cascade;
alter table public.tasks add constraint tasks_type_check check (type in ('lead','bid','admin','invoicing','ar','meeting','web_dev'));
alter table public.tasks add constraint tasks_status_check check (status in ('todo','pending','hold','review','done'));
alter table public.tasks add constraint tasks_label_check check (label is null or label in ('roof','roof_framing','framing'));
alter table public.tasks add constraint tasks_bid_status_check check (bid_status is null or bid_status in ('queue','started','supplier','ready'));
-- (backup.tasks_20260702 remains available; no task rows were touched anyway.)
```

## Self-Review

- **Spec coverage:** tables (B) ✓, RLS (B) ✓, invariants (B) ✓, seed per company from
  constants (E) ✓, drop CHECKs (B/E) ✓, snapshot + verify (Delivery) ✓, no row rewrites
  (Decisions) ✓. Runtime loading / done-refactor / admin UI / new-task UI are Phases 2–4.
- **Placeholders:** none — every step is runnable SQL with expected output.
- **Consistency:** column names (`company_id`,`type`,`status`,`label`,`bid_status`),
  constraint names, and helper functions match the live schema inspected on 2026-07-02.
