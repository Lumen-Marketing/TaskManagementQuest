/* Simple pub/sub used for one-way data flow:
   Models mutate and emit. Views subscribe and re-render.
   Controllers call model methods in response to user input. */
window.App = window.App || {};

App.EventBus = (function () {
  const listeners = {};
  return {
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return () => this.off(event, fn);
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
})();
