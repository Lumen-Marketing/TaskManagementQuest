// js/services/TaskDraftClient.js
// Client wrapper for the ai-assistant "draft_task" action: pure gate/merge
// helpers (unit-tested) + a fetch that never throws. Debounce lives in the view.
window.App = window.App || {};

App.TaskDraftClient = class TaskDraftClient {
  constructor({ dataStore }) { this.dataStore = dataStore; }

  static shouldRequest(text, lastText, opts) {
    const o = opts || {};
    const minLen = o.minLen || 12;
    const minWords = o.minWords || 3;
    const t = String(text || '').trim();
    if (t.length < minLen) return false;
    if (t.split(/\s+/).filter(Boolean).length < minWords) return false;
    if (t === String(lastText || '').trim()) return false;
    return true;
  }

  static mergeDraftIntoState(draft, locked) {
    const lockedSet = locked instanceof Set ? locked : new Set(locked || []);
    const keys = ['assignee', 'company', 'priority', 'due', 'dueTime'];
    const apply = {};
    const aiFilled = [];
    for (const k of keys) {
      if (draft && draft[k] != null && !lockedSet.has(k)) { apply[k] = draft[k]; aiFilled.push(k); }
    }
    return { apply, aiFilled };
  }

  // Never throws. Returns { draft } or { draft: null }.
  async fetchDraft({ text, team, companies, today }) {
    let res;
    try { res = await this.dataStore.draftTask({ text, team, companies, today }); }
    catch (_e) { return { draft: null }; }
    if (!res || !res.ok || !res.draft) return { draft: null };
    return { draft: res.draft };
  }
};
