create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from anon, authenticated, public;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
  end if;
end $$;

do $$
declare
  table_name text;
  approved_check text := 'exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved is true)';
begin
  foreach table_name in array array[
    'companies', 'team_members', 'tasks', 'task_watchers', 'task_subtasks',
    'task_activity', 'time_entries', 'active_timers', 'notifications'
  ] loop
    execute format('drop policy if exists "authenticated can read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "authenticated can insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "authenticated can update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "authenticated can delete %1$s" on public.%1$I', table_name);

    execute format('create policy "approved users can read %1$s" on public.%1$I for select to authenticated using (%2$s)', table_name, approved_check);
    execute format('create policy "approved users can insert %1$s" on public.%1$I for insert to authenticated with check (%2$s)', table_name, approved_check);
    execute format('create policy "approved users can update %1$s" on public.%1$I for update to authenticated using (%2$s) with check (%2$s)', table_name, approved_check);
    execute format('create policy "approved users can delete %1$s" on public.%1$I for delete to authenticated using (%2$s)', table_name, approved_check);
  end loop;
end $$;
