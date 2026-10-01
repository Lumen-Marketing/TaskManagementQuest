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
-- public.profiles — RECONCILED against the production catalog (schema metadata only,
-- no row data; read from the Quest HQ production SQL editor, 2026-09-30).
--
-- This file declares ONLY the columns that exist BEFORE migration 003. Every other
-- production column is added by a numbered file and is deliberately NOT declared here:
--   email_verified (006)  member_id (007)  supervisor_id (012)  company_ids (016->021)
--   avatar_url (019)      position (065)
-- Constraints, indexes, policies and triggers likewise come from the numbered files
-- (profiles_role_check/profiles_supervisor_not_self 014, profiles_avatar_url_safe 022,
-- profiles_member_id_unique 033, profiles_company_ids_idx 021, the three sync triggers
-- 039/045/068, and the policies from 007/014/017/021/024/030).
--
-- Production-observed pre-003 shape:
--   id         uuid  PK  -> auth.users(id) ON DELETE CASCADE   (profiles_id_fkey / profiles_pkey)
--   email      text  NULL
--   full_name  text  NULL
--   approved   boolean, no NOT NULL here (014 "ensure approval status is a real boolean,
--              not null" sets it), default false  (final prod: NOT NULL default false)
--   role       text  NULL, NO default here (007 then 032 set the default 'worker'; final
--              prod: nullable, default 'worker'::text)
--   created_at timestamptz NOT NULL default now()
--
-- Corrections vs the earlier provisional baseline:
--   * REMOVED updated_at — production's profiles has no such column (014's comment about
--     bumping it never produced one).
--   * role is nullable with no baseline default (was NOT NULL default 'member').
--
-- Known production DRIFT (not reproduced here, deliberately): production's profiles has
-- NO `onboarded` column although migration 015 adds it and js/app.js writes it. A replay
-- therefore yields one extra column (`onboarded boolean not null default false`) versus
-- production. Either production never received 015 (the app's onboarded write fails
-- there) or the column was later dropped. Decide before the hosted dev rebuild.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  approved   boolean default false,
  role       text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
