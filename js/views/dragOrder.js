window.App = window.App || {};

/* Pointer-based vertical drag-to-reorder for a list of rows. Works for mouse
   AND touch (Pointer Events), so it's phone-friendly. The caller passes a
   container whose direct children each carry data-id; while dragging we move the
   dragged row among its siblings live, and on release call
   onDrop(movedId, newIndex). Keep rows as direct children (no wrappers).

   Move/up are bound to `document` (not the row) for the duration of a drag. We
   deliberately do NOT pointer-capture the dragged element: re-inserting a
   captured node in the DOM can drop its capture in Chromium, which silently
   killed pointermove so nothing reordered. Document-level listeners keep firing
   regardless of how the node moves. */
App.makeReorderable = function makeReorderable(container, { onDrop, handleSelector } = {}) {
  let dragEl = null;        // the row being dragged
  let pointerId = null;
  let moved = false;        // did the pointer actually move during this drag?

  const rows = () => Array.from(container.children).filter(el => el.dataset && el.dataset.id != null);

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return; // primary / single touch only
    const row = e.target.closest('[data-id]');
    if (!row || row.parentElement !== container) return;
    if (handleSelector && !e.target.closest(handleSelector)) return;
    dragEl = row;
    pointerId = e.pointerId;
    moved = false;
    row.classList.add('dragging');
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', finish, true);
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragEl || e.pointerId !== pointerId) return;
    e.preventDefault();
    moved = true;
    const y = e.clientY;
    // Insert the dragged row before the first sibling whose vertical midpoint is
    // below the pointer; past the last midpoint, append to the end.
    const siblings = rows().filter(r => r !== dragEl);
    let placed = false;
    for (const sib of siblings) {
      const rect = sib.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { container.insertBefore(dragEl, sib); placed = true; break; }
    }
    if (!placed) container.appendChild(dragEl);
  };

  const finish = (e) => {
    if (!dragEl || (e && e.pointerId != null && e.pointerId !== pointerId)) return;
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', finish, true);
    document.removeEventListener('pointercancel', finish, true);
    const el = dragEl;
    const didMove = moved;
    el.classList.remove('dragging');
    const newIndex = rows().indexOf(el);
    dragEl = null;
    pointerId = null;
    // Only report a reorder if the pointer actually moved — a plain click on the
    // handle shouldn't rewrite the order.
    if (didMove && typeof onDrop === 'function') onDrop(el.dataset.id, newIndex);
  };

  container.addEventListener('pointerdown', onPointerDown);

  return function cleanup() {
    container.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', finish, true);
    document.removeEventListener('pointercancel', finish, true);
  };
};
