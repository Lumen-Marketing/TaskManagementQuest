-- REVIEW ONLY: apply on an isolated DEV database after 072, 073 and 074.
-- Extends the existing underwriting row and append-only history. No new tenant
-- tables, no RLS changes, no replacement of migration 073's decimal equations.
begin;
alter table public.underwritings add column if not exists workflow jsonb;
alter table public.underwriting_field_changes drop constraint if exists underwriting_field_changes_field_check;
alter table public.underwriting_field_changes add constraint underwriting_field_changes_field_check
  check (field_name in ('roof_area_sqft','waste_percent','material_cost','labor_cost','other_cost','target_margin_percent','status','workflow'));

-- Recompute economics from the line inputs; a supplied snapshot/readiness flag
-- cannot authorize approval or silently replace the figures protected by 073.
create or replace function public.validate_underwriting_v1(u public.underwritings)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare
  w jsonb := u.workflow; s jsonb; ln jsonb; j record;
  qty numeric; price numeric; materials numeric := 0; labor numeric; other numeric := 0;
  tax numeric; quote numeric; commission numeric; overhead numeric; hard numeric; net numeric;
  area numeric; order_sq numeric; adjusted_order numeric; report_order jsonb; all_priced boolean := true; current_prices boolean := true;
  expected_qty numeric; measured numeric; cov numeric; low_area numeric; shingle_area numeric; accessory text; key text;
  rate numeric; cr numeric; ov numeric; ready boolean;
begin
  if w is null then return true; end if;
  if w->>'schemaVersion' is distinct from '1' or w->'measurement'->>'schemaVersion' is distinct from '1'
     or jsonb_typeof(w->'measurement'->'source') is distinct from 'object'
     or nullif(w->'measurement'->'source'->>'provider','') is null
     or nullif(w->'measurement'->'source'->>'reportName','') is null
     or nullif(w->'measurement'->'source'->>'reference','') is null
     or coalesce((w->'measurement'->'source'->>'page')::integer,0) < 1 then
    raise exception 'normalized measurement source is required';
  end if;
  area := coalesce(w->'measurementOverrides'->>'roofAreaSqft', w->'measurement'->>'roofAreaSqft')::numeric;
  if area is null or area <= 0 or area is distinct from u.roof_area_sqft then raise exception 'measurement area does not match saved input'; end if;
  order_sq := ceil(area * (100 + u.waste_percent) / 10000);
  adjusted_order := round(area*(100+u.waste_percent)/100,0);
  if nullif(w->'measurementOverrides'->>'roofAreaSqft','') is null then
    select x into report_order from jsonb_array_elements(w->'measurement'->'reportWasteTable') x where (x->>'wastePercent')::numeric = u.waste_percent limit 1;
    if report_order is not null then
      adjusted_order := (report_order->>'adjustedAreaSqft')::numeric; order_sq := (report_order->>'orderSquares')::numeric;
      if abs(adjusted_order-round(area*(100+u.waste_percent)/100,0)) > ceil(1+u.waste_percent/100)
         or order_sq <> ceil(adjusted_order/100) then raise exception 'report order exceeds rounding tolerance'; end if;
    end if;
  end if;
  s := w->'snapshot';
  if jsonb_typeof(s->'lines') is distinct from 'array' or jsonb_array_length(s->'lines') <> 11 then raise exception 'eleven material lines are required'; end if;
  if (select count(distinct x->>'key') from jsonb_array_elements(s->'lines') x) <> 11 then raise exception 'duplicate material line'; end if;
  select sum((p->>'areaSqft')::numeric) filter(where (p->>'pitchRise')::numeric < 2),
    sum((p->>'areaSqft')::numeric) filter(where (p->>'pitchRise')::numeric >= 2) into low_area,shingle_area
    from jsonb_array_elements(w->'measurement'->'pitchAreas') p;
  if jsonb_array_length(w->'measurement'->'pitchAreas') > 0 then low_area:=coalesce(low_area,0); shingle_area:=coalesce(shingle_area,0); end if;
  for ln in select value from jsonb_array_elements(s->'lines') loop
    if ln->>'key' not in ('shingles','deckProtection','starter','ridgeCap','dripEdge','leakBarrier','lowSlopeBase','lowSlopeCap','coilNails','capNails','stepFlashing') then raise exception 'unknown material line'; end if;
    key := ln->>'key';
    if nullif(w->'materials'->key->>'quantity','') is not null then
      expected_qty := (w->'materials'->key->>'quantity')::numeric;
    elsif key in ('coilNails','capNails') then
      select (r->>'quantity')::numeric into expected_qty from jsonb_array_elements(w->'measurement'->'materialRecommendations') r
        where r->>'key'=key and (r->>'wastePercent')::numeric=u.waste_percent limit 1;
    else
      cov := case key when 'shingles' then 32.8 when 'deckProtection' then 1000 when 'starter' then 120
        when 'ridgeCap' then 25 when 'dripEdge' then 10 when 'stepFlashing' then 10 when 'lowSlopeBase' then 200
        when 'lowSlopeCap' then 100 when 'leakBarrier' then 200 end;
      measured := case key when 'shingles' then shingle_area when 'deckProtection' then area
        when 'lowSlopeBase' then low_area when 'lowSlopeCap' then low_area
        when 'stepFlashing' then (w->'measurement'->'lengths'->>'step')::numeric else null end;
      if key in ('starter','dripEdge','ridgeCap','leakBarrier') then
        accessory := key;
        measured := (w->'measurement'->'reportedAccessories'->>accessory)::numeric;
        if measured is null then
          measured := case key
            when 'starter' then (w->'measurement'->'lengths'->>'eaves')::numeric+(w->'measurement'->'lengths'->>'rakes')::numeric
            when 'dripEdge' then (w->'measurement'->'lengths'->>'eaves')::numeric+(w->'measurement'->'lengths'->>'rakes')::numeric
            when 'ridgeCap' then (w->'measurement'->'lengths'->>'hips')::numeric+(w->'measurement'->'lengths'->>'ridges')::numeric
            when 'leakBarrier' then (w->'measurement'->'lengths'->>'bends')::numeric+(w->'measurement'->'lengths'->>'eaves')::numeric
              +(w->'measurement'->'lengths'->>'flashing')::numeric+(w->'measurement'->'lengths'->>'hips')::numeric
              +(w->'measurement'->'lengths'->>'rakes')::numeric+(w->'measurement'->'lengths'->>'step')::numeric+(w->'measurement'->'lengths'->>'valleys')::numeric end;
        end if;
        if key='leakBarrier' then measured:=measured*3; end if;
      end if;
      expected_qty := ceil(measured * (100+u.waste_percent) / 100 / cov);
    end if;
    if expected_qty is null or expected_qty is distinct from (ln->>'quantity')::numeric then raise exception 'material coverage quantity mismatch'; end if;
    qty := (ln->>'quantity')::numeric; price := (ln->>'unitPrice')::numeric;
    if qty is null or qty < 0 or (price is null and qty > 0) or price < 0 then raise exception 'material quantity and pricing are incomplete'; end if;
    if qty > 0 and (nullif(ln->>'supplier','') is null or (coalesce(ln->>'pricedAt','') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((ln->>'pricedAt')::date,'YYYY-MM-DD') <> ln->>'pricedAt')) then current_prices := false; end if;
    materials := materials + round(qty * coalesce(price,0),2);
    if qty > 0 and (ln->>'total')::numeric is distinct from round(qty * price,2) then raise exception 'material extended cost mismatch'; end if;
    -- Product, price and any override must match the user-edited line inputs.
    if (w->'materials'->(ln->>'key')->>'unitPrice')::numeric is distinct from price then raise exception 'material price mismatch'; end if;
    if nullif(w->'materials'->(ln->>'key')->>'quantity','') is not null
       and (w->'materials'->(ln->>'key')->>'quantity')::numeric is distinct from qty then raise exception 'quantity override mismatch'; end if;
  end loop;
  tax := (w->>'taxPercent')::numeric;
  rate := (w->>'laborRate')::numeric;
  quote := (w->>'clientPrice')::numeric;
  cr := (w->>'commissionPercent')::numeric; ov := (w->>'overheadPercent')::numeric;
  if tax is null or tax < 0 or tax > 100 or rate is null or rate < 0 or quote is null or quote < 0
     or cr is null or cr < 0 or ov is null or ov < 0 or cr + ov >= 100 then raise exception 'invalid job economics'; end if;
  if (w->>'targetMarginPercent')::numeric is distinct from u.target_margin_percent then raise exception 'margin input mismatch'; end if;
  materials := materials + round(materials * tax / 100,2);
  labor := order_sq * rate;
  for j in select * from jsonb_each_text(w->'jobCosts') loop
    if j.key not in ('dumpster','delivery','permit','plywood','solar','flashing','other') or j.value::numeric < 0 then raise exception 'invalid job cost'; end if;
    other := other + j.value::numeric;
  end loop;
  commission := round(quote * cr / 100,2); overhead := round(quote * ov / 100,2);
  hard := materials + labor + other; net := quote - hard - commission - overhead;
  if u.material_cost is distinct from materials or u.labor_cost is distinct from labor or u.other_cost is distinct from other + commission + overhead
     or (s->>'hardCost')::numeric is distinct from hard
     or (s->>'netProfit')::numeric is distinct from net
     or (s->'order'->>'orderSquares')::numeric is distinct from order_sq
     or (s->'order'->>'adjustedAreaSqft')::numeric is distinct from adjusted_order then
    raise exception 'V1 cost/order snapshot does not match saved inputs';
  end if;
  ready := coalesce(w->'review'->>'measurementsVerified','false') = 'true'
    and coalesce(w->'review'->>'wasteConfirmed','false') = 'true'
    and coalesce(w->'review'->>'materialTakeoffReviewed','false') = 'true'
    and coalesce(w->'review'->>'laborConfirmed','false') = 'true'
    and coalesce(w->'review'->>'pricingCurrent','false') = 'true'
    and jsonb_array_length(w->'measurement'->'pitchAreas') > 0 and current_prices and all_priced
    and quote > 0 and round(net/ nullif(quote,0)*100,2) >= u.target_margin_percent;
  return coalesce(ready,false);
end; $$;
revoke all on function public.validate_underwriting_v1(public.underwritings) from public, anon, authenticated;
-- Trigger functions execute this helper as their invoker, so authenticated needs
-- EXECUTE; it only validates caller-supplied composites and reads no tenant data.
grant execute on function public.validate_underwriting_v1(public.underwritings) to authenticated;

create or replace function public.guard_underwriting_v1()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare ready boolean;
begin
  if tg_op = 'UPDATE' then
    if old.workflow is not null and new.workflow is null then raise exception 'V1 source and provenance cannot be removed'; end if;
    if old.status in ('approved','declined') and new.workflow is distinct from old.workflow then raise exception 'reviewed V1 snapshot is locked'; end if;
    -- Any source, quantity, cost or waste edit clears corresponding confirmations.
    if new.workflow->'measurementOverrides' is distinct from old.workflow->'measurementOverrides'
       or new.workflow->'materials' is distinct from old.workflow->'materials' then
      if (new.workflow->'measurementOverrides' is not null or exists(select 1 from jsonb_each(new.workflow->'materials') m where nullif(m.value->>'quantity','') is not null))
         and nullif(btrim(coalesce(current_setting('app.uw_change_reason',true),'')),'') is null then
        raise exception 'record a reason for source/quantity overrides';
      end if;
    end if;
    if new.workflow is not null and old.workflow is not null then
      if new.workflow->'measurement' is distinct from old.workflow->'measurement'
         or new.workflow->'measurementOverrides' is distinct from old.workflow->'measurementOverrides'
         or new.waste_percent is distinct from old.waste_percent then
        new.workflow := jsonb_set(new.workflow,'{review}','{}'::jsonb);
      elsif new.workflow->'materials' is distinct from old.workflow->'materials' then
        new.workflow := jsonb_set(jsonb_set(new.workflow,'{review,materialTakeoffReviewed}','false'::jsonb),'{review,pricingCurrent}','false'::jsonb);
      end if;
    end if;
  end if;
  if new.workflow is not null then
    ready := public.validate_underwriting_v1(new);
    if new.status in ('ready_for_review','approved') and not ready then raise exception 'complete PROVE checks before review or approval'; end if;
    if tg_op = 'INSERT' or new.workflow is distinct from old.workflow then
      new.workflow := jsonb_set(new.workflow,'{provenance}',jsonb_build_object('savedBy',public.current_member_id(),'savedAt',now(),'importMethod',coalesce(new.workflow->'measurement'->'source'->>'method','manual')));
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists underwritings_v1_guard on public.underwritings;
create trigger underwritings_v1_guard before insert or update on public.underwritings for each row execute function public.guard_underwriting_v1();

create or replace function public.log_underwriting_v1()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.workflow is distinct from old.workflow then
    insert into public.underwriting_field_changes(tenant_id,company_id,underwriting_id,field_name,old_value,new_value,changed_by,reason)
    values(new.tenant_id,new.company_id,new.id,'workflow',old.workflow::text,new.workflow::text,public.current_member_id(),nullif(current_setting('app.uw_change_reason',true),''));
  end if;
  return null;
end; $$;
drop trigger if exists underwritings_v1_log on public.underwritings;
create trigger underwritings_v1_log after update on public.underwritings for each row execute function public.log_underwriting_v1();

create or replace function public.save_underwriting_v1(
  p_id uuid, p_roof_area_sqft numeric, p_waste_percent numeric, p_material_cost numeric,
  p_labor_cost numeric, p_other_cost numeric, p_target_margin_percent numeric,
  p_adjusted_roof_area_sqft numeric, p_squares numeric, p_total_estimated_cost numeric,
  p_recommended_sale_price numeric, p_reason text, p_workflow jsonb
) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if p_workflow is null then raise exception 'V1 workflow is required'; end if;
  perform set_config('app.uw_change_reason',coalesce(p_reason,''),true);
  update public.underwritings set roof_area_sqft=p_roof_area_sqft,waste_percent=p_waste_percent,
    material_cost=p_material_cost,labor_cost=p_labor_cost,other_cost=p_other_cost,target_margin_percent=p_target_margin_percent,
    adjusted_roof_area_sqft=p_adjusted_roof_area_sqft,squares=p_squares,total_estimated_cost=p_total_estimated_cost,
    recommended_sale_price=p_recommended_sale_price,calculated_at=now(),workflow=p_workflow where id=p_id;
  if not found then raise exception 'underwriting not found'; end if;
end; $$;
revoke all on function public.save_underwriting_v1(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,jsonb) from public, anon;
grant execute on function public.save_underwriting_v1(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,jsonb) to authenticated;
commit;
