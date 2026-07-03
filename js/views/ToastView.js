window.App = window.App || {};

App.ToastView = class ToastView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  /* `action` (optional): { label, onClick } renders an inline button (e.g. Undo);
     clicking it fires onClick and dismisses the toast. `duration` (optional, ms)
     overrides the default dwell — pair it with the caller's own timer so the
     action window and the toast vanish together. */
  show({ title, sub, variant, action, duration }) {
    if (!this.container) return;
    const icon = variant === 'celebrate' ? 'ti-sparkles' : 'ti-mail';
    const el = document.createElement('div');
    el.className = 'toast' + (variant ? ` toast-${variant}` : '');
    el.innerHTML = `
      <i class="ti ${icon} icon-main"></i>
      <div class="toast-body">
        <div class="toast-title">${App.utils.escapeHtml(title)}</div>
        ${sub ? `<div class="toast-sub">${App.utils.escapeHtml(sub)}</div>` : ''}
      </div>
      ${action && action.label ? `<button class="toast-action" type="button">${App.utils.escapeHtml(action.label)}</button>` : ''}
      <i class="ti ti-x toast-close"></i>
    `;
    this.container.appendChild(el);
    el.querySelector('.toast-close').addEventListener('click', () => el.remove());
    if (action && typeof action.onClick === 'function') {
      el.querySelector('.toast-action').addEventListener('click', () => {
        try { action.onClick(); } finally { el.remove(); }
      });
    }
    const dwell = duration || (variant === 'celebrate' ? 5500 : 4500);
    setTimeout(() => {
      // Exit via the shared .leaving class (CSS owns the easing/duration), then
      // remove once it has played. Guard against double-remove on manual close.
      if (!el.isConnected) return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 320);
    }, dwell);
    // Return the node so callers can update it in place (e.g. a "Saving…" toast
    // that becomes "Saved" and pulses once the debounced save actually lands).
    return el;
  }
};
