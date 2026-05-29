window.App = window.App || {};

App.ToastView = class ToastView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  show({ title, sub }) {
    if (!this.container) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `
      <i class="ti ti-mail icon-main"></i>
      <div class="toast-body">
        <div class="toast-title">${App.utils.escapeHtml(title)}</div>
        ${sub ? `<div class="toast-sub">${App.utils.escapeHtml(sub)}</div>` : ''}
      </div>
      <i class="ti ti-x toast-close"></i>
    `;
    this.container.appendChild(el);
    el.querySelector('.toast-close').addEventListener('click', () => el.remove());
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s, transform 0.3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 300);
    }, 4500);
  }
};
