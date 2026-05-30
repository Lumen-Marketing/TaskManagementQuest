window.App = window.App || {};

App.ToastView = class ToastView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  show({ title, sub, variant }) {
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
      <i class="ti ti-x toast-close"></i>
    `;
    this.container.appendChild(el);
    el.querySelector('.toast-close').addEventListener('click', () => el.remove());
    const dwell = variant === 'celebrate' ? 5500 : 4500;
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s, transform 0.3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 300);
    }, dwell);
  }
};
