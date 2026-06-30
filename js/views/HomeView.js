window.App = window.App || {};

/* HomeView — the personal landing screen (every role). Greeting + quick actions,
   a 4-chip stat strip, an "Up next" card (Focus order then soonest-due), the live
   "At risk" list, and a "Recents" activity feed built from each task's persisted
   activity[]. Renders into #homeWrap when view is 'home'. */
App.HomeView = class HomeView {
  constructor({ controller }) {
    this.controller = controller;
    this.wrap = document.getElementById('homeWrap');
    this.subscribe();
    if (this.visible()) this.render();
  }

  subscribe() {
    const rerender = () => {
      if (this.visible()) this.render();
      else this._rendered = false; // re-arm the entrance reveal for the next visit
    };
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

  // 4 counts over the current user's tasks.
  _stats() {
    const me = this.controller.currentUser;
    const today = App.utils.todayISO(0);
    const all = this.controller.visibleTasks({ includeDone: true }).filter(t => t.assignee === me);
    const open = all.filter(t => t.status !== 'done');
    // Done in the last 7 days (HQ calendar days).
    const wkSet = new Set();
    for (let i = 0; i < 7; i++) wkSet.add(App.utils.todayISO(-i));
    const doneWeek = all.filter(t => t.completedAt && wkSet.has(App.utils.hqDateOf(t.completedAt))).length;
    return [
      { label: 'Open', value: open.length, icon: 'ti-inbox', tone: 'tone-blue' },
      { label: 'Due today', value: open.filter(t => t.due === today).length, icon: 'ti-calendar-due', tone: 'tone-amber' },
      { label: 'Overdue', value: open.filter(t => t.due && t.due < today).length, warn: true, icon: 'ti-flame', tone: 'tone-rust' },
      { label: 'Done this week', value: doneWeek, icon: 'ti-circle-check', tone: 'tone-green' },
    ];
  }

  // Status mix over the current user's tasks, mapped to the donut's three bands:
  // In progress (pending/review), Completed (done), Not started (todo/hold).
  _statusMix() {
    const me = this.controller.currentUser;
    const all = this.controller.visibleTasks({ includeDone: true }).filter(t => t.assignee === me);
    const inProg = all.filter(t => t.status === 'pending' || t.status === 'review').length;
    const done = all.filter(t => t.status === 'done').length;
    const notStarted = all.length - inProg - done; // todo / hold / unset
    return { inProg, done, notStarted, total: all.length };
  }

  // My open tasks: Focus order first (focusSeq set), then soonest due. Top 5.
  _upNext() {
    const me = this.controller.currentUser;
    const today = App.utils.todayISO(0);
    return this.controller.visibleTasks({ includeDone: false })
      .filter(t => t.assignee === me)
      .sort((a, b) => {
        const fa = a.focusSeq == null ? Infinity : a.focusSeq;
        const fb = b.focusSeq == null ? Infinity : b.focusSeq;
        if (fa !== fb) return fa - fb;
        return String(a.due || '9999').localeCompare(String(b.due || '9999'));
      })
      .slice(0, 5)
      .map(t => ({ t, overdue: !!(t.due && t.due < today) }));
  }

  // Flatten activity[] across the role-scoped task set into one feed. Managers
  // (reports.view) see all company-scoped activity; everyone else sees their
  // own world (assignee/creator/watcher).
  _recents() {
    const me = this.controller.currentUser;
    const manager = App.can('reports.view');
    let tasks = this.controller.visibleTasks({ includeDone: true });
    if (!manager) {
      tasks = tasks.filter(t =>
        t.assignee === me || t.creator === me || (t.watchers || []).includes(me));
    }
    const feed = [];
    for (const t of tasks) {
      for (const a of (t.activity || [])) {
        if (!a || (!a.at && !a.what)) continue;
        // `at` is a real timestamp on app-written activity; legacy/seed rows only
        // carry a `when` label. Keep both — timestamped first, labelled after.
        feed.push({ who: a.who || '', what: a.what || '', at: a.at || null, when: a.when || '', title: t.title, id: t.id });
      }
    }
    feed.sort((x, y) => {
      if (x.at && y.at) return String(y.at).localeCompare(String(x.at));
      if (x.at) return -1;
      if (y.at) return 1;
      return 0;
    });
    return feed.slice(0, 12);
  }

  render() {
    const esc = App.utils.escapeHtml;
    const today = App.utils.todayISO(0);
    const stats = this._stats();
    const upNext = this._upNext();
    const atRisk = this._atRisk();
    const recents = this._recents();

    // Each stat is an icon chip + figure. The overdue tile flips to an alert
    // wash only when it actually has a count, so it earns the eye.
    const statHtml = stats.map(s => `
      <div class="qhq-stat ${s.tone} ${s.warn && s.value ? 'is-alert' : ''}">
        <span class="qhq-stat-ic"><i class="ti ${s.icon}"></i></span>
        <div class="qhq-stat-body">
          <div class="sv tnum ${s.warn && s.value ? 'warn' : ''}">${s.value}</div>
          <div class="sl">${esc(s.label)}</div>
        </div>
      </div>`).join('');

    // A consistent, scannable section heading: tinted glyph + bold title + caption.
    const cardHead = (icon, tone, title, meta) => `
      <div class="qhq-card-h">
        <span class="qhq-hicon ${tone}"><i class="ti ${icon}"></i></span>
        <span class="qhq-htext"><span class="ct">${esc(title)}</span><span class="meta">${esc(meta)}</span></span>
      </div>`;

    // Deterministic monogram + tone for the activity feed, so each actor reads
    // as a person at a glance without pulling avatars over the wire.
    const TONES = ['tone-amber', 'tone-blue', 'tone-green', 'tone-slate'];
    const initials = name => (String(name || '?').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('') || '?').toUpperCase();
    const toneFor = s => TONES[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

    const PRIO = { critical: 'critical', urgent: 'urgent', high: 'high', medium: 'medium', low: 'low' };
    const unHtml = upNext.length ? upNext.map(r => `
      <div class="qhq-un-row" data-id="${esc(r.t.id)}" role="button" tabindex="0">
        <span class="qhq-un-dot ${PRIO[r.t.priority] || 'medium'}"></span>
        <span class="qhq-un-t">${esc(r.t.title)}</span>
        <span class="qhq-un-due ${r.overdue ? 'over' : ''}">${r.t.due ? esc(r.t.due.slice(5)) : '—'}</span>
      </div>`).join('')
      : `<div class="qhq-empty">No open tasks assigned to you. 🎉</div>`;

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

    // Projects-overview donut from the real status mix (conic-gradient bands).
    const mix = this._statusMix();
    const pct = n => (mix.total ? (n / mix.total) * 100 : 0);
    const a = pct(mix.inProg), b = pct(mix.done);
    const donutStyle = mix.total
      ? `background: conic-gradient(var(--blue) 0 ${a}%, var(--amber) ${a}% ${a + b}%, var(--bg-3) ${a + b}% 100%);`
      : `background: var(--bg-3);`;
    const donutHtml = `
      <div class="qhq-card qhq-donut-card">
        ${cardHead('ti-chart-donut', 'tone-blue', 'Projects overview', 'your tasks')}
        <div class="qhq-donut-wrap">
          <div class="qhq-donut" style="${donutStyle}"><div class="qhq-donut-hole"><div class="qhq-donut-num tnum">${mix.total}</div><div class="qhq-donut-lbl">tasks</div></div></div>
          <div class="qhq-donut-legend">
            <div><span class="d" style="background:var(--blue)"></span>In progress <b class="tnum">${mix.inProg}</b></div>
            <div><span class="d" style="background:var(--amber)"></span>Completed <b class="tnum">${mix.done}</b></div>
            <div><span class="d" style="background:var(--bg-3)"></span>Not started <b class="tnum">${mix.notStarted}</b></div>
          </div>
        </div>
      </div>`;

    const recHtml = recents.length ? recents.map(r => `
      <div class="qhq-rec-row" data-id="${esc(r.id)}" role="button" tabindex="0">
        <span class="qhq-rec-av ${toneFor(r.who)}" aria-hidden="true">${esc(initials(r.who))}</span>
        <span class="qhq-rec-tx"><b>${esc(r.who)}</b> ${esc(r.what)} · <span class="qhq-rec-task">${esc(r.title)}</span></span>
        <span class="qhq-rec-ago">${esc((r.at && App.utils.timeAgo(r.at)) || r.when || 'recently')}</span>
      </div>`).join('')
      : `<div class="qhq-empty">No recent activity yet.</div>`;

    // Animate the entrance only on the first paint after landing on Home, not on
    // every data-driven re-render (re-armed in subscribe when the view is hidden).
    const enter = this._rendered ? '' : ' qhq-enter';
    this._rendered = true;

    this.wrap.innerHTML = `
      <div class="qhq-home${enter}">
        <div class="qhq-head">
          <div>
            <div class="qhq-greet">${this._greeting()}, <span class="em">${esc(this._firstName())}</span></div>
            <div class="qhq-dateline"><i class="ti ti-calendar-event"></i> ${esc(this._longDate(today))}</div>
          </div>
          <div class="qhq-actions">
            <button type="button" class="qhq-act primary" data-act="new"><i class="ti ti-plus"></i> New task</button>
            <button type="button" class="qhq-act" data-act="all">All tasks</button>
            <button type="button" class="qhq-act" data-act="calendar">Calendar</button>
          </div>
        </div>

        <div class="qhq-statstrip">${statHtml}</div>

        <div class="qhq-home-grid">
          <div class="qhq-card">
            ${cardHead('ti-stack-2', 'tone-amber', 'Up next', 'your queue')}
            <div class="qhq-unlist">${unHtml}</div>
          </div>
          ${donutHtml}
          <div class="qhq-card">
            ${cardHead('ti-alert-triangle', 'tone-rust', 'At risk', 'needs attention')}
            <div class="qhq-arlist">${riskRows}</div>
          </div>
        </div>

        <div class="qhq-card qhq-recents">
          ${cardHead('ti-activity', 'tone-slate', 'Recents', App.can('reports.view') ? 'team activity' : 'your activity')}
          <div class="qhq-reclist">${recHtml}</div>
        </div>
      </div>`;

    // Wire interactions.
    this.wrap.querySelectorAll('.qhq-act').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'new') this.controller.openNewTaskModal();
      else if (a === 'all') this.controller.setView('all');
      else if (a === 'calendar') {
        // "Calendar" isn't a view — it's a layout of the task list. Open the
        // All-tasks view, then switch its layout to the calendar.
        this.controller.setView('all');
        this.controller.setLayout('calendar');
      }
    }));
    const open = el => { const id = el.dataset.id; if (id) this.controller.selectTask(id); };
    this.wrap.querySelectorAll('.qhq-un-row, .qhq-rec-row').forEach(el => {
      el.addEventListener('click', () => open(el));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(el); } });
    });
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
};
