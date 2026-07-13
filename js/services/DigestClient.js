// js/services/DigestClient.js
// Client wrapper around the ai-assistant "weekly_digest" action: per-user,
// per-Phoenix-WEEK localStorage cache + a defensive response guard. Pure
// helpers are static so they can be unit-tested under node.
window.App = window.App || {};

App.DigestClient = class DigestClient {
  constructor({ dataStore }) { this.dataStore = dataStore; }

  // The Monday (UTC-computed, no TZ drift) of the week containing dateISO.
  static weekKey(dateISO) {
    const [y, m, d] = String(dateISO).split('-').map(Number);
    const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
    const dow = dt.getUTCDay();            // 0 Sun .. 6 Sat
    const diff = dow === 0 ? -6 : 1 - dow; // shift back to Monday
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt.toISOString().slice(0, 10);
  }

  static cacheKey(userId, weekISO) { return `qhq.digest.${userId}.${weekISO}`; }

  static readCache(storage, userId, weekISO) {
    try {
      const raw = storage.getItem(DigestClient.cacheKey(userId, weekISO));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_e) { return null; }
  }

  static writeCache(storage, userId, weekISO, digest) {
    try { storage.setItem(DigestClient.cacheKey(userId, weekISO), JSON.stringify(digest)); }
    catch (_e) { /* private mode / quota — cache is best-effort */ }
  }

  static guard(digest) {
    if (!digest || typeof digest !== 'object') return null;
    if (typeof digest.text !== 'string' || !digest.text.trim()) return null;
    if (!Array.isArray(digest.bullets)) return null;
    return digest;
  }

  // Returns { digest, fromCache } or { digest: null, error }. Never throws.
  async get(userId, { force = false } = {}) {
    const week = DigestClient.weekKey(App.utils.todayISO(0));
    const storage = window.localStorage;
    if (!force) {
      const hit = DigestClient.guard(DigestClient.readCache(storage, userId, week));
      if (hit) return { digest: hit, fromCache: true };
    }
    let res;
    try { res = await this.dataStore.getWeeklyDigest(); }
    catch (err) { return { digest: null, error: (err && err.message) || String(err) }; }
    if (!res || !res.ok) return { digest: null, error: (res && res.error) || 'AI unavailable.' };
    const digest = DigestClient.guard(res.digest);
    if (!digest) return { digest: null, error: 'AI returned nothing usable.' };
    DigestClient.writeCache(storage, userId, week, digest);
    return { digest, fromCache: false };
  }
};
