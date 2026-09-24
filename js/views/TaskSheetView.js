/* Mobile task sheet — Abraham's approved v2 quick add.
   One component, two modes: NEW TASK and EDIT TASK.

   Built on App.Menu's existing 'sheet' presentation, which already owns the
   scrim, Escape, click-away and focus return. NOTE: App.Menu keeps only ONE
   menu open at a time and closes the previous one, so the picker trays are
   panels inside this element, never App.Menu calls. Opening a tray through
   App.Menu would close the sheet out from under it. */
(function () {
  'use strict';
  window.App = window.App || {};

  App.TaskSheetView = class TaskSheetView {
    constructor({ controller }) {
      this.controller = controller;
      this.handle = null;
      this.mode = 'new';
      this.taskId = null;
      this.form = null;
      this._titleValue = '';
    }

    get isOpen() { return !!this.handle; }

    _ctx() {
      // '*' is the all-companies sentinel and 'overall' spans every company —
      // neither is a company a task can be filed under, so fall back to the
      // first real one. Without this the sheet opens showing "*" and the
      // taxonomy lookups miss, leaving raw keys in the STATUS and TYPE rows.
      const cur = this.controller.uiState.currentCompany;
      const real = Object.keys(App.COMPANIES || {}).filter(id => id !== 'overall');
      const company = (cur && cur !== '*' && cur !== 'overall') ? cur : real[0];
      const type = (App.taxonomy.activeTypes(company)[0] || { key: 'admin' }).key;
      return {
        company,
        me: this.controller.currentUser,
        todayIso: App.utils.todayISO(0),
        defaultType: type,
        defaultStatus: App.taxonomy.defaultStatus(company, type) || 'todo',
      };
    }

    openNew(prefill) {
      this.mode = 'new';
      this.taskId = null;
      this._titleValue = '';
      this.form = Object.assign(App.TaskSheet.form.defaults(this._ctx()), prefill || {});
      this._open();
    }

    openEdit(taskId) {
      const t = this.controller.getTask(taskId);
      if (!t) return;
      this.mode = 'edit';
      this.taskId = taskId;
      this.form = Object.assign(App.TaskSheet.form.defaults(this._ctx()), {
        company: t.company,
        whos: (t.assigneeIds && t.assigneeIds.length) ? t.assigneeIds.slice() : [t.assignee],
        priority: t.priority,
        status: t.status,
        type: t.type,
        due: t.due || '',
        time: t.dueTime || '',
        label: t.label || 'none',
        project: t.project || null,
        detail: t.description || '',
        checklist: (Array.isArray(t.subtasks) ? t.subtasks : []).map(s => ({ t: s.t, d: !!s.d })),
      });
      this._titleValue = t.title || '';
      this._open();
    }

    close() { if (this.handle) this.handle.close('api'); }

    _open() {
      if (this.handle) this.handle.close('reopen');
      this.handle = App.Menu.open({
        present: 'sheet',
        className: 'task-sheet',
        onClose: () => { this.handle = null; this._el = null; },
        build: (el, handle) => {
          // App.Menu invokes build() BEFORE open() returns, so this.handle is
          // still null here. Capture both now — _renderChecklist runs during
          // this callback and needs the element.
          this._el = el;
          this.handle = handle;
          el.setAttribute('aria-label', this.mode === 'edit' ? 'Edit task' : 'New task');
          el.innerHTML = this._html();
          this._bind(el);
          // Focus after the sheet is in the document, or iOS drops the keyboard.
          const input = el.querySelector('.ts-title-in');
          if (input) setTimeout(() => input.focus(), 50);
        },
      });
    }

    _html() {
      const editing = this.mode === 'edit';
      return `
        <div class="ts-grab" aria-hidden="true"></div>
        <header class="ts-head">
          <span class="ts-label">${editing ? 'EDIT TASK' : 'NEW TASK'}</span>
          <button class="ts-close" type="button" aria-label="Close">
            <i class="ti ti-x"></i>
          </button>
        </header>
        <div class="ts-body">
          <input class="ts-title-in" type="text" autocomplete="off" enterkeyhint="done"
                 placeholder="What needs to get done?" aria-label="Task title"
                 value="${App.utils.escapeHtml(this._titleValue || '')}">
          <p class="ts-hint">type <b>@name</b> <b>#company</b> <b>!high</b> <b>tmrw</b> <b>9:30a</b> — rows fill live</p>
          ${App.TaskSheet.rows.render(this.form, { display: (f) => this._display(f) })}
          ${editing ? '<button class="ts-open-full" type="button">Open full task</button>' : ''}
        </div>
        <div class="ts-tray" data-tray hidden></div>
        <footer class="ts-foot">
          ${editing
            ? `<button class="ts-delete" type="button" aria-label="Delete task"><i class="ti ti-trash"></i></button>
               <button class="ts-save btn btn-primary" type="button">Save changes</button>`
            : `<button class="ts-save-another" type="button">SAVE +<br>ANOTHER</button>
               <button class="ts-save btn btn-primary" type="button">Add task</button>`}
        </footer>`;
    }

    /* How each field renders in its row. Kept in one place so the row and its
       tray can never disagree about a label. */
    _display(field) {
      const f = this.form;
      switch (field) {
        case 'company': {
          const c = (App.COMPANIES || {})[f.company] || { label: f.company };
          return {
            label: c.label || f.company,
            swatch: `<i class="ts-swatch" style="background:${App.utils.companyColor(f.company)}"></i>`,
          };
        }
        case 'assignee': {
          const p = App.directory.person(f.whos[0]);
          return { label: p ? p.name : 'Unassigned', swatch: p ? App.utils.avatarHtml(p) : '' };
        }
        case 'priority': {
          const p = (App.PRIORITIES || {})[f.priority] || { label: f.priority, cls: '' };
          return { label: p.label, pill: true, pillCls: p.cls };
        }
        case 'status':
          return { label: App.taxonomy.statusLabel(f.company, f.type, f.status) || f.status };
        case 'type':
          return { label: App.taxonomy.typeLabel(f.company, f.type) || f.type };
        case 'due':
          return { label: f.due ? App.utils.formatDue(f.due).text : 'No date' };
        case 'time':
          return { label: f.time ? App.utils.formatClock(f.time) : 'No time' };
        case 'reminder': {
          const m = { '': 'None', at: 'At due time', '1h': '1 hr before', '1d': '1 day before' };
          return { label: m[f.reminder || ''] || 'None' };
        }
        case 'label':
          return { label: App.taxonomy.labelLabel(f.company, f.label) || 'None' };
        case 'project': {
          const p = (App.PROJECTS && f.project) ? App.PROJECTS[f.project] : null;
          return { label: p ? p.name : 'No project' };
        }
        default: return { label: '' };
      }
    }

    /* atEnd decides whether the FINAL token counts as complete.
       false while typing: "9a" on the way to "9am" must not resolve and vanish
       under the cursor. true on save: the last token is finished by definition,
       and without it every saved title keeps its trailing token. This mirrors
       NewTaskPageView.submit(), which calls _applyParse(true). */
    _parseCtx(atEnd) {
      return {
        team: App.utils.peopleInCompany(this.form.company, this.controller.currentUser)
          .map(p => ({ id: p.id, name: p.name })),
        companies: Object.values(App.COMPANIES || {}).map(c => ({ id: c.id, label: c.label })),
        today: App.utils.todayISO(0),
        atEnd: !!atEnd,
      };
    }

    _bind(el) {
      el.querySelector('.ts-close').addEventListener('click', () => this.close());
      el.querySelector('.ts-save').addEventListener('click', () => this._save(false));

      const another = el.querySelector('.ts-save-another');
      if (another) another.addEventListener('click', () => this._save(true));

      const del = el.querySelector('.ts-delete');
      if (del) del.addEventListener('click', () => {
        const id = this.taskId;
        this.close();
        this.controller.deleteTask(id);
      });

      const full = el.querySelector('.ts-open-full');
      if (full) full.addEventListener('click', () => {
        const id = this.taskId;
        this.close();
        this.controller.selectTask(id);
      });

      el.querySelectorAll('.ts-row').forEach(r =>
        r.addEventListener('click', () => this._openTray(r.dataset.field)));

      const more = el.querySelector('.ts-more-toggle');
      more.addEventListener('click', () => {
        const group = el.querySelector('.ts-more');
        const open = group.hidden;
        group.hidden = !open;
        more.setAttribute('aria-expanded', String(open));
        more.classList.toggle('is-open', open);
        more.querySelector('i').className = 'ti ' + (open ? 'ti-chevron-down' : 'ti-chevron-right');
      });

      // Rows fill live as he types — the same parser the desktop page uses, and
      // the path that makes voice-to-text entry work.
      el.querySelector('.ts-title-in').addEventListener('input', (e) => {
        const applied = App.TaskSheet.form.applyTokens(this.form, e.target.value, this._parseCtx(false));
        this.form = applied.form;
        ['company', 'assignee', 'priority', 'due', 'time'].forEach(f =>
          App.TaskSheet.rows.update(el, f, this._display(f)));
      });

      // Drag-down on grab handle to dismiss sheet (like pulling down a notification shade)
      const grab = el.querySelector('.ts-grab');
      if (grab) {
        let dragStarted = false;
        let startY = 0;
        grab.addEventListener('pointerdown', (e) => {
          // Only primary touch/button
          if (e.button != null && e.button !== 0) return;
          dragStarted = true;
          startY = e.clientY;
          e.preventDefault(); // prevent text selection etc.
        });
        grab.addEventListener('pointermove', (e) => {
          if (!dragStarted) return;
          e.preventDefault(); // prevent scrolling
          const deltaY = e.clientY - startY;
          // If dragged down past threshold, dismiss
          if (deltaY > 50) { // 50px threshold
            this.close();
            dragStarted = false;
          }
        });
        grab.addEventListener('pointerup', () => {
          dragStarted = false;
        });
        grab.addEventListener('pointercancel', () => {
          dragStarted = false;
        });
      }

      el.querySelector('.ts-detail').addEventListener('input', (e) => {
        this.form.detail = e.target.value;
      });

      this._bindChecklist(el);
    }

    _openTray(field) {
      const el = this._el;
      const tray = el.querySelector('[data-tray]');
      const spec = App.TaskSheet.trays.build(field, this.form,
        { todayIso: App.utils.todayISO(0), me: this.controller.currentUser });

      el.querySelectorAll('.ts-row.is-open').forEach(r => r.classList.remove('is-open'));
      el.querySelector(`.ts-row[data-field="${field}"]`).classList.add('is-open');

      tray.hidden = false;
      tray.innerHTML = `
        <div class="ts-tray-head">
          <span>${App.utils.escapeHtml(spec.title)}</span>
          <button class="ts-tray-done" type="button">DONE</button>
        </div>
        ${spec.html}`;

      tray.querySelector('.ts-tray-done').addEventListener('click', () => this._closeTray());
      tray.querySelectorAll('[data-value]').forEach(b => b.addEventListener('click', () => {
        this._setField(field, b.dataset.value);
        if (!spec.stayOpen) { this._closeTray(); return; }
        tray.querySelectorAll('[data-value]').forEach(x => x.classList.remove('is-on'));
        b.classList.add('is-on');
      }));

      const native = tray.querySelector('input[type="date"], input[type="time"]');
      if (native) native.addEventListener('change', () => {
        this._setField(field, native.value);
        this._closeTray();
      });
    }

    _closeTray() {
      const el = this._el;
      if (!el) return;
      el.querySelector('[data-tray]').hidden = true;
      el.querySelectorAll('.ts-row.is-open').forEach(r => r.classList.remove('is-open'));
    }

    _setField(field, value) {
      const f = this.form;
      if (field === 'assignee') f.whos = [value];
      else f[field] = value;

      App.TaskSheet.rows.update(this._el, field, this._display(field));

      // Changing company or type can invalidate the chosen status and type,
      // because the taxonomy scopes types per company and statuses per type.
      if (field === 'company') {
        const types = App.taxonomy.activeTypes(f.company).map(t => t.key);
        if (types.length && types.indexOf(f.type) === -1) {
          f.type = types[0];
          App.TaskSheet.rows.update(this._el, 'type', this._display('type'));
        }
      }
      if (field === 'company' || field === 'type') {
        const valid = App.taxonomy.activeStatuses(f.company, f.type).map(s => s.key);
        if (valid.length && valid.indexOf(f.status) === -1) {
          f.status = App.taxonomy.defaultStatus(f.company, f.type) || valid[0];
          App.TaskSheet.rows.update(this._el, 'status', this._display('status'));
        }
        // The assignee roster is company-scoped too.
        if (field === 'company') {
          const people = App.utils.peopleInCompany(f.company, this.controller.currentUser)
            .map(p => p.id);
          if (people.length && people.indexOf(f.whos[0]) === -1) {
            f.whos = [people.indexOf(this.controller.currentUser) !== -1
              ? this.controller.currentUser : people[0]];
            App.TaskSheet.rows.update(this._el, 'assignee', this._display('assignee'));
          }
        }
      }
    }

    /* ---------------- checklist ---------------- */

    _renderChecklist() {
      const ul = this._el.querySelector('[data-checklist]');
      ul.innerHTML = this.form.checklist.map((s, i) => `
        <li class="${s.d ? 'is-done' : ''}">
          <button class="ts-check-box" type="button" data-idx="${i}"
                  aria-label="${s.d ? 'Mark step not done' : 'Mark step done'}">
            <i class="ti ${s.d ? 'ti-square-check' : 'ti-square'}"></i>
          </button>
          <span class="ts-check-t">${App.utils.escapeHtml(s.t)}</span>
          <button class="ts-check-x" type="button" data-idx="${i}" aria-label="Remove step">
            <i class="ti ti-x"></i>
          </button>
        </li>`).join('');

      ul.querySelectorAll('.ts-check-box').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.idx;
        this.form.checklist[i].d = !this.form.checklist[i].d;
        this._renderChecklist();
      }));
      ul.querySelectorAll('.ts-check-x').forEach(b => b.addEventListener('click', () => {
        this.form.checklist.splice(+b.dataset.idx, 1);
        this._renderChecklist();
      }));
    }

    _addChecklistStep(text) {
      const t = String(text || '').trim();
      if (!t) return false;
      this.form.checklist.push({ t, d: false });
      this._renderChecklist();
      return true;
    }

    _bindChecklist(el) {
      const input = el.querySelector('.ts-check-in');
      const add = () => {
        if (this._addChecklistStep(input.value)) input.value = '';
        input.focus();
      };
      el.querySelector('.ts-check-btn').addEventListener('click', add);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();       // no <form> here, but stop any ancestor handler
        add();
      });
      this._renderChecklist();
    }

    /* ---------------- save ---------------- */

    /* Validation is inline: focus the title and swap the placeholder. The
       handoff is explicit that there are no alert dialogs. */
    _rejectEmptyTitle(el) {
      const input = el.querySelector('.ts-title-in');
      input.classList.add('is-invalid');
      input.placeholder = 'A title is required';
      input.focus();
      setTimeout(() => input.classList.remove('is-invalid'), 1200);
    }

    _save(keepOpen) {
      const el = this._el;
      if (!el) return;

      // A step typed but never added is still a step he meant to keep.
      const pending = el.querySelector('.ts-check-in');
      if (pending && pending.value.trim()) {
        this._addChecklistStep(pending.value);
        pending.value = '';
      }

      const raw = el.querySelector('.ts-title-in').value || '';
      const applied = App.TaskSheet.form.applyTokens(this.form, raw, this._parseCtx(true));
      if (!applied.cleanTitle.trim()) { this._rejectEmptyTitle(el); return; }
      this._commit(applied, keepOpen);
    }

    /* Echo what was actually scheduled, not just "saved" — a mis-parsed token
       is only catchable if the confirmation states the result. */
    _scheduleEcho() {
      const bits = [];
      if (this.form.due) bits.push(App.utils.formatDue(this.form.due).text);
      if (this.form.time) bits.push(App.utils.formatClock(this.form.time));
      const p = App.directory.person(this.form.whos[0]);
      if (p) bits.push(p.name);
      return bits.join(' · ');
    }

    _commit(applied, keepOpen) {
      const el = this._el;
      this.form = applied.form;
      const payload = App.TaskSheet.form.toPayload(this.form, applied.cleanTitle);

      let clean;
      try {
        clean = App.validate.newTask(payload);
      } catch (err) {
        // Keep the sheet and every value; say which field is wrong.
        this.controller.toastView.show({ title: 'Check the task', sub: err.message });
        const row = err.field && el.querySelector(`.ts-row[data-field="${err.field}"]`);
        if (row) row.classList.add('is-invalid');
        return;
      }

      const extras = {
        project: this.form.project || null,
        reminderOffset: this.form.reminder || null,
        // Same channels the desktop New Task page defaults to, so a task
        // created on a phone notifies exactly like one created at a desk.
        // WhatsApp dispatch is out of scope for mobile v1 per the handoff.
        notify: { email: true, inapp: true, watchers: false, whatsapp: false },
        // Rides the controller's own "Task created" toast instead of stacking a
        // second one — it keeps the View action, and the later toast would
        // otherwise hide this echo anyway.
        toastSub: this._scheduleEcho(),
      };

      if (this.mode === 'edit') {
        // updateTaskDetails returns false on a validation problem and has
        // already toasted why. Honour that: closing regardless would discard
        // his edits while claiming the save worked. It toasts "Task updated"
        // itself on success, so there is nothing to add here.
        const ok = this.controller.updateTaskDetails(this.taskId, Object.assign({}, clean, extras));
        if (ok) this.close();
        return;
      }

      this.controller.createTask(Object.assign({}, clean, extras));

      if (!keepOpen) { this.close(); return; }

      // Batch entry: keep the routing fields, drop what was specific to this one.
      this.form.detail = '';
      this.form.checklist = [];
      const input = el.querySelector('.ts-title-in');
      input.value = '';
      el.querySelector('.ts-detail').value = '';
      this._renderChecklist();
      // Deferred like the focus in _open: createTask selects the new task and
      // emits selection:changed after this returns, and whatever reacts to that
      // takes the focus back if it is claimed synchronously here.
      setTimeout(() => { if (this._el) input.focus(); }, 50);
    }
  };
})();
