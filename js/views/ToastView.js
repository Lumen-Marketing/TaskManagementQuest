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
      el.style.transition = 'opacity 0.3s, transform 0.3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 300);
    }, dwell);
  }
};
