// supabase/functions/ai-assistant/lib/draft.mjs
// Pure: validate/normalize the model's task-draft JSON against the allowed
// people/company lists. No I/O, no globals. Anything unrecognized → null.
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateDraft(raw, opts) {
  const out = { assignee: null, company: null, priority: null, due: null, dueTime: null };
  if (!raw || typeof raw !== 'object') return out;
  const team = (opts && opts.team) || [];
  const companies = (opts && opts.companies) || [];
  const teamIds = new Set(team.map((t) => t && t.id).filter(Boolean));
  const compIds = new Set(companies.map((c) => c && c.id).filter(Boolean));

  if (typeof raw.assignee === 'string' && teamIds.has(raw.assignee)) out.assignee = raw.assignee;
  if (typeof raw.company === 'string' && compIds.has(raw.company)) out.company = raw.company;
  if (typeof raw.priority === 'string' && PRIORITIES.has(raw.priority)) out.priority = raw.priority;
  if (typeof raw.due === 'string' && DATE_RE.test(raw.due) && !Number.isNaN(Date.parse(raw.due))) out.due = raw.due;
  if (typeof raw.dueTime === 'string' && TIME_RE.test(raw.dueTime)) out.dueTime = raw.dueTime;
  return out;
}
