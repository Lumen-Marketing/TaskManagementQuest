-- DEV-only rollback: refuses to discard source/provenance or recorded V1 history.
begin;
do $$ begin
  if exists(select 1 from public.underwritings where workflow is not null)
     or exists(select 1 from public.underwriting_field_changes where field_name='workflow') then
    raise exception '075 rollback refused: V1 records/history exist; preserve or migrate their provenance first';
  end if;
end $$;
drop trigger if exists underwritings_v1_guard on public.underwritings;
drop trigger if exists underwritings_v1_log on public.underwritings;
drop function if exists public.guard_underwriting_v1();
drop function if exists public.log_underwriting_v1();
drop function if exists public.validate_underwriting_v1(public.underwritings);
drop function if exists public.save_underwriting_v1(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,jsonb);
alter table public.underwritings drop column if exists workflow;
alter table public.underwriting_field_changes drop constraint if exists underwriting_field_changes_field_check;
alter table public.underwriting_field_changes add constraint underwriting_field_changes_field_check
  check(field_name in ('roof_area_sqft','waste_percent','material_cost','labor_cost','other_cost','target_margin_percent','status'));
commit;
