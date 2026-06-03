-- 023: Add the "Website" company row.
--
-- Mirrors the original 003 seed for the three companies: each row in
-- public.companies pairs an id (referenced by tasks.company_id) with
-- a display label and a CSS pill class (rendered in chips / sidebar
-- dots). Idempotent — re-running this migration is a no-op.

insert into public.companies (id, label, pill)
values ('website', 'Website', 'pill-website')
on conflict (id) do update set
  label = excluded.label,
  pill  = excluded.pill;
