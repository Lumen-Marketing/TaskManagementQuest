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

    this.btn = document.getElementById('scaleBtn');
    if (!this.btn) return;
    this.popover = null;

    this.applyStored();
    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    document.addEventListener('click', (e) => {
      if (this.popover && !this.popover.contains(e.target) && e.target !== this.btn && !this.btn.contains(e.target)) {
        this.close();
      }
    });
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

  toggle() { if (this.popover) this.close(); else this.open(); }

  open() {
    const cur = this.currentScale();
    this.popover = document.createElement('div');
    this.popover.className = 'scale-popover';
    this.popover.innerHTML = `
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
    document.body.appendChild(this.popover);

    const r = this.btn.getBoundingClientRect();
    this.popover.style.position = 'fixed';
    this.popover.style.top   = (r.bottom + 6) + 'px';
    this.popover.style.right = (window.innerWidth - r.right) + 'px';

    const range = this.popover.querySelector('#scaleRange');
    range.addEventListener('input', () => this.apply(parseFloat(range.value)));

    this.popover.querySelectorAll('[data-step]').forEach(b => {
      b.addEventListener('click', () => {
        const dir = b.dataset.step === '+1' ? 1 : -1;
        const next = Math.max(this.MIN, Math.min(this.MAX, this.currentScale() + dir * this.STEP));
        const rounded = Math.round(next / this.STEP) * this.STEP;
        range.value = String(rounded);
        this.apply(rounded);
      });
    });

    this.popover.querySelector('[data-action="reset"]').addEventListener('click', () => {
      range.value = String(this.DEFAULT);
      this.apply(this.DEFAULT);
    });

    this.btn.classList.add('active');
  }

  close() {
    if (this.popover) this.popover.remove();
    this.popover = null;
    this.btn.classList.remove('active');
  }

  updateReadout(scale) {
    const el = this.popover && this.popover.querySelector('#scaleReadout');
    if (el) el.textContent = `${Math.round(scale * 100)}%`;
  }
};
