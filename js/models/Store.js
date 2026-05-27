window.App = window.App || {};

App.Store = class Store {
  constructor(key) {
    this.key = key;
  }
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  save(data) {
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch (e) {
      // quota or disabled storage — ignore
    }
  }
  clear() {
    try { localStorage.removeItem(this.key); } catch (e) {}
  }
};
