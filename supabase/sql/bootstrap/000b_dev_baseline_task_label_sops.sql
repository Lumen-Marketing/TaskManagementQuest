-- DEV-ONLY — NOT a production migration. Fills the slot of the never-committed
-- migration 069 (task_label_sops). Run AFTER 068 and BEFORE 070/072.
-- See 000_dev_baseline.sql for the evidence trail and why this is provisional.
--
-- NOT production-faithful. The repo establishes only that a table of this name exists with an
-- `id` (one row per SOP checklist step of a label; hard-deleted) — the real column list is
-- UNKNOWN, and production may not even have the table (the client reads it via _optionalSelect).
-- This is the minimum that lets 072 add tenant_id to it. Recover the truth with
-- tools/prod-catalog/task_label_sops.sql (read-only) and see
-- docs/runbooks/underwriting-073-open-items.md §3.
-- (task_label_sops.id: SupabaseDataStore.updateSopStep/deleteSopStep; company_id:
-- per-company like the other 056 taxonomy tables; tenant_id is added by 072.)

-- PROVISIONAL — replace with production schema definition before hosted dev rebuild
create table if not exists public.task_label_sops (
  id         uuid primary key default gen_random_uuid(),
  company_id text references public.companies(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.task_label_sops enable row level security;
