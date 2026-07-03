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

  // Pending/async state for a button: disable it and show a spinner (CSS owns
  // the .is-busy look) so the user sees the action is in flight. Returns a
  // restore() to call when the promise settles. Idempotent-safe: restore()
  // re-enables and clears the class. Works with or without motion (the spinner
  // is a affordance, not a delight — reduced-motion still shows a static mark).
  function busy(el) {
    if (!el) return function () {};
    const wasDisabled = el.disabled === true;
    el.classList.add('is-busy');
    if ('disabled' in el) el.disabled = true;
    el.setAttribute('aria-busy', 'true');
    return function restore() {
      el.classList.remove('is-busy');
      if ('disabled' in el) el.disabled = wasDisabled;
      el.removeAttribute('aria-busy');
    };
  }

  // Error feedback: a quick horizontal shake + red flash. Used when a save
  // fails, the app goes offline, or input validation rejects a field. Under
  // reduced motion we skip the shake but still flash so failure is visible.
  function shake(el) {
    if (!el || typeof el.animate !== 'function') return;
    if (reduce()) {
      el.animate(
        [{ filter: 'none' }, { filter: 'brightness(1.4) saturate(1.6)' }, { filter: 'none' }],
        { duration: 300, easing: 'ease-out' }
      );
      return;
    }
    el.animate(
      [{ transform: 'translateX(0)' },
       { transform: 'translateX(-6px)', offset: 0.15 },
       { transform: 'translateX(5px)', offset: 0.3 },
       { transform: 'translateX(-4px)', offset: 0.45 },
       { transform: 'translateX(3px)', offset: 0.6 },
       { transform: 'translateX(-2px)', offset: 0.75 },
       { transform: 'translateX(0)' }],
      { duration: 440, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' }
    );
  }

  // Destructive-action feedback: collapse a row/card out (fade + slide + shrink
  // its own height) then run done() — which typically removes it from the model
  // and re-renders. Under reduced motion, run done() immediately. done() always
  // runs exactly once, even if the animation is interrupted.
  function collapseOut(el, done) {
    const finish = typeof done === 'function' ? done : function () {};
    if (!el || typeof el.animate !== 'function' || reduce()) { finish(); return; }
    const h = el.getBoundingClientRect().height;
    let called = false;
    const run = () => { if (!called) { called = true; finish(); } };
    const anim = el.animate(
      [{ opacity: 1, transform: 'translateX(0)', height: h + 'px', marginTop: getComputedStyle(el).marginTop, marginBottom: getComputedStyle(el).marginBottom },
       { opacity: 0, transform: 'translateX(-24px)', height: '0px', marginTop: '0px', marginBottom: '0px' }],
      { duration: 260, easing: 'cubic-bezier(0.4, 0, 1, 1)' }
    );
    el.style.overflow = 'hidden';
    anim.onfinish = run;
    anim.oncancel = run;
    // Safety net in case the WAAPI events don't fire (element detached early).
    setTimeout(run, 320);
  }

  return { pop, pulse, check, arrive, flip, busy, shake, collapseOut, reduce };
})();
