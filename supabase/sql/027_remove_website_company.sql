-- 027: Remove the "Website" company (reverses migration 023).
--
-- tasks.company_id is a NOT NULL FK to companies(id) with no cascade (003),
-- so the company row can't be dropped while tasks still point at it. Per the
-- decision to keep that work, first reassign every Website task to Lumen,
-- then strip 'website' from each profile's company_ids access array, then
-- delete the company row. Wrapped in a transaction so it's all-or-nothing;
-- idempotent (a re-run finds nothing left to change).

begin;

-- 1. Move Website tasks to Lumen so the FK no longer blocks the delete.
update public.tasks
  set company_id = 'lumen'
  where company_id = 'website';

-- 2. Revoke Website from anyone who had it in their company access list.
update public.profiles
  set company_ids = array_remove(company_ids, 'website')
  where 'website' = any(company_ids);

-- 3. Drop the company row itself.
delete from public.companies where id = 'website';

commit;
