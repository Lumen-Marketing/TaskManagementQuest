// js/services/RollupClient.js
// Client wrapper around the ai-assistant "project_rollup" action: a SESSION-ONLY
// in-memory cache keyed by project id (no localStorage — rollups are on-demand and
// projects change often) plus a defensive response guard. Statics are pure so they
// can be unit-tested under node.
window.App = window.App || {};

App.RollupClient = class RollupClient {
  constructor({ dataStore }) { this.dataStore = dataStore; }

  static get(id) { return RollupClient.cache.get(id) || null; }
  static set(id, value) { RollupClient.cache.set(id, value); }
  static clear(id) { RollupClient.cache.delete(id); }

  static guard(rollup) {
    if (!rollup || typeof rollup !== 'object') return null;
    if (typeof rollup.text !== 'string' || !rollup.text.trim()) return null;
    if (!Array.isArray(rollup.bullets)) return null;
    return rollup;
  }

  // Returns { rollup, generatedAt, fromCache } or { rollup: null, error }. Never throws.
  async fetch(projectId, projectName, { force = false } = {}) {
    if (!force) {
      const hit = RollupClient.get(projectId);
      if (hit && RollupClient.guard(hit.rollup)) return { ...hit, fromCache: true };
    }
    let res;
    try { res = await this.dataStore.projectRollup({ projectId, projectName, today: App.utils.todayISO(0) }); }
    catch (err) { return { rollup: null, error: (err && err.message) || String(err) }; }
    if (!res || !res.ok) return { rollup: null, error: (res && res.error) || 'AI unavailable.' };
    const rollup = RollupClient.guard(res.rollup);
    if (!rollup) return { rollup: null, error: 'AI returned nothing usable.' };
    const entry = { rollup, generatedAt: res.generatedAt || null };
    RollupClient.set(projectId, entry);
    return { ...entry, fromCache: false };
  }
};

// Session-lived cache (no static class fields in this zero-build SPA).
App.RollupClient.cache = new Map();
