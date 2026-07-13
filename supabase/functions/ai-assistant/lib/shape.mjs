// supabase/functions/ai-assistant/lib/shape.mjs
// Pure: validates/normalizes the model's reply into { text, bullets }, or a
// deterministic count-based fallback when the model output is unusable.

function pluralize(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

export function fallbackBriefing(ctx) {
  const c = (ctx && ctx.counts) || { overdue: 0, dueToday: 0, onHold: 0, completedSince: 0 };
  const parts = [];
  if (c.overdue) parts.push(`${pluralize(c.overdue, 'task')} overdue`);
  if (c.dueToday) parts.push(`${c.dueToday} due today`);
  if (c.onHold) parts.push(`${c.onHold} on hold`);
  const head = parts.length ? parts.join(', ') + '.' : 'Nothing overdue or due today.';
  const tail = c.completedSince ? ` ${pluralize(c.completedSince, 'task')} completed since yesterday.` : '';
  const bullets = ((ctx && ctx.lines) || []).slice(0, 3).map((l) => ({ taskId: null, label: l }));
  return { text: (head + tail).trim(), bullets, source: 'fallback' };
}

export function shapeBriefing(modelText, ctx) {
  if (typeof modelText !== 'string' || !modelText.trim()) return fallbackBriefing(ctx);
  const lines = modelText.split('\n').map((l) => l.trim()).filter(Boolean);
  // Bullets = lines starting with a list marker; narrative = the rest.
  const isBullet = (l) => /^([-*•]|\d+[.)])\s+/.test(l);
  const bulletLines = lines.filter(isBullet).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ''));
  const narrative = lines.filter((l) => !isBullet(l)).join(' ').trim();
  if (!narrative && !bulletLines.length) return fallbackBriefing(ctx);
  const bullets = bulletLines.slice(0, 3).map((label) => ({ taskId: null, label }));
  return { text: narrative || bulletLines[0], bullets, source: 'model' };
}
