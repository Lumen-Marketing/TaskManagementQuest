// supabase/functions/checkins/lib/stalled.mjs
// Pure stalled-task detection. A task is stalled if it is open and its
// updated_at is older than stalledDays. Grouped by EVERY assignee (lead +
// co-assignees, migration 060) so a co-assignee's stalled task counts. No I/O.
const DONE = new Set(['done', 'complete', 'completed']);

export function taskAssignees(task) {
  if (!task) return [];
  if (Array.isArray(task.assignee_ids) && task.assignee_ids.length) return task.assignee_ids;
  return task.assignee_id ? [task.assignee_id] : [];
}

export function stalledByPerson(tasks, { nowMs, stalledDays }) {
  const cutoff = nowMs - stalledDays * 24 * 60 * 60 * 1000;
  const out = new Map();
  for (const t of tasks || []) {
    if (!t) continue;
    if (DONE.has(String(t.status || '').toLowerCase())) continue;
    const ts = Date.parse(t.updated_at || '');
    if (Number.isNaN(ts) || ts >= cutoff) continue;
    const entry = { id: t.id, title: t.title };
    for (const person of taskAssignees(t)) {
      if (!out.has(person)) out.set(person, []);
      out.get(person).push(entry);
    }
  }
  return out;
}
