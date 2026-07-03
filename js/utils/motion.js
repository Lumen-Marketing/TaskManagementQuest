window.App = window.App || {};

/* Microinteraction helper for the six JS-triggered "hero" moments.
   Web Animations API only — no dependencies, no build step. Every method is a
   no-op-but-correct fallback under prefers-reduced-motion (the state change the
   caller already made stays; we just skip the animation). Views call these and
   never branch on reduced-motion themselves — the single gate lives here.

   All animations use transform/opacity only (compositor-friendly). Durations and
   easings mirror the tokens in tokens.css so JS and CSS share one rhythm. */
App.Motion = (function () {
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduce = () => !!(mq && mq.matches);
  const canAnimate = (el) => !!(el && typeof el.animate === 'function' && !reduce());

  // Springy scale pop — badges, checkmarks, counters, rank chips.
  function pop(el) {
    if (!canAnimate(el)) return;
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }],
      { duration: 360, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
    );
  }

  // Success confirmation — a single soft pulse. Used when a save lands or a
  // timer changes state. Confirms the async result, not the click.
  function pulse(el) {
    if (!canAnimate(el)) return;
    el.animate(
      [{ transform: 'scale(1)', opacity: 1 },
       { transform: 'scale(1.14)', opacity: 0.75, offset: 0.4 },
       { transform: 'scale(1)', opacity: 1 }],
      { duration: 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    );
  }

  // Completion check — pop the element, then wipe a soft radial highlight so the
  // check reads as "drawn in". Works on any element (we don't require an SVG
  // path, so it's safe on the icon-font checkmarks this app uses).
  function check(el) {
    if (!canAnimate(el)) return;
    el.animate(
      [{ transform: 'scale(0.4) rotate(-12deg)', opacity: 0 },
       { transform: 'scale(1.25) rotate(4deg)', opacity: 1, offset: 0.55 },
       { transform: 'scale(1) rotate(0deg)', opacity: 1 }],
      { duration: 420, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
    );
  }

  // Entrance for a just-created row/card: spring-rise into place, then a warm
  // highlight tint that fades over ~2s so the eye lands on the new item —
  // visible proof it was created. Two layered animations on one element.
  function arrive(el) {
    // Reduced-motion: skip entirely — the success toast already confirms creation.
    if (!canAnimate(el)) return;
    el.animate(
      [{ transform: 'translateY(10px) scale(0.98)', opacity: 0 },
       { transform: 'translateY(0) scale(1)', opacity: 1 }],
      { duration: 400, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
    );
    el.animate(
      [{ boxShadow: '0 0 0 9999px rgba(237, 78, 13, 0.14)', offset: 0 },
       { boxShadow: '0 0 0 9999px rgba(237, 78, 13, 0.14)', offset: 0.15 },
       { boxShadow: '0 0 0 9999px rgba(237, 78, 13, 0)', offset: 1 }],
      { duration: 2000, easing: 'ease-out' }
    );
  }

  // FLIP: run `mutate()` (which reorders/regroups children of `container`), then
  // glide each moved child from its old box to its new one instead of teleporting.
  // Children must carry data-id so we can pair before/after positions.
  function flip(container, mutate) {
    if (!container || typeof mutate !== 'function') { if (typeof mutate === 'function') mutate(); return; }
    if (reduce() || typeof container.querySelectorAll !== 'function') { mutate(); return; }

    const first = new Map();
    container.querySelectorAll('[data-id]').forEach((el) => {
      first.set(el.dataset.id, el.getBoundingClientRect());
    });

    mutate();

    container.querySelectorAll('[data-id]').forEach((el) => {
      const prev = first.get(el.dataset.id);
      if (!prev || typeof el.animate !== 'function') return;
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      if (!dx && !dy) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
      );
    });
  }

  return { pop, pulse, check, arrive, flip, reduce };
})();
