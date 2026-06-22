window.App = window.App || {};

/* HomeView — the personal landing screen (every role). Greeting + due-today /
   waiting-on-you counts + a live, role/company-scoped "At risk" list. The AI
   brief copy and "Handled for you" card are static placeholders for now.
   Renders into #homeWrap when the current view is 'home'. */
App.HomeView = class HomeView {
  constructor({ controller }) {
    this.controller = controller;
    this.wrap = document.getElementById('homeWrap');
    this.subscribe();
    if (this.visible()) this.render();
  }

  subscribe() {
    const rerender = () => { if (this.visible()) this.render(); };
    App.EventBus.on('view:changed', rerender);
    App.EventBus.on('tasks:changed', rerender);
    App.EventBus.on('company:changed', rerender);
    App.EventBus.on('people:changed', rerender);
  }

  visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }

  _firstName() {
    const p = App.currentProfile || {};
    const full = p.full_name || (App.PEOPLE[this.controller.currentUser] || {}).name || 'there';
    return String(full).trim().split(/\s+/)[0];
  }

  _greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  _longDate(iso) {
    // iso is YYYY-MM-DD; parse as local midnight so the weekday/day are correct.
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // Open tasks (scoped) that are at risk, with a reason + chip.
  _atRisk() {
    const today = App.utils.todayISO(0);
    const tasks = this.controller.visibleTasks({ includeDone: false });
    const out = [];
    for (const t of tasks) {
      const overdue = !!(t.due && t.due < today);
      const parked = t.status === 'hold';
      const hot = (t.priority === 'critical' || t.priority === 'high');
      if (!overdue && !parked) continue;
      const reason = overdue && hot ? 'Overdue + high priority'
        : overdue ? 'Past due'
        : 'On hold';
      const chip = overdue && hot ? { cls: 'risk', label: 'at risk' }
        : overdue ? { cls: 'risk', label: 'late' }
        : { cls: 'hold', label: 'blocked' };
      out.push({ t, reason, chip, overdue });
    }
    out.sort((a, b) => (b.overdue - a.overdue) || String(a.t.due).localeCompare(String(b.t.due)));
    return out.slice(0, 6);
  }

  render() {
    const me = this.controller.currentUser;
    const today = App.utils.todayISO(0);
    const mine = this.controller.visibleTasks({ includeDone: false }).filter(t => t.assignee === me);
    const dueToday = mine.filter(t => t.due === today).length;
    const waiting = mine.filter(t => t.status === 'review' || t.status === 'hold').length;
    const atRisk = this._atRisk();
    const esc = App.utils.escapeHtml;

    const riskRows = atRisk.length ? atRisk.map(r => `
      <div class="qhq-ar-row">
        <div class="qhq-ar-ic ${r.chip.cls}"><i class="ti ${r.overdue ? 'ti-alert-triangle' : 'ti-player-pause'}"></i></div>
        <div class="qhq-ar-b">
          <div class="qhq-ar-t">${esc(r.t.title)}</div>
          <div class="qhq-ar-s">${esc(this.controller.getUserName(r.t.assignee))} · ${esc(r.reason)}</div>
        </div>
        <span class="qhq-chip ${r.chip.cls}">${esc(r.chip.label)}</span>
      </div>`).join('')
      : `<div class="qhq-empty">Nothing at risk right now. 🎉</div>`;

    this.wrap.innerHTML = `
      <div class="qhq-home">
        <div class="qhq-greet">${this._greeting()}, <span class="em">${esc(this._firstName())}</span></div>
        <div class="qhq-dateline">${esc(this._longDate(today))} · ${dueToday} due today · ${waiting} waiting on you</div>

        <div class="qhq-brief">
          <div class="qhq-brief-h">
            <span class="qhq-spark"><i class="ti ti-sparkles"></i></span>
            <span class="t">Your morning brief</span>
            <span class="b">QUEST AI</span>
          </div>
          <p class="qhq-brief-tx">Prioritize overdue and high-impact work first. An automatic summary of your workspace will appear here — for now, the cards below show what needs you.</p>
        </div>

        <div class="qhq-home-grid">
          <div class="qhq-card">
            <div class="qhq-card-h"><span class="ct">At risk</span><span class="meta">· needs attention</span></div>
            <div class="qhq-arlist">${riskRows}</div>
          </div>
          <div class="qhq-card">
            <div class="qhq-card-h"><span class="ct">Handled for you</span><span class="meta">· coming soon</span></div>
            <div class="qhq-hdlist"><div class="qhq-empty">Automated summaries will appear here.</div></div>
          </div>
        </div>
      </div>`;
  }
};
