// supabase/functions/ai-assistant/lib/chat.mjs
// Pure: turn the viewer's tasks into a compact, prompt-ready snapshot. No I/O,
// no globals. Callers pass already-label-resolved items and a `done` boolean;
// this module only tags, orders, formats, and caps. Mirrored verbatim as
// App.ChatClient.buildSnapshot on the client (browser globals can't import ESM).
const trunc = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) : t; };

function tagFor(t, today) {
  if (t.done) return 'DONE';
  if (String(t.status || '').toLowerCase() === 'hold') return 'ON HOLD';
  if (t.due && t.due < today) return 'OVERDUE';
  if (t.due && t.due === today) return 'DUE TODAY';
  return 'OPEN';
}

// Sort buckets: overdue first, done last.
const RANK = { OVERDUE: 0, 'DUE TODAY': 1, 'ON HOLD': 2, OPEN: 3, DONE: 4 };

export function buildChatSnapshot(items, opts) {
  const { today, max = 200 } = opts || {};
  const rows = (items || []).filter(Boolean).map((t) => ({ t, tag: tagFor(t, today) }));
  rows.sort((a, b) => {
    if (RANK[a.tag] !== RANK[b.tag]) return RANK[a.tag] - RANK[b.tag];
    // Done: most recently completed first. Others: soonest due first, no-due last.
    if (a.tag === 'DONE') return String(b.t.completedAt || '').localeCompare(String(a.t.completedAt || ''));
    return String(a.t.due || '9999').localeCompare(String(b.t.due || '9999'));
  });
  const truncated = rows.length > max;
  const lines = rows.slice(0, max).map(({ t, tag }) => {
    const parts = [tag, trunc(t.title, 80), t.company || '—', t.assignee || '—',
      t.due ? 'due ' + t.due : 'no due date'];
    if (t.done && t.completedAt) parts.push('completed ' + String(t.completedAt).slice(0, 10));
    return parts.join(' · ');
  });
  return { lines, truncated };
}
