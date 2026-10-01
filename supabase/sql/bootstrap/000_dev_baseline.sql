-- ============================================================================
-- DEV-ONLY BASELINE — NOT a production migration. Never add this to the numbered
-- history and never run it against production (qqvmcsvdxhgjooirznrj).
--
-- Purpose: the numbered files in supabase/sql/ cannot replay from zero because two
-- objects were created outside the repo history:
--   * public.profiles        — created in the dashboard before migration 003
--   * public.task_label_sops — migration "069" was never committed
-- This file supplies profiles (run FIRST, before 003). 000b_dev_baseline_task_label_sops.sql
-- supplies the other, at the missing-069 slot (it needs public.companies from 003).
--
-- PROVISIONAL — replace with production schema definition before hosted dev rebuild.
-- Every column below is here because the repo's own SQL/code REQUIRES it; nothing
-- more has been inferred. Later numbered files add the remaining profiles columns
-- (email_verified, member_id, company_id(s), supervisor_id, onboarded, avatar_url,
-- position, ...), so they are deliberately NOT declared here.
--
-- Evidence trail:
--   profiles.id          005/006/007 (`p.id = auth.uid()`), 006 handle_new_user insert
--   profiles.email       006/007 handle_new_user insert
--   profiles.full_name   006/007 handle_new_user insert
--   profiles.approved    005 (`p.approved is true`), 006 (`alter column approved set default true`)
--   profiles.role        007 (`alter column role set default 'member'`), 014 (role check)
--   profiles.created_at  js/services/SupabaseDataStore.js:171 (`order('created_at')`)
--   profiles.updated_at  014 ("trigger ensuring profiles.updated_at is bumped")
--   task_label_sops.id   SupabaseDataStore.updateSopStep/deleteSopStep (`.eq('id', id)`)
--   task_label_sops.company_id  every other taxonomy table (056) is per-company, and
--                        072 stamps tenant_id onto this table. Beyond id/company_id/
--                        created_at the real columns are UNKNOWN to this repo.
-- ============================================================================

create extension if not exists pgcrypto;

-- PROVISIONAL — replace with production schema definition before hosted dev rebuild
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  approved   boolean not null default false,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
