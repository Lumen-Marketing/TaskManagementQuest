window.App = window.App || {};

/* ReportsView — company analytics (admin/supervisors). Computes everything from
   the role/company-scoped task set (controller.visibleTasks) so numbers match
   what the user is allowed to see. Renders into #reportsWrap when view is
   'reports'. Range (week/month/quarter) is local view state. */
App.ReportsView = class ReportsView {
  constructor({ controller }) {
    this.controller = controller;
    this.wrap = document.getElementById('reportsWrap');
    this.range = 'month';
    this.subscribe();
    if (this.visible()) this.render();
  }

  subscribe() {
    const rerender = () => { if (this.visible()) this.render(); };
    App.EventBus.on('view:changed', rerender);
    App.EventBus.on('tasks:changed', rerender);
    App.EventBus.on('company:changed', rerender);
  }

  visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }

  _shortDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Range start as an HQ-calendar YYYY-MM-DD string, so the range boundary uses
  // the same HQ-calendar basis as the on-time / cycle math (hqDateOf vs t.due).
  // Anchoring on the HQ "today" date avoids an off-by-one-day for non-Phoenix
  // viewers near range edges.
  _rangeStartISO() {
    const todayHQ = App.utils.todayISO(0); // YYYY-MM-DD in HQ zone
    const [y, m, d] = todayHQ.split('-').map(Number);
    // UTC date arithmetic on the calendar components keeps day/month math exact.
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (this.range === 'week') dt.setUTCDate(dt.getUTCDate() - 7);
    else if (this.range === 'quarter') dt.setUTCMonth(dt.getUTCMonth() - 3);
    else dt.setUTCMonth(dt.getUTCMonth() - 1);
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${mm}-${dd}`;
  }

  _metrics() {
    const all = this.controller.visibleTasks({ includeDone: true });
    const open = all.filter(t => !App.taxonomy.isDone(t));
    const today = App.utils.todayISO(0);
    const startISO = this._rangeStartISO();
    // Compare on the HQ calendar day (same basis as on-time / cycle math) so the
    // range boundary doesn't drift a day for non-Phoenix viewers.
    const done = all.filter(t => t.completedAt && App.utils.hqDateOf(t.completedAt) >= startISO);

    const critHigh = open.filter(t => t.priority === 'critical' || t.priority === 'high').length;
    const overdue = open.filter(t => t.due && t.due < today).length;

    // On-time: completion HQ date <= due date.
    const withDue = done.filter(t => t.due);
    const onTime = withDue.filter(t => App.utils.hqDateOf(t.completedAt) <= t.due).length;
    const onTimeRate = withDue.length ? Math.round((onTime / withDue.length) * 100) : null;

    // Cycle time: completed_at - created_at, in days.
    const withSpan = done.filter(t => t.createdAt && t.completedAt);
    const avgCycle = withSpan.length
      ? (withSpan.reduce((s, t) => s + (new Date(t.completedAt) - new Date(t.createdAt)), 0)
          / withSpan.length / 86400000)
      : null;

    // Status mix (all scoped tasks).
    const statuses = ['todo', 'pending', 'review', 'hold', 'done'];
    const mix = statuses.map(s => ({ s, n: all.filter(t => t.status === s).length }));

    // Throughput by person (completed in range).
    const byPerson = {};
    done.forEach(t => { byPerson[t.assignee] = (byPerson[t.assignee] || 0) + 1; });
    const people = Object.entries(byPerson)
      .map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n).slice(0, 8);

    // Throughput per week (last 8 weeks) from completed_at.
    const weeks = [];
    const wk0 = new Date(); wk0.setHours(0, 0, 0, 0); wk0.setDate(wk0.getDate() - 7 * 7);
    for (let i = 0; i < 8; i++) {
      const a = new Date(wk0); a.setDate(a.getDate() + i * 7);
      const b = new Date(a); b.setDate(b.getDate() + 7);
      weeks.push(all.filter(t => t.completedAt && new Date(t.completedAt) >= a && new Date(t.completedAt) < b).length);
    }

    // Critical & High open, soonest due first.
    const critList = open.filter(t => t.priority === 'critical' || t.priority === 'high')
      .sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));

    return { critHigh, overdue, completed: done.length, onTimeRate, avgCycle, mix, people, weeks, critList, total: all.length };
  }

  render() {
    const m = this._metrics();
    const esc = App.utils.escapeHtml;
    const STATUS_LABEL = { todo: 'To do', pending: 'In progress', review: 'In review', hold: 'Blocked', done: 'Done' };
    const STATUS_VAR = { todo: 'var(--ink-3)', pending: 'var(--amber)', review: '#8268DC', hold: 'var(--rust)', done: 'var(--green)' };

    const kpi = (label, val, sub) =>
      `<div class="qhq-kpi"><div class="kl">${esc(label)}</div><div class="kv tnum">${val}</div><div class="kd">${esc(sub)}</div></div>`;

    const maxPerson = Math.max(1, ...m.people.map(p => p.n));
    const personBars = m.people.length ? m.people.map(p => `
      <div class="qhq-bh-row"><span class="nm">${esc(this.controller.getUserName(p.id))}</span>
        <div class="qhq-bh-track"><i style="width:${Math.round((p.n / maxPerson) * 100)}%"></i></div>
        <span class="v">${p.n}</span></div>`).join('') : `<div class="qhq-empty">No completions in range.</div>`;

    const mixTotal = Math.max(1, m.mix.reduce((s, x) => s + x.n, 0));
    const mixBar = m.mix.map(x => x.n ? `<i style="width:${(x.n / mixTotal) * 100}%;background:${STATUS_VAR[x.s]}"></i>` : '').join('');
    const mixLegend = m.mix.map(x => `<div><span class="d" style="background:${STATUS_VAR[x.s]}"></span>${STATUS_LABEL[x.s]} <b>${x.n}</b></div>`).join('');

    const maxWeek = Math.max(1, ...m.weeks);
    const pts = m.weeks.map((n, i) => `${20 + i * 84},${(150 - (n / maxWeek) * 110).toFixed(1)}`).join(' ');

    const today = App.utils.todayISO(0);
    const critRows = m.critList.length ? m.critList.map(t => `
      <div class="qhq-cl-row">
        <span class="pf ${t.priority}"></span>
        <span class="ti">${esc(t.title)}</span>
        <span class="who">${esc(this.controller.getUserName(t.assignee))}</span>
        <span class="pill">${esc(STATUS_LABEL[t.status] || t.status)}</span>
        <span class="due ${t.due && t.due < today ? 'over' : ''}">${esc(this._shortDate(t.due))}</span>
      </div>`).join('') : `<div class="qhq-empty">No critical or high open tasks. 🎉</div>`;

    const rangeBtns = ['week', 'month', 'quarter']
      .map(r => `<button data-range="${r}" class="${r === this.range ? 'on' : ''}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('');

    this.wrap.innerHTML = `
      <div class="qhq-rpt">
        <div class="qhq-rpt-top">
          <div><div class="h">Company reports</div><div class="sub">Scoped to your access · ${m.total} tasks</div></div>
          <div class="qhq-range" role="tablist" aria-label="Range">${rangeBtns}</div>
        </div>

        <div class="qhq-kpi-row">
          ${kpi('Critical & High open', m.critHigh, 'open now')}
          ${kpi('Overdue', m.overdue, 'past due')}
          ${kpi('Completed', m.completed, 'in range')}
          ${kpi('On-time rate', m.onTimeRate == null ? '—' : m.onTimeRate + '%', 'of completed')}
          ${kpi('Avg cycle time', m.avgCycle == null ? '—' : m.avgCycle.toFixed(1) + 'd', 'create → done')}
        </div>

        <div class="qhq-charts">
          <div class="qhq-chart-card">
            <div class="cc-h"><span class="ct">Throughput</span><span class="meta">· completed / week · last 8 weeks</span></div>
            <svg viewBox="0 0 640 160" class="qhq-spark-svg" preserveAspectRatio="none">
              <polyline points="${pts}" fill="none" stroke="var(--amber)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="qhq-chart-card">
            <div class="cc-h"><span class="ct">Throughput by person</span><span class="meta">· in range</span></div>
            <div class="qhq-bars">${personBars}</div>
          </div>
        </div>

        <div class="qhq-charts" style="grid-template-columns:1fr 1.4fr">
          <div class="qhq-chart-card">
            <div class="cc-h"><span class="ct">Open work by status</span></div>
            <div class="qhq-statmix"><div class="qhq-mixbar">${mixBar}</div><div class="qhq-mixlegend">${mixLegend}</div></div>
          </div>
          <div class="qhq-chart-card">
            <div class="cc-h"><span class="ct">Critical &amp; High — company-wide</span></div>
            <div class="qhq-cllist">${critRows}</div>
          </div>
        </div>
      </div>`;

    this.wrap.querySelectorAll('.qhq-range button').forEach(b =>
      b.addEventListener('click', () => { this.range = b.dataset.range; this.render(); }));
  }
};
