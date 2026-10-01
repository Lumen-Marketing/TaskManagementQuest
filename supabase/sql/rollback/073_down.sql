-- 073 rollback. Requires 074_down first. No CASCADE; unknown dependencies abort atomically.
-- Default refuses data loss. After an approved, verified backup ONLY,
-- SET quest.rollback_allow_data_loss = '073' to opt in.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.proposals') is not null or to_regclass('public.proposal_counters') is not null then
    raise exception '073 rollback refused: roll back 074 first';
  end if;
end $$;
lock table public.underwritings, public.task_underwriting_links, public.underwriting_field_changes in access exclusive mode;
do $$ begin
  if (exists(select 1 from public.underwritings) or exists(select 1 from public.task_underwriting_links)
      or exists(select 1 from public.underwriting_field_changes))
     and current_setting('quest.rollback_allow_data_loss',true) is distinct from '073' then
    raise exception '073 rollback refused: underwriting data exists; verified backup and explicit data-loss approval required';
  end if;
end $$;
drop function public.create_underwriting_for_task(text);
drop function public.save_underwriting_estimate(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text);
drop function public.set_underwriting_status(uuid,text,text);
drop table public.task_underwriting_links;
drop table public.underwriting_field_changes;
drop table public.underwritings;
drop function public.guard_task_underwriting_link();
drop function public.guard_underwriting_update();
drop function public.guard_underwriting_project();
drop function public.log_underwriting_changes();
commit;
