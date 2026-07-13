// js/services/ChatClient.js
// Client wrapper for the ai-assistant "chat" action: pure snapshot/history
// helpers (unit-tested) + a fetch that never throws.
//
// buildSnapshot MIRRORS supabase/functions/ai-assistant/lib/chat.mjs verbatim —
// keep the two in sync (browser globals can't import the ESM module). Callers
// pass already-label-resolved items with a `done` boolean; this only tags,
// orders, formats, and caps.
window.App = window.App || {};

const _trunc = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) : t; };
function _tagFor(t, today) {
  if (t.done) return 'DONE';
  if (String(t.status || '').toLowerCase() === 'hold') return 'ON HOLD';
  if (t.due && t.due < today) return 'OVERDUE';
  if (t.due && t.due === today) return 'DUE TODAY';
  return 'OPEN';
}
const _RANK = { OVERDUE: 0, 'DUE TODAY': 1, 'ON HOLD': 2, OPEN: 3, DONE: 4 };

App.ChatClient = class ChatClient {
  constructor({ dataStore }) { this.dataStore = dataStore; }

  static buildSnapshot(items, opts) {
    const { today, max = 200 } = opts || {};
    const rows = (items || []).filter(Boolean).map((t) => ({ t, tag: _tagFor(t, today) }));
    rows.sort((a, b) => {
      if (_RANK[a.tag] !== _RANK[b.tag]) return _RANK[a.tag] - _RANK[b.tag];
      if (a.tag === 'DONE') return String(b.t.completedAt || '').localeCompare(String(a.t.completedAt || ''));
      return String(a.t.due || '9999').localeCompare(String(b.t.due || '9999'));
    });
    const truncated = rows.length > max;
    const lines = rows.slice(0, max).map(({ t, tag }) => {
      const parts = [tag, _trunc(t.title, 80), t.company || '—', t.assignee || '—',
        t.due ? 'due ' + t.due : 'no due date'];
      if (t.done && t.completedAt) parts.push('completed ' + String(t.completedAt).slice(0, 10));
      return parts.join(' · ');
    });
    return { lines, truncated };
  }

  static trimHistory(messages, maxTurns) {
    const n = maxTurns || 6;
    const arr = Array.isArray(messages) ? messages : [];
    return arr
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-n)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  // Never throws. Returns { answer } or { answer: null }.
  async ask({ question, history, tasks, today, truncated, clock, me }) {
    let res;
    try { res = await this.dataStore.chat({ question, history, tasks, today, truncated, clock, me }); }
    catch (_e) { return { answer: null }; }
    if (!res || !res.ok || !res.answer) return { answer: null };
    return { answer: res.answer };
  }
};
