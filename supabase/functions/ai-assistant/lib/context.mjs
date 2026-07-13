// supabase/functions/ai-assistant/lib/context.mjs
// Pure: turns the viewer's tasks into a compact, prompt-ready context. No I/O,
// no globals, no task descriptions/comment bodies — titles only, truncated.
const DONE = new Set(['done', 'complete', 'completed']);
const trunc = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) : t; };

export function buildBriefingContext(tasks, opts) {
  const { me, today, maxItems = 25 } = opts || {};
  const mine = (tasks || []).filter((t) => t && t.assignee === me);

  const isDone = (t) => DONE.has(String(t.status || '').toLowerCase());
  const open = mine.filter((t) => !isDone(t));
  const overdue = open.filter((t) => t.due && t.due < today);
  const dueToday = open.filter((t) => t.due === today);
  const onHold = open.filter((t) => t.status === 'hold');
  const completedSince = mine.filter((t) => {
    if (!isDone(t) || !t.completedAt) return false;
    // completedAt is an ISO instant; compare its date portion to `today`.
    return String(t.completedAt).slice(0, 10) >= today;
  });

  const counts = {
    overdue: overdue.length,
    dueToday: dueToday.length,
    onHold: onHold.length,
    completedSince: completedSince.length,
    total: open.length,
  };

  // Deterministic ordering: overdue, due-today, on-hold, then remaining open by
  // focus order (focusSeq asc, unset last) then soonest due.
  const bySeq = (a, b) => {
    const fa = a.focusSeq == null ? Infinity : a.focusSeq;
    const fb = b.focusSeq == null ? Infinity : b.focusSeq;
    if (fa !== fb) return fa - fb;
    return String(a.due || '9999').localeCompare(String(b.due || '9999'));
  };
  const seen = new Set();
  const push = (arr, out) => { for (const t of arr) { if (!seen.has(t.id)) { seen.add(t.id); out.push(t); } } };
  const ordered = [];
  push(overdue.slice().sort(bySeq), ordered);
  push(dueToday.slice().sort(bySeq), ordered);
  push(onHold.slice().sort(bySeq), ordered);
  push(open.slice().sort(bySeq), ordered);

  const tag = (t) => t.due && t.due < today ? 'OVERDUE'
    : t.due === today ? 'DUE TODAY'
    : t.status === 'hold' ? 'ON HOLD' : 'OPEN';
  const lines = ordered.slice(0, maxItems).map((t) =>
    `${tag(t)} · ${trunc(t.title, 80)} · ${t.company || '—'} · ${t.due ? 'due ' + t.due : 'no due date'}`);

  return { today, counts, lines };
}
