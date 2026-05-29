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
                <span class="avatar-xs" style="background:${me.color};">${App.utils.initials(me.full)}</span>You (${me.name})
              </div>
            </div>
            <div>
              <div class="field-label">Assigned to</div>
              <select id="nt-assignee" class="assigned-field" style="width:100%; padding: 6px 10px; font-size: 12px;">
                ${Object.values(App.PEOPLE).map(p => `<option value="${p.id}" ${p.id === this.currentUser ? 'selected' : ''}>${p.name}</option>`).join('')}
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
            <input type="time" id="nt-time" class="picker-input" placeholder="--:--" style="width:100%; padding: 6px 10px; font-size: 12px;" />
            <div class="user-menu-hint" style="margin-top:5px;">Leave blank if this task isn't tied to a specific time.</div>
          </div>

          <div id="nt-bid-status-row" class="field hidden" style="margin-top:14px;">
            <div class="field-label">Bid status</div>
            <select id="nt-bid-status" style="width:100%; padding: 6px 10px; font-size: 12px;">
              ${Object.entries(App.BID_STATUSES).map(([k, v]) => `<option value="${k}" ${k === 'queue' ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>

          <div class="field-row-3" style="margin-top:14px;">
            <div>
              <div class="field-label">Urgency</div>
              <select id="nt-urgency" style="width:100%; padding: 6px 10px; font-size: 12px;">
                ${Object.entries(App.URGENCIES).map(([k, v]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${v.label}</option>`).join('')}
              </select>
            </div>
            <div>
              <div class="field-label">Priority</div>
              <select id="nt-priority" style="width:100%; padding: 6px 10px; font-size: 12px;">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
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
      </div>
    `;
  }

  bindEvents() {
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
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
      chip.innerHTML = `<span class="avatar-xs" style="background:${p.color};">${App.utils.initials(p.full)}</span>${p.name} <i class="ti ti-x remove"></i>`;
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
      Object.values(App.PEOPLE).filter(p => p.id !== assigneeId && !this.watchers.has(p.id)).forEach(p => {
        const item = document.createElement('div');
        item.className = 'watcher-dropdown-item';
        item.innerHTML = `<span class="avatar-xs" style="background:${p.color};">${App.utils.initials(p.full)}</span>${p.full}`;
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
    const titleEl = document.getElementById('nt-title');
    const title = titleEl.value.trim();
    if (!title) {
      titleEl.focus();
      titleEl.style.borderBottom = '1px solid var(--rust)';
      return;
    }
    const payload = {
      title,
      description: document.getElementById('nt-desc').value.trim(),
      assignee: document.getElementById('nt-assignee').value,
      type: document.getElementById('nt-type').value,
      bidStatus: document.getElementById('nt-bid-status').value,
      company: document.getElementById('nt-company').value,
      due: document.getElementById('nt-due').value,
      dueTime: document.getElementById('nt-time').value || null,
      urgency: document.getElementById('nt-urgency').value,
      priority: document.getElementById('nt-priority').value,
      status: document.getElementById('nt-status').value,
      watchers: Array.from(this.watchers),
      notify: {
        email:    document.getElementById('nt-notify-email').checked,
        inapp:    document.getElementById('nt-notify-inapp').checked,
        watchers: document.getElementById('nt-notify-watchers').checked,
        whatsapp: document.getElementById('nt-notify-whatsapp').checked,
      },
    };
    this.controller.createTask(payload);
    this.close();
  }
};
