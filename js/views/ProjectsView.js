window.App = window.App || {};

/* Projects view: each company is its own warm panel (a "box"), clearly
   separated by the page wash and a company-tinted header — never borders.
   Inside a box, folders are compact task-list-style rows grouped by due date,
   with a completion progress bar. A click-to-complete circle on each row marks
   the folder done, dropping it into that company's collapsed "Completed" group.
   A folder row's chevron expands it to reveal all of its tasks; clicking the
   row scopes the task list to it (controller.openProject). */
App.ProjectsView = class ProjectsView {
  constructor({ controller, taskModel }) {
    this.controller = controller;
    this.taskModel = taskModel;
    this.wrap = document.getElementById('projectsWrap');
    this.sort = 'recent';
    this.coFilter = '*';         // mobile chip strip: '*' = All (see _chipFolders)
    this.expanded = new Set();   // folder ids with their task drawer open
    this.collapsed = new Set();  // due-group keys the user has collapsed
    this._seenDone = new Set();  // done-group keys already auto-collapsed once
    this._rollupState = new Map(); // projectId → 'idle' | 'loading' | 'error'
    this._rollupErr = new Map();   // projectId → error string
    this._rollupClient = null;     // lazily created App.RollupClient
    this._ac = new AbortController();
    App.EventBus.on('view:changed',    (v) => { if (v === 'projects') this.render(); }, { signal: this._ac.signal });
    App.EventBus.on('projects:changed', () => { if (this._visible()) this.render(); }, { signal: this._ac.signal });
    App.EventBus.on('tasks:changed',    () => { if (this._visible()) this.render(); }, { signal: this._ac.signal });
    App.EventBus.on('company:changed',  () => { if (this._visible()) this.render(); }, { signal: this._ac.signal });
  }

  _visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }

  // A folder is "active" while its lifecycle status is open; anything else
  // (done / archived / lost …) reads as closed and files under Completed.
  _isActive(p) { return ['lead', 'active', 'hold'].includes(p.status); }

  _counts(id) {
    const all = this.taskModel.all().filter(t => t.project === id);
    return { open: all.filter(t => !App.taxonomy.isDone(t)).length, done: all.filter(t => App.taxonomy.isDone(t)).length };
  }

  _folderTasks(id) {
    const rank = { critical: 0, urgent: 1, high: 2, medium: 3, low: 4 };
    return this.taskModel.all().filter(t => t.project === id)
      .sort((a, b) =>
        ((App.taxonomy.isDone(a)) - (App.taxonomy.isDone(b))) ||
        ((rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)) ||
        String(a.due || '').localeCompare(String(b.due || '')));
  }

  // Every folder in the sidebar-company scope (active + completed). Completed
  // folders live in a collapsed group rather than behind a toggle.
  _baseFolders() {
    const cur = this.controller.uiState.currentCompany;
    return Object.values(App.projects || {})
      .filter(p => !cur || cur === '*' || p.companyId === cur);
  }

  _sortFolders(list) {
    const arr = list.slice();
    if (this.sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (this.sort === 'active') arr.sort((a, b) => this._counts(b.id).open - this._counts(a.id).open);
    return arr; // 'recent' keeps created_at insertion order
  }

  // The mobile chip strip narrows the page to one company. It only renders on a
  // phone, and '*' means "All", so on desktop this is always the identity
  // filter and _visibleFolders behaves exactly as it did before the strip.
  _chipFolders() {
    const base = this._baseFolders();
    return this.coFilter === '*' ? base : base.filter(p => p.companyId === this.coFilter);
  }

  _visibleFolders() { return this._sortFolders(this._chipFolders()); }

  // The hero: the soonest-due open project — the Projects twin of the Tasks
  // page's "Up next". Falls back to the first open project when nothing is
  // dated (a card that says "here's the work" still beats no card), and to
  // nothing at all when there are no open projects to point at.
  _heroFolder() {
    const open = this._chipFolders().filter(p => this._isActive(p));
    if (!open.length) return null;
    const dated = open.filter(p => p.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    return dated[0] || open[0];
  }

  _companyColor(companyId) {
    return ({ roofing: 'var(--u-high)', drafting: 'var(--blue)', lumen: 'var(--amber)' })[companyId] || 'var(--amber)';
  }
  _folderColor(p) {
    return (p.color && p.color.toLowerCase() !== '#8f867b') ? p.color : this._companyColor(p.companyId);
  }
  _prioColor(prio) {
    return ({ critical: 'var(--u-critical)', urgent: 'var(--u-urgent)', high: 'var(--u-high)', medium: 'var(--u-medium)', low: 'var(--u-low)' })[prio] || 'var(--u-medium)';
  }
  _fmtDue(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  _taskRow(t) {
    const esc = App.utils.escapeHtml;
    const st = App.STATUSES[t.status] || { label: t.status || '' };
    const person = App.directory.person(t.assignee) || App.directory.personFallback(t.assignee);
    const due = App.utils.formatDue ? (App.utils.formatDue(t.due) || {}) : {};
    const dueText = (due && due.text) ? due.text : '';
    const done = App.taxonomy.isDone(t);
    return `
      <div class="pv-trow${done ? ' done' : ''}" data-task="${esc(t.id)}" role="button" tabindex="0">
        <span class="pv-tprio" style="background:${this._prioColor(t.priority)}"></span>
        <span class="pv-ttitle">${esc(t.title)}</span>
        <span class="pv-tstatus">${esc(st.label)}</span>
        <span class="pv-tassignee">${esc(person.name)}</span>
        <span class="pv-tdue">${esc(dueText)}</span>
      </div>`;
  }

  // Inline ✨ trigger shown beside the project name while the folder is open.
  // The generated summary itself renders in the drawer via _rollupHtml.
  _rollupInline(p) {
    const esc = App.utils.escapeHtml;
    const state = this._rollupState.get(p.id) || 'idle';
    const cached = App.RollupClient && App.RollupClient.get(p.id);
    if (state === 'loading') {
      return `<span class="pv-rollup-inline loading"><i class="ti ti-sparkles"></i><span class="pv-rollup-lbl">Summarizing…</span></span>`;
    }
    if (state === 'error') {
      return `<button class="pv-rollup-inline" data-rollup="${esc(p.id)}" type="button" title="Try again"><i class="ti ti-sparkles"></i><span class="pv-rollup-lbl">Try again</span></button>`;
    }
    if (cached && cached.rollup) {
      return `<button class="pv-rollup-inline" data-rollup-refresh="${esc(p.id)}" type="button" title="Refresh summary"><i class="ti ti-sparkles"></i><span class="pv-rollup-lbl">Refresh</span></button>`;
    }
    return `<button class="pv-rollup-inline" data-rollup="${esc(p.id)}" type="button" title="Summarize this project"><i class="ti ti-sparkles"></i><span class="pv-rollup-lbl">Summarize</span></button>`;
  }

  // Rollup CONTENT for an expanded folder (the trigger lives inline beside the
  // name — see _rollupInline). Reads live state + the session cache so
  // re-expanding a folder shows a prior summary immediately. Empty when idle
  // with nothing cached — the beside-name button is the only entry point.
  _rollupHtml(p) {
    const esc = App.utils.escapeHtml;
    const state = this._rollupState.get(p.id) || 'idle';
    const cached = App.RollupClient && App.RollupClient.get(p.id);
    if (state === 'loading') {
      return `<div class="pv-rollup" data-rollup-for="${esc(p.id)}">
        <div class="pv-rollup-skel"></div><div class="pv-rollup-skel short"></div></div>`;
    }
    if (state === 'error') {
      const msg = this._rollupErr.get(p.id) || 'Summary unavailable.';
      return `<div class="pv-rollup" data-rollup-for="${esc(p.id)}">
        <div class="pv-rollup-line">${esc(msg)}</div></div>`;
    }
    if (cached && cached.rollup) {
      const r = cached.rollup;
      const bullets = (r.bullets || []).slice(0, 3).map(b => `<li>${esc(b.label)}</li>`).join('');
      const when = cached.generatedAt ? this._fmtWhen(cached.generatedAt) : '';
      return `<div class="pv-rollup" data-rollup-for="${esc(p.id)}">
        <div class="pv-rollup-head">
          <span class="pv-rollup-eyebrow"><i class="ti ti-sparkles"></i> AI rollup</span>
          ${when ? `<span class="pv-rollup-when">${esc(when)}</span>` : ''}
        </div>
        <div class="pv-rollup-text">${esc(r.text)}</div>
        ${bullets ? `<ul class="pv-rollup-bullets">${bullets}</ul>` : ''}</div>`;
    }
    return ''; // idle & no cache → nothing in the drawer; trigger is beside the name
  }

  _fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return 'Updated ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // Fetch (or refresh) the rollup for one project, driving the strip through
  // loading → cached/error. Result lands in App.RollupClient.cache.
  _generateRollup(id, force = false) {
    if (!App.RollupClient || !this.controller.dataStore) {
      this._rollupState.set(id, 'error');
      this._rollupErr.set(id, 'AI is not available.');
      this._renderBody();
      return;
    }
    const p = (App.projects || {})[id];
    const name = (p && p.name) || '';
    this._rollupState.set(id, 'loading');
    this._renderBody();
    const client = this._rollupClient || (this._rollupClient = new App.RollupClient({ dataStore: this.controller.dataStore }));
    client.fetch(id, name, { force }).then((r) => {
      if (r.rollup) { this._rollupState.set(id, 'idle'); this._rollupErr.delete(id); }
      else { this._rollupState.set(id, 'error'); this._rollupErr.set(id, r.error || 'Summary unavailable.'); }
      if (this._visible()) this._renderBody();
    });
  }

  _row(p) {
    const esc = App.utils.escapeHtml;
    const c = this._counts(p.id);
    const total = c.open + c.done;
    const pct = total ? Math.round((c.done / total) * 100) : 0;
    const color = this._folderColor(p);
    const open = this.expanded.has(p.id);
    const done = !this._isActive(p);
    const due = p.dueDate ? this._fmtDue(p.dueDate) : '';
    const overdue = !done && this._dueBucket(p) === 'overdue';
    const prog = total
      ? `<span class="pv-track"><span class="pv-fill" style="width:${pct}%"></span></span><span class="pv-progtxt"><b>${c.open}</b> open · ${c.done} done</span>`
      : `<span class="pv-progtxt pv-progtxt-empty">No tasks yet</span>`;
    const check = App.can('tasks.write')
      ? `<button class="pv-check${done ? ' done' : ''}" data-done="${esc(p.id)}" type="button" aria-label="${done ? 'Reopen project' : 'Mark project complete'}" title="${done ? 'Reopen project' : 'Mark complete'}"><i class="ti ti-check"></i></button>`
      : '';
    const actions = App.can('tasks.write')
      ? `<span class="pv-actions">
          <button class="pv-act" data-addtask="${esc(p.id)}" type="button" aria-label="Add task to ${esc(p.name)}" title="Add task"><i class="ti ti-plus"></i></button>
          <button class="pv-act pv-act-del" data-del="${esc(p.id)}" type="button" aria-label="Delete ${esc(p.name)}" title="Delete project"><i class="ti ti-trash"></i></button>
        </span>`
      : '';
    let drawer = '';
    if (open) {
      const tasks = this._folderTasks(p.id);
      drawer = this._rollupHtml(p) + `<div class="pv-tasks">${tasks.length
        ? tasks.map(t => this._taskRow(t)).join('')
        : '<div class="pv-noTasks">No tasks in this project yet.</div>'}</div>`;
    }
    return `
      <div class="pv-rowwrap${open ? ' open' : ''}${done ? ' isdone' : ''}" style="--pc:${esc(color)}">
        <div class="pv-row" data-project="${esc(p.id)}" role="button" tabindex="0">
          <button class="pv-chev" data-toggle="${esc(p.id)}" aria-label="Toggle tasks" aria-expanded="${open}" type="button"><i class="ti ti-chevron-right"></i></button>
          ${check}
          <span class="pv-id"><span class="pv-name">${esc(p.name)}</span>${(p.client || p.address) ? `<span class="pv-client">${esc(p.client || p.address)}</span>` : ''}${open ? this._rollupInline(p) : ''}</span>
          <span class="pv-prog">${prog}</span>
          <span class="pv-duecol${overdue ? ' overdue' : ''}">${due ? 'Due ' + esc(due) : ''}</span>
          ${actions}
        </div>
        ${drawer}
      </div>`;
  }

  /* ---- Mobile shell (css/mobile.css §5). These nodes render at every width
     and css/mobile.css reveals them only ≤720px — the same trick
     ProgressWidgetView uses for .progress-line. That is deliberate: it keeps
     this view free of width checks, so there is no resize handler and no
     "am I mobile" flag to get out of sync with the CSS. ---- */

  // Hero — the soonest-due open project, mirroring the Tasks page's Up next.
  _heroHtml() {
    const esc = App.utils.escapeHtml;
    const p = this._heroFolder();
    if (!p) return '';
    const co = App.directory.company(p.companyId) || App.directory.companyFallback(p.companyId);
    const c = this._counts(p.id);
    const overdue = this._dueBucket(p) === 'overdue';
    const due = p.dueDate
      ? `<span class="pv-hero-due${overdue ? ' overdue' : ''}">${overdue ? 'Overdue' : 'Due ' + esc(this._fmtDue(p.dueDate))}</span>`
      : '';
    return `
      <div class="m-hero-mount">
        <div class="m-hero pv-hero" data-hero="${esc(p.id)}" role="button" tabindex="0" style="--pc:${esc(this._folderColor(p))}">
          <div class="m-hero-text">
            <div class="m-hero-eyebrow">Up next</div>
            <div class="m-hero-title">${esc(p.name)}</div>
            <div class="m-hero-meta">
              <span class="pv-hero-co"><span class="pv-hero-dot"></span>${esc(co.label)}</span>
              ${due}
              <span class="pv-hero-open">${c.open} open</span>
            </div>
          </div>
          <span class="m-hero-action pv-hero-go" aria-hidden="true"><i class="ti ti-arrow-right"></i></span>
        </div>
      </div>`;
  }

  // Chip strip — the company panels (.pv-cobox) collapsed into one scrolling
  // row of filters, exactly as the Tasks table does it. Built from the folders
  // actually in scope, so it never offers an empty company.
  _chipsHtml() {
    const esc = App.utils.escapeHtml;
    const base = this._baseFolders();
    const ids = [...new Set(base.map(p => p.companyId))];
    if (ids.length < 2) return '';   // one company — a filter with one option is noise
    const chip = (id, label, color) => `
      <button class="m-chip${this.coFilter === id ? ' on' : ''}" data-co="${esc(id)}" type="button"
        ${color ? `style="--cc:${esc(color)}"` : ''}>
        ${color ? '<span class="m-chip-dot"></span>' : ''}${esc(label)}
      </button>`;
    return `<div class="m-chips" role="group" aria-label="Filter by company">
      ${chip('*', 'All', '')}
      ${ids.map(id => {
        const co = App.directory.company(id) || App.directory.companyFallback(id);
        return chip(id, co.label, this._companyColor(id));
      }).join('')}
    </div>`;
  }

  render() {
    if (!this.wrap) this.wrap = document.getElementById('projectsWrap');
    if (!this.wrap) return;
    // _chipFolders, not _baseFolders: on a phone the company chips narrow the
    // page, and stat cards that kept counting the companies you just filtered
    // OUT would be lying. '*' (All) is the identity filter and is the only
    // value desktop ever has, so the desktop numbers are unchanged.
    const base = this._chipFolders();
    const counts = base.map(p => this._counts(p.id));
    const openTotal = counts.reduce((n, c) => n + c.open, 0);
    const doneTotal = counts.reduce((n, c) => n + c.done, 0);
    // The "Complete" ring tracks folders, not tasks: checking a project off
    // (setProjectStatus → 'complete') is what should move it. A folder counts
    // as complete once its lifecycle status is closed (anything but active).
    const doneFolders = base.filter(p => !this._isActive(p)).length;
    const pct = base.length ? Math.round((doneFolders / base.length) * 100) : 0;
    const companies = new Set(base.map(p => p.companyId)).size;

    this.wrap.innerHTML = `
      <div class="pv-head">
        <div class="pv-head-l">
          <div class="pv-eyebrow">Workspace</div>
          <h1 class="pv-title">Projects</h1>
        </div>
        <div class="pv-head-r">
          <!-- .m-selwrap is display:contents above 720px, so on desktop this
               select is still a direct child of .pv-head-r and lays out exactly
               as it always has. On a phone the wrapper becomes a 38px box, the
               glyph shows, and the select goes transparent on top of it — which
               keeps the native picker instead of reimplementing one. -->
          <span class="m-selwrap">
            <i class="ti ti-arrows-sort m-glyph" aria-hidden="true"></i>
            <select class="pv-sort" id="proj-sort" aria-label="Sort projects">
              <option value="recent"${this.sort === 'recent' ? ' selected' : ''}>Recently added</option>
              <option value="name"${this.sort === 'name' ? ' selected' : ''}>Name (A–Z)</option>
              <option value="active"${this.sort === 'active' ? ' selected' : ''}>Most active</option>
            </select>
          </span>
          ${App.can('tasks.write') ? `<button class="pv-new" data-action="new-folder" type="button"><i class="ti ti-plus"></i> <span class="pv-new-lbl">New project</span></button>` : ''}
        </div>
      </div>

      <!-- .pv-shell mirrors #taskViewWrap's box on a phone (12px margin + 12px
           padding = the x=24 gutter every band on the Tasks page sits on).
           The chip strip's edge-bleed is -12/+12 and only lands on that gutter
           inside a box shaped like this one. -->
      <div class="pv-shell">
        ${this._heroHtml()}

      <!-- The real KPI cards, moved inside .pv-shell so a phone can put them
           directly under the hero (they used to sit after it in source order,
           which would have stranded them below the chip strip). .pv-shell has
           NO desktop styling — it is a plain block — so the cards' own
           28px side margin still applies above 720px and the desktop row is
           byte-identical to before. -->
      <div class="pv-kpis">
        <div class="pv-kpi" style="--kc:var(--amber)">
          <span class="pv-kpi-ic"><i class="ti ti-folders"></i></span>
          <div class="pv-kpi-body"><div class="pv-kpi-num">${base.length}</div><div class="pv-kpi-lbl">Projects</div></div>
        </div>
        <div class="pv-kpi" style="--kc:var(--u-high)">
          <span class="pv-kpi-ic"><i class="ti ti-list-check"></i></span>
          <div class="pv-kpi-body"><div class="pv-kpi-num">${openTotal}</div><div class="pv-kpi-lbl">Open tasks</div></div>
        </div>
        <div class="pv-kpi" style="--kc:var(--green)">
          <span class="pv-kpi-ic"><i class="ti ti-circle-check"></i></span>
          <div class="pv-kpi-body"><div class="pv-kpi-num">${doneTotal}</div><div class="pv-kpi-lbl">Completed</div></div>
        </div>
        <div class="pv-kpi" style="--kc:var(--blue)">
          <span class="pv-kpi-ic"><i class="ti ti-building"></i></span>
          <div class="pv-kpi-body"><div class="pv-kpi-num">${companies}</div><div class="pv-kpi-lbl">Companies</div></div>
        </div>
        <div class="pv-kpi pv-kpi-ring">
          <div class="pv-ring" style="--p:${pct}%"><b>${base.length ? pct + '%' : '—'}</b></div>
          <div class="pv-kpi-body"><div class="pv-kpi-cmplbl">Complete</div><div class="pv-kpi-lbl">${base.length ? 'across all projects' : 'no projects yet'}</div></div>
        </div>
      </div>

        ${this._chipsHtml()}
      </div>

      <div class="pv-body"></div>`;

    const sort = this.wrap.querySelector('#proj-sort');
    if (sort) sort.addEventListener('change', () => { this.sort = sort.value; this._renderBody(); });
    const nf = this.wrap.querySelector('[data-action="new-folder"]');
    if (nf) nf.addEventListener('click', () => this.controller.promptNewFolder());

    // Chips change what the hero and the stat line describe, not just the list,
    // so this re-renders the head rather than only the body.
    this.wrap.querySelectorAll('.m-chip[data-co]').forEach(b =>
      b.addEventListener('click', () => { this.coFilter = b.dataset.co; this.render(); }));
    const hero = this.wrap.querySelector('.pv-hero[data-hero]');
    if (hero) hero.addEventListener('click', () => this.controller.openProject(hero.dataset.hero));

    this._renderBody();
  }

  _toggle(id) {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this._renderBody();
  }

  _toggleGroup(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key); else this.collapsed.add(key);
    this._renderBody();
  }

  // Due-date bucket for a folder, mirroring TaskModel.groupByDue.
  _dueBucket(p) {
    if (!p.dueDate) return 'none';
    const t0 = App.utils.todayISO(0), t1 = App.utils.todayISO(1), t7 = App.utils.todayISO(7);
    const d = p.dueDate;
    if (d < t0) return 'overdue';
    if (d === t0) return 'today';
    if (d === t1) return 'tomorrow';
    if (d <= t7) return 'week';
    return 'later';
  }

  _renderBody() {
    const host = this.wrap && this.wrap.querySelector('.pv-body');
    if (!host) return;
    // When a chip has narrowed the page to one company, that company's panel
    // header is a duplicate of the lit chip — mobile.css hides it on this flag.
    host.classList.toggle('pv-filtered', this.coFilter !== '*');
    const esc = App.utils.escapeHtml;
    const folders = this._visibleFolders();
    if (!folders.length) {
      host.innerHTML = `<div class="pv-blank">No projects yet — create one to group related tasks.</div>`;
      return;
    }
    const BUCKETS = [
      { key: 'overdue',  label: 'Overdue',     color: 'var(--rust)' },
      { key: 'today',    label: 'Today',       color: 'var(--u-high)' },
      { key: 'tomorrow', label: 'Tomorrow',    color: 'var(--u-high)' },
      { key: 'week',     label: 'This week',   color: 'var(--blue)' },
      { key: 'later',    label: 'Upcoming',    color: 'var(--green)' },
      { key: 'none',     label: 'No due date', color: 'var(--pv-ink-4)' },
      { key: 'done',     label: 'Completed',   color: 'var(--pv-ink-4)' },
    ];

    // One box per company (appearance order); inside, folders split into
    // due-date groups — active folders by due bucket, closed folders under
    // Completed (auto-collapsed the first time it appears).
    const byCo = {};
    folders.forEach(p => { (byCo[p.companyId] = byCo[p.companyId] || []).push(p); });

    let html = '';
    Object.keys(byCo).forEach(cid => {
      const co = App.directory.company(cid) || App.directory.companyFallback(cid);
      const list = byCo[cid];
      const byBucket = {};
      list.forEach(p => {
        const b = this._isActive(p) ? this._dueBucket(p) : 'done';
        (byBucket[b] = byBucket[b] || []).push(p);
      });
      let inner = '';
      BUCKETS.forEach(b => {
        const rows = byBucket[b.key];
        if (!rows || !rows.length) return;
        const gkey = cid + '::' + b.key;
        if (b.key === 'done' && !this._seenDone.has(gkey)) { this._seenDone.add(gkey); this.collapsed.add(gkey); }
        const collapsed = this.collapsed.has(gkey);
        inner += `<div class="pv-duegroup${collapsed ? ' collapsed' : ''}">
          <div class="pv-duehdr" data-group="${esc(gkey)}" role="button" tabindex="0">
            <span class="pv-duechev"><i class="ti ti-chevron-down"></i></span>
            <span class="pv-duedot" style="background:${b.color}"></span>
            <span class="pv-duename">${b.label}</span>
            <span class="pv-duecnt">${rows.length}</span>
          </div>
          ${collapsed ? '' : rows.map(p => this._row(p)).join('')}
        </div>`;
      });
      html += `<section class="pv-cobox" style="--co:${this._companyColor(cid)}">
        <div class="pv-cohead">
          <span class="pv-codot"></span>
          <span class="pv-coname">${esc(co.label)}</span>
          <span class="pv-cocnt">${list.length}</span>
        </div>
        ${inner}
      </section>`;
    });
    host.innerHTML = html;

    host.querySelectorAll('.pv-duehdr').forEach(h =>
      h.addEventListener('click', () => this._toggleGroup(h.dataset.group)));
    host.querySelectorAll('.pv-check').forEach(btn =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.done;
        const p = (App.projects || {})[id];
        const reopen = p && !this._isActive(p);
        if (reopen) { this.controller.setProjectStatus(id, 'active'); return; }
        // Finishing a folder — one clean signal. Draw the check on the button,
        // then let the row file into the Completed group. No pulse, no sweep,
        // no celebration toast; the check plus the row moving is the feedback.
        if (App.Motion) App.Motion.check(btn.querySelector('i'));
        const delay = (App.Motion && App.Motion.reduce()) ? 0 : 260;
        // 'complete' — NOT 'done'. The projects_status_check constraint only
        // allows lead/active/hold/complete/cancelled, so 'done' fails the write.
        setTimeout(() => this.controller.setProjectStatus(id, 'complete'), delay);
      }));
    host.querySelectorAll('.pv-act[data-addtask]').forEach(btn =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = (App.projects || {})[btn.dataset.addtask];
        if (!p) return;
        this.controller.openNewTaskPage({ project: p.id, company: p.companyId });
      }));
    host.querySelectorAll('.pv-act[data-del]').forEach(btn =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = (App.projects || {})[btn.dataset.del];
        if (!p) return;
        const c = this._counts(p.id);
        const n = c.open + c.done;
        const warn = n
          ? `\n\n${n} task${n === 1 ? '' : 's'} filed here will be kept and unfiled (moved out of the project), not deleted.`
          : '';
        if (window.confirm(`Delete project "${p.name}"?${warn}`)) this.controller.deleteProject(p.id);
      }));
    host.querySelectorAll('.pv-chev').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggle(btn.dataset.toggle); }));
    host.querySelectorAll('[data-rollup]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._generateRollup(btn.dataset.rollup); }));
    host.querySelectorAll('[data-rollup-refresh]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._generateRollup(btn.dataset.rollupRefresh, true); }));
    host.querySelectorAll('.pv-row').forEach(row =>
      row.addEventListener('click', () => this.controller.openProject(row.dataset.project)));
    host.querySelectorAll('.pv-trow[data-task]').forEach(row =>
      row.addEventListener('click', (e) => { e.stopPropagation(); this.controller.selectTask(row.dataset.task); }));
  }
};
