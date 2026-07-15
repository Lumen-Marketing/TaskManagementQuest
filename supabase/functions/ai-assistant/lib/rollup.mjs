// supabase/functions/ai-assistant/lib/rollup.mjs
// Pure: summarize ONE project's tasks into a "where does it stand" rollup
// context — percent complete plus a done/slipped/coming/open partition — with
// model-text shaping and a deterministic fallback. No I/O, no globals. Modeled
// on lib/digest.mjs; helpers are copied locally to keep the module self-contained.
const DONE = new Set(['done', 'complete', 'completed']);
const trunc = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) : t; };
const isDone = (t) => !!t.completedAt || DONE.has(String(t.status || '').toLowerCase());

// Shift a YYYY-MM-DD string by whole days using UTC math (no TZ drift).
function shiftISO(dateISO, days) {
  const [y, m, d] = String(dateISO).split('-').map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function buildRollupContext(tasks, opts) {
  const { today, projectName = '', windowDays = 7, maxItems = 25 } = opts || {};
  const weekAgo = shiftISO(today, -windowDays);
  const weekAhead = shiftISO(today, windowDays);
  const list = (tasks || []).filter(Boolean);

  const total = list.length;
  const doneAll = list.filter(isDone);
  const pct = total ? Math.round((doneAll.length / total) * 100) : 0;

  const done = doneAll.filter((t) => {
    if (!t.completedAt) return false;
    const d = String(t.completedAt).slice(0, 10);
    return d >= weekAgo && d <= today;
  });
  const slipped = list.filter((t) => !isDone(t) && t.due && t.due >= weekAgo && t.due < today);
  const coming = list.filter((t) => !isDone(t) && t.due && t.due >= today && t.due <= weekAhead);
  const openNoDate = list.filter((t) => !isDone(t) && !t.due);

  const counts = { total, done: done.length, slipped: slipped.length, coming: coming.length, open: openNoDate.length };

  const byDue = (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'));
  const lines = [];
  slipped.slice().sort(byDue).forEach((t) => lines.push(`SLIPPED · ${trunc(t.title, 80)} · ${t.company || '—'} · was due ${t.due}`));
  coming.slice().sort(byDue).forEach((t) => lines.push(`DUE ${t.due} · ${trunc(t.title, 80)} · ${t.company || '—'}`));
  openNoDate.slice().forEach((t) => lines.push(`OPEN · ${trunc(t.title, 80)} · ${t.company || '—'}`));
  done.slice().forEach((t) => lines.push(`DONE · ${trunc(t.title, 80)} · ${t.company || '—'}`));

  return { today, projectName, counts, pct, lines: lines.slice(0, maxItems) };
}

function pluralize(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

export function fallbackRollup(ctx) {
  const c = (ctx && ctx.counts) || { total: 0, done: 0, slipped: 0, coming: 0, open: 0 };
  const pct = (ctx && typeof ctx.pct === 'number') ? ctx.pct : 0;
  const name = (ctx && ctx.projectName) || 'This project';
  if (!c.total) return { text: `${name} has no tasks yet.`, bullets: [], source: 'fallback' };
  const parts = [`${pct}% complete`];
  if (c.done) parts.push(`${pluralize(c.done, 'task')} done this week`);
  if (c.slipped) parts.push(`${c.slipped} slipped`);
  if (c.coming) parts.push(`${c.coming} due in the next 7 days`);
  if (c.open) parts.push(`${c.open} open with no date`);
  const text = `${name}: ${parts.join(', ')}.`;
  const bullets = ((ctx && ctx.lines) || []).slice(0, 3).map((l) => ({ taskId: null, label: l }));
  return { text, bullets, source: 'fallback' };
}

export function shapeRollup(modelText, ctx) {
  if (typeof modelText !== 'string' || !modelText.trim()) return fallbackRollup(ctx);
  const lines = modelText.split('\n').map((l) => l.trim()).filter(Boolean);
  const isBullet = (l) => /^([-*•]|\d+[.)])\s+/.test(l);
  const bulletLines = lines.filter(isBullet).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ''));
  const narrative = lines.filter((l) => !isBullet(l)).join(' ').trim();
  if (!narrative && !bulletLines.length) return fallbackRollup(ctx);
  const bullets = bulletLines.slice(0, 3).map((label) => ({ taskId: null, label }));
  return { text: narrative || bulletLines[0], bullets, source: 'model' };
}
