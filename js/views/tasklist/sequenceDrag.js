/* Pointer drag-to-reorder ACROSS groups. Unlike App.makeReorderable (single
   container), this moves the REAL row between group-list containers as the
   pointer travels, then reports the final order of every affected list. Moving
   the real element (no floating ghost) keeps scoped skins like the qt-table
   styled correctly during the drag. Mouse + touch (Pointer Events).

   Contract: each group list matches groupListSelector and carries data-cat;
   its reorderable rows are direct descendants matching rowSelector, each with
   data-id; drag starts only on handleSelector. onDrop is called with
   { id, fromCat, toCat, orderedIds } where orderedIds maps each AFFECTED cat to
   its final [id,...] order read from the live DOM. */
window.App = window.App || {};
App.makeGroupReorderable = function (board, opts) {
  const { groupListSelector, rowSelector, handleSelector, onDrop } = opts || {};
  let dragEl = null, pointerId = null, fromCat = null, moved = false;

  const lists = () => Array.from(board.querySelectorAll(groupListSelector));
  const rowsIn = (l) => Array.from(l.querySelectorAll(rowSelector));
  const listOf = (el) => el.closest(groupListSelector);

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;      // primary / single touch
    const handle = e.target.closest(handleSelector);
    if (!handle) return;
    const row = handle.closest(rowSelector);
    if (!row) return;
    e.preventDefault();
    dragEl = row;
    pointerId = e.pointerId;
    moved = false;
    const l = listOf(row);
    fromCat = l && l.dataset ? l.dataset.cat : null;
    row.classList.add('dragging');
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }

  function onMove(e) {
    if (!dragEl || e.pointerId !== pointerId) return;
    e.preventDefault();
    moved = true;
    const x = e.clientX, y = e.clientY;

    // Which group list is the pointer over? (small vertical slop so you can drop
    // into an adjacent group's edge). Fall back to the row's current list.
    const target = lists().find(l => {
      const r = l.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top - 20 && y <= r.bottom + 20;
    }) || listOf(dragEl);
    lists().forEach(l => l.classList.toggle('droptarget', l === target));
    if (!target) return;

    // Insert before the first sibling whose vertical midpoint is below the
    // pointer; past the last, append. Reparents the real row live.
    const sibs = rowsIn(target).filter(r => r !== dragEl);
    let before = null;
    for (const s of sibs) {
      const r = s.getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = s; break; }
    }
    if (before) target.insertBefore(dragEl, before);
    else target.appendChild(dragEl);
  }

  function onUp(e) {
    if (!dragEl || (e && e.pointerId != null && e.pointerId !== pointerId)) return;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    const el = dragEl, from = fromCat, didMove = moved;
    el.classList.remove('dragging');
    lists().forEach(l => l.classList.remove('droptarget'));
    dragEl = null; pointerId = null;
    if (!didMove) return; // a plain click on the handle isn't a reorder

    const toList = listOf(el);
    const toCat = toList && toList.dataset ? toList.dataset.cat : from;
    const orderedIds = {};
    const affected = new Set([from, toCat]);
    lists().forEach(l => {
      if (affected.has(l.dataset.cat)) orderedIds[l.dataset.cat] = rowsIn(l).map(r => r.dataset.id);
    });
    if (typeof onDrop === 'function') onDrop({ id: el.dataset.id, fromCat: from, toCat, orderedIds });
  }

  board.addEventListener('pointerdown', onDown);
  return function cleanup() {
    board.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    if (dragEl) { dragEl.classList.remove('dragging'); dragEl = null; }
  };
};
