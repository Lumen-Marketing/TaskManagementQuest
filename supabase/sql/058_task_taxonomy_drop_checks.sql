-- 058: Drop the fixed type/status/label/bid_status CHECK constraints on tasks now that
-- the taxonomy tables (056/057) define the allowed values per company. The
-- priority/urgency/due_time/reminder_at CHECKs are intentionally left in place.
-- Safe because every existing task's keys were seeded in 057 (verified: 0 unresolved).
-- Applied to production (project qqvmcsvdxhgjooirznrj) on 2026-07-02.

alter table public.tasks drop constraint if exists tasks_type_check;
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks drop constraint if exists tasks_label_check;
alter table public.tasks drop constraint if exists tasks_bid_status_check;
