// supabase/functions/ai-assistant/lib/digest.mjs
// Pure: partition the viewer's tasks into a weekly done/slipped/coming digest
// context, plus model-text shaping and a deterministic fallback. No I/O, no
// globals. Mirrored (inlined) into PASTE-INTO-SUPABASE-DASHBOARD.ts.
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

export function buildDigestContext(tasks, opts) {
  const { today, windowDays = 7, maxItems = 25 } = opts || {};
  const weekAgo = shiftISO(today, -windowDays);
  const weekAhead = shiftISO(today, windowDays);
  const list = (tasks || []).filter(Boolean);

  const done = list.filter((t) => {
    if (!isDone(t) || !t.completedAt) return false;
    const d = String(t.completedAt).slice(0, 10);
    return d >= weekAgo && d <= today;
  });
  const slipped = list.filter((t) => !isDone(t) && t.due && t.due >= weekAgo && t.due < today);
  const coming = list.filter((t) => !isDone(t) && t.due && t.due >= today && t.due <= weekAhead);

  const counts = { done: done.length, slipped: slipped.length, coming: coming.length };

  const byDue = (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'));
  const lines = [];
  slipped.slice().sort(byDue).forEach((t) => lines.push(`SLIPPED · ${trunc(t.title, 80)} · ${t.company || '—'} · was due ${t.due}`));
  coming.slice().sort(byDue).forEach((t) => lines.push(`DUE ${t.due} · ${trunc(t.title, 80)} · ${t.company || '—'}`));
  done.slice().forEach((t) => lines.push(`DONE · ${trunc(t.title, 80)} · ${t.company || '—'}`));

  return { today, counts, lines: lines.slice(0, maxItems) };
}

function pluralize(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

export function fallbackDigest(ctx) {
  const c = (ctx && ctx.counts) || { done: 0, slipped: 0, coming: 0 };
  const parts = [];
  if (c.done) parts.push(`${pluralize(c.done, 'task')} completed this week`);
  if (c.slipped) parts.push(`${c.slipped} slipped`);
  if (c.coming) parts.push(`${c.coming} due in the next 7 days`);
  const text = parts.length ? parts.join(', ') + '.'
    : 'A quiet week — nothing completed, slipped, or due in the next 7 days.';
  const bullets = ((ctx && ctx.lines) || []).slice(0, 3).map((l) => ({ taskId: null, label: l }));
  return { text, bullets, source: 'fallback' };
}

export function shapeDigest(modelText, ctx) {
  if (typeof modelText !== 'string' || !modelText.trim()) return fallbackDigest(ctx);
  const lines = modelText.split('\n').map((l) => l.trim()).filter(Boolean);
  const isBullet = (l) => /^([-*•]|\d+[.)])\s+/.test(l);
  const bulletLines = lines.filter(isBullet).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ''));
  const narrative = lines.filter((l) => !isBullet(l)).join(' ').trim();
  if (!narrative && !bulletLines.length) return fallbackDigest(ctx);
  const bullets = bulletLines.slice(0, 3).map((label) => ({ taskId: null, label }));
  return { text: narrative || bulletLines[0], bullets, source: 'model' };
}
