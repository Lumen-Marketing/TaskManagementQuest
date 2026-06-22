-- 052_add_task_completed_at.sql
-- Persist WHEN a task was completed so the Reports screen can compute throughput,
-- on-time rate and average cycle time from real history. Nullable; non-done tasks
-- keep NULL. The client stamps it on the status -> done transition (TaskModel.toggleDone)
-- and clears it on reopen.
--
-- Apply this to Supabase BEFORE deploying the matching client change to main.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Best-effort backfill so already-done tasks contribute to history. updated_at is
-- the closest proxy we have for "when it was last set to done".
UPDATE tasks
   SET completed_at = updated_at
 WHERE status = 'done'
   AND completed_at IS NULL;
