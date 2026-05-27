insert into public.tasks (id, title, description, company_id, creator_id, assignee_id, due, priority, urgency, status) values
  ('t1', 'Lien filing - CNL job', 'Mechanic''s lien paperwork prepped. Need to file with Maricopa County recorder before end of week.', 'roofing', 'abraham', 'abraham', current_date - 4, 'high', 'urgent', 'todo'),
  ('t2', 'Update QR ROC complaint draft', 'Add the contract excerpt and email chain as exhibits before sending.', 'roofing', 'abraham', 'kristine', current_date - 2, 'medium', 'high', 'pending'),
  ('t3', 'CNL demand letter follow-up', 'Call CNL accounting by EOD. If no commitment, file mechanic''s lien tomorrow + Justice Court small claims by Friday.', 'roofing', 'abraham', 'abraham', current_date, 'high', 'critical', 'todo'),
  ('t4', 'Paradise Valley demo punch list', 'Final walkthrough items. See photos in shared album.', 'roofing', 'abraham', 'alkeith', current_date, 'high', 'urgent', 'todo'),
  ('t5', 'Jesus week-2 KPI review', 'Review against 90-day vesting milestones. Doors knocked, appts set, contracts signed.', 'roofing', 'abraham', 'abraham', current_date, 'medium', 'high', 'review'),
  ('t6', 'Send Andres weekly QA brief', '', 'drafting', 'abraham', 'abraham', current_date, 'low', 'medium', 'todo'),
  ('t7', 'Adrian - confirm trial milestones', '3-month trial KPIs need to be in writing before next sync.', 'lumen', 'abraham', 'abraham', current_date, 'medium', 'high', 'todo'),
  ('t8', 'Lumen pitch deck v3 sign-off', 'Final review of HVAC pitch deck before client outreach.', 'lumen', 'abraham', 'adrian', current_date + 1, 'medium', 'medium', 'review'),
  ('t9', 'DraftTrack markup tool QA', 'Test all markup tools on Safari + Chrome. Document any issues.', 'drafting', 'abraham', 'andres', current_date + 1, 'medium', 'medium', 'todo'),
  ('t10', 'Schedule monsoon ad shoot', 'Friday morning, blue sky. Confirm location + crew.', 'lumen', 'abraham', 'adrian', current_date + 3, 'medium', 'medium', 'todo'),
  ('t11', 'Supabase auth wiring', 'DraftTrack client portal - add auth + persistent storage.', 'drafting', 'abraham', 'abraham', current_date + 4, 'high', 'high', 'hold'),
  ('t12', 'GC outreach v2 script', 'Hormozi-style warm follow-up. Lead with the ROC + insurance angle.', 'roofing', 'abraham', 'jesus', current_date + 5, 'medium', 'medium', 'todo'),
  ('t13', 'Order shingles, Gilbert job', '', 'roofing', 'abraham', 'kristine', current_date - 1, 'medium', 'medium', 'done'),
  ('t14', 'Send Adrian operating agreement', '', 'lumen', 'abraham', 'abraham', current_date - 2, 'high', 'high', 'done'),
  ('t15', 'Material handoff - Mesa job', 'Voice note from Alkeith: confirm metal flashing arrives at yard by Thursday.', 'roofing', 'alkeith', 'kristine', current_date + 2, 'low', 'chill', 'todo')
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  company_id = excluded.company_id,
  creator_id = excluded.creator_id,
  assignee_id = excluded.assignee_id,
  due = excluded.due,
  priority = excluded.priority,
  urgency = excluded.urgency,
  status = excluded.status;

delete from public.task_watchers where task_id in ('t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11','t12','t13','t14','t15');
insert into public.task_watchers (task_id, member_id) values
  ('t1', 'kristine'),
  ('t3', 'kristine'),
  ('t4', 'abraham'),
  ('t5', 'jesus'),
  ('t7', 'adrian'),
  ('t8', 'abraham'),
  ('t12', 'abraham'),
  ('t14', 'adrian'),
  ('t15', 'abraham');

delete from public.task_subtasks where task_id in ('t1','t3','t4');
insert into public.task_subtasks (task_id, body, done, sort_order) values
  ('t1', 'Pull deed info', true, 0),
  ('t1', 'Notarize', false, 1),
  ('t3', 'Send certified letter', true, 0),
  ('t3', 'Call accounting', false, 1),
  ('t3', 'Prep lien paperwork', false, 2),
  ('t4', 'Tear-off west slope', true, 0),
  ('t4', 'Replace decking 2 sheets', true, 1),
  ('t4', 'Drip edge install', false, 2),
  ('t4', 'Final cleanup + photos', false, 3);

delete from public.task_activity where task_id in ('t1','t2','t3','t4','t8','t9','t12','t15');
insert into public.task_activity (task_id, who, what, when_label, created_at) values
  ('t1', 'Abraham', 'created this task', '5d ago', now() - interval '5 days'),
  ('t2', 'Abraham', 'assigned this to Kristine', '3d ago', now() - interval '3 days'),
  ('t3', 'Kristine', 'uploaded letter.pdf', '2h ago', now() - interval '2 hours'),
  ('t3', 'Abraham', 'set due date today', 'yesterday', now() - interval '1 day'),
  ('t4', 'Abraham', 'assigned this to Alkeith', 'yesterday', now() - interval '1 day'),
  ('t8', 'Abraham', 'assigned this to Adrian', '2d ago', now() - interval '2 days'),
  ('t9', 'Abraham', 'assigned this to Andres', '2d ago', now() - interval '2 days'),
  ('t12', 'Abraham', 'assigned this to Jesus', 'today', now()),
  ('t15', 'Alkeith', 'created via voice note', '1h ago', now() - interval '1 hour');

delete from public.time_entries where id in ('e1','e2','e3','e4','e5','e6','e7');
insert into public.time_entries (id, user_id, task_id, start_at, end_at, duration_ms, note) values
  ('e1', 'abraham', 't3', now() - interval '26 hours', now() - interval '24.2 hours', 6480000, 'CNL call prep'),
  ('e2', 'abraham', 't1', now() - interval '50 hours', now() - interval '48.5 hours', 5400000, 'Lien paperwork'),
  ('e3', 'kristine', 't2', now() - interval '28 hours', now() - interval '25 hours', 10800000, 'ROC complaint draft'),
  ('e4', 'alkeith', 't4', now() - interval '8 hours', now() - interval '3.5 hours', 16200000, 'Paradise Valley demo'),
  ('e5', 'andres', 't9', now() - interval '6 hours', now() - interval '3 hours', 10800000, 'Markup QA Safari'),
  ('e6', 'adrian', 't8', now() - interval '30 hours', now() - interval '27.5 hours', 9000000, 'Pitch deck review'),
  ('e7', 'jesus', 't12', now() - interval '4 hours', now() - interval '2.2 hours', 6480000, 'GC outreach draft');
