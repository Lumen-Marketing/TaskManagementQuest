window.App = window.App || {};

/* Full-page premium "New task" work-order screen.
   Left column: boxed title (with live token parsing) + four numbered sections
   (01 Routing, 02 Schedule, 03 Detail, 04 Watchers). Right column: a dark
   work-order "ticket" (App.WorkOrderRail) that live-mirrors the form. Sticky
   footer with Cancel / Create. Everything is custom pickers (no native selects)
   so it can be fully themed via tokens.css; company selection threads a --accent
   var through the screen. Field ids stay `nt-*` where App.validate.newTask maps
   errors to inputs (title). Saves through controller.createTask (multi-assignee,
   whos[] ordered, lead = index 0). */
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
      remind: 'at', customN: 2, customU: 'hours',
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
    // Left→right ascending severity, from App.PRIORITIES.
    return ['low', 'medium', 'high', 'urgent', 'critical'].filter(k => (App.PRIORITIES || {})[k]);
  }
  _isHigh(p) {
    const o = (App.PRIORITIES[p] || {}).order;
    const hi = (App.PRIORITIES.high || {}).order;
    return o != null && hi != null && o <= hi;
  }

  /* ---------------- template ---------------- */
  template() {
    const me = App.PEOPLE[this.currentUser] || { name: 'you' };
    return `
      <div id="nt-root" class="wo-mode">
        <div class="nt-topbar">
          <button class="nt-back" data-action="close" type="button" aria-label="Back to tasks"><i class="ti ti-arrow-left"></i> Tasks</button>
          <span class="nt-crumb">/</span><span class="nt-tag">NEW TASK</span>
          <span class="nt-byline">Created by ${App.utils.escapeHtml(me.name)}</span>
        </div>

        <div class="nt-cols">
          <div class="nt-sheet">
            <div class="nt-titlebox">
              <input id="nt-title" class="nt-title-in" placeholder="What needs to get done?" autocomplete="off" aria-label="Task title" />
              <div id="nt-flash" class="nt-flash" aria-live="polite"></div>
              <div class="nt-hint">Type <b>@name</b> <b>#company</b> <b>!high</b> <b>tmrw</b> <b>9:30a</b> — fields fill as you write.</div>
            </div>

            <div class="nt-sec" data-sec="routing">
              <div class="nt-sec-h"><span class="nt-n">01</span><span class="nt-t">Routing</span><span class="nt-k">C · A · P</span></div>
              <div class="nt-frow">
                ${this._pickField('company', 'COMPANY', 'C')}
                ${this._pickField('assignee', 'ASSIGNEE', 'A')}
                ${this._priField()}
                ${this._pickField('type', 'TYPE', '')}
                ${this._pickField('status', 'STATUS', '')}
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
                <div class="nt-f" id="nt-custom-wrap" style="display:none">
                  <label>CUSTOM REMINDER</label>
                  <div class="nt-cu-row">
                    <input type="number" id="nt-customN" min="1" max="99" value="2" />
                    ${this._pickInline('customU', 'hours before')}
                  </div>
                </div>
              </div>
            </div>

            <div class="nt-sec" data-sec="detail">
              <div class="nt-sec-h"><span class="nt-n">03</span><span class="nt-t">Detail</span></div>
              <textarea id="nt-desc" class="nt-desc" placeholder="Add context, links, scope…" aria-label="Description"></textarea>
              <div class="nt-chkrow">
                <span class="nt-plus">+</span>
                <input id="nt-subtask-input" placeholder="Add a checklist step, press Enter" />
              </div>
              <div class="nt-sublist" id="nt-subtasks"></div>
            </div>

            <div class="nt-sec" data-sec="watchers">
              <div class="nt-sec-h"><span class="nt-n">04</span><span class="nt-t">Watchers</span></div>
              <div class="nt-frow">
                ${this._pickField('watch', 'WATCHERS', '')}
              </div>
            </div>
          </div>

          <div class="nt-rail" id="nt-rail"></div>
        </div>

        <div class="nt-foot">
          <span class="nt-legend"><b>C</b> company · <b>A</b> assignee · <b>P</b> priority · <b>D</b> due · <b>⌘↵</b> create</span>
          <span class="nt-grow"></span>
          <button class="nt-btn-ghost" data-action="close" type="button">Cancel</button>
          <button class="nt-btn-create" id="nt-create" type="button" disabled>Create &amp; dispatch <span class="k">⌘↵</span></button>
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
  _pickInline(key, label) {
    return `<div class="nt-f2">
      <button class="nt-pick" id="nt-pick-${key}" type="button"><span class="nt-pick-val">${label}</span><svg class="nt-car" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
      <div class="nt-menu" id="nt-menu-${key}"></div>
    </div>`;
  }
  _priField() {
    return `<div class="nt-f"><label>PRIORITY<span class="nt-kk">P</span></label>
      <div class="nt-seg" id="nt-seg-pri">${this._priList().map(k =>
        `<button type="button" data-p="${k}">${App.utils.escapeHtml(App.PRIORITIES[k].label)}</button>`).join('')}</div>
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
  _companyItems() {
    return this._companyChoices().ids.map(id => {
      const c = App.COMPANIES[id] || { label: id };
      const sel = this.S.company === id;
      return `<button class="nt-mitem" data-v="${id}"><span class="nt-dot" style="background:${this._companyColor(id)}"></span>${App.utils.escapeHtml(c.label)}${sel ? '<span class="nt-check">✓</span>' : ''}</button>`;
    }).join('');
  }
  _assigneeItems() {
    return this._peopleFor(this.S.company).map(p => {
      const on = this.S.whos.includes(p.id);
      const sub = p.position || (p.role && App.ROLES && App.ROLES[p.role] ? App.ROLES[p.role].label : p.role);
      return `<button class="nt-mitem" data-v="${p.id}"><span class="nt-mini" style="background:${p.color || 'var(--ink-3)'}">${App.utils.escapeHtml((p.name || '?').slice(0, 2).toUpperCase())}</span>${App.utils.escapeHtml(p.name)}${on ? '<span class="nt-check">✓</span>' : (sub ? `<small>${App.utils.escapeHtml(sub)}</small>` : '')}</button>`;
    }).join('');
  }
  _typeItems() {
    const list = App.taxonomy.activeTypes(this.S.company);
    return (list.length ? list : [{ key: 'admin', label: 'Admin' }]).map(t =>
      `<button class="nt-mitem" data-v="${t.key}">${App.utils.escapeHtml(t.label)}${this.S.type === t.key ? '<span class="nt-check">✓</span>' : ''}</button>`).join('');
  }
  _statusItems() {
    const list = App.taxonomy.activeStatuses(this.S.company, this.S.type);
    if (!list.length) return `<div class="nt-mempty">No statuses for this type</div>`;
    return list.map(s =>
      `<button class="nt-mitem" data-v="${s.key}"><span class="nt-dot" style="background:${s.color || 'var(--ink-3)'}"></span>${App.utils.escapeHtml(s.label)}${this.S.status === s.key ? '<span class="nt-check">✓</span>' : ''}</button>`).join('');
  }
  _labelItems() {
    const list = App.taxonomy.activeLabels(this.S.company);
    const head = `<button class="nt-mitem" data-v="">None${!this.S.label ? '<span class="nt-check">✓</span>' : ''}</button>`;
    const rows = list.map(l =>
      `<button class="nt-mitem" data-v="${l.key}"><span class="nt-dot" style="background:${l.color || 'var(--ink-3)'}"></span>${App.utils.escapeHtml(l.label)}${this.S.label === l.key ? '<span class="nt-check">✓</span>' : ''}</button>`).join('');
    const create = `<div class="nt-mnew"><input placeholder="New label…" maxlength="24" /><button data-newlabel type="button">Create</button></div>`;
    return head + rows + create;
  }
  _projectItems() {
    const list = Object.values(App.projects || {}).filter(p => p.companyId === this.S.company);
    const head = `<button class="nt-mitem" data-v="">No project${!this.S.project ? '<span class="nt-check">✓</span>' : ''}</button>`;
    const rows = list.map(p =>
      `<button class="nt-mitem" data-v="${p.id}">${App.utils.escapeHtml(p.name)}${this.S.project === p.id ? '<span class="nt-check">✓</span>' : ''}</button>`).join('');
    const create = `<div class="nt-mnew"><input placeholder="New project…" maxlength="32" /><button data-newproject type="button">Create</button></div>`;
    return head + rows + create;
  }
  _remindItems() {
    const opts = { none: 'None', at: 'At due time', '1h': '1 hour before', '1d': '1 day before', morn: 'Morning of (7 AM)', custom: 'Custom…' };
    return Object.entries(opts).map(([k, v]) =>
      `<button class="nt-mitem" data-v="${k}">${v}${this.S.remind === k ? '<span class="nt-check">✓</span>' : ''}</button>`).join('');
  }
  _customUItems() {
    return ['minutes', 'hours', 'days'].map(u =>
      `<button class="nt-mitem" data-v="${u}">${u} before${this.S.customU === u ? '<span class="nt-check">✓</span>' : ''}</button>`).join('');
  }
  _watchItems() {
    return this._peopleFor(this.S.company).map(p => {
      const assigned = this.S.whos.includes(p.id);
      const on = this.watchers.includes(p.id);
      return `<button class="nt-mitem" data-v="${p.id}" ${assigned ? 'disabled' : ''}><span class="nt-mini" style="background:${p.color || 'var(--ink-3)'}">${App.utils.escapeHtml((p.name || '?').slice(0, 2).toUpperCase())}</span>${App.utils.escapeHtml(p.name)}${on ? '<span class="nt-check">✓</span>' : `<small>${assigned ? 'assigned' : (p.role || '')}</small>`}</button>`;
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
    let rows = `<button class="nt-mitem" data-time="">No time${!this.S.time ? '<span class="nt-check">✓</span>' : ''}</button>`;
    for (let mins = 6 * 60; mins <= 19 * 60 + 30; mins += 30) {
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      const v = `${hh}:${mm}`;
      const label = this._fmtTime(v);
      rows += `<button class="nt-mitem" data-time="${v}">${label}${this.S.time === v ? '<span class="nt-check">✓</span>' : ''}</button>`;
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
    if (this.S.remind === 'custom') {
      const n = this.S.customN, u = this.S.customU;
      const unit = n == 1 ? u.slice(0, -1) : u;
      return `${n} ${unit} before`;
    }
    return { none: 'None', at: 'At due time', '1h': '1 hour before', '1d': '1 day before', morn: 'Morning of' }[this.S.remind] || '—';
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
    if (this.S.remind === 'morn') return `${this.S.date}T07:00`;
    let ms = 0;
    if (this.S.remind === '1h') ms = 3600e3;
    else if (this.S.remind === '1d') ms = 864e5;
    else if (this.S.remind === 'custom') {
      const n = Math.max(1, Number(this.S.customN) || 1);
      ms = n * ({ minutes: 60e3, hours: 3600e3, days: 864e5 }[this.S.customU] || 3600e3);
    }
    return fmt(new Date(dueDt.getTime() - ms));
  }

  /* ---------------- events ---------------- */
  bindEvents() {
    const root = document.getElementById('nt-root');
    root.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => this.controller.closeNewTaskPage()));
    document.getElementById('nt-create').addEventListener('click', () => this.submit());

    // Title parsing.
    const title = document.getElementById('nt-title');
    title.addEventListener('input', () => { this._applyParse(false); this.sync(); });
    title.addEventListener('blur', () => { this._applyParse(true); this.sync(); });

    // Description + subtasks.
    document.getElementById('nt-desc').addEventListener('input', (e) => { this.description = e.target.value; });
    const subIn = document.getElementById('nt-subtask-input');
    subIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._addSubtask(); } });

    // Pickers.
    this._bindPick('company', () => this._companyItems(), (v) => { this.S.company = v; this._afterCompany(); }, false);
    this._bindPick('assignee', () => this._assigneeItems(), (v) => { this._toggleWho(v); }, true);
    this._bindPick('type', () => this._typeItems(), (v) => { this.S.type = v; this.sync('type'); }, false);
    this._bindPick('status', () => this._statusItems(), (v) => { this.S.status = v; this.sync(); }, false);
    this._bindPick('label', () => this._labelItems(), (v) => { this.S.label = v || null; this.sync('lab'); }, false);
    this._bindPick('project', () => this._projectItems(), (v) => { this.S.project = v || null; this.sync('proj'); }, false);
    this._bindPick('remind', () => this._remindItems(), (v) => { this.S.remind = v; this.sync('rem'); }, false);
    this._bindPick('customU', () => this._customUItems(), (v) => { this.S.customU = v; this.sync('rem'); }, false);
    this._bindPick('watch', () => this._watchItems(), (v) => { this._toggleWatcher(v); }, true);
    this._bindPick('date', () => this._calMenu(), null, false);
    this._bindPick('time', () => this._timeMenu(), null, false);

    // Inline create rows (label / project).
    this._bindCreateRow('label', 'newlabel', (val) => this._createLabel(val));
    this._bindCreateRow('project', 'newproject', (val) => this._createProject(val));

    // Calendar interactions (delegated on the date menu).
    const dateMenu = document.getElementById('nt-menu-date');
    dateMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const nav = e.target.closest('[data-cal]');
      if (nav) { this._calM += (nav.dataset.cal === 'next' ? 1 : -1); if (this._calM < 0) { this._calM = 11; this._calY--; } if (this._calM > 11) { this._calM = 0; this._calY++; } this._reopen('date', () => this._calMenu()); return; }
      const day = e.target.closest('[data-day]');
      if (day) { this.S.date = day.dataset.day; this._closeMenus(); this.sync('due'); }
    });
    const timeMenu = document.getElementById('nt-menu-time');
    timeMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = e.target.closest('[data-time]');
      if (t) { this.S.time = t.dataset.time; this._closeMenus(); this.sync('due'); }
    });

    // Custom reminder N.
    document.getElementById('nt-customN').addEventListener('input', (e) => { this.S.customN = Math.max(1, Number(e.target.value) || 1); this.sync('rem'); });

    // Priority segmented.
    document.getElementById('nt-seg-pri').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return; this._setPri(b.dataset.p);
    });

    // Dispatch tags live on the rail — delegated there.
    document.getElementById('nt-rail').addEventListener('click', (e) => {
      const t = e.target.closest('.dtag'); if (!t) return;
      const ch = t.dataset.ch;
      if (ch === 'wa' && !this._isHigh(this.S.pri)) return;
      this.S.channels[ch] = !this.S.channels[ch];
      this.sync();
    });

    // Outside-click closes menus.
    this._docClick = (e) => { if (!e.target.closest('.nt-f') && !e.target.closest('.nt-f2')) this._closeMenus(); };
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
      if (e.target.closest('.nt-mnew')) return; // handled by _bindCreateRow
      const it = e.target.closest('[data-v]');
      if (!it || it.disabled) { e.stopPropagation(); return; }
      e.stopPropagation();
      if (onPick) onPick(it.dataset.v);
      if (keepOpen) this._reopen(key, itemsFn); else this._closeMenus();
    });
  }
  _bindCreateRow(key, flag, create) {
    const menu = document.getElementById('nt-menu-' + key);
    if (!menu) return;
    menu.addEventListener('click', (e) => {
      const btn = e.target.closest(`[data-${flag}]`);
      if (!btn) return;
      e.stopPropagation();
      const inp = menu.querySelector('.nt-mnew input');
      const val = inp && inp.value.trim();
      if (val) create(val);
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.nt-mnew input')) {
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
    if (this.S.project && App.projects[this.S.project] && App.projects[this.S.project].companyId !== this.S.company) this.S.project = null;
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
      row.innerHTML = `<span class="nt-subtext"></span><button class="nt-subdel" type="button" aria-label="Remove step">×</button>`;
      row.querySelector('.nt-subtext').textContent = text;
      row.querySelector('.nt-subdel').addEventListener('click', () => { this.subtasks.splice(i, 1); this._renderSubtasks(); this.sync('sub'); });
      list.appendChild(row);
    });
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
    // Reuse the existing project create path.
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
      companies: this._companyChoices().ids.map(id => ({ id, label: (App.COMPANIES[id] || { label: id }).label })),
    };
  }
  _applyParse(atEnd) {
    const el = document.getElementById('nt-title');
    if (!el || !App.parseTaskTitle) return;
    const r = App.parseTaskTitle(el.value, this._parseCtx(atEnd));
    if (!r.hits.length) return;
    const p = r.patches;
    if (p.addWhos) p.addWhos.forEach(id => { if (!this.S.whos.includes(id)) this.S.whos.push(id); });
    if (p.company) { this.S.company = p.company; this._afterCompany(); }
    if (p.pri) this.S.pri = p.pri;
    if (p.date) this.S.date = p.date;
    if (p.time) this.S.time = p.time;
    el.value = r.cleanTitle + (atEnd ? '' : ' ');
    this._flash('✓ ' + r.hits.map(h => `${h.kind} → ${h.label}`).join(' · '));
    r.hits.forEach(h => this._glow('nt-pick-' + this._hitToField(h.kind)));
    this.sync(this._hitToKey(r.hits[0].kind));
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

    // Accent var.
    const root = document.getElementById('nt-root');
    if (root) root.style.setProperty('--accent', this._companyColor(this.S.company));

    // Priority segmented active.
    document.querySelectorAll('#nt-seg-pri button').forEach(b => b.classList.toggle('on', b.dataset.p === this.S.pri));

    // Custom reminder visibility.
    const cw = document.getElementById('nt-custom-wrap');
    if (cw) cw.style.display = this.S.remind === 'custom' ? '' : 'none';

    // Picker button labels.
    this._setPickLabel('company', (App.COMPANIES[this.S.company] || { label: this.S.company }).label, this._companyColor(this.S.company));
    this._setAssigneeLabel();
    this._setPickLabel('type', App.taxonomy.typeLabel(this.S.company, this.S.type));
    this._setPickLabel('status', App.taxonomy.statusLabel(this.S.company, this.S.type, this.S.status));
    this._setPickLabel('label', this.S.label ? App.taxonomy.labelLabel(this.S.company, this.S.label) : 'None', null, !this.S.label);
    this._setPickLabel('project', this.S.project && App.projects[this.S.project] ? App.projects[this.S.project].name : 'No project', null, !this.S.project);
    this._setPickLabel('date', this._fmtDateShort(this.S.date));
    this._setPickLabel('time', this._fmtTime(this.S.time), null, !this.S.time);
    this._setPickLabel('remind', this._reminderText());
    this._setWatchLabel();
    const cuBtn = document.querySelector('#nt-pick-customU .nt-pick-val');
    if (cuBtn) cuBtn.textContent = this.S.customU + ' before';

    // Rail.
    this._renderRail(changedKey);

    // Readiness.
    const title = ((document.getElementById('nt-title') || {}).value || '').trim();
    const ready = { title: !!title, who: this.S.whos.length > 0, due: !!this.S.date };
    const btn = document.getElementById('nt-create');
    if (btn) btn.disabled = !(ready.title && ready.who && ready.due);

    // Touched section nodes.
    this._markTouched();
  }

  _setPickLabel(key, text, swatch, placeholder) {
    const btn = document.getElementById('nt-pick-' + key);
    if (!btn) return;
    const val = btn.querySelector('.nt-pick-val');
    val.classList.toggle('ph', !!placeholder);
    val.innerHTML = (swatch ? `<span class="nt-dot" style="background:${swatch}"></span>` : '') + App.utils.escapeHtml(text || '');
  }
  _setAssigneeLabel() {
    const btn = document.getElementById('nt-pick-assignee');
    if (!btn) return;
    const roster = this._peopleFor(this.S.company);
    const people = this.S.whos.map(id => (roster.find(p => p.id === id) || App.PEOPLE[id] || { name: id, color: 'var(--ink-3)' }));
    const avatars = people.slice(0, 3).map(p => `<span class="nt-mini stack" style="background:${p.color || 'var(--ink-3)'}">${App.utils.escapeHtml((p.name || '?').slice(0, 2).toUpperCase())}</span>`).join('');
    const label = people.length === 1 ? people[0].name : `${people[0].name} +${people.length - 1}`;
    btn.querySelector('.nt-pick-val').innerHTML = avatars + `<span>${App.utils.escapeHtml(label)}</span>`;
  }
  _setWatchLabel() {
    const btn = document.getElementById('nt-pick-watch');
    if (!btn) return;
    const val = btn.querySelector('.nt-pick-val');
    if (!this.watchers.length) { val.classList.add('ph'); val.textContent = 'Add watchers…'; return; }
    val.classList.remove('ph');
    const people = this.watchers.map(id => App.PEOPLE[id] || { name: id, color: 'var(--ink-3)' });
    const avatars = people.slice(0, 3).map(p => `<span class="nt-mini stack" style="background:${p.color || 'var(--ink-3)'}">${App.utils.escapeHtml((p.name || '?').slice(0, 2).toUpperCase())}</span>`).join('');
    const label = people.length === 1 ? people[0].name : `${people[0].name} +${people.length - 1}`;
    val.innerHTML = avatars + `<span>${App.utils.escapeHtml(label)}</span>`;
  }
  _fmtDateShort(iso) {
    if (!iso) return 'Pick date';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  _railModel() {
    const roster = this._peopleFor(this.S.company);
    const people = this.S.whos.map(id => (roster.find(p => p.id === id) || App.PEOPLE[id] || { name: id }));
    const title = ((document.getElementById('nt-title') || {}).value || '').trim();
    return {
      woNumber: this.woNumber,
      title,
      company: { label: (App.COMPANIES[this.S.company] || { label: this.S.company }).label, color: this._companyColor(this.S.company) },
      assignees: people.map(p => ({ name: p.name, init: (p.name || '?').slice(0, 2).toUpperCase(), color: p.color || 'var(--ink-3)' })),
      priority: { key: this.S.pri, label: (App.PRIORITIES[this.S.pri] || { label: this.S.pri }).label },
      due: this._fmtDateShort(this.S.date).toUpperCase(),
      time: this.S.time ? this._fmtTime(this.S.time) : '',
      reminderText: this._reminderText(),
      label: this.S.label ? App.taxonomy.labelLabel(this.S.company, this.S.label) : null,
      project: this.S.project && App.projects[this.S.project] ? App.projects[this.S.project].name : null,
      subtaskCount: this.subtasks.length,
      watchers: this.watchers.map(id => (App.PEOPLE[id] || { name: id }).name),
      channels: this.S.channels,
      ready: { title: !!title, who: this.S.whos.length > 0, due: !!this.S.date },
      dispatched: this.dispatched,
    };
  }
  _renderRail(changedKey) {
    const el = document.getElementById('nt-rail');
    if (!el) return;
    el.innerHTML = App.WorkOrderRail.render(this._railModel());
    if (changedKey) {
      const line = el.querySelector(`.wo-line[data-k="${changedKey}"]`);
      if (line) { line.classList.remove('tick'); void line.offsetWidth; line.classList.add('tick'); }
    }
  }
  _markTouched() {
    // Light a section's node once anything in it differs from the empty defaults.
    const routing = this.S.whos.length > 1 || this.S.label || this.S.project || this.S.pri !== 'medium';
    const schedule = !!this.S.time || this.S.remind !== 'at';
    const detail = this.subtasks.length > 0 || this.description;
    const watchers = this.watchers.length > 0;
    const set = (sec, on) => { const s = document.querySelector(`.nt-sec[data-sec="${sec}"]`); if (s) s.classList.toggle('touched', !!on); };
    set('routing', routing); set('schedule', schedule); set('detail', detail); set('watchers', watchers);
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
      reminderOffset: this.S.remind === 'custom' ? `custom:${this.S.customN}:${this.S.customU}` : this.S.remind,
      notify: { email: this.S.channels.email, inapp: this.S.channels.inapp, watchers: this.S.channels.watchers, whatsapp: this.S.channels.wa },
    });
    this.dispatched = true;
    this._renderRail();
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
