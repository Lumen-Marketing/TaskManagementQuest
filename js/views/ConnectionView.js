window.App = window.App || {};

/* ConnectionView — network-resilience surface.
   Listens to the browser's online/offline events and:
   - shows a persistent banner while offline so the user has a CLEAR message
     (not just a silent failed save) that their connection dropped,
   - exposes App.isOffline for other code to read,
   - on reconnect, hides the banner, toasts "Back online", and calls
     onReconnect() to flush any changes that couldn't be saved while offline.

   The actual no-data-loss guarantee lives in the save layer (app.js re-flags
   dirty tasks/entries when a save throws), so a save attempted mid-outage is
   retried on the next change or on reconnect rather than lost. This view is the
   user-visible half: it makes the outage legible and triggers the flush. */
App.ConnectionView = class ConnectionView {
  constructor({ toastView, onReconnect } = {}) {
    this.toastView = toastView;
    this.onReconnect = typeof onReconnect === 'function' ? onReconnect : () => {};
    this.banner = document.getElementById('offlineBanner');

    // navigator.onLine is a best-effort hint (it only knows the OS link state,
    // not whether Supabase is reachable), but it's reliable for the "cable
    // unplugged / wifi off" case this requirement targets.
    App.isOffline = !navigator.onLine;
    if (App.isOffline) this._showOffline();

    window.addEventListener('offline', () => this._handleOffline());
    window.addEventListener('online', () => this._handleOnline());
  }

  _handleOffline() {
    if (App.isOffline) return;
    App.isOffline = true;
    this._showOffline();
  }

  _handleOnline() {
    if (!App.isOffline) return;
    App.isOffline = false;
    this._hideOffline();
    if (this.toastView) {
      this.toastView.show({ title: 'Back online', sub: 'Syncing your latest changes…' });
    }
    // Flush anything that piled up while offline. Guarded so a flush failure
    // (still flaky) can't take down the reconnect handler.
    try { this.onReconnect(); } catch (e) { console.warn('[connection] reconnect flush failed', e); }
  }

  _showOffline() {
    if (this.banner) this.banner.classList.remove('hidden');
  }

  _hideOffline() {
    if (this.banner) this.banner.classList.add('hidden');
  }
};
