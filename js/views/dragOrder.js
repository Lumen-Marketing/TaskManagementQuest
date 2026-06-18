window.App = window.App || {};

/* Pointer-based vertical drag-to-reorder for a list of rows. Works for mouse
   AND touch (Pointer Events), so it's phone-friendly. The caller passes a
   container whose direct children each carry data-id; while dragging we move the
   dragged row among its siblings live, and on release call
   onDrop(movedId, newIndex). Keep rows as direct children (no wrappers). */
App.makeReorderable = function makeReorderable(container, { onDrop, handleSelector } = {}) {
  let dragEl = null;       // the row being dragged
  let pointerId = null;

  const rows = () => Array.from(container.children).filter(el => el.dataset && el.dataset.id != null);

  const onPointerDown = (e) => {
    // Primary button / single touch only. Respect an optional drag handle.
    if (e.button != null && e.button !== 0) return;
    const row = e.target.closest('[data-id]');
    if (!row || row.parentElement !== container) return;
    if (handleSelector && !e.target.closest(handleSelector)) return;
    dragEl = row;
    pointerId = e.pointerId;
    row.classList.add('dragging');
    // Capture so we keep getting moves even if the pointer leaves the row.
    try { row.setPointerCapture(pointerId); } catch (_) {}
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragEl || e.pointerId !== pointerId) return;
    e.preventDefault();
    const y = e.clientY;
    // Find the sibling whose vertical midpoint the pointer has crossed and
    // insert the dragged row before it; past the last midpoint, append.
    const siblings = rows().filter(r => r !== dragEl);
    let placed = false;
    for (const sib of siblings) {
      const rect = sib.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (y < mid) { container.insertBefore(dragEl, sib); placed = true; break; }
    }
    if (!placed) container.appendChild(dragEl);
  };

  const finish = (e) => {
    if (!dragEl || (e && e.pointerId !== pointerId)) return;
    const moved = dragEl;
    moved.classList.remove('dragging');
    try { moved.releasePointerCapture(pointerId); } catch (_) {}
    const newIndex = rows().indexOf(moved);
    dragEl = null;
    pointerId = null;
    if (typeof onDrop === 'function') onDrop(moved.dataset.id, newIndex);
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', finish);

  return function cleanup() {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', finish);
    container.removeEventListener('pointercancel', finish);
  };
};
