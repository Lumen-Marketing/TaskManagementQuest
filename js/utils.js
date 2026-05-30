window.App = window.App || {};

App.utils = {
  initials(name) {
    return String(name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  },

  todayISO(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  },

  formatDuration(ms) {
    if (!ms || ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  },

  formatHours(ms) {
    const hours = (ms || 0) / (60 * 60 * 1000);
    if (hours < 0.1) return '0h';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    return `${hours.toFixed(1)}h`;
  },

  timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  },

  formatDue(iso) {
    const t0 = App.utils.todayISO(0);
    const t1 = App.utils.todayISO(1);
    if (iso === t0) return { text: 'Today', cls: 'due-today' };
    if (iso === t1) return { text: 'Tomorrow', cls: '' };
    const d = new Date(iso);
    if (iso < t0) {
      return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: 'due-overdue' };
    }
    return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: '' };
  },

  formatClock(hhmm) {
    if (!hhmm) return '';
    const parts = String(hhmm).split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1] || 0);
    if (Number.isNaN(h)) return '';
    const period = h >= 12 ? 'PM' : 'AM';
    const hr = ((h + 11) % 12) + 1;
    return `${hr}:${String(m).padStart(2, '0')} ${period}`;
  },

  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  uid(prefix = '') {
    return prefix + Date.now() + Math.random().toString(36).slice(2, 6);
  },
};
