(function () {
  'use strict';

  window.App = window.App || {};

  function sectionForHash() {
    return ({ workforce: 'team', transform: 'reports' })[App.controller?.questDomain]
      || App.controller?.questDomain || 'home';
  }

  function labelOf(el) {
    return String(el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function apply() {
    const section = sectionForHash();

    document.body.dataset.routeSection = section;

    /*
     * Scope this to the top navigation only.
     * We deliberately support anchors, buttons and data-view driven controls
     * because Quest currently uses a mixture of navigation patterns.
     */
    const navRoots = Array.from(
      document.querySelectorAll(
        'header, .topbar, .top-bar, .app-header, .app-nav'
      )
    );

    const roots = navRoots.length ? navRoots : [document.body];

    roots.forEach(root => {
      const candidates = Array.from(
        root.querySelectorAll('a, button, [data-view]')
      );

      candidates.forEach(el => {
        if (!['home', 'tasks', 'projects', 'team', 'reports'].includes(labelOf(el))) {
          return;
        }

        const active = labelOf(el) === section;

        el.classList.toggle('route-active', active);

        if (active) {
          el.setAttribute('aria-current', 'page');
        } else if (el.getAttribute('aria-current') === 'page') {
          el.removeAttribute('aria-current');
        }
      });
    });
  }

  function boot() {
    apply();

    window.addEventListener('hashchange', apply);

    if (App.EventBus && typeof App.EventBus.on === 'function') {
      App.EventBus.on('view:changed', apply);
    }

    const observer = new MutationObserver(() => apply());

    const nav =
      document.querySelector('header, .topbar, .top-bar, .app-header, .app-nav');

    if (nav) {
      observer.observe(nav, {
        childList: true,
        subtree: true
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
