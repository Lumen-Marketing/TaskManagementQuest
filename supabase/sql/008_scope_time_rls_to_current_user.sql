drop policy if exists "role users can read time_entries" on public.time_entries;
drop policy if exists "role users can insert time_entries" on public.time_entries;
drop policy if exists "role users can update time_entries" on public.time_entries;
drop policy if exists "role users can delete time_entries" on public.time_entries;
create policy "role users can read time_entries" on public.time_entries
for select to authenticated
using (public.current_profile_role() in ('admin', 'construction_supervisor', 'supervisor', 'sales') or user_id = public.current_member_id());
create policy "role users can insert time_entries" on public.time_entries
for insert to authenticated
with check (user_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor'));
create policy "role users can update time_entries" on public.time_entries
for update to authenticated
using (user_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor'))
with check (user_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor'));
create policy "role users can delete time_entries" on public.time_entries
for delete to authenticated
using (user_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor'));

drop policy if exists "role users can read active_timers" on public.active_timers;
drop policy if exists "role users can insert active_timers" on public.active_timers;
drop policy if exists "role users can update active_timers" on public.active_timers;
drop policy if exists "role users can delete active_timers" on public.active_timers;
create policy "role users can read active_timers" on public.active_timers
for select to authenticated
using (public.current_profile_role() in ('admin', 'construction_supervisor', 'supervisor', 'sales') or user_id = public.current_member_id());
create policy "role users can insert active_timers" on public.active_timers
for insert to authenticated
with check (user_id = public.current_member_id());
create policy "role users can update active_timers" on public.active_timers
for update to authenticated
using (user_id = public.current_member_id()) with check (user_id = public.current_member_id());
create policy "role users can delete active_timers" on public.active_timers
for delete to authenticated
using (user_id = public.current_member_id());

drop policy if exists "role users can read notifications" on public.notifications;
drop policy if exists "role users can insert notifications" on public.notifications;
drop policy if exists "role users can update notifications" on public.notifications;
drop policy if exists "role users can delete notifications" on public.notifications;
create policy "role users can read notifications" on public.notifications
for select to authenticated
using (member_id = public.current_member_id() or public.can_manage_roles());
create policy "role users can insert notifications" on public.notifications
for insert to authenticated
with check (member_id = public.current_member_id() or public.current_profile_role() in ('admin', 'construction_supervisor', 'supervisor', 'sales'));
create policy "role users can update notifications" on public.notifications
for update to authenticated
using (member_id = public.current_member_id() or public.can_manage_roles())
with check (member_id = public.current_member_id() or public.can_manage_roles());
create policy "role users can delete notifications" on public.notifications
for delete to authenticated
using (member_id = public.current_member_id() or public.can_manage_roles());
