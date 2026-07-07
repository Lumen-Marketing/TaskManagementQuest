window.App = window.App || {};

/* UiScaleView — zoom slider in the topbar that resizes the whole app for
   wide-screen users. Writes the scale to a CSS variable on :root which is
   read by .app { zoom: var(--ui-scale) }. Persisted to localStorage. */
App.UiScaleView = class UiScaleView {
  constructor() {
    this.STORAGE_KEY = 'questhq:ui-scale';
    this.MIN = 0.85;
    this.MAX = 1.4;
    this.STEP = 0.05;
    this.DEFAULT = 1;

    this.popover = null;

    // Always apply the stored scale on boot, even though the trigger now lives
    // in the account menu (there's no dedicated top-bar button anymore).
    this.applyStored();

    // Back-compat: if a #scaleBtn is present, keep wiring it.
    this.btn = document.getElementById('scaleBtn');
    if (this.btn) {
      this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleAt(this.btn); });
    }
    // Dismissal (click-away / Esc) is App.Menu's job.
  }

  currentScale() {
    const v = parseFloat(localStorage.getItem(this.STORAGE_KEY) || String(this.DEFAULT));
    return Number.isFinite(v) ? Math.max(this.MIN, Math.min(this.MAX, v)) : this.DEFAULT;
  }

  apply(scale) {
    document.documentElement.style.setProperty('--ui-scale', String(scale));
    try { localStorage.setItem(this.STORAGE_KEY, String(scale)); } catch (e) {}
    if (this.popover) this.updateReadout(scale);
  }

  applyStored() { this.apply(this.currentScale()); }

  // Public entry point used by the account menu: open the scale popover
  // anchored to a given element (falls back to the legacy button).
  openAt(anchor) {
    if (this._handle) this._handle.close('api');
    const anchorEl = anchor || this.btn;
    const cur = this.currentScale();
    this._handle = App.Menu.open({
      anchor: anchorEl,
      className: 'scale-popover',
      placement: 'bottom-end',
      onClose: () => {
        this._handle = null;
        this.popover = null;
        if (this.btn) this.btn.classList.remove('active');
      },
      build: (pop) => {
        this.popover = pop;
        pop.innerHTML = `
          <div class="scale-pop-title">Display size</div>
          <div class="scale-pop-row">
            <button class="scale-step" data-step="-1" aria-label="Smaller"><i class="ti ti-zoom-out"></i></button>
            <input type="range" id="scaleRange" min="${this.MIN}" max="${this.MAX}" step="${this.STEP}" value="${cur}" />
            <button class="scale-step" data-step="+1" aria-label="Bigger"><i class="ti ti-zoom-in"></i></button>
          </div>
          <div class="scale-pop-readout">
            <span id="scaleReadout">${Math.round(cur * 100)}%</span>
            <button class="scale-reset" data-action="reset">Reset</button>
          </div>
          <div class="scale-pop-hint">Drag the slider or use the +/− buttons to scale the whole app. Saved per browser.</div>
        `;
        const range = pop.querySelector('#scaleRange');
        range.addEventListener('input', () => this.apply(parseFloat(range.value)));
        pop.querySelectorAll('[data-step]').forEach(b => {
          b.addEventListener('click', () => {
            const dir = b.dataset.step === '+1' ? 1 : -1;
            const next = Math.max(this.MIN, Math.min(this.MAX, this.currentScale() + dir * this.STEP));
            const rounded = Math.round(next / this.STEP) * this.STEP;
            range.value = String(rounded);
            this.apply(rounded);
          });
        });
        pop.querySelector('[data-action="reset"]').addEventListener('click', () => {
          range.value = String(this.DEFAULT);
          this.apply(this.DEFAULT);
        });
      },
    });
    if (this.btn) this.btn.classList.add('active');
  }

  toggleAt(anchor) { if (this._handle) this._handle.close('api'); else this.openAt(anchor); }

  close() {
    if (this._handle) this._handle.close('api');
  }

  updateReadout(scale) {
    const el = this.popover && this.popover.querySelector('#scaleReadout');
    if (el) el.textContent = `${Math.round(scale * 100)}%`;
  }
};
