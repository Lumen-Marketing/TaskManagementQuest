-- 057: Seed each existing company's taxonomy from the current js/constants.js values.
-- Every type is seeded with the standard statuses (todo..done) so no existing task row
-- is invalidated when the CHECKs are dropped in 058. Idempotent (on conflict do nothing).
-- Bid's real pipeline stages (In queue..Ready) are added later by an admin in Phase 3.
-- Applied to production (project qqvmcsvdxhgjooirznrj) on 2026-07-02.

insert into public.task_types (company_id, key, label, sort_order)
select c.id, t.key, t.label, t.ord
from public.companies c
cross join (values
  ('lead','Lead',0),('bid','Bid / Estimate',1),('admin','Admin',2),
  ('invoicing','Invoicing',3),('ar','AR',4),('meeting','Meeting',5),
  ('web_dev','Web development',6)
) t(key,label,ord)
on conflict (company_id, key) do nothing;

insert into public.task_type_statuses (company_id, type_key, key, label, color, sort_order, is_done, is_default)
select c.id, ty.key, s.key, s.label, s.color, s.ord, s.is_done, s.is_default
from public.companies c
cross join (values ('lead'),('bid'),('admin'),('invoicing'),('ar'),('meeting'),('web_dev')) ty(key)
cross join (values
  ('todo','Working on it','#3E7BF2',0,false,true),
  ('pending','Pending','#8F867B',1,false,false),
  ('hold','Stuck','#E0484D',2,false,false),
  ('review','In review','#ED9A3A',3,false,false),
  ('done','Done','#2E9E6B',4,true,false)
) s(key,label,color,ord,is_done,is_default)
on conflict (company_id, type_key, key) do nothing;

insert into public.task_labels (company_id, key, label, sort_order)
select c.id, l.key, l.label, l.ord
from public.companies c
cross join (values ('roof','Roof',0),('roof_framing','Roof & Framing',1),('framing','Framing',2)) l(key,label,ord)
on conflict (company_id, key) do nothing;
