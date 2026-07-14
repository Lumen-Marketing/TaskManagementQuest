-- 067: Register the "Overall" pseudo-company.
--
-- "Overall" is the spans-all-companies company: a task set to Overall shows
-- under every real company's view plus its own. The client models it in
-- App.COMPANIES (js/constants.js) as { id:'overall', label:'Overall',
-- pill:'pill-overall', all:true }.
--
-- public.tasks.company_id has a FOREIGN KEY to public.companies
-- (tasks_company_id_fkey), so 'overall' must exist as a real companies row
-- before any Overall task can be inserted. Without this row, creating an
-- Overall task fails with:
--   insert or update on table "tasks" violates foreign key constraint
--   "tasks_company_id_fkey"
--
-- This is a DATA row, not a schema change: the companies table already mirrors
-- the client's App.COMPANIES (id / label / pill). Idempotent.
--
-- NOTE: this does NOT grant anyone access. Visibility is still gated by
-- migration 028 RLS (company_id = any(profiles.company_ids)). Grant a user
-- Overall access by ticking the "Overall" checkbox in the People / Approvals
-- admin (writes 'overall' into profiles.company_ids), or see
-- docs/overall-company-setup.md for the SQL equivalent.

begin;

insert into public.companies (id, label, pill)
values ('overall', 'Overall', 'pill-overall')
on conflict (id) do nothing;

commit;

-- Verify: should list roofing, drafting, lumen, overall.
--   select id, label, pill from public.companies order by created_at;
