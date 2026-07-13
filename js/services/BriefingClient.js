// js/services/BriefingClient.js
// Client wrapper around the ai-assistant edge function's "briefing" action:
// per-user, per-Phoenix-day localStorage cache + a defensive response guard.
// Pure helpers are static so they can be unit-tested under node.
window.App = window.App || {};

App.BriefingClient = class BriefingClient {
  constructor({ dataStore }) { this.dataStore = dataStore; }

  static cacheKey(userId, dateISO) { return `qhq.briefing.${userId}.${dateISO}`; }

  static readCache(storage, userId, dateISO) {
    try {
      const raw = storage.getItem(BriefingClient.cacheKey(userId, dateISO));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_e) { return null; }
  }

  static writeCache(storage, userId, dateISO, briefing) {
    try { storage.setItem(BriefingClient.cacheKey(userId, dateISO), JSON.stringify(briefing)); }
    catch (_e) { /* private mode / quota — cache is best-effort */ }
  }

  static guard(briefing) {
    if (!briefing || typeof briefing !== 'object') return null;
    if (typeof briefing.text !== 'string' || !briefing.text.trim()) return null;
    if (!Array.isArray(briefing.bullets)) return null;
    return briefing;
  }

  // Returns { briefing, fromCache } or { briefing: null, error }. Never throws.
  async get(userId, { force = false } = {}) {
    const day = App.utils.todayISO(0);
    const storage = window.localStorage;
    if (!force) {
      const hit = BriefingClient.guard(BriefingClient.readCache(storage, userId, day));
      if (hit) return { briefing: hit, fromCache: true };
    }
    let res;
    try { res = await this.dataStore.getBriefing(); }
    catch (err) { return { briefing: null, error: (err && err.message) || String(err) }; }
    if (!res || !res.ok) return { briefing: null, error: (res && res.error) || 'AI unavailable.' };
    const briefing = BriefingClient.guard(res.briefing);
    if (!briefing) return { briefing: null, error: 'AI returned nothing usable.' };
    BriefingClient.writeCache(storage, userId, day, briefing);
    return { briefing, fromCache: false };
  }
};
