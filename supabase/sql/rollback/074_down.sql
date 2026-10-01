-- 074 rollback. Run BEFORE 073_down. No CASCADE; unknown dependencies abort atomically.
-- Default refuses to destroy proposal data or numbering history. After an approved,
-- verified backup ONLY, SET quest.rollback_allow_data_loss = '074' to opt in.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
lock table public.proposals, public.proposal_counters in access exclusive mode;
do $$ begin
  if (exists(select 1 from public.proposals) or exists(select 1 from public.proposal_counters))
     and current_setting('quest.rollback_allow_data_loss',true) is distinct from '074' then
    raise exception '074 rollback refused: proposal data/counters exist; verified backup and explicit data-loss approval required';
  end if;
end $$;
drop function public.create_proposal_for_underwriting(uuid);
drop table public.proposals;
drop table public.proposal_counters;
drop function public.guard_proposal_insert();
drop function public.guard_proposal_update();
drop function public.proposals_assign_number();
drop function public.assign_proposal_number(text);
commit;
