-- 061: Per-company sequential work-order number (QH-####).
--
-- Assigned atomically at create time via an RPC. The increment is a SINGLE upsert
-- statement so concurrent inserts can never collide on the same value. Idempotent.

create table if not exists public.wo_counters (
  company_id text primary key,
  next_val   int not null default 1
);
alter table public.wo_counters enable row level security;

alter table public.tasks
  add column if not exists wo_number int;

-- security definer so any authenticated caller can advance the counter without
-- direct table grants; the atomic upsert returns the value assigned to THIS call.
create or replace function public.assign_wo_number(company text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned int;
begin
  insert into public.wo_counters as c (company_id, next_val)
    values (company, 2)
  on conflict (company_id)
    do update set next_val = c.next_val + 1
    returning (c.next_val - 1) into assigned;
  -- On the very first insert for a company there is no conflict, so the RETURNING
  -- above yields null; that company's first work order is number 1.
  return coalesce(assigned, 1);
end;
$$;

grant execute on function public.assign_wo_number(text) to authenticated;

-- Verify: assign_wo_number('roofing') returns 1, then 2, then 3 …; a different
-- company starts again at 1. Numbers are per-company and never reused.
