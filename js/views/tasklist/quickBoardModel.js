/* Ordering and segmenting for the quick board (the phone default layout).
   Pure and free of DOM so the rule from the handoff — not-done first, then
   priority, then due ascending — is pinned by unit tests rather than read off
   a rendered list. */
(function () {
  'use strict';
  window.App = window.App || {};

  const isDone = (t) => !!(App.taxonomy && App.taxonomy.isDone(t));

  // Unknown keys sort last instead of throwing: taxonomy is DB-driven and a
  // task can carry a priority that was renamed or retired.
  function priorityOrder(t) {
    const p = (App.PRIORITIES || {})[t.priority];
    return p && typeof p.order === 'number' ? p.order : Number.MAX_SAFE_INTEGER;
  }

  // Undated tasks sort after dated ones of the same priority. '' would sort
  // FIRST in a plain string compare, which would push every undated task to the
  // top of the board.
  function dueKey(t) {
    return t.due ? t.due : '￿';
  }

  function bySegment(tasks, seg) {
    const list = Array.isArray(tasks) ? tasks : [];
    if (seg === 'open') return list.filter(t => !isDone(t));
    if (seg === 'done') return list.filter(t => isDone(t));
    return list.slice();
  }

  function sort(tasks) {
    return (Array.isArray(tasks) ? tasks : []).slice().sort((a, b) => {
      const ad = isDone(a) ? 1 : 0, bd = isDone(b) ? 1 : 0;
      if (ad !== bd) return ad - bd;
      const ap = priorityOrder(a), bp = priorityOrder(b);
      if (ap !== bp) return ap - bp;
      const ak = dueKey(a), bk = dueKey(b);
      if (ak !== bk) return ak < bk ? -1 : 1;
      return 0;
    });
  }

  function isOverdue(t, todayIso) {
    if (!t || !t.due || isDone(t)) return false;
    return t.due < todayIso;
  }

  App.QuickBoard = { bySegment, sort, isOverdue };
})();
