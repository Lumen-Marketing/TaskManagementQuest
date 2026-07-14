-- 068: "Overall" access is AUTOMATIC for cross-company members.
--
-- Policy decision: being in 2+ real companies IS what makes someone a
-- cross-company member, so Overall access should follow from that rather than
-- being a separate checkbox an admin has to remember to tick.
--
-- Access is enforced by migration-028 RLS as `company_id = any(company_ids)`,
-- so "has Overall access" literally means "'overall' is in profiles.company_ids".
-- We therefore MAINTAIN that array with a trigger instead of hand-granting:
--
--   >= 2 real companies  -> 'overall' is added to company_ids
--   <  2 real companies  -> 'overall' is removed from company_ids
--
-- ("real" = any company id other than 'overall' itself.)
--
-- Because the client derives its company list from profiles.company_ids
-- (AppController.initCompanyContext), the Overall option/chip appears for these
-- users with no client-side change. Developers keep god-mode access regardless.
--
-- Also fixes a gap this exposes: migration 041 constrains a WORKER's INSERT so
-- the assignee must belong to the task's company. For an Overall task that would
-- demand the assignee also have 'overall' — but an Overall task spans every
-- company and its picker offers the FULL roster, so any approved member must be
-- assignable. assignee_in_company() is updated to treat 'overall' as matching
-- any approved profile.
--
-- Idempotent; transaction-wrapped.

begin;

------------------------------------------------------------------------
-- 1. Keep 'overall' in sync with real-company count on every write.
------------------------------------------------------------------------
create or replace function public.sync_overall_company()
returns trigger
language plpgsql
as $$
declare
  real_count int;
begin
  new.company_ids := coalesce(new.company_ids, '{}'::text[]);

  select count(*) into real_count
  from unnest(new.company_ids) c
  where c <> 'overall';

  if real_count >= 2 then
    if not ('overall' = any(new.company_ids)) then
      new.company_ids := array_append(new.company_ids, 'overall');
    end if;
  else
    new.company_ids := array_remove(new.company_ids, 'overall');
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_overall on public.profiles;
create trigger profiles_sync_overall
before insert or update on public.profiles
for each row execute function public.sync_overall_company();

------------------------------------------------------------------------
-- 2. Backfill existing profiles (the no-op SET fires the trigger, which
--    normalizes company_ids in both directions).
------------------------------------------------------------------------
update public.profiles set company_ids = company_ids;

------------------------------------------------------------------------
-- 3. An Overall task may be assigned to ANY approved member.
--    (Supersedes the helper from migration 041; the INSERT policy that
--    calls it is unchanged.)
------------------------------------------------------------------------
create or replace function public.assignee_in_company(p_member_id text, p_company_id text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.member_id = p_member_id
      and p.approved is distinct from false
      and (p_company_id = 'overall' or p_company_id = any(p.company_ids))
  );
$$;

revoke all on function public.assignee_in_company(text, text) from public, anon;
grant execute on function public.assignee_in_company(text, text) to authenticated;

commit;

-- Verify: everyone with 2+ real companies should now show has_overall = true.
--   select member_id, role, company_ids, ('overall' = any(company_ids)) as has_overall
--   from public.profiles order by role, member_id;
