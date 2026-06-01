window.App = window.App || {};

/* ResizeHandleView — drag handle that resizes the right detail pane.
   Writes the live width to a CSS var on .main (consumed by
   .main.with-detail) and persists it to localStorage. */
App.ResizeHandleView = class ResizeHandleView {
  constructor({ controller }) {
    this.controller = controller;
    this.handle = document.getElementById('resizeHandle');
    this.main   = document.getElementById('mainPane');
    this.detail = document.getElementById('detailPane');
    if (!this.handle || !this.main) return;

    this.STORAGE_KEY = 'questhq:detail-width';
    this.MIN = 320;            // detail pane never narrower than this
    this.LIST_MIN = 520;       // list pane keeps at least this much room
    this.MAX_VW_HARD = 0.7;    // and never more than 70% of viewport regardless

    this.applyStoredWidth();
    this.syncVisibility();
    this.bindDrag();
    this.subscribe();
  }

  subscribe() {
    App.EventBus.on('selection:changed', () => this.syncVisibility());
    App.EventBus.on('view:changed',      () => this.syncVisibility());
    window.addEventListener('resize',    () => this.applyStoredWidth());
  }

  /* The handle is only meaningful when the detail pane is showing. */
  syncVisibility() {
    const hasDetail = this.main.classList.contains('with-detail') && !this.detail.classList.contains('hidden');
    this.handle.classList.toggle('hidden', !hasDetail);
    if (hasDetail) this.positionHandle();
  }

  /* Pin the handle to the left edge of the detail pane. Detail width comes
     from CSS var --detail-width, so we read computed style off the pane. */
  positionHandle() {
    const rect = this.detail.getBoundingClientRect();
    const mainRect = this.main.getBoundingClientRect();
    this.handle.style.left = (rect.left - mainRect.left) + 'px';
  }

  applyStoredWidth() {
    let width = parseInt(localStorage.getItem(this.STORAGE_KEY) || '340', 10);
    width = this.clamp(width);
    this.main.style.setProperty('--detail-width', width + 'px');
    if (this.main.classList.contains('with-detail')) this.positionHandle();
  }

  clamp(px) {
    // Always leave LIST_MIN px for the list; also cap at MAX_VW_HARD of
    // viewport. On narrow viewports LIST_MIN is the binding constraint;
    // on wide ones MAX_VW_HARD kicks in.
    const mainWidth = (this.main && this.main.getBoundingClientRect().width) || window.innerWidth;
    const maxByList = Math.max(this.MIN, mainWidth - this.LIST_MIN);
    const maxByVw   = Math.floor(window.innerWidth * this.MAX_VW_HARD);
    const max = Math.min(maxByList, maxByVw);
    return Math.max(this.MIN, Math.min(max, px));
  }

  bindDrag() {
    let startX = 0;
    let startWidth = 0;
    let dragging = false;
    let pointerId = null;

    const onMove = (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = startX - e.clientX;
      const next = this.clamp(startWidth + dx);
      this.main.style.setProperty('--detail-width', next + 'px');
      this.positionHandle();
    };
    const onUp = (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      this.handle.classList.remove('dragging');
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const px = parseInt(getComputedStyle(this.main).getPropertyValue('--detail-width'), 10);
      if (!Number.isNaN(px)) localStorage.setItem(this.STORAGE_KEY, String(px));
    };

    // Block native touch scrolling on the handle so drags don't scroll the page.
    this.handle.style.touchAction = 'none';

    this.handle.addEventListener('pointerdown', (e) => {
      if (dragging) return;
      e.preventDefault();
      dragging = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startWidth = this.detail.getBoundingClientRect().width;
      this.handle.classList.add('dragging');
      document.body.classList.add('is-resizing');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    this.handle.addEventListener('dblclick', () => {
      const next = 340;
      this.main.style.setProperty('--detail-width', next + 'px');
      localStorage.setItem(this.STORAGE_KEY, String(next));
      this.positionHandle();
    });
  }
};
