/* CsvExport — assembles the CSV row grids for the two exports (tasks, time).
   Pure data transformation: tasks/entries in, rows out — the controller keeps
   the surrounding concerns (which tasks are visible, download trigger, toast).
   Extracted from AppController (C6 attrition) because format knowledge —
   column order, label fallbacks, subtask "done/total", hour rounding — is the
   kind of thing that silently drifts; here it's one module with unit tests.
   Dual-environment export (browser global + CommonJS) like PersistenceEngine. */
(function (root) {
  'use strict';

  function personName(id) {
    const App = root.App;
    const p = App.directory && App.directory.person(id);
    return (p && (p.full || p.name)) || id || '';
  }

  function tasksRows(tasks) {
    const App = root.App;
    const rows = [['Title', 'Type', 'Label', 'Company', 'Assignee', 'Priority', 'Status', 'Due', 'Created by', 'Subtasks', 'Description']];
    tasks.forEach(t => {
      const label = (t.label && t.label !== 'none' && App.TASK_LABELS[t.label]) ? App.TASK_LABELS[t.label].label : '';
      const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
      const subDone = subs.filter(s => s.d).length;
      rows.push([
        t.title || '',
        (App.TASK_TYPES[t.type] || {}).label || t.type || '',
        label,
        (App.directory.company(t.company) || {}).label || t.company || '',
        personName(t.assignee),
        (App.PRIORITIES[t.priority] || {}).label || t.priority || '',
        (App.STATUSES[t.status] || {}).label || t.status || '',
        t.due || '',
        personName(t.creator),
        subs.length ? `${subDone}/${subs.length}` : '',
        t.description || '',
      ]);
    });
    return rows;
  }

  function timeRows(tasks, entries) {
    const App = root.App;
    const byId = new Map(tasks.map(t => [t.id, t]));
    const ids = new Set(tasks.map(t => t.id));
    const sorted = (entries || [])
      .filter(e => ids.has(e.taskId))
      .slice()
      .sort((a, b) => (a.start || 0) - (b.start || 0));
    const rows = [['Date', 'Person', 'Task', 'Company', 'Hours', 'Note']];
    sorted.forEach(e => {
      const t = byId.get(e.taskId) || {};
      rows.push([
        e.start ? App.utils.toISODate(new Date(e.start)) : '',
        personName(e.userId),
        t.title || e.taskTitle || e.taskId || '',
        (App.directory.company(t.company) || {}).label || '',
        ((e.durationMs || 0) / 3600000).toFixed(2),
        e.note || '',
      ]);
    });
    return rows;
  }

  const App = root.App = root.App || {};
  App.csvExport = { tasksRows, timeRows, personName };
  if (typeof module !== 'undefined' && module.exports) module.exports = { tasksRows, timeRows, personName };
})(typeof window !== 'undefined' ? window : globalThis);
