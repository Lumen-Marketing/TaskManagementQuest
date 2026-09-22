/* Picker trays for the mobile task sheet.
   These are panels INSIDE the sheet, never App.Menu calls — App.Menu keeps one
   menu open at a time, so opening a tray through it would close the sheet.

   Option lists come from the live taxonomy, which is scoped per company AND per
   type: the status list is rebuilt from the CURRENT form every time the tray is
   opened, so changing the type changes the statuses on offer. */
(function () {
  'use strict';
  window.App = window.App || {};
  const TS = (App.TaskSheet = App.TaskSheet || {});

  const esc = (s) => App.utils.escapeHtml(String(s == null ? '' : s));
  const swatch = (color) => `<i class="ts-swatch" style="background:${color || 'var(--ink-3)'}"></i>`;

  function chips(options, selected) {
    return `<div class="ts-opts">${options.map(o => `
      <button class="ts-opt ${o.value === selected ? 'is-on' : ''}" type="button"
              data-value="${esc(o.value)}">${o.swatch || ''}${esc(o.label)}</button>`).join('')}</div>`;
  }

  function build(field, form, ctx) {
    switch (field) {
      case 'company': {
        const opts = Object.values(App.COMPANIES || {}).map(c => ({
          value: c.id, label: c.label, swatch: swatch(App.utils.companyColor(c.id)),
        }));
        return { title: 'COMPANY', html: chips(opts, form.company) };
      }

      case 'assignee': {
        // Company-scoped, not the whole directory: App.directory.people()
        // returns everyone regardless of company.
        const opts = App.utils.peopleInCompany(form.company, ctx.me).map(p => ({
          value: p.id, label: p.name, swatch: App.utils.avatarHtml(p),
        }));
        return { title: 'ASSIGNEE', html: chips(opts, form.whos[0]) };
      }

      case 'priority': {
        // A segmented bar, not chips: the selected segment fills with its own
        // colour and the tray stays open until DONE.
        //
        // FOUR segments, not five. NewTaskPageView._priList() deliberately omits
        // 'urgent' on the create path ("pro1 v1-FINAL" — it stays in the data
        // model but is not offered), and that is exactly the handoff's bar.
        // Building this from Object.keys(App.PRIORITIES) would show five and
        // reverse a deliberate product decision.
        const opts = ['low', 'medium', 'high', 'critical']
          .filter(k => (App.PRIORITIES || {})[k])
          .map(k => ({ value: k, label: App.PRIORITIES[k].label, cls: App.PRIORITIES[k].cls }));
        return {
          title: 'PRIORITY', stayOpen: true,
          html: `<div class="ts-seg">${opts.map(o => `
            <button class="ts-seg-b ${o.cls} ${o.value === form.priority ? 'is-on' : ''}"
                    type="button" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div>`,
        };
      }

      case 'status': {
        // Rebuilt from the CURRENT company + type every open — statuses are
        // scoped per type, so a cached list would offer impossible values.
        const opts = App.taxonomy.activeStatuses(form.company, form.type).map(s => ({
          value: s.key, label: s.label, swatch: swatch(s.color),
        }));
        return { title: 'STATUS', html: chips(opts, form.status) };
      }

      case 'type': {
        const opts = App.taxonomy.activeTypes(form.company).map(t => ({
          value: t.key, label: t.label,
        }));
        return { title: 'TYPE', html: chips(opts, form.type) };
      }

      case 'due': {
        const picks = TS.dates.quickPicks(ctx.todayIso).map(p => ({
          value: p.iso, label: p.label,
        }));
        return {
          title: 'DUE',
          html: chips(picks, form.due) +
            `<label class="ts-native"><i class="ti ti-calendar"></i>
               <input type="date" value="${esc(form.due)}" aria-label="Pick a date"></label>`,
        };
      }

      case 'time': {
        const picks = TS.dates.timePicks().map(p => ({ value: p.value, label: p.label }));
        return {
          title: 'TIME',
          html: chips(picks, form.time) +
            `<label class="ts-native"><i class="ti ti-clock"></i>
               <input type="time" value="${esc(form.time)}" aria-label="Pick a time"></label>`,
        };
      }

      case 'reminder': {
        const opts = [
          { value: '', label: 'None' }, { value: 'at', label: 'At due time' },
          { value: '1h', label: '1 hr before' }, { value: '1d', label: '1 day before' },
        ];
        return { title: 'REMINDER', html: chips(opts, form.reminder || '') };
      }

      case 'label': {
        const opts = App.taxonomy.activeLabels(form.company).map(l => ({
          value: l.key, label: l.label, swatch: swatch(l.color),
        }));
        return { title: 'LABEL', html: chips(opts, form.label) };
      }

      case 'project': {
        const list = App.PROJECTS ? Object.values(App.PROJECTS) : [];
        const opts = [{ value: '', label: 'No project' }].concat(
          list.map(p => ({ value: p.id, label: p.name })));
        return { title: 'PROJECT', html: chips(opts, form.project || '') };
      }

      default:
        return { title: String(field).toUpperCase(), html: chips([], null) };
    }
  }

  TS.trays = { build };
})();
