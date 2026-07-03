-- 059_bid_pipeline.sql — retire the separate bid_status field by folding the Bid
-- pipeline into the Bid type's own statuses. Snapshot-first; rewrites only bid rows.
begin;

-- 1. Snapshot (instant rollback safety net).
create schema if not exists backup;
create table if not exists backup.tasks_20260703 as select * from public.tasks;

-- 2. Clear the generic done/default flags on the Bid type so the partial unique
--    indexes (task_status_one_done / task_status_one_default) don't conflict.
update public.task_type_statuses
   set is_done = false, is_default = false
 where type_key = 'bid';

-- 3. Upsert the pipeline stages for every company that has a bid type.
--    Colours mirror the current bid pill tints; Done uses the standard done green.
insert into public.task_type_statuses
  (company_id, type_key, key, label, color, sort_order, is_done, is_default, active)
select c.company_id, 'bid', v.key, v.label, v.color, v.sort_order, v.is_done, v.is_default, true
from (select distinct company_id from public.task_type_statuses where type_key = 'bid') c
cross join (values
  ('queue',    'In queue',         '#3E7BF2', 0::float8, false, true),
  ('started',  'Started',          '#ED9A3A', 1,          false, false),
  ('supplier', 'Waiting supplier', '#E0484D', 2,          false, false),
  ('ready',    'Ready to submit',  '#8F867B', 3,          false, false),
  ('done',     'Done',             '#2E9E6B', 4,          true,  false)
) as v(key, label, color, sort_order, is_done, is_default)
on conflict (company_id, type_key, key) do update
  set label = excluded.label, color = excluded.color, sort_order = excluded.sort_order,
      is_done = excluded.is_done, is_default = excluded.is_default, active = true;

-- 4. Soft-delete the Bid type's leftover generic statuses (todo/pending/hold/review),
--    so the active Bid list is exactly the pipeline. 'done' is reused above.
update public.task_type_statuses
   set active = false
 where type_key = 'bid' and key in ('todo','pending','hold','review');

-- 5. Rewrite bid tasks' status onto a pipeline key (the ONLY rows changed):
--    completed stays done; otherwise use the old bid_status; no-stage -> queue.
update public.tasks
   set status = case
       when status = 'done' then 'done'
       when bid_status is not null then bid_status
       else 'queue' end
 where type = 'bid';

commit;
