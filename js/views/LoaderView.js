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
  let onMove = null;
  let tickerFn = null;
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
    let mouseX = window.innerWidth / 2;
    const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    let drift = 0.5, dir = 1;

    onMove = (e) => { mouseX = e.clientX; };
    window.addEventListener('mousemove', onMove);

    if (!window.gsap) return; // static grid; still hides on boot

    const gsap = window.gsap;
    gsap.ticker.lagSmoothing(0);
    const maxMove = 300;
    const base = 0.8;
    const inertia = [0.6, 0.4, 0.3, 0.2];

    tickerFn = () => {
      // No mouse (touch) → gently oscillate so the rows still drift.
      if (!finePointer) {
        drift += 0.0025 * dir;
        if (drift >= 1 || drift <= 0) dir *= -1;
        mouseX = drift * window.innerWidth;
      }
      rowEls.forEach((row, index) => {
        const direction = index % 2 === 0 ? 1 : -1;
        const moveAmount = ((mouseX / window.innerWidth) * maxMove - maxMove / 2) * direction;
        gsap.to(row, {
          x: moveAmount,
          duration: base + inertia[index % inertia.length],
          ease: 'power3.out',
          overwrite: 'auto',
        });
      });
    };
    gsap.ticker.add(tickerFn);
  }

  // Immediate teardown of the animation loop + listeners (no DOM removal). Safe to
  // call from the role-gate / fatal-error paths before they replace document.body.
  function stop() {
    if (stopped) return;
    stopped = true;
    if (onMove) { window.removeEventListener('mousemove', onMove); onMove = null; }
    if (window.gsap && tickerFn) { window.gsap.ticker.remove(tickerFn); tickerFn = null; }
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
