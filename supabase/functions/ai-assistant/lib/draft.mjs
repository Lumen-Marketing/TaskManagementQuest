// supabase/functions/ai-assistant/lib/draft.mjs
// Pure: validate/normalize the model's task-draft JSON against the allowed
// people/company lists. No I/O, no globals. Anything unrecognized → null.
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Reminder is a fixed relative-to-due offset enum (see NewTaskPageView._remindItems).
const REMINDERS = new Set(['none', 'at', '30m', '1h', '1d']);

const MAX_ASSIGNEES = 10;

const idSet = (list) => new Set((list || []).map((x) => x && x.id).filter(Boolean));

export function validateDraft(raw, opts) {
  const out = { assignees: [], company: null, priority: null, due: null, dueTime: null, type: null, label: null, project: null, status: null, remind: null };
  if (!raw || typeof raw !== 'object') return out;
  const o = opts || {};
  const teamIds = idSet(o.team);
  const compIds = idSet(o.companies);
  const typeIds = idSet(o.types);
  const labelIds = idSet(o.labels);
  const projectIds = idSet(o.projects);
  const statusIds = idSet(o.statuses);

  // Accept an `assignees` array or a singular `assignee`; keep only real roster
  // ids, de-duplicated and capped.
  const candidates = Array.isArray(raw.assignees) ? raw.assignees
    : (typeof raw.assignee === 'string' ? [raw.assignee] : []);
  const seen = new Set();
  for (const id of candidates) {
    if (typeof id === 'string' && teamIds.has(id) && !seen.has(id)) { seen.add(id); out.assignees.push(id); }
    if (out.assignees.length >= MAX_ASSIGNEES) break;
  }
  if (typeof raw.company === 'string' && compIds.has(raw.company)) out.company = raw.company;
  if (typeof raw.priority === 'string' && PRIORITIES.has(raw.priority)) out.priority = raw.priority;
  if (typeof raw.due === 'string' && DATE_RE.test(raw.due) && !Number.isNaN(Date.parse(raw.due))) out.due = raw.due;
  if (typeof raw.dueTime === 'string' && TIME_RE.test(raw.dueTime)) out.dueTime = raw.dueTime;
  if (typeof raw.type === 'string' && typeIds.has(raw.type)) out.type = raw.type;
  if (typeof raw.label === 'string' && labelIds.has(raw.label)) out.label = raw.label;
  if (typeof raw.project === 'string' && projectIds.has(raw.project)) out.project = raw.project;
  if (typeof raw.status === 'string' && statusIds.has(raw.status)) out.status = raw.status;
  if (typeof raw.remind === 'string' && REMINDERS.has(raw.remind)) out.remind = raw.remind;
  return out;
}
