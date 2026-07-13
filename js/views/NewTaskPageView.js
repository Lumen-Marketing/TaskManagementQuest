window.App = window.App || {};

/* Full-page "New task" screen — v1-FINAL fidelity to docs/pro1.html.
   Left column: bordered title card (with live token parsing) + four numbered
   sections (01 Routing, 02 Schedule, 03 Detail, 04 Watchers). Right column: a
   sticky white "Task Preview" card (_renderPreview) that live-mirrors the form
   and holds the DISPATCH VIA chips, the READY TO CREATE checklist, and the single
   Create & dispatch button — there is no separate footer. Everything is custom
   pickers (no native selects), styled by css/newtask.css. Field ids stay `nt-*`
   where App.validate.newTask maps errors to inputs (title). Saves through
   controller.createTask (multi-assignee, whos[] ordered, lead = index 0). */
App.NewTaskPageView = class NewTaskPageView {
  constructor({ controller, currentUser }) {
    this.controller = controller;
    this.currentUser = currentUser;
    this.wrap = document.getElementById('newTaskWrap');
    this._openMenu = null;           // id of the currently-open menu, or null
    this._docClick = null;
    this._onKey = null;

    App.EventBus.on('newtask:changed', (isOpen) => {
      if (isOpen) this.render(this.controller._newTaskPrefill || {});
      else this.teardown();
    });
  }

  teardown() {
    if (this._docClick) { document.removeEventListener('click', this._docClick); this._docClick = null; }
    if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null; }
    if (this.wrap) this.wrap.innerHTML = '';
  }

  /* ---------------- lifecycle ---------------- */
  render(prefill = {}) {
    if (!this.wrap) this.wrap = document.getElementById('newTaskWrap');
    if (!this.wrap) return;
    const { selected } = this._companyChoices();
    const company = (prefill && prefill.company) || selected;
    const type = (App.taxonomy.activeTypes(company)[0] || { key: 'admin' }).key;
    this.S = {
      company,
      whos: [this.currentUser],
      pri: 'medium',
      type,
      status: App.taxonomy.defaultStatus(company, type),
      label: null,
      project: (prefill && prefill.project) || null,
      remind: 'at',
      date: (prefill && prefill.due) || App.utils.todayISO(1),
      time: '',
      channels: { email: true, inapp: true, watchers: false, wa: false },
    };
    this.watchers = [];
    this.subtasks = [];
    this.description = '';
    this.woNumber = null;            // preview '—' until create assigns a real number
    this.dispatched = false;
    this._calY = null; this._calM = null;

    this._userSet = new Set();   // draft keys the user or token parser has set
    this._aiSet = new Set();     // draft keys the AI filled (for the ✨ marker)
    this._draftLast = '';        // last title text sent to the AI
    this._draftTimer = null;
    this._draftClient = App.TaskDraftClient ? new App.TaskDraftClient({ dataStore: this.controller.dataStore }) : null;

    this.wrap.innerHTML = this.template();
    this.bindEvents();
    this.sync();
    setTimeout(() => { const el = document.getElementById('nt-title'); if (el) el.focus(); }, 30);
    try { this.wrap.scrollTop = 0; } catch (e) { /* noop */ }
  }

  /* ---------------- helpers ---------------- */
  _companyChoices() {
    let ids = ((this.controller.uiState && this.controller.uiState.companies) || []).filter(id => id !== '*');
    if (!ids.length) ids = Object.keys(App.COMPANIES || {});
    const cur = this.controller.uiState && this.controller.uiState.currentCompany;
    const selected = (cur && cur !== '*') ? cur : ids[0];
    return { ids, selected };
  }

  // Per-company accent, taken from the existing token palette (no hardcoded hex).
  // Each company maps to one of the app's accent tokens by its order in the list.
  _accentToken(companyId) {
    const tokens = ['--amber', '--blue', '--rust', '--green'];
    const ids = this._companyChoices().ids;
    const i = Math.max(0, ids.indexOf(companyId));
    return tokens[i % tokens.length];
  }
  _resolveVar(token) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#ED4E0D'; }
    catch (e) { return '#ED4E0D'; }
  }
  _companyColor(companyId) { return this._resolveVar(this._accentToken(companyId)); }

  _peopleFor(companyId) { return App.utils.peopleInCompany(companyId, this.currentUser); }

  _priList() {
    // pro1 v1-FINAL: four levels only (Low / Med / High / Critical). 'Urgent'
    // still exists in the data model but is intentionally not offered here.
    return ['low', 'medium', 'high', 'critical'].filter(k => (App.PRIORITIES || {})[k]);
  }
  _isHigh(p) {
    const o = (App.PRIORITIES[p] || {}).order;
    const hi = (App.PRIORITIES.high || {}).order;
    return o != null && hi != null && o <= hi;
  }

  /* ---------------- template ---------------- */
  template() {
    const me = App.directory.person(this.currentUser) || { name: 'you', color: '#444441' };
    const meInit = App.utils.escapeHtml((me.name || '?').slice(0, 2).toUpperCase());
    return `
      <div id="nt-root" class="nt-page">
        <div class="nt-head">
          <div class="nt-crumb">
            <button class="nt-crumb-back" data-action="close" type="button" aria-label="Back to tasks">‹</button>
            <button class="nt-crumb-link" data-action="close" type="button">Tasks</button>
            <span class="nt-crumb-sep">/</span>
            <span class="nt-crumb-cur">NEW TASK</span>
          </div>
          <span class="nt-createdby"><span class="nt-mini" style="background:${me.color || '#444441'}">${meInit}</span> Created by ${App.utils.escapeHtml(me.name)}</span>
        </div>

        <div class="nt-cols">
          <div class="nt-sheet">
            <div class="nt-titlebox">
              <input id="nt-title" class="nt-title-in" placeholder="What needs to get done?" autocomplete="off" aria-label="Task title" />
              <div id="nt-flash" class="nt-flash" aria-live="polite"></div>
              <p class="nt-hint">Type <b>@name</b> <b>#company</b> <b>!high</b> <b>tmrw</b> <b>9:30a</b> — fields fill as you write.</p>
            </div>

            <div class="nt-sec" data-sec="routing">
              <div class="nt-sec-h"><span class="nt-n">01</span><span class="nt-t">Routing</span><span class="nt-k">C · A · P</span>${App.can('task-setup.manage') ? '<button class="nt-setup-link" data-action="task-setup" type="button"><i class="ti ti-adjustments"></i> Task setup</button>' : ''}</div>
              <div class="nt-frow">
                ${this._pickField('company', 'COMPANY', 'C')}
                ${this._pickField('assignee', 'ASSIGNEE', 'A')}
                ${this._priField()}
                ${this._pickField('status', 'STATUS', '')}
                ${this._pickField('type', 'TYPE', '')}
                ${this._pickField('label', 'LABEL', 'L')}
                ${this._pickField('project', 'PROJECT', '')}
              </div>
            </div>

            <div class="nt-sec" data-sec="schedule">
              <div class="nt-sec-h"><span class="nt-n">02</span><span class="nt-t">Schedule</span><span class="nt-k">D</span></div>
              <div class="nt-frow">
                ${this._pickField('date', 'DUE DATE', 'D', 'nt-cal-menu')}
                ${this._pickField('time', 'TIME', '', 'nt-time-menu')}
                ${this._pickField('remind', 'REMINDER', '')}
              </div>
            </div>

            <div class="nt-sec" data-sec="detail">
              <div class="nt-sec-h"><span class="nt-n">03</span><span class="nt-t">Detail</span></div>
              <textarea id="nt-desc" class="nt-desc" placeholder="Add context, links, scope…" aria-label="Description"></textarea>
              <div class="nt-sublist" id="nt-subtasks"></div>
              <div class="nt-chkrow">
                <input id="nt-subtask-input" placeholder="Add a checklist step, press Enter" />
                <button class="nt-chkadd" id="nt-subtask-add" type="button" aria-label="Add step">+</button>
              </div>
            </div>

            <div class="nt-sec" data-sec="watchers">
              <div class="nt-sec-h"><span class="nt-n">04</span><span class="nt-t">Watchers</span></div>
              <div class="nt-wrow">
                <span id="nt-watch-tags"></span>
                <div class="nt-f nt-watch-add">
                  <button class="nt-pick nt-ghost" id="nt-pick-watch" type="button" aria-haspopup="listbox"><span class="nt-pick-val"><i class="ti ti-plus"></i> Add watchers</span></button>
                  <div class="nt-menu" id="nt-menu-watch"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="nt-preview" id="nt-preview"></div>
        </div>
      </div>`;
  }

  _pickField(key, label, kk, menuClass = '') {
    return `<div class="nt-f">
      <label>${label}${kk ? `<span class="nt-kk">${kk}</span>` : ''}</label>
      <button class="nt-pick" id="nt-pick-${key}" type="button" aria-haspopup="listbox"><span class="nt-pick-val"></span><svg class="nt-car" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
      <div class="nt-menu ${menuClass}" id="nt-menu-${key}"></div>
    </div>`;
  }
  _priField() {
    // pro1 shows "Med" (not "Medium") and always-uppercase "CRITICAL".
    const PLABEL = { low: 'Low', medium: 'Med', high: 'High', critical: 'CRITICAL' };
    return `<div class="nt-f"><label>PRIORITY<span class="nt-kk">P</span><span id="nt-ai-pri"></span></label>
      <div class="nt-seg" id="nt-seg-pri">${this._priList().map(k =>
        `<button type="button" data-p="${k}">${PLABEL[k] || App.utils.escapeHtml(App.PRIORITIES[k].label)}</button>`).join('')}</div>
    </div>`;
  }

  /* ---------------- menu infrastructure ---------------- */
  _closeMenus() {
    if (this._openMenu) {
      const m = document.getElementById('nt-menu-' + this._openMenu);
      if (m) m.classList.remove('open');
      this._openMenu = null;
    }
  }
  _toggleMenu(key, itemsFn) {
    const menu = document.getElementById('nt-menu-' + key);
    if (!menu) return;
    const wasOpen = this._openMenu === key;
    this._closeMenus();
    if (!wasOpen) {
      menu.innerHTML = itemsFn();
      menu.classList.add('open');
      this._openMenu = key;
    }
  }
  _reopen(key, itemsFn) {
    const menu = document.getElementById('nt-menu-' + key);
    if (menu && this._openMenu === key) menu.innerHTML = itemsFn();
  }

  /* ---------------- picker item builders ---------------- */
  _menuHead(text) { return `<div class="nt-mhead">${App.utils.escapeHtml(text)}</div>`; }
  _createNewRow(label) { return `<button class="nt-createnew" data-createnew type="button"><i class="ti ti-plus"></i> ${App.utils.escapeHtml(label)}</button>`; }
  _check(on) { return on ? '<span class="nt-check"><i class="ti ti-check"></i></span>' : ''; }

  _companyItems() {
    return this._menuHead('COMPANY') + this._companyChoices().ids.map(id => {
      const c = App.directory.company(id) || { label: id };
      return `<button class="nt-mitem" data-v="${id}"><span class="nt-sq" style="background:${this._companyColor(id)}"></span>${App.utils.escapeHtml(c.label)}${this._check(this.S.company === id)}</button>`;
    }).join('');
  }
  _assigneeItems() {
    return this._menuHead('ASSIGNEES · PICK MULTIPLE') + this._peopleFor(this.S.company).map(p => {
      const on = this.S.whos.includes(p.id);
      const sub = p.position || (p.role && App.ROLES && App.ROLES[p.role] ? App.ROLES[p.role].label : p.role);
      const nameHtml = sub ? `<span class="nt-mname">${App.utils.escapeHtml(p.name)}<small>${App.utils.escapeHtml(sub)}</small></span>` : App.utils.escapeHtml(p.name);
      return `<button class="nt-mitem" data-v="${p.id}"><span class="nt-mini" style="background:${p.color || '#444441'}">${App.utils.escapeHtml((p.name || '?').slice(0, 2).toUpperCase())}</span>${nameHtml}${this._check(on)}</button>`;
    }).join('');
  }
  _typeItems() {
    const list = App.taxonomy.activeTypes(this.S.company);
    const rows = (list.length ? list : [{ key: 'admin', label: 'Admin' }]).map(t =>
      `<button class="nt-mitem" data-v="${t.key}">${App.utils.escapeHtml(t.label)}${this._check(this.S.type === t.key)}</button>`).join('');
    const create = App.can('task-setup.manage') ? this._createNewRow('Create new type…') : '';
    return this._menuHead('TYPE') + rows + create;
  }
  _statusItems() {
    const list = App.taxonomy.activeStatuses(this.S.company, this.S.type);
    const rows = list.length
      ? list.map(s => `<button class="nt-mitem" data-v="${s.key}"><span class="nt-dot" style="background:${s.color || '#888780'}"></span>${App.utils.escapeHtml(s.label)}${this._check(this.S.status === s.key)}</button>`).join('')
      : `<div class="nt-mempty">No statuses for this type</div>`;
    const create = App.can('task-setup.manage') ? this._createNewRow('Create new status…') : '';
    return this._menuHead('STATUS') + rows + create;
  }
  _labelItems() {
    const list = App.taxonomy.activeLabels(this.S.company);
    const head = `<button class="nt-mitem" data-v="">None${this._check(!this.S.label)}</button>`;
    const rows = list.map(l =>
      `<button class="nt-mitem" data-v="${l.key}"><span class="nt-dot" style="background:${l.color || '#888780'}"></span>${App.utils.escapeHtml(l.label)}${this._check(this.S.label === l.key)}</button>`).join('');
    return this._menuHead('LABEL') + head + rows + this._createNewRow('Create new label…');
  }
  _projectItems() {
    const list = Object.values(App.projects || {}).filter(p => p.companyId === this.S.company);
    const head = `<button class="nt-mitem" data-v="">No project${this._check(!this.S.project)}</button>`;
    const rows = list.map(p =>
      `<button class="nt-mitem" data-v="${p.id}">${App.utils.escapeHtml(p.name)}${this._check(this.S.project === p.id)}</button>`).join('');
    return this._menuHead('PROJECT') + head + rows + this._createNewRow('Create new project…');
  }
  _remindItems() {
    // pro1 v1-FINAL reminder set.
    const opts = { none: 'No reminder', at: 'At due time', '30m': '30 min before', '1h': '1 hour before', '1d': '1 day before' };
    return this._menuHead('REMINDER') + Object.entries(opts).map(([k, v]) =>
      `<button class="nt-mitem" data-v="${k}">${v}${this._check(this.S.remind === k)}</button>`).join('');
  }
  _watchItems() {
    return this._menuHead('WATCHERS · PICK MULTIPLE') + this._peopleFor(this.S.company).map(p => {
      const assigned = this.S.whos.includes(p.id);
      const on = this.watchers.includes(p.id);
      const wsub = assigned ? 'assigned' : (p.position || (p.role && App.ROLES && App.ROLES[p.role] ? App.ROLES[p.role].label : p.role) || '');
      const wnameHtml = wsub ? `<span class="nt-mname">${App.utils.escapeHtml(p.name)}<small>${App.utils.escapeHtml(wsub)}</small></span>` : App.utils.escapeHtml(p.name);
      return `<button class="nt-mitem" data-v="${p.id}" ${assigned ? 'disabled' : ''}><span class="nt-mini" style="background:${p.color || '#444441'}">${App.utils.escapeHtml((p.name || '?').slice(0, 2).toUpperCase())}</span>${wnameHtml}${this._check(on)}</button>`;
    }).join('');
  }

  /* ---------------- calendar + time ---------------- */
  _calMenu() {
    const today = App.utils.todayISO(0);
    const parts = (this.S.date || today).split('-');
    if (this._calY === null) { this._calY = +parts[0]; this._calM = +parts[1] - 1; }
    const y = this._calY, m = this._calM;
    const first = new Date(Date.UTC(y, m, 1));
    const startDow = first.getUTCDay();
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const monthName = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += `<span class="nt-cd off"></span>`;
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cls = 'nt-cd' + (iso === this.S.date ? ' sel' : '') + (iso === today ? ' tod' : '');
      cells += `<button type="button" class="${cls}" data-day="${iso}">${d}</button>`;
    }
    const chip = (lbl, iso) => `<button type="button" class="nt-cq" data-day="${iso}">${lbl}</button>`;
    return `
      ${this._menuHead('DUE DATE')}
      <div class="nt-cal-h">
        <button type="button" data-cal="prev" aria-label="Previous month">‹</button>
        <b>${monthName}</b>
        <button type="button" data-cal="next" aria-label="Next month">›</button>
      </div>
      <div class="nt-cal-w">${['S','M','T','W','T','F','S'].map(d => `<span>${d}</span>`).join('')}</div>
      <div class="nt-cal-g">${cells}</div>
      <div class="nt-cal-q">
        ${chip('TODAY', App.utils.todayISO(0))}${chip('TMRW', App.utils.todayISO(1))}
        ${chip('+1W', App.utils.todayISO(7))}
      </div>`;
  }
  _timeMenu() {
    let rows = this._menuHead('TIME') + `<button class="nt-mitem" data-time="">No time${this._check(!this.S.time)}</button>`;
    for (let mins = 6 * 60; mins <= 19 * 60 + 30; mins += 30) {
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      const v = `${hh}:${mm}`;
      const label = this._fmtTime(v);
      rows += `<button class="nt-mitem" data-time="${v}">${label}${this._check(this.S.time === v)}</button>`;
    }
    return rows;
  }
  _fmtTime(v) {
    if (!v) return 'No time';
    const [h, m] = v.split(':').map(Number);
    const ap = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  }

  /* ---------------- reminder computation ---------------- */
  _reminderText() {
    return { none: 'No reminder', at: 'At due time', '30m': '30 min before', '1h': '1 hour before', '1d': '1 day before' }[this.S.remind] || '—';
  }
  _computeReminderAt() {
    if (!this.S.date || this.S.remind === 'none') return null;
    const time = this.S.time || '09:00';
    const dueDt = new Date(`${this.S.date}T${time}:00`);
    if (isNaN(dueDt)) return null;
    const fmt = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    if (this.S.remind === 'at') return fmt(dueDt);
    let ms = 0;
    if (this.S.remind === '30m') ms = 30 * 60e3;
    else if (this.S.remind === '1h') ms = 3600e3;
    else if (this.S.remind === '1d') ms = 864e5;
    return fmt(new Date(dueDt.getTime() - ms));
  }

  /* ---------------- events ---------------- */
  bindEvents() {
    const root = document.getElementById('nt-root');
    root.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => this.controller.closeNewTaskPage()));
    const setupBtn = root.querySelector('[data-action="task-setup"]');
    if (setupBtn) setupBtn.addEventListener('click', () => { this.controller.setView('admin:task-setup'); });
    // The Create button lives in the preview card (re-rendered each sync); it's
    // handled by the delegated #nt-preview click listener below.

    // Title parsing.
    const title = document.getElementById('nt-title');
    title.addEventListener('input', () => { this._applyParse(false); this._scheduleDraft(); this.sync(); });
    title.addEventListener('blur', () => { this._applyParse(true); this.sync(); });

    // Description + subtasks.
    document.getElementById('nt-desc').addEventListener('input', (e) => { this.description = e.target.value; });
    const subIn = document.getElementById('nt-subtask-input');
    subIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._addSubtask(); } });
    const subAdd = document.getElementById('nt-subtask-add');
    if (subAdd) subAdd.addEventListener('click', () => this._addSubtask());

    // Pickers.
    this._bindPick('company', () => this._companyItems(), (v) => { this.S.company = v; this._afterCompany(); this._lockField('company'); }, false);
    this._bindPick('assignee', () => this._assigneeItems(), (v) => { this._toggleWho(v); this._lockField('assignees'); }, true);
    this._bindPick('type', () => this._typeItems(), (v) => { this.S.type = v; this.sync('type'); }, false);
    this._bindPick('status', () => this._statusItems(), (v) => { this.S.status = v; this.sync(); }, false);
    this._bindPick('label', () => this._labelItems(), (v) => { this.S.label = v || null; this.sync('lab'); }, false);
    this._bindPick('project', () => this._projectItems(), (v) => { this.S.project = v || null; this.sync('proj'); }, false);
    this._bindPick('remind', () => this._remindItems(), (v) => { this.S.remind = v; this.sync('rem'); }, false);
    this._bindPick('watch', () => this._watchItems(), (v) => { this._toggleWatcher(v); }, true);
    this._bindPick('date', () => this._calMenu(), null, false);
    this._bindPick('time', () => this._timeMenu(), null, false);

    // Inline create-new (type / status / label / project) — orange row swaps to an input.
    this._bindCreateRow('type', (val) => this._createType(val));
    this._bindCreateRow('status', (val) => this._createStatus(val));
    this._bindCreateRow('label', (val) => this._createLabel(val));
    this._bindCreateRow('project', (val) => this._createProject(val));

    // Calendar interactions (delegated on the date menu).
    const dateMenu = document.getElementById('nt-menu-date');
    dateMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const nav = e.target.closest('[data-cal]');
      if (nav) { this._calM += (nav.dataset.cal === 'next' ? 1 : -1); if (this._calM < 0) { this._calM = 11; this._calY--; } if (this._calM > 11) { this._calM = 0; this._calY++; } this._reopen('date', () => this._calMenu()); return; }
      const day = e.target.closest('[data-day]');
      if (day) { this.S.date = day.dataset.day; this._lockField('due'); this._closeMenus(); this.sync('due'); }
    });
    const timeMenu = document.getElementById('nt-menu-time');
    timeMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = e.target.closest('[data-time]');
      if (t) { this.S.time = t.dataset.time; this._lockField('dueTime'); this._closeMenus(); this.sync('due'); }
    });

    // Priority segmented.
    document.getElementById('nt-seg-pri').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return; this._setPri(b.dataset.p);
    });

    // Preview card — dispatch chips + the Create button live here (re-rendered each sync).
    document.getElementById('nt-preview').addEventListener('click', (e) => {
      if (e.target.closest('#nt-create')) { this.submit(); return; }
      const t = e.target.closest('.dchip'); if (!t || t.disabled) return;
      const ch = t.dataset.ch;
      if (ch === 'wa' && !this._isHigh(this.S.pri)) return;
      this.S.channels[ch] = !this.S.channels[ch];
      this.sync();
    });

    // Watcher removable tags (delegated on the watchers row).
    document.getElementById('nt-watch-tags').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]'); if (!rm) return;
      e.stopPropagation();
      this._toggleWatcher(rm.dataset.rm);
    });

    // Outside-click closes menus.
    this._docClick = (e) => { if (!e.target.closest('.nt-f')) this._closeMenus(); };
    document.addEventListener('click', this._docClick);

    // Keyboard map.
    this._onKey = (e) => this._handleKey(e);
    document.addEventListener('keydown', this._onKey);
  }

  _bindPick(key, itemsFn, onPick, keepOpen) {
    const btn = document.getElementById('nt-pick-' + key);
    const menu = document.getElementById('nt-menu-' + key);
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleMenu(key, itemsFn); });
    menu.addEventListener('click', (e) => {
      if (e.target.closest('.nt-createnew') || e.target.closest('.nt-newinput')) return; // handled by _bindCreateRow
      const it = e.target.closest('[data-v]');
      if (!it || it.disabled) { e.stopPropagation(); return; }
      e.stopPropagation();
      if (onPick) onPick(it.dataset.v);
      if (keepOpen) this._reopen(key, itemsFn); else this._closeMenus();
    });
  }
  _bindCreateRow(key, create) {
    const menu = document.getElementById('nt-menu-' + key);
    if (!menu) return;
    menu.addEventListener('click', (e) => {
      // "+ Create new …" row → swap the menu to an inline name input (pro1 behavior).
      if (e.target.closest('[data-createnew]')) {
        e.stopPropagation();
        menu.innerHTML = `${this._menuHead('NEW ' + key.toUpperCase())}
          <div class="nt-newinput"><input placeholder="Name the ${key}…" maxlength="32" autocomplete="off" /><button data-add type="button">Add</button></div>`;
        const inp = menu.querySelector('.nt-newinput input');
        if (inp) inp.focus();
        return;
      }
      if (e.target.closest('[data-add]')) {
        e.stopPropagation();
        const inp = menu.querySelector('.nt-newinput input');
        const val = inp && inp.value.trim();
        if (val) create(val);
      }
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.nt-newinput input')) {
        e.preventDefault(); const val = e.target.value.trim(); if (val) create(val);
      }
    });
  }

  /* ---------------- state mutations ---------------- */
  _afterCompany() {
    // Re-scope type → status to the new company.
    const types = App.taxonomy.activeTypes(this.S.company);
    if (!types.some(t => t.key === this.S.type)) this.S.type = (types[0] || { key: 'admin' }).key;
    const statuses = App.taxonomy.activeStatuses(this.S.company, this.S.type);
    if (!statuses.some(s => s.key === this.S.status)) this.S.status = App.taxonomy.defaultStatus(this.S.company, this.S.type);
    // Re-scope assignees/watchers/project to the new company's people.
    const allowed = new Set(this._peopleFor(this.S.company).map(p => p.id));
    this.S.whos = this.S.whos.filter(w => allowed.has(w));
    if (!this.S.whos.length) this.S.whos = [this.currentUser];
    this.watchers = this.watchers.filter(w => allowed.has(w));
    const _proj = App.directory.project(this.S.project);
    if (this.S.project && _proj && _proj.companyId !== this.S.company) this.S.project = null;
    this.sync('co');
  }
  _toggleWho(id) {
    const i = this.S.whos.indexOf(id);
    if (i >= 0) { if (this.S.whos.length > 1) this.S.whos.splice(i, 1); }
    else this.S.whos.push(id);
    this.sync('who');
  }
  _toggleWatcher(id) {
    if (this.S.whos.includes(id)) return;
    const i = this.watchers.indexOf(id);
    if (i >= 0) this.watchers.splice(i, 1); else this.watchers.push(id);
    this.sync('wat');
  }
  _setPri(p) {
    this.S.pri = p;
    this._lockField('priority');
    if (!this._isHigh(p)) this.S.channels.wa = false;
    else if (!this.S.channels.wa) this.S.channels.wa = true; // auto-arm on high+
    this.sync('pri');
  }
  _addSubtask() {
    const inp = document.getElementById('nt-subtask-input');
    const v = inp.value.trim();
    if (!v) return;
    if (this.subtasks.length >= (App.validate.LIMITS.subtasks || 50)) return;
    this.subtasks.push(v.slice(0, App.validate.LIMITS.title || 200));
    inp.value = ''; inp.focus();
    this._renderSubtasks(); this.sync('sub');
  }
  _renderSubtasks() {
    const list = document.getElementById('nt-subtasks');
    list.innerHTML = '';
    this.subtasks.forEach((text, i) => {
      const row = document.createElement('div');
      row.className = 'nt-subitem';
      row.innerHTML = `<span class="nt-sub-box"></span><span class="nt-subtext"></span><button class="nt-subdel" type="button" aria-label="Remove step"><i class="ti ti-x"></i></button>`;
      row.querySelector('.nt-subtext').textContent = text;
      row.querySelector('.nt-subdel').addEventListener('click', () => { this.subtasks.splice(i, 1); this._renderSubtasks(); this.sync('sub'); });
      list.appendChild(row);
    });
  }
  async _createStatus(val) {
    try {
      await this.controller.addStatus(this.S.company, this.S.type, val, '#8f867b');
      const exists = App.taxonomy.activeStatuses(this.S.company, this.S.type).find(s => s.label.toLowerCase() === val.toLowerCase());
      if (exists) this.S.status = exists.key;
    } catch (e) { /* noop */ }
    this._closeMenus(); this._flash('✓ status created → ' + val); this.sync();
  }
  async _createType(val) {
    try {
      await this.controller.addType(this.S.company, val, '#8f867b');
      const newKey = val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('type_' + Date.now());
      const exists = App.taxonomy.activeTypes(this.S.company).find(t => t.label.toLowerCase() === val.toLowerCase());
      this.S.type = (exists && exists.key) || newKey;
      this.S.status = App.taxonomy.defaultStatus(this.S.company, this.S.type);
    } catch (e) { /* noop */ }
    this._closeMenus(); this._flash('✓ type created → ' + val); this.sync('type');
  }
  _createLabel(val) {
    // Optimistically add to the in-memory taxonomy so it appears immediately.
    // NOTE: server-side persistence goes through the admin taxonomy path (wired
    // in a follow-up); for now this is an in-session label.
    try {
      const list = App.taxonomy.activeLabels(this.S.company);
      if (!list.some(l => l.label.toLowerCase() === val.toLowerCase())) {
        const key = val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('lbl_' + list.length);
        (App.TASK_LABELS = App.TASK_LABELS || {})[key] = { id: key, label: val };
        this.S.label = key;
      }
    } catch (e) { /* noop */ }
    this._closeMenus(); this._flash('✓ label created → ' + val); this.sync('lab');
  }
  _createProject(val) {
    // Auto-caps the project name on save (this inline path calls the data store
    // directly rather than controller.createProject, so it needs its own upper()).
    val = App.utils.upper(val);
    const row = { name: val, company_id: this.S.company };
    if (this.controller.dataStore && this.controller.dataStore.createProject) {
      Promise.resolve(this.controller.dataStore.createProject(row)).then((res) => {
        if (res && res.id) {
          App.projects = App.projects || {};
          App.projects[res.id] = { id: res.id, name: val, companyId: this.S.company, color: '', status: 'active' };
          this.S.project = res.id; this.sync('proj');
        }
      }).catch(() => {});
    }
    this._closeMenus(); this._flash('✓ project created → ' + val); this.sync('proj');
  }

  /* ---------------- title parser ---------------- */
  _parseCtx(atEnd) {
    return {
      atEnd: !!atEnd,
      today: App.utils.todayISO(0),
      team: this._peopleFor(this.S.company).map(p => ({ id: p.id, name: p.name })),
      companies: this._companyChoices().ids.map(id => ({ id, label: (App.directory.company(id) || { label: id }).label })),
    };
  }
  _applyParse(atEnd) {
    const el = document.getElementById('nt-title');
    if (!el || !App.parseTaskTitle) return;
    const r = App.parseTaskTitle(el.value, this._parseCtx(atEnd));
    if (!r.hits.length) return;
    const p = r.patches;
    if (p.addWhos) { p.addWhos.forEach(id => { if (!this.S.whos.includes(id)) this.S.whos.push(id); }); this._userSet.add('assignees'); this._aiSet.delete('assignees'); }
    if (p.company) { this.S.company = p.company; this._afterCompany(); this._userSet.add('company'); this._aiSet.delete('company'); }
    if (p.pri) { this.S.pri = p.pri; this._userSet.add('priority'); this._aiSet.delete('priority'); }
    if (p.date) { this.S.date = p.date; this._userSet.add('due'); this._aiSet.delete('due'); }
    if (p.time) { this.S.time = p.time; this._userSet.add('dueTime'); this._aiSet.delete('dueTime'); }
    el.value = r.cleanTitle + (atEnd ? '' : ' ');
    this._flash('✓ ' + r.hits.map(h => `${h.kind} → ${h.label}`).join(' · '));
    r.hits.forEach(h => this._glow('nt-pick-' + this._hitToField(h.kind)));
    this.sync(this._hitToKey(r.hits[0].kind));
  }
  // A user/token change to a field: never let the AI touch it again, and drop
  // any ✨ marker it had.
  _lockField(key) { if (this._userSet) { this._userSet.add(key); this._aiSet.delete(key); } }

  // Small "AI" marker appended to the label of a field the AI filled.
  _aiTag(key) { return this._aiSet && this._aiSet.has(key) ? '<span class="nt-ai" title="Filled by AI — edit to override">AI</span>' : ''; }

  // Debounced natural-language draft. Called on each title input; fires ~800ms
  // after typing stops, only when the sentence is substantial and changed.
  _scheduleDraft() {
    if (!this._draftClient) return;
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => {
      const el = document.getElementById('nt-title');
      const text = (el && el.value ? el.value : '').trim();
      if (!App.TaskDraftClient.shouldRequest(text, this._draftLast, {})) return;
      this._draftLast = text;
      const ctx = this._parseCtx(false);
      this._draftClient.fetchDraft({ text, team: ctx.team, companies: ctx.companies, today: ctx.today })
        .then(({ draft }) => { if (draft) this._applyAiDraft(draft); });
    }, 800);
  }

  // Apply the validated draft to fields the user/token parser hasn't set.
  _applyAiDraft(draft) {
    const { apply, aiFilled } = App.TaskDraftClient.mergeDraftIntoState(draft, this._userSet);
    if (!aiFilled.length) return;
    // Company first: it re-scopes the assignee roster.
    if ('company' in apply) { this.S.company = apply.company; this._afterCompany(); this._aiSet.add('company'); }
    if ('assignees' in apply) {
      const roster = new Set(this._peopleFor(this.S.company).map(p => p.id));
      const valid = apply.assignees.filter(id => roster.has(id));
      if (valid.length) { this.S.whos = valid; this._aiSet.add('assignees'); }
    }
    if ('priority' in apply) { this.S.pri = apply.priority; this._aiSet.add('priority'); }
    if ('due' in apply) { this.S.date = apply.due; this._aiSet.add('due'); }
    if ('dueTime' in apply) { this.S.time = apply.dueTime; this._aiSet.add('dueTime'); }
    this.sync();
  }

  _hitToField(kind) { return { assignee: 'assignee', company: 'company', pri: 'pri', date: 'date', time: 'time' }[kind] || ''; }
  _hitToKey(kind) { return { assignee: 'who', company: 'co', pri: 'pri', date: 'due', time: 'due' }[kind]; }
  _flash(msg) {
    const el = document.getElementById('nt-flash');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => el.classList.remove('show'), 1600);
  }
  _glow(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('glow');
    setTimeout(() => el.classList.remove('glow'), 1300);
  }

  /* ---------------- keyboard ---------------- */
  _handleKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this.submit(); return; }
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/^(INPUT|TEXTAREA)$/.test(tag)) return;
    if (e.key === 'Escape') { this._closeMenus(); return; }
    const map = { c: 'company', a: 'assignee', l: 'label', d: 'date' };
    const k = e.key.toLowerCase();
    if (k === 'p') { e.preventDefault(); const list = this._priList(); const i = list.indexOf(this.S.pri); this._setPri(list[(i + 1) % list.length]); return; }
    if (map[k]) {
      e.preventDefault();
      const fn = { company: () => this._companyItems(), assignee: () => this._assigneeItems(), label: () => this._labelItems(), date: () => this._calMenu() }[map[k]];
      this._toggleMenu(map[k], fn);
    }
  }

  /* ---------------- sync (single source of truth) ---------------- */
  sync(changedKey) {
    if (!this.S) return;
    // Invariants.
    this.watchers = this.watchers.filter(w => !this.S.whos.includes(w));
    const statuses = App.taxonomy.activeStatuses(this.S.company, this.S.type);
    if (statuses.length && !statuses.some(s => s.key === this.S.status)) this.S.status = App.taxonomy.defaultStatus(this.S.company, this.S.type);
    if (!this._isHigh(this.S.pri)) this.S.channels.wa = false;

    // Priority segmented active.
    document.querySelectorAll('#nt-seg-pri button').forEach(b => b.classList.toggle('on', b.dataset.p === this.S.pri));
    const priMark = document.getElementById('nt-ai-pri');
    if (priMark) priMark.innerHTML = this._aiTag('priority');

    // Picker button labels (pro1: company square, status/label dots, folder/cal/clock/bell icons).
    this._setPickLabel('company', (App.directory.company(this.S.company) || { label: this.S.company }).label, { square: this._companyColor(this.S.company) });
    this._setAssigneeLabel();
    this._setPickLabel('type', App.taxonomy.typeLabel(this.S.company, this.S.type));
    this._setPickLabel('status', App.taxonomy.statusLabel(this.S.company, this.S.type, this.S.status), { swatch: this._statusColor() });
    this._setPickLabel('label', this.S.label ? App.taxonomy.labelLabel(this.S.company, this.S.label) : 'None', this.S.label ? { swatch: this._labelColor() } : { placeholder: true });
    this._setPickLabel('project', App.directory.project(this.S.project) ? App.directory.project(this.S.project).name : 'No project', this.S.project ? { icon: 'ti-folder' } : { icon: 'ti-folder', placeholder: true });
    this._setPickLabel('date', this._fmtDateShort(this.S.date), this.S.date ? { icon: 'ti-calendar-event' } : { icon: 'ti-calendar-event', placeholder: true });
    this._setPickLabel('time', this._fmtTime(this.S.time), this.S.time ? { icon: 'ti-clock' } : { icon: 'ti-clock', placeholder: true });
    this._setPickLabel('remind', this._reminderText(), { icon: 'ti-bell' });
    this._renderWatchTags();

    // Preview card owns the Create button + its disabled state.
    this._renderPreview();
  }

  _statusColor() {
    const s = App.taxonomy.activeStatuses(this.S.company, this.S.type).find(x => x.key === this.S.status);
    return (s && s.color) || '#888780';
  }
  _labelColor() {
    const l = App.taxonomy.activeLabels(this.S.company).find(x => x.key === this.S.label);
    return (l && l.color) || '#888780';
  }

  _setPickLabel(key, text, opts = {}) {
    const btn = document.getElementById('nt-pick-' + key);
    if (!btn) return;
    const val = btn.querySelector('.nt-pick-val');
    val.classList.toggle('ph', !!opts.placeholder);
    let lead = '';
    if (opts.square) lead = `<span class="nt-sq" style="background:${opts.square}"></span>`;
    else if (opts.swatch) lead = `<span class="nt-dot" style="background:${opts.swatch}"></span>`;
    else if (opts.icon) lead = `<i class="ti ${opts.icon}"></i>`; // opts.icon is the FULL ti-* class — the icon-subset scanner needs whole literals at call sites
    const aiKey = { company: 'company', date: 'due', time: 'dueTime' }[key];
    const tag = aiKey ? this._aiTag(aiKey) : '';
    val.innerHTML = lead + `<span class="nt-pick-txt">${App.utils.escapeHtml(text || '')}</span>` + tag;
  }
  _setAssigneeLabel() {
    const btn = document.getElementById('nt-pick-assignee');
    if (!btn) return;
    const roster = this._peopleFor(this.S.company);
    const people = this.S.whos.map(id => (roster.find(p => p.id === id) || App.directory.person(id) || { name: id, color: '#444441' }));
    const val = btn.querySelector('.nt-pick-val');
    val.classList.toggle('ph', !people.length);
    if (!people.length) { val.innerHTML = '<span class="nt-pick-txt">Assign…</span>'; return; }
    const avatars = people.slice(0, 3).map(p => `<span class="nt-mini stack" style="background:${p.color || '#444441'}">${App.utils.escapeHtml((p.name || '?').slice(0, 2).toUpperCase())}</span>`).join('');
    const label = people.length === 1 ? people[0].name : `${people[0].name} +${people.length - 1}`;
    val.innerHTML = avatars + `<span class="nt-pick-txt">${App.utils.escapeHtml(label)}</span>` + this._aiTag('assignees');
  }
  _renderWatchTags() {
    const box = document.getElementById('nt-watch-tags');
    if (!box) return;
    box.innerHTML = this.watchers.map(id => {
      const p = App.directory.person(id) || { name: id, color: '#444441' };
      const init = App.utils.escapeHtml((p.name || '?').slice(0, 2).toUpperCase());
      return `<span class="nt-wtag"><span class="nt-mini" style="background:${p.color || '#444441'}">${init}</span>${App.utils.escapeHtml(p.name)}<button type="button" data-rm="${id}" aria-label="Remove watcher"><i class="ti ti-x"></i></button></span>`;
    }).join('');
  }
  _fmtDateShort(iso) {
    if (!iso) return 'Pick a date';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /* ---------------- preview card (pro1 "Task Preview") ---------------- */
  _renderPreview() {
    const el = document.getElementById('nt-preview');
    if (!el) return;
    const esc = App.utils.escapeHtml;
    const roster = this._peopleFor(this.S.company);
    const people = this.S.whos.map(id => (roster.find(p => p.id === id) || App.directory.person(id) || { name: id, color: '#444441' }));
    const title = ((document.getElementById('nt-title') || {}).value || '').trim();
    const no = (this.woNumber === null || this.woNumber === undefined) ? '—' : 'QH-' + String(this.woNumber).padStart(4, '0');

    const coLabel = (App.directory.company(this.S.company) || { label: this.S.company }).label.replace(/^Quest\s+/, '');
    const priText = { low: 'LOW', medium: 'MED', high: 'HIGH', critical: 'CRITICAL' }[this.S.pri] || String(this.S.pri).toUpperCase();
    const priCls = { low: 'low', medium: 'med', high: 'high', critical: 'critical' }[this.S.pri] || 'low';
    const dueTxt = this.S.date ? (this._fmtDateShort(this.S.date).toUpperCase() + (this.S.time ? ' · ' + this._fmtTime(this.S.time) : '')) : '';

    const av = (p, stacked) => `<span class="nt-mini${stacked ? ' stack' : ''}" style="background:${p.color || '#444441'}">${esc((p.name || '?').slice(0, 2).toUpperCase())}</span>`;
    const stack = people.slice(0, 3).map(p => av(p, true)).join('');
    const whoLabel = people.length === 1 ? esc(people[0].name) : `${esc(people[0].name)} +${people.length - 1}`;

    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    let rows = '';
    rows += row('COMPANY', `<span class="nt-pv-sq" style="background:${this._companyColor(this.S.company)}"></span>${esc(coLabel)}`);
    rows += row('ASSIGNED', people.length ? `${stack} ${whoLabel}` : '<span class="dim">—</span>');
    rows += row('PRIORITY', `<span class="nt-badge ${priCls}">${priText}</span>`);
    rows += row('DUE', dueTxt ? `<span class="mono">${esc(dueTxt)}</span>` : '<span class="dim">—</span>');
    rows += row('REMINDER', `<span class="mono">${esc(this._reminderText().toUpperCase())}</span>`);
    const labelTxt = this.S.label ? App.taxonomy.labelLabel(this.S.company, this.S.label) : null;
    if (labelTxt) rows += row('LABEL', esc(labelTxt));
    const projTxt = App.directory.project(this.S.project) ? App.directory.project(this.S.project).name : null;
    if (projTxt) rows += row('PROJECT', esc(projTxt));
    const typeTxt = App.taxonomy.typeLabel(this.S.company, this.S.type);
    if (typeTxt) rows += row('TYPE', esc(typeTxt));
    if (this.subtasks.length) rows += row('CHECKLIST', `<span class="mono">${this.subtasks.length} STEP${this.subtasks.length === 1 ? '' : 'S'}</span>`);
    if (this.watchers.length) rows += row('WATCHERS', this.watchers.map(id => av(App.directory.person(id) || { name: id }, false)).join(' '));

    const hi = this._isHigh(this.S.pri);
    if (!hi) this.S.channels.wa = false;
    const ch = this.S.channels;
    const dchip = (k, label, on, disabled) => `<button class="dchip ${on ? 'on' : ''}" data-ch="${k}" type="button" ${disabled ? 'disabled' : ''}>${label}</button>`;
    const dispatch = dchip('email', 'EMAIL', ch.email, false) + dchip('inapp', 'IN-APP', ch.inapp, false) +
      dchip('watchers', 'CC WATCHERS', ch.watchers, false) + dchip('wa', hi ? 'WHATSAPP' : 'WHATSAPP · HIGH ONLY', ch.wa, !hi);

    const ready = { title: !!title, who: this.S.whos.length > 0, due: !!this.S.date };
    const rrow = (ok, label) => `<div class="readyrow ${ok ? 'ok' : ''}"><span class="rst"></span>${label}</div>`;
    const readyHtml = rrow(ready.title, 'Title') + rrow(ready.who, 'Assignee') + rrow(ready.due, 'Due date');
    const allReady = ready.title && ready.who && ready.due;

    const chans = [ch.email && 'email', ch.inapp && 'in-app', ch.watchers && 'CC watchers', ch.wa && 'WhatsApp'].filter(Boolean);
    const who = people.length ? ((people[0].name || '').split(' ')[0] + (people.length > 1 ? ` +${people.length - 1}` : '')) : '—';
    const note = allReady ? `Dispatches to <b>${esc(who)}</b> via ${chans.join(' + ') || 'no channels'}.` : 'Finish the required fields to create.';

    el.innerHTML = `
      <div class="nt-pv-head">
        <div class="nt-pv-brand"><span class="nt-pv-q">Q</span><div><p class="nt-pv-name">Quest HQ</p><p class="nt-pv-sub">TASK PREVIEW</p></div></div>
        <div class="nt-pv-no"><p class="nt-pv-sub">NO.</p><p class="nt-pv-num">${no}</p></div>
      </div>
      <p class="nt-pv-title ${title ? '' : 'empty'}">${title ? esc(title) : 'Untitled task'}</p>
      <table class="nt-pv-table">${rows}</table>
      <div class="nt-pv-dispatch"><p class="nt-pv-lbl">DISPATCH VIA</p><div class="dchips">${dispatch}</div></div>
      <div class="nt-pv-ready"><p class="nt-pv-lbl">READY TO CREATE</p>${readyHtml}
        <button class="nt-create" id="nt-create" type="button" ${allReady ? '' : 'disabled'}>Create &amp; dispatch</button>
        <p class="nt-pv-note">${note}</p>
      </div>`;
  }

  /* ---------------- submit ---------------- */
  submit() {
    const el = document.getElementById('nt-title');
    if (!el) return;
    this._applyParse(true);
    const title = (document.getElementById('nt-title').value || '').trim();
    const raw = {
      title,
      description: this.description,
      whos: this.S.whos.slice(),
      type: this.S.type, label: this.S.label || 'none', company: this.S.company,
      due: this.S.date, dueTime: this.S.time || null,
      priority: this.S.pri, status: this.S.status,
      watchers: this.watchers.slice(),
      subtasks: this.subtasks.slice(),
    };
    let clean;
    try { clean = App.validate.newTask(raw); }
    catch (err) { this._showFieldError(err); return; }
    const payload = Object.assign({}, clean, {
      project: this.S.project || null,
      reminderAt: this._computeReminderAt(),
      reminderOffset: this.S.remind,
      notify: { email: this.S.channels.email, inapp: this.S.channels.inapp, watchers: this.S.channels.watchers, whatsapp: this.S.channels.wa },
    });
    this.dispatched = true;
    this._renderPreview();
    this.controller.createTask(payload);
    this.controller.closeNewTaskPage();
  }

  _showFieldError(err) {
    const map = { title: 'nt-title' };
    const id = map[err && err.field] || ('nt-pick-' + (err && err.field));
    const elx = id && document.getElementById(id);
    if (elx) { elx.focus && elx.focus(); if (App.Motion && App.Motion.shake) App.Motion.shake(elx); }
    const tv = this.controller && this.controller.toastView;
    if (tv && tv.show) tv.show({ title: 'Cannot create task', sub: (err && err.message) || 'Check the highlighted field.' });
  }
};
