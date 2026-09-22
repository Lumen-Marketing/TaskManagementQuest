/* The mobile task sheet's state, as data.
   Kept free of DOM so the two things most likely to break quietly — token
   stripping and the checklist-to-subtasks mapping — are covered by unit tests
   instead of being inferred from a rendered sheet. */
(function () {
  'use strict';
  window.App = window.App || {};
  const TS = (App.TaskSheet = App.TaskSheet || {});

  function defaults(ctx) {
    return {
      company: ctx.company,
      whos: ctx.me ? [ctx.me] : [],   // validate.newTask demands at least one
      priority: 'medium',
      status: ctx.defaultStatus || 'todo',
      type: ctx.defaultType || 'admin',
      due: ctx.todayIso,
      time: '',
      reminder: null,
      label: 'none',
      project: null,
      detail: '',
      checklist: [],
    };
  }

  /* Re-derive the token-driven fields from the CURRENT title on every keystroke.
     Returns a new form; the caller keeps the old one until it decides to swap,
     so a half-typed "@je" never clobbers a row the user set by hand. */
  function applyTokens(form, rawTitle, parseCtx) {
    const parsed = App.parseTaskTitle(String(rawTitle || ''), parseCtx);
    const next = Object.assign({}, form, {
      whos: form.whos.slice(),
      checklist: form.checklist.slice(),
    });
    const p = parsed.patches || {};
    if (p.company) next.company = p.company;
    if (p.pri) next.priority = p.pri;
    if (p.date) next.due = p.date;
    if (p.time) next.time = p.time;
    if (p.addWhos && p.addWhos.length) next.whos = p.addWhos.slice();
    return { form: next, hits: parsed.hits || [], cleanTitle: parsed.cleanTitle };
  }

  function toPayload(form, cleanTitle) {
    return {
      title: cleanTitle,
      description: form.detail || '',
      whos: form.whos.slice(),
      type: form.type,
      // '' would make validate.newTask substitute 'roof'; 'none' is the explicit
      // "no label" key from App.TASK_LABELS.
      label: form.label || 'none',
      company: form.company,
      due: form.due,
      dueTime: form.time || null,
      priority: form.priority,
      status: form.status,
      project: form.project || null,
      reminderOffset: form.reminder || null,
      watchers: [],                               // desktop-only in v1
      subtasks: (form.checklist || [])
        .filter(s => String(s.t || '').trim())
        .map(s => ({ t: String(s.t).trim(), d: !!s.d })),
    };
  }

  TS.form = { defaults, applyTokens, toPayload };
})();
