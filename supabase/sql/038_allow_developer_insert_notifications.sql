-- 038: Let developer accounts deliver notifications to other members.
--
-- Migration 011 set out to add the 'developer' role to "every RLS role check"
-- so developer accounts have admin-level reach — but the notifications INSERT
-- policy created back in migration 008 was missed. As a result, a developer
-- creating/assigning a task for someone else trips:
--   new row violates row-level security policy for table "notifications"
-- when the app inserts the recipient's in-app notification (the task itself
-- saves fine; only the notification ping is blocked).
--
-- This recreates the INSERT policy with 'developer' added to the privileged
-- role list, matching the task/time policies. The read/update/delete policies
-- already admit developers via can_manage_roles(), so only INSERT needs the fix.
-- Idempotent.

begin;

drop policy if exists "role users can insert notifications" on public.notifications;
create policy "role users can insert notifications" on public.notifications
for insert to authenticated
with check (
  member_id = public.current_member_id()
  or public.current_profile_role() in ('admin', 'construction_supervisor', 'developer', 'supervisor', 'sales')
);

commit;
