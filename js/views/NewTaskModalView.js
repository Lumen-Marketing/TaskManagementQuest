window.App = window.App || {};

App.NewTaskModalView = class NewTaskModalView {
  constructor({ controller, currentUser }) {
    this.controller = controller;
    this.currentUser = currentUser;
    this.modal = null;
    this.watchers = new Set();
  }

  open() {
    if (this.modal) return; // already open
    this.watchers = new Set();
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    this.modal.id = 'newTaskModal';
    this.modal.innerHTML = this.template();
    document.body.appendChild(this.modal);

    this.bindEvents();
    setTimeout(() => document.getElementById('nt-title').focus(), 50);
    this.renderWatcherChips();
    this.updateDelegationBanner();
  }

  close() {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
  }

  template() {
    const me = App.PEOPLE[this.currentUser];
    return `
      <div class="modal" data-stop>
        <div class="modal-head">
          <div class="modal-title">New task</div>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="field field-title">
            <input type="text" id="nt-title" placeholder="What needs to happen?" autofocus />
          </div>

          <div class="field">
            <textarea id="nt-desc" placeholder="Add details, links, context..." rows="3" style="resize: vertical;"></textarea>
          </div>

          <div class="field-row" style="margin-bottom: 14px;">
            <div>
              <div class="field-label">Created by <i class="ti ti-lock"></i></div>
              <div class="locked-field">
                ${App.utils.avatarHtml(me)}You (${me.name})
              </div>
            </div>
            <div>
              <div class="field-label">Assigned to</div>
              <select id="nt-assignee" class="assigned-field" style="width:100%; padding: 6px 10px; font-size: 12px;">
                ${App.utils.activePeople(this.currentUser).map(p => `<option value="${p.id}" ${p.id === this.currentUser ? 'selected' : ''}>${p.name}</option>`).join('')}
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
                <option value="roofing">Roofing</option>
                <option value="drafting">Drafting</option>
                <option value="lumen">Lumen</option>
              </select>
            </div>
            <div>
              <div class="field-label">Due</div>
              <input type="date" id="nt-due" class="picker-input" value="${App.utils.todayISO(1)}" style="width:100%; padding: 6px 10px; font-size: 12px;" />
            </div>
          </div>

          <div class="field" style="margin-top:14px;">
            <div class="field-label">Time <span class="field-optional">Optional</span></div>
            <input type="text" id="nt-time" inputmode="text" autocomplete="off" placeholder="e.g. 9:30 AM or 14:30" style="width:100%; padding: 6px 10px; font-size: 12px;" />
            <div class="user-menu-hint" style="margin-top:5px;">Type a time like <strong>9am</strong>, <strong>2:30 PM</strong> or <strong>14:30</strong> — or leave blank.</div>
          </div>

          <div id="nt-bid-status-row" class="field hidden" style="margin-top:14px;">
            <div class="field-label">Bid status</div>
            <select id="nt-bid-status" style="width:100%; padding: 6px 10px; font-size: 12px;">
              ${Object.entries(App.BID_STATUSES).map(([k, v]) => `<option value="${k}" ${k === 'queue' ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
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
          <span style="font-size:10.5px; color: var(--ink-3);">Press <kbd>Ctrl ↵</kbd> to create</span>
          <div style="display:flex; gap:6px;">
            <button class="btn" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="submit">Create &amp; notify</button>
          </div>
        </div>
        <div class="modal-resize-handle" data-stop title="Drag to resize"></div>
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
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    document.getElementById('nt-assignee').addEventListener('change', () => this.updateDelegationBanner());
    document.getElementById('nt-type').addEventListener('change', () => this.updateBidStatusRow());
    this.updateBidStatusRow();

    // Clicking anywhere on a date/time box opens its native picker (not just the icon).
    this.modal.querySelectorAll('.picker-input').forEach(input => {
      input.addEventListener('click', () => {
        try { input.showPicker(); } catch (e) { /* unsupported or not user-activated */ }
      });
    });

    // Free-typed time: normalise to HH:MM on blur so it matches what the
    // validator/DB expect (e.g. "2:30 pm" -> "14:30"). Left as-typed if it
    // can't be parsed, so submit can surface a clear error.
    const timeInput = document.getElementById('nt-time');
    if (timeInput) {
      timeInput.addEventListener('blur', () => {
        const parsed = this._parseTime(timeInput.value);
        if (parsed) timeInput.value = parsed;
      });
    }

    this._bindResize();
  }

  // Drag-to-resize from the bottom-left grip. Sizing is per-open (the modal is
  // rebuilt on each open), which is the intent: "manually adjust the size".
  // The backdrop centres the panel horizontally, so width grows symmetrically —
  // a 1px cursor move widens each side by 1px, hence the x2 on the horizontal
  // delta so the grip tracks the pointer. Vertically the panel is top-aligned,
  // so height tracks 1:1. Dragging left/down enlarges (bottom-left corner).
  _bindResize() {
    const handle = this.modal.querySelector('.modal-resize-handle');
    const panel = this.modal.querySelector('.modal');
    if (!handle || !panel) return;

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
        panel.style.width = Math.max(380, Math.min(maxW, startW + (startX - ev.clientX) * 2)) + 'px';
        panel.style.height = Math.max(320, Math.min(maxH, startH + (ev.clientY - startY))) + 'px';
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
      chip.innerHTML = `${App.utils.avatarHtml(p)}${p.name} <i class="ti ti-x remove"></i>`;
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
      dropdown.innerHTML = '';
      App.utils.activePeople().filter(p => p.id !== assigneeId && !this.watchers.has(p.id)).forEach(p => {
        const item = document.createElement('div');
        item.className = 'watcher-dropdown-item';
        item.innerHTML = `${App.utils.avatarHtml(p)}${p.full}`;
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
    const timeRaw = document.getElementById('nt-time').value.trim();
    const rawPayload = {
      title: document.getElementById('nt-title').value,
      description: document.getElementById('nt-desc').value,
      assignee: document.getElementById('nt-assignee').value,
      type: document.getElementById('nt-type').value,
      bidStatus: document.getElementById('nt-bid-status').value,
      company: document.getElementById('nt-company').value,
      due: document.getElementById('nt-due').value,
      dueTime: timeRaw ? (this._parseTime(timeRaw) || timeRaw) : null,
      priority: document.getElementById('nt-priority').value,
      status: document.getElementById('nt-status').value,
      watchers: Array.from(this.watchers),
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
      type: 'nt-type', company: 'nt-company', due: 'nt-due',
      dueTime: 'nt-time', priority: 'nt-priority', status: 'nt-status',
      bidStatus: 'nt-bid-status',
    };
    const id = fieldMap[err && err.field];
    const el = id && document.getElementById(id);
    if (el) {
      el.focus();
      el.style.borderBottom = '1px solid var(--rust)';
    }
    // Surface the validator's message via toast so the user sees WHY the
    // submit was rejected, not just a red underline.
    const toast = this.controller && this.controller.toastView;
    if (toast) toast.show({ title: 'Cannot create task', sub: err.message });
  }
};
