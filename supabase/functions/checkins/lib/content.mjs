// supabase/functions/checkins/lib/content.mjs
// Pure content builders + deterministic fallbacks for the three check-in modes.
// The engine feeds *Context output to Groq for wording; if Groq is unusable the
// fallback string ships instead. No I/O, no globals.
const DONE = new Set(['done', 'complete', 'completed']);
const isDone = (t) => !!t.completed_at || DONE.has(String(t.status || '').toLowerCase());
const trunc = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) : t; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const MODE_SUBJECT = {
  morning: 'Your morning check-in',
  eod: 'Your end-of-day check-in',
  stalled: 'Tasks that have gone quiet',
};

// Per-mode deep-link CTA for the email button. The route is appended to APP_URL
// (e.g. `${APP_URL}#/tasks/execution`). ⚠️ These labels+routes MUST match
// App.utils.checkinCta in js/utils.js — the client renders the same CTA in the
// bell from the notification's subject. A change here is a change there too.
export const MODE_ROUTE = {
  morning: '#/tasks/execution',
  eod: '#/tasks',
  stalled: '#/tasks',
};
export const MODE_CTA_LABEL = {
  morning: "Set today's focus",
  eod: 'Review today',
  stalled: 'Review stalled tasks',
};

export function morningContext(tasks, { today }) {
  const list = (tasks || []).filter((t) => t && !isDone(t));
  const overdue = list.filter((t) => t.due && t.due < today);
  const dueToday = list.filter((t) => t.due === today);
  const counts = { overdue: overdue.length, dueToday: dueToday.length, total: list.length };
  const lines = [...overdue, ...dueToday].slice(0, 10).map((t) =>
    `${t.due < today ? 'OVERDUE' : 'DUE TODAY'} · ${trunc(t.title, 80)}`);
  return { counts, lines };
}

export function eodContext(tasks, { today }) {
  const list = (tasks || []).filter(Boolean);
  const done = list.filter((t) => isDone(t) && String(t.completed_at || '').slice(0, 10) === today);
  const open = list.filter((t) => !isDone(t));
  const slipped = open.filter((t) => t.due && t.due < today);
  const counts = { done: done.length, slipped: slipped.length, open: open.length };
  const lines = [
    ...done.slice(0, 5).map((t) => `DONE · ${trunc(t.title, 80)}`),
    ...slipped.slice(0, 5).map((t) => `SLIPPED · ${trunc(t.title, 80)}`),
  ];
  return { counts, lines };
}

export function shapeMessage(modelText, fallbackText) {
  if (typeof modelText === 'string' && modelText.trim()) return { text: modelText.trim(), source: 'model' };
  return { text: fallbackText, source: 'fallback' };
}

export function fallbackMorning(ctx) {
  const c = (ctx && ctx.counts) || { overdue: 0, dueToday: 0, total: 0 };
  const parts = [];
  if (c.overdue) parts.push(`${plural(c.overdue, 'task')} overdue`);
  if (c.dueToday) parts.push(`${c.dueToday} due today`);
  const head = parts.length ? parts.join(', ') + '.' : 'Nothing overdue or due today.';
  // No rhetorical question — the check-in's CTA button carries the action.
  return `${head} You have ${plural(c.total, 'open task')}. Set today's focus below.`;
}

export function fallbackEod(ctx) {
  const c = (ctx && ctx.counts) || { done: 0, slipped: 0, open: 0 };
  const parts = [];
  if (c.done) parts.push(`${plural(c.done, 'task')} done today`);
  if (c.slipped) parts.push(`${c.slipped} slipped past due`);
  const head = parts.length ? parts.join(', ') + '.' : 'No completions logged today.';
  // No directive to reply — the 'Review today' CTA button carries the action.
  return `${head} ${plural(c.open, 'task')} still open.`;
}

export function stalledText(items) {
  const names = (items || []).slice(0, 8).map((x) => `- ${trunc(x.title, 80)}`).join('\n');
  const n = (items || []).length;
  return `${plural(n, 'task')} of yours ${n === 1 ? 'has' : 'have'} gone quiet — still moving?\n${names}`;
}
