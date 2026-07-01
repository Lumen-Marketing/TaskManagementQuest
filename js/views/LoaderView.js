window.App = window.App || {};

/* Boot loading screen — a vanilla port of the React Bits "GridMotion" component
   (the app is a zero-build static SPA, so the JSX/React original can't run here).
   A 4x7 grid of image tiles, rotated, with GSAP mouse-parallax on the rows; a
   centered Quest HQ mark sits on top so it reads as "loading". Mounts itself into
   #appLoader as soon as this script runs (placed right after the div in app.html),
   and app.js calls App.hideAppLoader() once boot finishes.

   Classes are prefixed `ldr-` so generic names (.row/.intro/.noscroll) can't clash
   with app styles. GSAP is optional — if the CDN is blocked the grid still shows
   statically and still hides on boot. */
App.LoaderView = (function () {
  // One image, reused for every tile (the browser dedupes to a single request).
  // Sized down from the source URL — this is a brief loader, not a gallery.
  const IMG = 'https://images.unsplash.com/photo-1748370987492-eb390a61dcda?q=80&w=1600&auto=format&fit=crop';
  const ROWS = 4;
  const COLS = 7;
  const MIN_MS = 1000;   // keep it on screen long enough to be seen
  const FADE_MS = 600;   // must match the #appLoader opacity transition
  const MAX_MS = 15000;  // safety: dismiss even if boot never signals

  let mountAt = 0;
  let rowEls = [];
  let tweens = [];
  let hiding = false;
  let stopped = false;

  function build() {
    const root = document.getElementById('appLoader');
    if (!root || root.dataset.built) return;
    root.dataset.built = '1';
    mountAt = Date.now();

    const intro = document.createElement('section');
    intro.className = 'ldr-intro';

    const grid = document.createElement('div');
    grid.className = 'ldr-grid';
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'ldr-row';
      for (let c = 0; c < COLS; c++) {
        const item = document.createElement('div');
        item.className = 'ldr-item';
        const inner = document.createElement('div');
        inner.className = 'ldr-item-inner';
        const img = document.createElement('div');
        img.className = 'ldr-item-img';
        img.style.backgroundImage = `url("${IMG}")`;
        inner.appendChild(img);
        item.appendChild(inner);
        row.appendChild(item);
      }
      grid.appendChild(row);
      rowEls.push(row);
    }
    intro.appendChild(grid);

    const brand = document.createElement('div');
    brand.className = 'ldr-brand';
    brand.innerHTML =
      '<div class="ldr-logo"><i class="ti ti-bolt"></i></div>' +
      '<div class="ldr-name">Quest HQ</div>' +
      '<div class="ldr-dots"><span></span><span></span><span></span></div>';
    intro.appendChild(brand);

    root.appendChild(intro);
    startAnim();

    // Safety net: never let the loader trap the app if boot silently fails.
    setTimeout(hide, MAX_MS);
  }

  function startAnim() {
    const grid = document.querySelector('#appLoader .ldr-grid');

    // No GSAP (CDN blocked) → fall back to a pure-CSS oscillation so it STILL moves.
    if (!window.gsap) {
      if (grid) grid.classList.add('ldr-fallback');
      return;
    }

    // Continuous automatic parallax: each row glides back and forth on its own,
    // alternating direction and speed. No mouse needed — it always moves.
    const gsap = window.gsap;
    gsap.ticker.lagSmoothing(0);
    tweens = rowEls.map((row, index) => {
      const direction = index % 2 === 0 ? 1 : -1;
      const amp = 130 * direction;
      return gsap.fromTo(
        row,
        { x: -amp },
        { x: amp, duration: 2.2 + index * 0.5, ease: 'sine.inOut', repeat: -1, yoyo: true }
      );
    });
  }

  // Immediate teardown of the animation loop + listeners (no DOM removal). Safe to
  // call from the role-gate / fatal-error paths before they replace document.body.
  function stop() {
    if (stopped) return;
    stopped = true;
    if (tweens.length) { tweens.forEach(tw => { if (tw && tw.kill) tw.kill(); }); tweens = []; }
  }

  // Graceful hide: enforce a minimum on-screen time, fade out, then remove.
  function hide() {
    if (hiding) return;
    hiding = true;
    const root = document.getElementById('appLoader');
    if (!root) { stop(); return; }
    const wait = Math.max(0, MIN_MS - (Date.now() - mountAt));
    setTimeout(() => {
      stop();
      root.classList.add('is-hiding');
      setTimeout(() => { if (root.parentNode) root.parentNode.removeChild(root); }, FADE_MS);
    }, wait);
  }

  // Mount now — this script is placed immediately after #appLoader in app.html.
  build();

  return { hide, stop, build };
})();

App.hideAppLoader = function () { if (App.LoaderView) App.LoaderView.hide(); };
