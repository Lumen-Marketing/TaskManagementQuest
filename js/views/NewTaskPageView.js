window.App = window.App || {};

/* Full-page "New task" form. Replaces the old centered NewTaskModalView: same
   fields, validation, and createTask path, but rendered into the #newTaskWrap
   surface (driven by controller.uiState.creatingTask) so it reads as its own
   page — matching the redesigned task detail page. The modal-only extras
   (focus-trap, drag-resize, Ctrl+S size pinning, text zoom) are intentionally
   dropped; a full page doesn't need them. Field element IDs are kept as `nt-*`
   so App.validate.newTask's field→input error mapping is unchanged. */
App.NewTaskPageView = class NewTaskPageView {
  constructor({ controller, currentUser }) {
    this.controller = controller;
    this.currentUser = currentUser;
    this.wrap = document.getElementById('newTaskWrap');
    this.watchers = new Set();
    this.subtasks = [];

    // Render when the controller opens the page; tear down when it closes.
    App.EventBus.on('newtask:changed', (isOpen) => {
      if (isOpen) this.render(this.controller._newTaskPrefill || {});
      else this.teardown();
    });
  }

  teardown() {
    if (this.wrap) this.wrap.innerHTML = '';
  }

  render(prefill = {}) {
    if (!this.wrap) this.wrap = document.getElementById('newTaskWrap');
    if (!this.wrap) return;
    this.watchers = new Set();
    this.subtasks = [];
    this.wrap.innerHTML = this.template();

    if (prefill && prefill.due) {
      const dueEl = document.getElementById('nt-due');
      if (dueEl) dueEl.value = prefill.due;
    }

    this.bindEvents();
    // Pre-fill company + project when opened from a project detail's "New task".
    if (prefill && prefill.company) {
      const cs = document.getElementById('nt-company');
      if (cs) { cs.value = prefill.company; this._onCompanyChanged(prefill.company); }
    }
    if (prefill && prefill.project) this._setProject(prefill.project);
    this.renderWatcherChips();
    this.renderSubtaskChips();
    this.updateBidStatusRow();
    this.updateDelegationBanner();
    setTimeout(() => { const el = document.getElementById('nt-title'); if (el) el.focus(); }, 30);
    try { this.wrap.scrollTop = 0; window.scrollTo(0, 0); } catch (e) { /* noop */ }
  }

  /* The company the task defaults to, plus the list offered in the dropdown.
     Excludes the developer '*' sentinel; falls back to every company when the
     session has none scoped. */
  _companyChoices() {
    let ids = (this.controller.uiState.companies || []).filter(id => id !== '*');
    if (!ids.length) ids = Object.keys(App.COMPANIES || {});
    const cur = this.controller.uiState.currentCompany;
    const selected = (cur && cur !== '*') ? cur : ids[0];
    return { ids, selected };
  }

  _assigneeOptionsHtml(companyId, selectedId) {
    return App.utils.peopleInCompany(companyId, this.currentUser)
      .map(p => `<option value="${App.utils.escapeHtml(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${App.utils.escapeHtml(p.name)}</option>`)
      .join('');
  }

  /* Re-scope the assignee + watcher pickers to a newly chosen company. */
  _onCompanyChanged(companyId) {
    const sel = document.getElementById('nt-assignee');
    if (sel) {
      const people = App.utils.peopleInCompany(companyId, this.currentUser);
      const has = id => people.some(p => p.id === id);
      const next = has(sel.value) ? sel.value
        : (has(this.currentUser) ? this.currentUser : (people[0] && people[0].id) || '');
      sel.innerHTML = people.map(p => `<option value="${App.utils.escapeHtml(p.id)}" ${p.id === next ? 'selected' : ''}>${App.utils.escapeHtml(p.name)}</option>`).join('');
      const allowed = new Set(people.map(p => p.id));
      let pruned = false;
      this.watchers.forEach(w => { if (!allowed.has(w)) { this.watchers.delete(w); pruned = true; } });
      if (pruned) this.renderWatcherChips();
    }
    const pb = document.getElementById('nt-project');
    if (pb && pb.dataset.current && App.projects[pb.dataset.current] && App.projects[pb.dataset.current].companyId !== companyId) this._setProject(null);
    this.updateDelegationBanner();
  }

  /* Reflect the chosen (or cleared) project on the picker-trigger button. */
  _setProject(id) {
    const btn = document.getElementById('nt-project');
    if (!btn) return;
    const p = id && App.projects ? App.projects[id] : null;
    btn.dataset.current = id || '';
    btn.classList.toggle('projtag-empty', !p);
    btn.style.setProperty('--pc', p ? p.color : '');
    btn.innerHTML = p
      ? `<i class="ti ti-folder"></i>${App.utils.escapeHtml(p.name)}`
      : `<i class="ti ti-folder-plus"></i>No project`;
  }

  template() {
    const me = App.PEOPLE[this.currentUser];
    const { ids: companyIds, selected: selectedCompany } = this._companyChoices();
    const row = (label, inner, extra = '') => `
      <div class="detail-row ${extra}">
        <span class="label">${label}</span>
        ${inner}
      </div>`;
    return `
      <div class="tdp-form">
        <div class="tdp-head">
          <button class="detail-back" data-action="close" aria-label="Back to tasks" type="button"><i class="ti ti-arrow-left"></i> Tasks</button>
          <div class="tdp-title-row">
            <h1 class="tdp-title">New task</h1>
          </div>
          <div class="tdp-meta"><span class="tdp-meta-item"><i class="ti ti-user"></i>Created by you (${App.utils.escapeHtml(me.name)})</span></div>
        </div>

        <div class="tdp-grid tdp-form-grid">
          <aside class="tdp-col-left">
            <div class="tdp-card">
              <div class="tdp-card-title"><i class="ti ti-info-circle"></i> Details</div>
              ${row('Assignee', `<select id="nt-assignee">${this._assigneeOptionsHtml(selectedCompany, this.currentUser)}</select>`)}
              ${row('Type', `<select id="nt-type">${Object.entries(App.TASK_TYPES).map(([k, v]) => `<option value="${k}" ${k === 'admin' ? 'selected' : ''}>${App.utils.escapeHtml(v.label)}</option>`).join('')}</select>`)}
              <div class="detail-row hidden" id="nt-bid-status-row">
                <span class="label">Bid status</span>
                <select id="nt-bid-status">${Object.entries(App.BID_STATUSES).map(([k, v]) => `<option value="${k}" ${k === 'queue' ? 'selected' : ''}>${App.utils.escapeHtml(v.label)}</option>`).join('')}</select>
              </div>
              ${row('Label', `<select id="nt-label">${Object.entries(App.TASK_LABELS).map(([k, v]) => `<option value="${k}" ${k === 'roof' ? 'selected' : ''}>${App.utils.escapeHtml(v.label)}</option>`).join('')}</select>`)}
              ${row('Company', `<select id="nt-company">${companyIds.map(id => { const c = App.COMPANIES[id] || { label: id }; return `<option value="${id}" ${id === selectedCompany ? 'selected' : ''}>${App.utils.escapeHtml(c.label)}</option>`; }).join('')}</select>`)}
              ${row('Project', `<button type="button" id="nt-project" class="projtag projtag-btn projtag-empty" data-current="" aria-haspopup="listbox"><i class="ti ti-folder-plus"></i>No project</button>`)}
              ${row('Due', `<input type="date" id="nt-due" class="picker-input" value="${App.utils.todayISO(1)}" />`)}
              ${row('Time', `<input type="text" id="nt-time" inputmode="text" autocomplete="off" placeholder="e.g. 9:30 AM" />`)}
              ${row('Reminder', `<input type="datetime-local" id="nt-reminderAt" class="picker-input" />`)}
              ${row('Priority', `<select id="nt-priority">${Object.entries(App.PRIORITIES).map(([k, v]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${App.utils.escapeHtml(v.label)}</option>`).join('')}</select>`)}
              ${row('Status', `<select id="nt-status"><option value="todo" selected>Active</option><option value="pending">Pending</option><option value="hold">On hold</option></select>`)}
            </div>
          </aside>

          <div class="tdp-col-main">
            <div class="tdp-card">
              <div class="tdp-card-title">Task</div>
              <div class="field field-title">
                <input type="text" id="nt-title" placeholder="Lead Name / Task" aria-label="Task title" required autofocus />
              </div>
              <div class="field" style="margin-top:12px;">
                <div class="field-label">Description</div>
                <textarea id="nt-desc" placeholder="Add details, links, context…" aria-label="Description" rows="4" style="resize:vertical; width:100%;"></textarea>
              </div>
              <div id="nt-delegation-banner" class="delegation-banner hidden" style="margin-top:12px;">
                <i class="ti ti-send"></i>
                <span id="nt-delegation-text"></span>
              </div>
            </div>

            <div class="tdp-card">
              <div class="tdp-card-title">Subtasks <span class="field-optional">Optional</span></div>
              <div class="subtask-add-row">
                <input type="text" id="nt-subtask-input" maxlength="200" placeholder="Add a step and press Enter" />
                <button class="btn btn-sm" type="button" data-action="add-subtask">Add</button>
              </div>
              <div class="subtask-chip-list" id="nt-subtasks"></div>
            </div>

            <div class="tdp-card">
              <div class="tdp-card-title"><i class="ti ti-bell"></i> Notify on create</div>
              <div class="notify-box">
                <label class="notify-option">
                  <input type="checkbox" id="nt-notify-email" checked />
                  <i class="ti ti-mail"></i>
                  <span id="nt-notify-email-label">Email assignee</span>
                  <span class="email-hint" id="nt-notify-email-addr"></span>
                </label>
                <label class="notify-option">
                  <input type="checkbox" id="nt-notify-inapp" checked />
                  <i class="ti ti-app-window"></i>
                  <span>In-app notification</span>
                </label>
                <label class="notify-option">
                  <input type="checkbox" id="nt-notify-watchers" checked />
                  <i class="ti ti-users"></i>
                  <span>Also email watchers</span>
                </label>
                <label class="notify-option">
                  <input type="checkbox" id="nt-notify-whatsapp" />
                  <i class="ti ti-brand-whatsapp"></i>
                  <span>WhatsApp ping (urgent only)</span>
                </label>
              </div>
            </div>
          </div>

          <aside class="tdp-col-right">
            <div class="tdp-card">
              <div class="tdp-card-title"><i class="ti ti-users"></i> Watchers</div>
              <div class="watcher-picker">
                <div class="watcher-tags" id="nt-watchers"></div>
                <div class="watcher-dropdown hidden" id="nt-watcher-dropdown"></div>
              </div>
            </div>
          </aside>
        </div>

        <div class="tdp-form-foot">
          <span class="tdp-form-hint">Press <kbd>Ctrl ↵</kbd> to create</span>
          <div class="tdp-form-foot-btns">
            <button class="btn" data-action="close" type="button">Cancel</button>
            <button class="btn btn-primary tdp-create-btn" data-action="submit" type="button">Create &amp; notify</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.wrap.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => this.controller.closeNewTaskPage()));
    const submitBtn = this.wrap.querySelector('[data-action="submit"]');
    if (submitBtn) submitBtn.addEventListener('click', () => this.submit());

    this.wrap.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); this.submit(); }
    });

    document.getElementById('nt-assignee').addEventListener('change', () => this.updateDelegationBanner());
    document.getElementById('nt-type').addEventListener('change', () => this.updateBidStatusRow());
    document.getElementById('nt-company').addEventListener('change', (e) => this._onCompanyChanged(e.target.value));

    const projBtn = document.getElementById('nt-project');
    if (projBtn) projBtn.addEventListener('click', () => {
      App.projectPicker.open({
        anchor: projBtn,
        companyId: document.getElementById('nt-company').value,
        currentId: projBtn.dataset.current || null,
        onSelect: (id) => this._setProject(id),
      });
    });

    this.wrap.querySelector('[data-action="add-subtask"]').addEventListener('click', () => this.addSubtask());
    const subtaskInput = document.getElementById('nt-subtask-input');
    if (subtaskInput) subtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.addSubtask(); }
    });

    this.wrap.querySelectorAll('.picker-input').forEach(input => {
      input.addEventListener('click', () => { try { input.showPicker(); } catch (e) { /* unsupported / not user-activated */ } });
    });

    // Free-typed time, masked to a clean 12h display; converted to 24h on submit.
    const timeInput = document.getElementById('nt-time');
    if (timeInput) {
      timeInput.addEventListener('input', () => {
        const formatted = this._maskTime(timeInput.value);
        if (formatted !== timeInput.value) {
          timeInput.value = formatted;
          timeInput.setSelectionRange(formatted.length, formatted.length);
        }
      });
      timeInput.addEventListener('blur', () => {
        const parsed = this._parseTime(timeInput.value);
        if (parsed) timeInput.value = App.utils.formatClock(parsed);
      });
    }
  }

  // Live input mask: auto-insert the colon as digits are typed, expand a typed
  // "a"/"p" into " AM"/" PM". e.g. "230"->"2:30", "230p"->"2:30 PM".
  _maskTime(raw) {
    let s = String(raw == null ? '' : raw).toLowerCase();
    let ap = '';
    if (s.includes('p')) ap = ' PM';
    else if (s.includes('a')) ap = ' AM';
    const digits = s.replace(/\D/g, '').slice(0, 4);
    if (!digits) return ap ? digits + ap : '';
    let body;
    if (digits.length <= 2) body = digits;
    else if (digits.length === 3) body = digits.slice(0, 1) + ':' + digits.slice(1);
    else body = digits.slice(0, 2) + ':' + digits.slice(2);
    return body + ap;
  }

  // Parse a loosely-typed time into strict 24h "HH:MM", or null if unusable.
  _parseTime(raw) {
    let s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!s) return null;
    let ap = null;
    const apMatch = s.match(/\s*([ap])\.?\s*m\.?$/);
    if (apMatch) { ap = apMatch[1]; s = s.slice(0, apMatch.index).trim(); }
    let h, min = 0;
    if (s.includes(':')) {
      const parts = s.split(':');
      if (parts.length !== 2 || parts[1].length !== 2) return null;
      h = parseInt(parts[0], 10);
      min = parseInt(parts[1], 10);
    } else {
      if (!/^\d+$/.test(s)) return null;
      if (s.length <= 2) { h = parseInt(s, 10); min = 0; }
      else if (s.length === 3) { h = parseInt(s.slice(0, 1), 10); min = parseInt(s.slice(1), 10); }
      else if (s.length === 4) { h = parseInt(s.slice(0, 2), 10); min = parseInt(s.slice(2), 10); }
      else return null;
    }
    if (isNaN(h) || isNaN(min) || min > 59) return null;
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === 'p' && h !== 12) h += 12;
      if (ap === 'a' && h === 12) h = 0;
    } else if (h > 23) {
      return null;
    }
    return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  }

  updateBidStatusRow() {
    const r = document.getElementById('nt-bid-status-row');
    if (!r) return;
    const type = document.getElementById('nt-type').value;
    r.classList.toggle('hidden', type !== 'bid');
  }

  renderWatcherChips() {
    const watchersEl = document.getElementById('nt-watchers');
    const dropdown = document.getElementById('nt-watcher-dropdown');
    if (!watchersEl || !dropdown) return;
    watchersEl.innerHTML = '';

    this.watchers.forEach(id => {
      const p = App.PEOPLE[id];
      const chip = document.createElement('span');
      chip.className = 'watcher-tag';
      chip.innerHTML = `${App.utils.avatarHtml(p)}${App.utils.escapeHtml(p.name)} <i class="ti ti-x remove"></i>`;
      chip.querySelector('.remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.watchers.delete(id);
        this.renderWatcherChips();
      });
      watchersEl.appendChild(chip);
    });

    const addBtn = document.createElement('span');
    addBtn.className = 'watcher-add';
    addBtn.textContent = this.watchers.size ? '+ add' : '+ Add watcher';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const assigneeId = document.getElementById('nt-assignee').value;
      const companyId = document.getElementById('nt-company').value;
      dropdown.innerHTML = '';
      App.utils.peopleInCompany(companyId).filter(p => p.id !== assigneeId && !this.watchers.has(p.id)).forEach(p => {
        const item = document.createElement('div');
        item.className = 'watcher-dropdown-item';
        item.innerHTML = `${App.utils.avatarHtml(p)}${App.utils.escapeHtml(p.full)}`;
        item.addEventListener('click', () => {
          this.watchers.add(p.id);
          dropdown.classList.add('hidden');
          this.renderWatcherChips();
        });
        dropdown.appendChild(item);
      });
      if (dropdown.children.length === 0) {
        dropdown.innerHTML = '<div style="padding: 8px 10px; font-size: 11px; color: var(--ink-3);">No more people to add</div>';
      }
      dropdown.classList.toggle('hidden');
    });
    watchersEl.appendChild(addBtn);
  }

  addSubtask() {
    const input = document.getElementById('nt-subtask-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (this.subtasks.length >= App.validate.LIMITS.subtasks) {
      this._toast('Too many subtasks', `Max ${App.validate.LIMITS.subtasks} per task.`);
      return;
    }
    this.subtasks.push(text.slice(0, App.validate.LIMITS.title));
    input.value = '';
    input.focus();
    this.renderSubtaskChips();
  }

  renderSubtaskChips() {
    const list = document.getElementById('nt-subtasks');
    if (!list) return;
    list.innerHTML = '';
    this.subtasks.forEach((text, i) => {
      const chip = document.createElement('span');
      chip.className = 'subtask-chip';
      chip.innerHTML = `<i class="ti ti-circle"></i><span class="subtask-chip-text"></span><i class="ti ti-x remove"></i>`;
      chip.querySelector('.subtask-chip-text').textContent = text;
      chip.querySelector('.remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.subtasks.splice(i, 1);
        this.renderSubtaskChips();
      });
      list.appendChild(chip);
    });
  }

  updateDelegationBanner() {
    const assigneeId = document.getElementById('nt-assignee').value;
    const banner = document.getElementById('nt-delegation-banner');
    const emailAddr = document.getElementById('nt-notify-email-addr');
    const emailLabel = document.getElementById('nt-notify-email-label');
    if (assigneeId !== this.currentUser) {
      banner.classList.remove('hidden');
      document.getElementById('nt-delegation-text').textContent =
        `${App.PEOPLE[assigneeId].name} will see "Assigned by ${App.PEOPLE[this.currentUser].name}" on this task.`;
      emailLabel.textContent = `Email ${App.PEOPLE[assigneeId].name}`;
      emailAddr.textContent = App.PEOPLE[assigneeId].email;
    } else {
      banner.classList.add('hidden');
      emailLabel.textContent = 'Email assignee';
      emailAddr.textContent = '';
    }
  }

  submit() {
    if (!this.wrap || !document.getElementById('nt-title')) return; // already torn down
    const timeRaw = document.getElementById('nt-time').value.trim();
    const pendingSubtask = document.getElementById('nt-subtask-input');
    const subtasks = this.subtasks.slice();
    if (pendingSubtask && pendingSubtask.value.trim()) subtasks.push(pendingSubtask.value.trim());
    const rawPayload = {
      title: document.getElementById('nt-title').value,
      description: document.getElementById('nt-desc').value,
      assignee: document.getElementById('nt-assignee').value,
      type: document.getElementById('nt-type').value,
      label: document.getElementById('nt-label').value,
      bidStatus: document.getElementById('nt-bid-status').value,
      company: document.getElementById('nt-company').value,
      due: document.getElementById('nt-due').value,
      dueTime: timeRaw ? (this._parseTime(timeRaw) || timeRaw) : null,
      priority: document.getElementById('nt-priority').value,
      status: document.getElementById('nt-status').value,
      watchers: Array.from(this.watchers),
      subtasks,
    };

    let clean;
    try {
      clean = App.validate.newTask(rawPayload);
    } catch (err) {
      this._showFieldError(err);
      return;
    }

    const reminderEl = document.getElementById('nt-reminderAt');
    const payload = Object.assign({}, clean, {
      project: (document.getElementById('nt-project').dataset.current || null),
      reminderAt: (reminderEl && reminderEl.value) ? reminderEl.value : null,
      notify: {
        email:    document.getElementById('nt-notify-email').checked,
        inapp:    document.getElementById('nt-notify-inapp').checked,
        watchers: document.getElementById('nt-notify-watchers').checked,
        whatsapp: document.getElementById('nt-notify-whatsapp').checked,
      },
    });
    this.controller.createTask(payload);
    this.controller.closeNewTaskPage();
  }

  _showFieldError(err) {
    const fieldMap = {
      title: 'nt-title', description: 'nt-desc', assignee: 'nt-assignee',
      type: 'nt-type', label: 'nt-label', company: 'nt-company', due: 'nt-due',
      dueTime: 'nt-time', priority: 'nt-priority', status: 'nt-status',
      bidStatus: 'nt-bid-status',
    };
    const id = fieldMap[err && err.field];
    const el = id && document.getElementById(id);
    if (el) {
      el.focus();
      el.style.borderColor = 'var(--rust)';
      el.setAttribute('aria-invalid', 'true');
      el.addEventListener('input', () => {
        el.removeAttribute('aria-invalid');
        el.style.borderColor = '';
      }, { once: true });
    }
    this._toast('Cannot create task', err.message);
  }

  _toast(title, sub) {
    const tv = this.controller && this.controller.toastView;
    if (tv && tv.show) tv.show({ title, sub });
  }
};
