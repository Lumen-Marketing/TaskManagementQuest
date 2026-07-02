window.App = window.App || {};

/* ReportsAdminView — developer-only "Problem reports" triage list. Renders
   into the shared #timeViewWrap like the other admin surfaces (ApprovalView /
   ClockDashboardView / TaskSetupAdminView), activated on the 'admin:reports'
   view. Reports are fetched on activation (not part of the main load());
   the Open⇄Resolved toggle persists through dataStore.setBugReportStatus. */
App.ReportsAdminView = class ReportsAdminView {
  constructor({ controller, dataStore }) {
    this.controller = controller;
    this.dataStore = dataStore;
    this.wrap = document.getElementById('timeViewWrap');
    this.reports = null;   // null = not loaded yet
    this.filter = 'open';  // 'open' | 'resolved' | 'all'

    App.EventBus.on('view:changed', (view) => { if (view === 'admin:reports') this.refresh(); });
  }

  visible() {
    return this.controller.uiState.view === 'admin:reports'
      && this.wrap && !this.wrap.classList.contains('hidden');
  }

  async refresh() {
    if (!this.wrap) this.wrap = document.getElementById('timeViewWrap');
    if (!this.wrap) return;
    if (!App.can('bug-reports.manage')) {
      this.wrap.innerHTML = `<div class="empty"><i class="ti ti-lock"></i><div class="empty-title">No access</div><div class="empty-sub">Only the developer can view problem reports.</div></div>`;
      return;
    }
    if (!this.reports) {
      this.wrap.innerHTML = `<div class="breports"><div class="empty-sub">Loading reports…</div></div>`;
    }
    try {
      this.reports = await this.dataStore.listBugReports();
    } catch (e) {
      this.wrap.innerHTML = `<div class="empty"><div class="empty-title">Couldn’t load reports</div><div class="empty-sub">${App.utils.escapeHtml((e && e.message) || '')}</div></div>`;
      return;
    }
    if (!this.visible()) return; // navigated away while loading
    this.render();
  }

  render() {
    const esc = App.utils.escapeHtml;
    const filtered = (this.reports || []).filter(r =>
      this.filter === 'all' ? true : r.status === this.filter);

    const tabs = [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, l]) => `
      <button type="button" class="theme-opt ${this.filter === v ? 'active' : ''}" data-filter="${v}">${l}</button>
    `).join('');

    const cards = filtered.map(r => {
      const ctx = r.context || {};
      const when = App.utils.formatInstant(new Date(r.created_at).getTime(), {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
      const ctxLine = [ctx.view, ctx.company, ctx.viewport]
        .filter(Boolean).map(esc).join(' · ');
      return `
        <div class="breport-card" data-id="${esc(r.id)}">
          <div class="breport-head">
            <span class="breport-type">${esc(r.type)}</span>
            <span class="breport-name">${esc(r.reporter_name || 'Unknown')}</span>
            <span class="breport-meta">${esc(r.reporter_email || '')}</span>
            <span class="breport-meta">${esc(when)}</span>
          </div>
          <div class="breport-desc">${esc(r.description)}</div>
          ${ctxLine ? `<div class="breport-meta" style="margin-top:6px;">${ctxLine}</div>` : ''}
          ${ctx.userAgent ? `<div class="breport-meta">${esc(ctx.userAgent)}</div>` : ''}
          <div class="breport-actions">
            <button type="button" class="btn" data-toggle-status>
              ${r.status === 'open' ? 'Mark resolved' : 'Reopen'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.wrap.innerHTML = `
      <div class="breports">
        <div class="breports-tabs" role="group" aria-label="Filter reports">${tabs}</div>
        ${cards || `<div class="empty"><i class="ti ti-bug-off"></i><div class="empty-title">No ${this.filter === 'all' ? '' : this.filter + ' '}reports</div></div>`}
      </div>
    `;
    this.bind();
  }

  bind() {
    this.wrap.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = btn.dataset.filter;
        this.render();
      });
    });
    this.wrap.querySelectorAll('[data-toggle-status]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.breport-card');
        const report = (this.reports || []).find(r => r.id === card.dataset.id);
        if (!report) return;
        btn.disabled = true;
        try {
          const updated = await this.dataStore.setBugReportStatus(
            report.id, report.status === 'open' ? 'resolved' : 'open');
          Object.assign(report, updated);
          this.render();
        } catch (e) {
          btn.disabled = false;
          if (this.controller.toastView) {
            this.controller.toastView.show({ title: 'Could not update report', sub: (e && e.message) || '' });
          }
        }
      });
    });
  }
};
