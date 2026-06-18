window.App = window.App || {};

App.NewTaskModalView = class NewTaskModalView {
  constructor({ controller, currentUser }) {
    this.controller = controller;
    this.currentUser = currentUser;
    this.modal = null;
    this.watchers = new Set();
    this.subtasks = []; // array of strings, in entry order
    // Persisted "pinned" popup size (Ctrl+S). Lets a user — e.g. on a very wide
    // screen — resize the modal once and have that size reused on every open.
    this.SIZE_KEY = 'questhq:newtask-size';
  }

  open(prefill = {}) {
    if (this.modal) return; // already open
    this.watchers = new Set();
    this.subtasks = [];
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    this.modal.id = 'newTaskModal';
    this.modal.innerHTML = this.template();
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-label', 'New task');
    document.body.appendChild(this.modal);

    // Optional prefill (e.g. clicking a day in the calendar sets the due date).
    if (prefill && prefill.due) {
      const dueEl = document.getElementById('nt-due');
      if (dueEl) dueEl.value = prefill.due;
    }

    this._releaseTrap = App.utils.trapFocus(this.modal);
    this.bindEvents();
    setTimeout(() => document.getElementById('nt-title').focus(), 50);
    this.renderWatcherChips();
    this.renderSubtaskChips();
    this.updateDelegationBanner();
  }

  close() {
    if (!this.modal) return;
    if (this._releaseTrap) { this._releaseTrap(); this._releaseTrap = null; }
    this.modal.remove();
    this.modal = null;
  }

  /* The company the task defaults to, plus the list offered in the dropdown.
     Excludes the developer '*' sentinel; falls back to every company when the
     session has none scoped. The assignee/watcher pickers scope to `selected`. */
  _companyChoices() {
    let ids = (this.controller.uiState.companies || []).filter(id => id !== '*');
    if (!ids.length) ids = Object.keys(App.COMPANIES || {});
    const cur = this.controller.uiState.currentCompany;
    const selected = (cur && cur !== '*') ? cur : ids[0];
    return { ids, selected };
  }

  /* Assignee <option>s scoped to one company. Always keeps the current user
     selectable (you can assign to yourself even in a company you only manage). */
  _assigneeOptionsHtml(companyId, selectedId) {
    return App.utils.peopleInCompany(companyId, this.currentUser)
      .map(p => `<option value="${App.utils.escapeHtml(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${App.utils.escapeHtml(p.name)}</option>`)
      .join('');
  }

  /* Re-scope the assignee + watcher pickers to a newly chosen company. Keeps the
     current assignee if they're still in-company, else falls back to yourself,
     else the first member; and drops any watchers who aren't in the new company. */
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
    this.updateDelegationBanner();
  }

  template() {
    const me = App.PEOPLE[this.currentUser];
    const { ids: companyIds, selected: selectedCompany } = this._companyChoices();
    return `
      <div class="modal" data-stop>
        <div class="modal-head">
          <div class="modal-title">New task</div>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="field field-title">
            <input type="text" id="nt-title" placeholder="Lead Name / Task" aria-label="Task title" required autofocus />
          </div>

          <div class="field">
            <textarea id="nt-desc" placeholder="Add details, links, context..." aria-label="Description" rows="3" style="resize: vertical;"></textarea>
          </div>

          <div class="field-row" style="margin-bottom: 14px;">
            <div>
              <div class="field-label">Created by <i class="ti ti-lock"></i></div>
              <div class="locked-field">
                ${App.utils.avatarHtml(me)}You (${App.utils.escapeHtml(me.name)})
              </div>
            </div>
            <div>
              <div class="field-label">Assigned to</div>
              <select id="nt-assignee" class="assigned-field" style="width:100%; padding: 6px 10px; font-size: 12px;">
                ${this._assigneeOptionsHtml(selectedCompany, this.currentUser)}
              </select>
            </div>
          </div>

          <div id="nt-delegation-banner" class="hidden" style="padding: 8px 12px; background: var(--blue-bg); border-left: 2px solid var(--blue); border-radius: 4px; font-size: 11.5px; color: var(--blue-ink); margin-bottom: 14px; display: flex; align-items: center; gap: 8px;">
            <i class="ti ti-send" style="font-size: 14px;"></i>
            <span id="nt-delegation-text"></span>
          </div>

          <div class="field">
            <div class="field-label">Also notify (watchers)</div>
            <div class="watcher-picker">
              <div class="watcher-tags" id="nt-watchers"></div>
              <div class="watcher-dropdown hidden" id="nt-watcher-dropdown"></div>
            </div>
          </div>

          <div class="field" style="margin-top:14px;">
            <div class="field-label">Subtasks <span class="field-optional">Optional</span></div>
            <div class="subtask-add-row">
              <input type="text" id="nt-subtask-input" maxlength="200" placeholder="Add a step and press Enter" />
              <button class="btn btn-sm" type="button" data-action="add-subtask">Add</button>
            </div>
            <div class="subtask-chip-list" id="nt-subtasks"></div>
          </div>

          <div class="field-row-3">
            <div>
              <div class="field-label">Type</div>
              <select id="nt-type" style="width:100%; padding: 6px 10px; font-size: 12px;">
                ${Object.entries(App.TASK_TYPES).map(([k, v]) => `<option value="${k}" ${k === 'admin' ? 'selected' : ''}>${v.label}</option>`).join('')}
              </select>
            </div>
            <div>
              <div class="field-label">Company</div>
              <select id="nt-company" style="width:100%; padding: 6px 10px; font-size: 12px;">
                ${companyIds.map(id => {
                  const c = App.COMPANIES[id] || { label: id };
                  return `<option value="${id}" ${id === selectedCompany ? 'selected' : ''}>${App.utils.escapeHtml(c.label)}</option>`;
                }).join('')}
              </select>
            </div>
            <div>
              <div class="field-label">Due</div>
              <input type="date" id="nt-due" class="picker-input" value="${App.utils.todayISO(1)}" style="width:100%; padding: 6px 10px; font-size: 12px;" />
            </div>
          </div>

          <div class="field" style="margin-top:14px;">
            <div class="field-label">Label</div>
            <select id="nt-label" style="width:100%; padding: 6px 10px; font-size: 12px;">
              ${Object.entries(App.TASK_LABELS).map(([k, v]) => `<option value="${k}" ${k === 'roof' ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>

          <div id="nt-bid-status-row" class="field hidden" style="margin-top:14px;">
            <div class="field-label">Bid status</div>
            <select id="nt-bid-status" style="width:100%; padding: 6px 10px; font-size: 12px;">
              ${Object.entries(App.BID_STATUSES).map(([k, v]) => `<option value="${k}" ${k === 'queue' ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>

          <div class="field" style="margin-top:14px;">
            <div class="field-label">Time <span class="field-optional">Optional</span></div>
            <input type="text" id="nt-time" inputmode="text" autocomplete="off" placeholder="e.g. 9:30 AM" style="width:100%; padding: 6px 10px; font-size: 12px;" />
            <div class="user-menu-hint" style="margin-top:5px;">Type digits like <strong>930</strong> then <strong>a</strong> or <strong>p</strong> — the time formats itself. Leave blank if not needed.</div>
          </div>

          <div class="field-row" style="margin-top:14px;">
            <div>
              <div class="field-label">Priority</div>
              <select id="nt-priority" style="width:100%; padding: 6px 10px; font-size: 12px;">
                ${Object.entries(App.PRIORITIES).map(([k, v]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${v.label}</option>`).join('')}
              </select>
            </div>
            <div>
              <div class="field-label">Initial status</div>
              <select id="nt-status" style="width:100%; padding: 6px 10px; font-size: 12px;">
                <option value="todo" selected>Active</option>
                <option value="pending">Pending</option>
                <option value="hold">On hold</option>
              </select>
            </div>
          </div>

          <div class="notify-box" style="margin-top: 14px;">
            <div class="notify-title"><i class="ti ti-bell"></i>Notify on create</div>
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
        <div class="modal-foot">
          <span style="font-size:10.5px; color: var(--ink-3);">Press <kbd>Ctrl ↵</kbd> to create · <kbd>Ctrl S</kbd> to save size</span>
          <div style="display:flex; gap:6px;">
            <button class="btn" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="submit">Create &amp; notify</button>
          </div>
        </div>
        <div class="modal-resize-handle" data-stop title="Drag to resize · Ctrl+S to save as default · Ctrl+Shift+S to reset"></div>
      </div>
    `;
  }

  bindEvents() {
    this.modal.addEventListener('click', (e) => {
      // Ignore the click that fires when a resize-drag is released over the
      // backdrop — otherwise dragging to enlarge would close the modal.
      if (e.target === this.modal && !this._resizing) this.close();
      if (e.target.closest('[data-stop]') && !e.target.closest('[data-action]')) e.stopPropagation();
    });
    this.modal.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', () => this.close()));
    this.modal.querySelector('[data-action="submit"]').addEventListener('click', () => this.submit());

    this.modal.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        // Pin the current popup size as the default (or, with Shift, clear it).
        // preventDefault stops the browser's "save page" dialog.
        e.preventDefault();
        if (e.shiftKey) this._clearSavedSize();
        else this._saveCurrentSize();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    document.getElementById('nt-assignee').addEventListener('change', () => this.updateDelegationBanner());
    document.getElementById('nt-type').addEventListener('change', () => this.updateBidStatusRow());
    // Changing the company re-scopes who you can assign to / watch — a task can
    // only go to people in its own company (worker INSERT is RLS-gated to that).
    document.getElementById('nt-company').addEventListener('change', (e) => this._onCompanyChanged(e.target.value));
    this.updateBidStatusRow();

    // Subtasks: Add button or Enter in the input appends a step.
    this.modal.querySelector('[data-action="add-subtask"]').addEventListener('click', () => this.addSubtask());
    const subtaskInput = document.getElementById('nt-subtask-input');
    if (subtaskInput) subtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.addSubtask(); }
    });

    // Clicking anywhere on a date/time box opens its native picker (not just the icon).
    this.modal.querySelectorAll('.picker-input').forEach(input => {
      input.addEventListener('click', () => {
        try { input.showPicker(); } catch (e) { /* unsupported or not user-activated */ }
      });
    });

    // Free-typed time, displayed as standard 12h time. We auto-insert the colon
    // as digits are typed and the AM/PM as soon as an "a"/"p" is hit; on blur we
    // settle on a clean "2:30 PM". The stored value is converted back to 24h
    // "HH:MM" at submit (what the validator/DB expect).
    const timeInput = document.getElementById('nt-time');
    if (timeInput) {
      timeInput.addEventListener('input', () => {
        const formatted = this._maskTime(timeInput.value);
        if (formatted !== timeInput.value) {
          timeInput.value = formatted;
          // Keep the caret at the end while typing forward.
          timeInput.setSelectionRange(formatted.length, formatted.length);
        }
      });
      timeInput.addEventListener('blur', () => {
        const parsed = this._parseTime(timeInput.value);
        if (parsed) timeInput.value = App.utils.formatClock(parsed); // -> "2:30 PM"
      });
    }

    this._bindResize();
  }

  // Drag-to-resize from the bottom-left grip. The panel opens at its natural CSS
  // size unless the user has pinned a default (Ctrl+S) — see _applySavedSize.
  // The backdrop centres the panel horizontally, so width grows symmetrically —
  // a 1px cursor move widens each side by 1px, hence the x2 on the horizontal
  // delta so the grip tracks the pointer. Vertically the panel is top-aligned,
  // so height tracks 1:1. Dragging left/down enlarges (bottom-left corner).
  _bindResize() {
    const handle = this.modal.querySelector('.modal-resize-handle');
    const panel = this.modal.querySelector('.modal');
    if (!handle || !panel) return;

    // The popup's natural opening width is the 1.0 zoom baseline. Text scales
    // up/down from here as the panel is widened/narrowed. Measured BEFORE any
    // pinned size is applied so the baseline stays the CSS default, not the
    // pinned width (otherwise the zoom math would drift).
    const baseW = panel.getBoundingClientRect().width || 540;

    // Restore a previously pinned default size, if one exists.
    this._applySavedSize(panel, baseW);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._resizing = true;
      const startX = e.clientX, startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      const startW = rect.width, startH = rect.height;

      const onMove = (ev) => {
        const maxW = window.innerWidth * 0.97;
        const maxH = window.innerHeight * 0.95;
        panel.style.maxWidth = 'none';
        panel.style.maxHeight = 'none';
        const w = Math.max(380, Math.min(maxW, startW + (startX - ev.clientX) * 2));
        panel.style.width = w + 'px';
        panel.style.height = Math.max(320, Math.min(maxH, startH + (ev.clientY - startY))) + 'px';
        // Zoom the text with the popup (clamped so it stays usable).
        const scale = Math.max(0.85, Math.min(2, w / baseW));
        panel.style.setProperty('--nt-scale', scale.toFixed(3));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        // Clear after the trailing click event has been dispatched.
        setTimeout(() => { this._resizing = false; }, 0);
      };
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ---------- pinned size (Ctrl+S) ---------- */

  // Read the pinned size from storage, or null if none / unusable.
  _loadSavedSize() {
    try {
      const s = JSON.parse(localStorage.getItem(this.SIZE_KEY) || 'null');
      if (s && typeof s.w === 'number' && typeof s.h === 'number') return s;
    } catch (e) { /* malformed / storage unavailable */ }
    return null;
  }

  // Apply a pinned size to the panel on open. Clamped to the current viewport so
  // a size pinned on a very wide screen still opens sanely on a smaller one, and
  // the text zoom is re-derived from the (CSS-default) baseline width.
  _applySavedSize(panel, baseW) {
    const s = this._loadSavedSize();
    if (!s) return;
    const maxW = window.innerWidth * 0.97;
    const maxH = window.innerHeight * 0.95;
    const w = Math.max(380, Math.min(maxW, s.w));
    const h = Math.max(320, Math.min(maxH, s.h));
    panel.style.maxWidth = 'none';
    panel.style.maxHeight = 'none';
    panel.style.width = w + 'px';
    panel.style.height = h + 'px';
    const scale = Math.max(0.85, Math.min(2, w / baseW));
    panel.style.setProperty('--nt-scale', scale.toFixed(3));
  }

  // Pin the panel's current size as the default for future opens.
  _saveCurrentSize() {
    const panel = this.modal && this.modal.querySelector('.modal');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    try {
      localStorage.setItem(this.SIZE_KEY, JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) }));
    } catch (e) { /* storage unavailable — nothing to persist */ }
    this._toast('Default size saved', 'This size will be used next time.');
  }

  // Forget the pinned size; future opens revert to the automatic default.
  _clearSavedSize() {
    try { localStorage.removeItem(this.SIZE_KEY); } catch (e) { /* ignore */ }
    this._toast('Size reset', 'Back to the automatic default size.');
  }

  // Single guarded entry point for every toast this modal raises.
  _toast(title, sub) {
    const tv = this.controller && this.controller.toastView;
    if (tv && tv.show) tv.show({ title, sub });
  }

  // Live input mask: auto-insert the colon as digits are typed, and expand a
  // typed "a"/"p" into " AM"/" PM". Returns the prettified display string.
  // e.g. "230"->"2:30", "230p"->"2:30 PM", "1430"->"14:30" (settled on blur).
  _maskTime(raw) {
    let s = String(raw == null ? '' : raw).toLowerCase();
    let ap = '';
    if (s.includes('p')) ap = ' PM';
    else if (s.includes('a')) ap = ' AM';

    const digits = s.replace(/\D/g, '').slice(0, 4);
    if (!digits) return ap ? digits + ap : '';

    let body;
    if (digits.length <= 2) body = digits;            // "2", "12" — colon comes next
    else if (digits.length === 3) body = digits.slice(0, 1) + ':' + digits.slice(1);
    else body = digits.slice(0, 2) + ':' + digits.slice(2);
    return body + ap;
  }

  // Parse a loosely-typed time into strict 24h "HH:MM", or null if unusable.
  // Accepts: "9", "930", "0930", "1430", "9:30", "9am", "2:30 pm", "12am"...
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
    const row = document.getElementById('nt-bid-status-row');
    if (!row) return;
    const type = document.getElementById('nt-type').value;
    row.classList.toggle('hidden', type !== 'bid');
  }

  renderWatcherChips() {
    const watchersEl = document.getElementById('nt-watchers');
    const dropdown = document.getElementById('nt-watcher-dropdown');
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
    // Guard against a double-submit (e.g. a fast double-tap on Create): once the
    // modal has been torn down a second invocation has nothing to read.
    if (!this.modal) return;
    const timeRaw = document.getElementById('nt-time').value.trim();
    // Fold in any subtask text the user typed but didn't explicitly "Add".
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

    const payload = Object.assign({}, clean, {
      notify: {
        email:    document.getElementById('nt-notify-email').checked,
        inapp:    document.getElementById('nt-notify-inapp').checked,
        watchers: document.getElementById('nt-notify-watchers').checked,
        whatsapp: document.getElementById('nt-notify-whatsapp').checked,
      },
    });
    this.controller.createTask(payload);
    this.close();
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
      el.style.borderBottom = '1px solid var(--rust)';
      el.setAttribute('aria-invalid', 'true');
      // Clear the invalid state once the user starts correcting the field.
      el.addEventListener('input', () => {
        el.removeAttribute('aria-invalid');
        el.style.borderBottom = '';
      }, { once: true });
    }
    // Surface the validator's message via toast so the user sees WHY the
    // submit was rejected, not just a red underline.
    this._toast('Cannot create task', err.message);
  }
};
