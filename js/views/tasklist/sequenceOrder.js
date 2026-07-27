/* Pure ordering + grouping for the Category Sequence Board. No DOM. Kept
   requireable (attaches to App) so it can be unit-tested in isolation. */
window.App = window.App || {};
(function () {
  'use strict';
  const RANK = { critical: 0, high: 1, medium: 2, low: 3 };

  // Fallback order for tasks with no manual position: soonest due, then higher
  // priority. Mirrors the execution-order tail compare.
  function seqTailCompare(a, b) {
    const ad = a.due || '9999-12-31';
    const bd = b.due || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2);
  }

  // One group's display order: manually-positioned tasks (focusSeq set) ranked
  // ascending, then the unpositioned rest by the fallback compare.
  function orderTasks(tasks) {
    const ranked = tasks.filter(t => t.focusSeq != null).sort((a, b) => a.focusSeq - b.focusSeq);
    const tail = tasks.filter(t => t.focusSeq == null).slice().sort(seqTailCompare);
    return ranked.concat(tail);
  }

  // Bucket tasks into ordered, non-empty groups. `key(task)` -> group key
  // (default: task.type). `order` lists the desired group order; unknown keys
  // are appended in first-seen order.
  function sequenceGroups(tasks, { key, order = [] } = {}) {
    const k = key || (t => t.type);
    const buckets = new Map();
    order.forEach(g => buckets.set(g, []));
    tasks.forEach(t => {
      const g = k(t) ?? '';
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(t);
    });
    const out = [];
    buckets.forEach((arr, g) => { if (arr.length) out.push({ key: g, tasks: orderTasks(arr) }); });
    return out;
  }

  // Given an ordered list of ids (final DOM order of a group), the seq value to
  // write for each so the display order persists. 1-based integers per group.
  function positionsFor(idsInOrder) {
    return idsInOrder.map((id, i) => ({ id, seq: i + 1 }));
  }

  App.sequenceOrder = { seqTailCompare, orderTasks, sequenceGroups, positionsFor };
})();
