/* Pointer drag-to-reorder ACROSS groups for the Category Sequence Board.
   Unlike App.makeReorderable (single container), this tracks a ghost element
   and reparents a row into whichever .seq-group-list the pointer is over, then
   reports the final order of every affected list. Mouse + touch (Pointer
   Events). Ported from the boss's approved mockup. */
window.App = window.App || {};
App.makeGroupReorderable = function (board, opts) {
  const { groupListSelector, rowSelector, handleSelector, onDrop } = opts || {};
  let drag = null;

  function lists() { return Array.from(board.querySelectorAll(groupListSelector)); }
  function rowsIn(list) { return Array.from(list.querySelectorAll(rowSelector)); }

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    const handle = e.target.closest(handleSelector);
    if (!handle) return;
    const row = handle.closest(rowSelector);
    if (!row) return;
    e.preventDefault();

    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('seq-ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);

    const ph = document.createElement('div');
    ph.className = 'seq-placeholder';

    drag = {
      row, ghost, ph,
      id: row.dataset.id,
      fromCat: row.dataset.cat,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
    };
    row.classList.add('dragging');
    position(e);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }

  function position(e) {
    drag.ghost.style.left = (e.clientX - drag.offX) + 'px';
    drag.ghost.style.top = (e.clientY - drag.offY) + 'px';
  }

  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    position(e);
    lists().forEach(l => l.classList.remove('droptarget'));
    drag.ph.remove();

    const target = lists().find(l => {
      const r = l.getBoundingClientRect();
      return e.clientY >= r.top - 14 && e.clientY <= r.bottom + 14;
    });
    if (!target) { drag.over = null; return; }
    target.classList.add('droptarget');

    const siblings = rowsIn(target).filter(r => r.dataset.id !== drag.id);
    let before = null;
    for (const r of siblings) {
      const rect = r.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { before = r; break; }
    }
    if (before) target.insertBefore(drag.ph, before);
    else target.appendChild(drag.ph);
    drag.over = target;
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    if (!drag) return;
    const { id, fromCat, over, ghost, ph, row } = drag;
    row.classList.remove('dragging');
    ghost.remove();

    let toCat = fromCat;
    if (over) {
      toCat = over.dataset.cat;
      over.insertBefore(row, ph); // land the real row where the placeholder is
    }
    ph.remove();
    lists().forEach(l => l.classList.remove('droptarget'));

    // Collect the final order of the affected lists from the live DOM.
    const orderedIds = {};
    const affected = new Set([fromCat, toCat]);
    lists().forEach(l => {
      if (affected.has(l.dataset.cat)) orderedIds[l.dataset.cat] = rowsIn(l).map(r => r.dataset.id);
    });

    const payload = { id, fromCat, toCat, orderedIds };
    drag = null;
    if (typeof onDrop === 'function') onDrop(payload);
  }

  board.addEventListener('pointerdown', onDown);
  return function cleanup() {
    board.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    if (drag) { drag.ghost.remove(); drag.ph.remove(); drag = null; }
  };
};
