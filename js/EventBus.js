/* Simple pub/sub used for one-way data flow:
   Models mutate and emit. Views subscribe and re-render.
   Controllers call model methods in response to user input. */

function makeEventBus() {
  const listeners = {};
  return {
    on(event, fn, { signal } = {}) {
      if (signal && signal.aborted) return () => {};
      (listeners[event] = listeners[event] || []).push(fn);
      const unsub = () => this.off(event, fn);
      if (signal) signal.addEventListener('abort', unsub, { once: true });
      return unsub;
    },
    off(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(l => l !== fn);
    },
    emit(event, payload) {
      (listeners[event] || []).forEach(fn => {
        try { fn(payload); } catch (e) { console.error('[EventBus]', event, e); }
      });
    },
  };
}

if (typeof window !== 'undefined') {
  window.App = window.App || {};
  App.EventBus = makeEventBus();
}

if (typeof module !== 'undefined') module.exports = { makeEventBus };
