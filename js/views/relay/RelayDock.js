(function () {
  'use strict';

  window.App = window.App || {};

  class RelayDock {
    constructor() {
      this.open = localStorage.getItem('quest:relay:open') === '1';

      // Focus is session-only.
      this.expanded = false;

      this.mode = 'pulse';
      this.composeKind = 'update';

      this.dock =
        localStorage.getItem('quest:relay:dock') ||
        'bottom-center';

      try {
        this.position = JSON.parse(
          localStorage.getItem('quest:relay:position') || 'null'
        );
      } catch (_) {
        this.position = null;
      }

      this._drag = null;
      this._trailAt = 0;

      // Route continuity.
      this.travelling = false;
      this.travelLabel = '';
      this._travelTimer = null;
      this._routeSettleTimer = null;

      // Relay should arrive after the environment settles.
      this.ready = false;
      this._readyTimer = null;

      this._flashTimer = null;
      this._resizeBound = false;
      this._escapeBound = false;

      this._onHashChange = this._onHashChange.bind(this);
      this._onViewChange = this._onViewChange.bind(this);
    }

    /* =====================================================
       MOUNT / LIFECYCLE
       ===================================================== */

    mount() {
      if (document.querySelector('[data-relay-root]')) return;

      this.root = document.createElement('div');
      this.root.id = 'relayDock';
      this.root.dataset.relayRoot = 'true';
      this.root.dataset.relayReady = 'false';

      document.body.appendChild(this.root);

      this.render();
      this.bind();

      window.addEventListener(
        'hashchange',
        this._onHashChange
      );

      if (
        App.EventBus &&
        typeof App.EventBus.on === 'function'
      ) {
        App.EventBus.on(
          'view:changed',
          this._onViewChange
        );

        App.EventBus.on(
          'comments:changed',
          () => {
            this.render();
            this.bind();
          }
        );
      }
      ['notifs:changed', 'people:changed', 'role:changed'].forEach(name => App.EventBus.on(name, () => { this.render(); this.bind(); }));
      this.setReady(true);
      this.waitForQuestReady();

      /*
       * First load:
       * let the Quest environment / motion resolve first,
       * then introduce Relay.
       */
      // requestAnimationFrame(() => {
      //   requestAnimationFrame(() => {
      //     this._readyTimer = setTimeout(() => {
      //       this.setReady(true);
      //       this.waitForQuestReady();
      //     }, 240);
      //   });
      // });
    }

    setReady(value) {
      this.ready = !!value;

      if (!this.root) return;

      this.root.dataset.relayReady =
        this.ready ? 'true' : 'false';
    }

    waitForQuestReady() {
      clearTimeout(this._readyTimer);

      const loader = document.getElementById('appLoader');

      if (!loader) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.setReady(true);
          });
        });

        return;
      }

      this.setReady(false);

      const loaderIsFinished = () => {
        if (!loader.isConnected) return true;

        const style = window.getComputedStyle(loader);
        const opacity = Number.parseFloat(style.opacity || '1');

        return (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          loader.hidden === true ||
          loader.classList.contains('hidden') ||
          opacity <= 0.01
        );
      };

      let finished = false;

      let observer;
      let checkInterval;

      const finish = () => {
        if (finished) return;
        finished = true;

        observer?.disconnect();
        clearInterval(checkInterval);
        clearTimeout(this._readyTimer);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            this.applyDock();
            this.setReady(true);
          });
        });
      };

      const check = () => {
        if (loaderIsFinished()) {
          finish();
        }
      };

      observer = new MutationObserver(check);

      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class', 'style', 'hidden']
      });

      checkInterval = window.setInterval(check, 50);

      this._readyTimer = window.setTimeout(finish, 16000);

      check();
    }

    _onHashChange() {
      const hash = String(
        window.location.hash || ''
      ).toLowerCase();

      let label = 'Moving through Quest';

      if (hash.includes('/task/')) {
        label = 'Opening task';
      } else if (hash.includes('projects')) {
        label = 'Opening projects';
      } else if (
        hash.includes('team') ||
        hash.includes('time')
      ) {
        label = 'Opening team';
      } else if (hash.includes('reports')) {
        label = 'Opening reports';
      } else if (hash.includes('wallboard')) {
        label = 'Opening wallboard';
      } else if (hash.includes('tasks')) {
        label = 'Opening tasks';
      } else {
        label = 'Opening Quest';
      }

      this.beginTravel(label);

      clearTimeout(this._routeSettleTimer);

      this._routeSettleTimer = setTimeout(() => {
        this.finishTravel();
      }, 260);
    }

    _onViewChange() {
      clearTimeout(this._travelTimer);
      this.travelling = false;
      this.render();
      this.bind();
      this.setReady(true);
    }

    beginTravel(label = '') {
      clearTimeout(this._travelTimer);
      clearTimeout(this._readyTimer);

      this.setReady(false);

      this.travelling = true;
      this.travelLabel =
        label || 'Moving through Quest';

      /*
       * Focus should never cover the world while the
       * world itself is changing.
       */
      if (this.expanded) {
        this.expanded = false;
      }

      this.render();
      this.bind();
    }

    finishTravel() {
      clearTimeout(this._travelTimer);
      clearTimeout(this._readyTimer);

      this._travelTimer =
        setTimeout(() => {
          this.travelling = false;
          this.travelLabel = '';

          this.render();
          this.bind();

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              this.applyDock();
              this.setReady(true);
            });
          });
        }, 100);
    }

    notificationCount() {
      return App.controller?.notifModel?.unreadCount() || 0;
    }

    userInfo() {
      const profile = App.currentProfile || {};
      const person = App.directory?.person(App.CURRENT_USER);
      const name = profile.full_name || person?.full || person?.name || profile.email || 'Signed-in user';
      return { name, role: App.effectiveRole(), initials: App.utils.initials(name) };
    }

    context() {
      /*
       * Relay follows the canonical lifecycle route directly.
       * AppController.activePhase can briefly lag the hash during shell
       * reconciliation, which previously left Relay on Query while Execute
       * was already visible.
       */
      const hash = String(window.location.hash || '').toLowerCase();

      const routePhase = [
        ['#/view/query',   'query',   'Query'],
        ['#/view/unit',    'unit',    'Unit'],
        ['#/view/execute', 'execute', 'Execute'],
        ['#/view/sight',   'sight',   'Sight'],
        ['#/view/total',   'total',   'Total']
      ].find(([route]) => hash.startsWith(route));

      if (routePhase) {
        return {
          kind: routePhase[1],
          label: routePhase[2]
        };
      }

      const phase = App.controller?.activePhase;

      return {
        kind: phase?.key || 'query',
        label: phase?.label || 'Query'
      };
    }

    /* =====================================================
       OPEN / FOCUS / MODES
       ===================================================== */

    setOpen(value) {
      this.open = !!value;

      localStorage.setItem(
        'quest:relay:open',
        this.open ? '1' : '0'
      );

      this.render();
      this.bind();
    }

    setExpanded(value) {
      this.expanded = !!value;

      this.render();
      this.bind();

      requestAnimationFrame(() => {
        if (
          this.expanded &&
          this.mode === 'find'
        ) {
          this.root
            .querySelector('.relay-v2-search')
            ?.focus();
        }

        if (
          this.expanded &&
          this.mode === 'compose'
        ) {
          this.root
            .querySelector('.relay-v2-input')
            ?.focus();
        }
      });
    }

    toggleExpanded() {
      this.setExpanded(!this.expanded);
    }

    setMode(mode) {
      this.mode = mode;

      this.render();
      this.bind();

      requestAnimationFrame(() => {
        if (mode === 'find') {
          this.root
            .querySelector('.relay-v2-search')
            ?.focus();
        }

        if (mode === 'compose') {
          this.root
            .querySelector('.relay-v2-input')
            ?.focus();
        }
      });
    }

    openComposer({
      mode = 'update',
      text = ''
    } = {}) {
      this.composeKind = mode;
      this.mode = 'compose';
      this.open = true;

      localStorage.setItem(
        'quest:relay:open',
        '1'
      );

      this.render();
      this.bind();

      requestAnimationFrame(() => {
        const input =
          this.root.querySelector(
            '.relay-v2-input'
          );

        if (!input) return;

        input.value = text;
        input.focus();

        const pos = input.value.length;
        input.setSelectionRange(pos, pos);
      });
    }

    /* =====================================================
       POSITION / DOCKING
       ===================================================== */

    setDock(dock) {
      const allowed = [
        'bottom-center',
        'bottom-left',
        'bottom-right',
        'left',
        'right'
      ];

      if (!allowed.includes(dock)) return;

      this.dock = dock;

      localStorage.setItem(
        'quest:relay:dock',
        dock
      );

      this.applyDock();
    }

    applyDock() {
      if (!this.root) return;

      /*
       * Expanded Relay becomes a centered operating
       * surface and ignores dock position.
       */
      if (this.expanded) {
        this.root.dataset.relayDock =
          'focus';

        this.root.style.removeProperty(
          'left'
        );

        this.root.style.removeProperty(
          'top'
        );

        this.root.style.removeProperty(
          'right'
        );

        this.root.style.removeProperty(
          'bottom'
        );

        this.root.style.removeProperty(
          'transform'
        );

        return;
      }

      /*
       * Default controller position.
       */
      this.root.dataset.relayDock =
        'bottom-center';

      this.root.style.left = '50%';
      this.root.style.top = 'auto';
      this.root.style.right = 'auto';
      this.root.style.bottom = '18px';
      this.root.style.transform =
        'translateX(-50%)';
    }

    /* =====================================================
       GLOBAL QUEST BRIDGES
       ===================================================== */

    claimGlobalControls() {
      /*
       * Relay becomes the visible controller while the
       * existing proven mechanisms can remain underneath.
       */

      const search =
        document.querySelector(
          'input[placeholder*="Search tasks"]'
        ) ||
        document.querySelector(
          'input[placeholder*="Search"]'
        );

      if (
        search &&
        !this.root.contains(search)
      ) {
        search
          .closest(
            'form, .search, .global-search, div'
          )
          ?.classList.add(
            'relay-owned-global-search'
          );
      }

      Array.from(
        document.querySelectorAll('button')
      ).forEach(button => {
        if (this.root.contains(button)) {
          return;
        }

        const text = String(
          button.textContent || ''
        )
          .trim()
          .toLowerCase();

        if (
          text.includes('clock in') ||
          text.includes('clock out')
        ) {
          button.classList.add(
            'relay-owned-clock'
          );
        }
      });

      const notif =
        document.querySelector(
          '[data-action="notifications"]'
        ) ||
        document.querySelector(
          '[aria-label*="Notification"]'
        ) ||
        document.querySelector(
          '[title*="Notification"]'
        );

      if (
        notif &&
        !this.root.contains(notif)
      ) {
        notif.classList.add(
          'relay-owned-notifications'
        );
      }

      const wallboard =
        document.querySelector(
          '[data-view="wallboard"]'
        );

      if (
        wallboard &&
        !this.root.contains(wallboard)
      ) {
        wallboard.classList.add(
          'relay-owned-wallboard'
        );
      }
    }

    openGlobalSearch() {
      const selectors = [
        'input[placeholder*="Search tasks"]',
        'input[placeholder*="Search"]',
        '[data-global-search] input',
        '#globalSearch'
      ];

      for (const selector of selectors) {
        const input =
          document.querySelector(selector);

        if (
          input &&
          !this.root.contains(input)
        ) {
          input.focus();
          input.select?.();

          return true;
        }
      }

      return false;
    }

    triggerWallboard() {
      const controller =
        (window.App && App.controller) ||
        window.appController ||
        null;

      /*
       * Prefer the real app controller.
       */
      if (
        controller &&
        typeof controller.setView ===
          'function'
      ) {
        controller.setView('wallboard');
        return true;
      }

      /*
       * Compatibility fallback.
       */
      const wallboard =
        document.querySelector(
          '[data-view="wallboard"]'
        );

      if (
        wallboard &&
        !this.root.contains(wallboard)
      ) {
        wallboard.click();
        return true;
      }

      return false;
    }

    triggerClock() {
      const buttons = Array.from(
        document.querySelectorAll('button')
      );

      const clock = buttons.find(btn => {
        if (this.root.contains(btn)) {
          return false;
        }

        const text = String(
          btn.textContent || ''
        )
          .trim()
          .toLowerCase();

        return (
          text === 'clock in' ||
          text.includes('clock in') ||
          text.includes('clock out')
        );
      });

      if (!clock) return false;

      clock.click();

      return true;
    }

    triggerNotifications() {
      const selectors = [
        '[data-action="notifications"]',
        '[aria-label*="Notification"]',
        '[title*="Notification"]'
      ];

      for (const selector of selectors) {
        const el =
          document.querySelector(selector);

        if (
          el &&
          !this.root.contains(el)
        ) {
          el.click();
          return true;
        }
      }

      return false;
    }

    /* =====================================================
       COMPOSER / TRAIL
       ===================================================== */

    async submitComposer() {
      const input =
        this.root.querySelector(
          '.relay-v2-input'
        );

      const text =
        input?.value.trim();

      if (!text) return;

      const ctx = this.context();

      if (this.composeKind === 'send') {
        this.flash(
          'Direct Send is not wired yet'
        );

        return;
      }

      if (
        ctx.kind === 'task' &&
        typeof window.__questRelayTaskBridge ===
          'function'
      ) {
        const button =
          this.root.querySelector(
            '.relay-v2-send'
          );

        if (button) {
          button.disabled = true;
          button.classList.add(
            'is-sending'
          );
        }

        try {
          const saved =
            await window.__questRelayTaskBridge({
              mode: this.composeKind,
              text,
              context: ctx
            });

          if (!saved) {
            this.flash('Not saved');
            return;
          }

          input.value = '';

          const labels = {
            update: 'Update posted',
            note: 'Note added',
            call: 'Call logged'
          };

          this.flash(
            labels[this.composeKind] ||
              'Posted'
          );

          window.dispatchEvent(
            new CustomEvent(
              'quest:relay-submit',
              {
                detail: {
                  mode:
                    this.composeKind,
                  text,
                  context: ctx,
                  persisted: true
                }
              }
            )
          );
        } finally {
          if (button) {
            button.disabled = false;
            button.classList.remove(
              'is-sending'
            );
          }
        }

        return;
      }

      this.flash(
        'Open a task to attach this to its Trail'
      );
    }

    flash(message) {
      const el =
        this.root.querySelector(
          '.relay-v2-feedback'
        );

      if (!el) return;

      el.textContent = message;
      el.classList.add('is-visible');

      clearTimeout(this._flashTimer);

      this._flashTimer = setTimeout(() => {
        el.classList.remove(
          'is-visible'
        );
      }, 1800);
    }

    /* =====================================================
       RENDER
       ===================================================== */

    render() {
      if (!this.root) return;

      const ctx = this.context();
      const count =
        this.notificationCount();
      const user =
        typeof this.userInfo === 'function'
          ? this.userInfo()
          : {
              name: 'Quest User',
              role: 'Member',
              initials: 'Q'
            };

      this.root.dataset.relayDock =
        this.dock;

      this.root.dataset.relayExpanded =
        this.expanded
          ? 'true'
          : 'false';

      this.root.dataset.relayTravelling =
        this.travelling
          ? 'true'
          : 'false';

      this.root.dataset.relayAttention =
        count > 0
          ? 'attention'
          : 'normal';

      this.root.dataset.relayReady =
        this.ready
          ? 'true'
          : 'false';

      /*
       * COLLAPSED CONTROLLER
       */
      if (!this.open) {
        this.root.innerHTML = `
          <div class="relay-v2-collapsed">

            <button
              type="button"
              class="relay-v2-operator"
              data-relay-account
              aria-label="Open account"
              title="${this.escape(user.name)}"
            >
              <span class="relay-v2-operator-avatar">
                ${this.escape(user.initials)}
              </span>

              <span class="relay-v2-operator-copy">
                <strong>${this.escape(user.name)}</strong>
              </span>
            </button>

            <button
              class="relay-v2-pill"
              data-relay-action="open"
              type="button"
              aria-label="Open Relay"
            >
              <span class="relay-v2-orb">
                <i class="relay-v2-live"></i>
              </span>

              <span class="relay-v2-pill-main">
                <strong>Relay</strong>

                <small>${
                  this.travelling
                    ? this.escape(
                        this.travelLabel
                      )
                    : this.escape(
                        ctx.label
                      )
                }</small>
              </span>

              ${
                count
                  ? `
                    <span class="relay-v2-count">
                      ${count}
                    </span>
                  `
                  : `
                    <span class="relay-v2-ready">
                      LIVE
                    </span>
                  `
              }
            </button>

            <button
              class="relay-v2-focus-launch"
              data-relay-action="focus-open"
              type="button"
              aria-label="Open Relay Focus"
              title="Open Relay Focus"
            >
              <span
                class="relay-focus-glyph"
                aria-hidden="true"
              >
                ↗
              </span>
            </button>
          </div>
        `;

        return;
      }

      /*
       * OPEN CONTROLLER
       */
      this.root.innerHTML = `
        <section
          class="relay-v2-panel"
          aria-label="Relay"
        >
          <header
            class="relay-v2-head"
          >
            <div class="relay-v2-brand">
              <span class="relay-v2-orb">
                <i class="relay-v2-live"></i>
              </span>

              <div>
                <strong>Relay</strong>
                <small>
                  Your live controller
                </small>
              </div>
            </div>

            <div class="relay-v2-head-right">
              ${
                count
                  ? `
                    <span class="relay-v2-attention">
                      ${count} need you
                    </span>
                  `
                  : `
                    <span class="relay-v2-connected">
                      Live
                    </span>
                  `
              }

              <button
                data-relay-action="expand"
                type="button"
                aria-label="${
                  this.expanded
                    ? 'Restore Relay'
                    : 'Expand Relay'
                }"
                title="${
                  this.expanded
                    ? 'Restore Relay'
                    : 'Expand Relay'
                }"
              >
                <span
                  class="relay-focus-glyph"
                  aria-hidden="true"
                >
                  ${
                    this.expanded
                      ? '↙'
                      : '↗'
                  }
                </span>
              </button>

              <button
                data-relay-action="close"
                type="button"
                aria-label="Collapse Relay"
                title="Collapse Relay"
              >
                <span
                  class="relay-collapse-glyph"
                  aria-hidden="true"
                >
                  ⌄
                </span>
              </button>
            </div>
          </header>

          <div class="relay-controller-identity">
            <button
              type="button"
              class="relay-controller-user relay-controller-user-button"
              data-relay-account
              aria-label="Open account"
            >
              <span class="relay-controller-avatar">
                ${this.escape(
                  user.initials
                )}
              </span>

              <span class="relay-controller-user-copy">
                <strong>
                  ${this.escape(
                    user.name
                  )}
                </strong>

                <small>
                  ${this.escape(
                    user.role
                  )}
                </small>
              </span>
            </button>

            <div class="relay-controller-location">
              <span>YOU'RE IN</span>

              <strong>
                ${this.escape(
                  ctx.label
                )}
              </strong>
            </div>
          </div>

          <nav
            class="relay-v2-nav"
            aria-label="Relay tools"
          >
            ${this.toolButton(
              'pulse',
              'ti-bell',
              'Pulse',
              count
            )}

            ${this.toolButton(
              'compose',
              'ti-message',
              'Act'
            )}

            ${this.toolButton(
              'find',
              'ti-search',
              'Find'
            )}

            ${this.toolButton(
              'clock',
              'ti-clock',
              'Clock'
            )}

            ${this.toolButton(
              'wallboard',
              'ti-device-tv',
              'Wall'
            )}
          </nav>

          <div class="relay-v2-surface">
            ${this.surfaceHtml(
              ctx,
              count
            )}
          </div>

          <div
            class="relay-v2-feedback"
            aria-live="polite"
          ></div>

          <footer class="relay-v2-foot">
            <span>
              Context follows the active phase.
            </span>

            <div>
              <i></i>
              Connected
            </div>
          </footer>
        </section>
      `;
    }

    toolButton(
      mode,
      icon,
      label,
      count = 0
    ) {
      return `
        <button
          class="relay-v2-tool ${
            this.mode === mode
              ? 'is-active'
              : ''
          }"
          data-relay-mode="${mode}"
          type="button"
        >
          <span>
            <i class="ti ${icon}"></i>

            ${
              mode === 'pulse' &&
              count
                ? `<b>${count}</b>`
                : ''
            }
          </span>

          <small>${label}</small>
        </button>
      `;
    }

    surfaceHtml(ctx, count) {
      /*
       * TRAVELLING
       */
      if (this.travelling) {
        return `
          <section class="relay-travel-surface">
            <div class="relay-travel-orbit">
              <span></span>
              <i></i>
            </div>

            <div>
              <span>RELAY</span>

              <strong>
                ${this.escape(
                  this.travelLabel ||
                  'Moving through Quest'
                )}
              </strong>

              <small>
                Staying with you while
                the operating context changes.
              </small>
            </div>
          </section>
        `;
      }

      /*
       * INBOX
       */
      if (this.mode === 'inbox') {
        return `
          <section class="relay-inbox">
            <div class="relay-inbox-head">
              <div>
                <span>INBOX</span>

                <strong>
                  ${
                    count
                      ? `${count} need you`
                      : 'You’re all caught up'
                  }
                </strong>
              </div>

              ${
                count
                  ? `
                    <button
                      type="button"
                      data-relay-action="notifications"
                    >
                      View all
                    </button>
                  `
                  : ''
              }
            </div>

            ${
              count
                ? `
                  <div class="relay-inbox-state">
                    <span class="relay-inbox-pulse"></span>

                    <div>
                      <strong>
                        Something needs your attention.
                      </strong>

                      <small>
                        Relay is carrying your live
                        notifications here.
                      </small>
                    </div>
                  </div>
                `
                : `
                  <div class="relay-inbox-empty">
                    <span class="relay-inbox-check">
                      ✓
                    </span>

                    <div>
                      <strong>Clear.</strong>

                      <small>
                        No new notifications right now.
                      </small>
                    </div>
                  </div>
                `
            }
          </section>
        `;
      }

      /*
       * COMPOSE
       */
      if (this.mode === 'compose') {
        return `
          <div class="relay-v2-compose-types">
            ${this.composeType(
              'update',
              'Update'
            )}

            ${this.composeType(
              'note',
              'Note'
            )}

            ${this.composeType(
              'call',
              'Call'
            )}

            ${this.composeType(
              'send',
              'Send'
            )}
          </div>

          <div class="relay-v2-compose">
            <textarea
              class="relay-v2-input"
              rows="3"
              placeholder="${
                this.composePlaceholder()
              }"
            ></textarea>

            <div class="relay-v2-compose-foot">
              <div>
                <button
                  type="button"
                  aria-label="Mention"
                >
                  <i class="ti ti-at"></i>
                </button>

                <button
                  type="button"
                  aria-label="Attach"
                >
                  <i class="ti ti-paperclip"></i>
                </button>
              </div>

              <button
                class="relay-v2-send"
                data-relay-action="send"
                type="button"
              >
                Send

                <i class="ti ti-arrow-up-right"></i>
              </button>
            </div>
          </div>
        `;
      }

      /*
       * FIND
       */
      if (this.mode === 'find') {
        return `
          <div class="relay-v2-find">
            <i class="ti ti-search"></i>

            <input
              class="relay-v2-search"
              type="search"
              placeholder="Search Quest…"
              autocomplete="off"
            >
          </div>

          <button
            class="relay-v2-big-action"
            data-relay-action="global-search"
            type="button"
          >
            <span>
              <strong>
                Open global search
              </strong>

              <small>
                Tasks, people, projects
              </small>
            </span>

            <i class="ti ti-arrow-up-right"></i>
          </button>

          <div class="relay-v2-hint">
            Command layer can later understand:
            <strong>
              reassign Paradise to Dana
            </strong>
          </div>
        `;
      }

      /*
       * CLOCK
       */
      if (this.mode === 'clock') {
        return `
          <button
            class="relay-v2-big-action"
            data-relay-action="clock"
            type="button"
          >
            <span>
              <strong>Clock</strong>

              <small>
                Start, stop, or switch
                your working context
              </small>
            </span>

            <i class="ti ti-player-play"></i>
          </button>

          <div class="relay-v2-hint">
            Current context:
            <strong>
              ${this.escape(ctx.label)}
            </strong>
          </div>
        `;
      }

      /*
       * WALLBOARD
       */
      if (this.mode === 'wallboard') {
        return `
          <div class="relay-controller-module">
            <div class="relay-controller-module-icon">
              <i class="ti ti-device-tv"></i>
            </div>

            <div class="relay-controller-module-copy">
              <span>WALLBOARD</span>

              <strong>
                Shared operating view
              </strong>

              <small>
                Open the existing Quest Wallboard
                from your controller.
              </small>
            </div>

            <button
              class="relay-controller-launch"
              data-relay-action="wallboard"
              type="button"
            >
              Open

              <i class="ti ti-arrow-up-right"></i>
            </button>
          </div>
        `;
      }

      /*
       * PULSE
       */
      return `
        <div class="relay-v2-pulse-head">
          <div>
            <span>PULSE</span>

            <strong>
              ${
                count
                  ? `${count} need you`
                  : 'You’re clear'
              }
            </strong>
          </div>

          <button
            data-relay-mode="inbox"
            type="button"
          >
            Open inbox

            <i class="ti ti-arrow-right"></i>
          </button>
        </div>

        <div class="relay-v2-pulse-card">
          <span class="relay-v2-pulse-dot"></span>

          <div>
            <strong>
              ${this.escape(ctx.label)}
            </strong>

            <small>
              ${
                ctx.kind === 'task'
                  ? 'Relay is attached to this task.'
                  : 'Relay is travelling with you.'
              }
            </small>
          </div>
        </div>

        <button
          class="relay-v2-quick-compose"
          data-relay-mode="compose"
          type="button"
        >
          <i class="ti ti-message-plus"></i>

          Do something quick…
        </button>
      `;
    }

    composeType(key, label) {
      return `
        <button
          class="${
            this.composeKind === key
              ? 'is-active'
              : ''
          }"
          data-compose-kind="${key}"
          type="button"
        >
          ${label}
        </button>
      `;
    }

    composePlaceholder() {
      const labels = {
        update: 'Write an update…',
        note: 'Capture a note…',
        call: 'Log a call…',
        send: 'Send something quick…'
      };

      return (
        labels[this.composeKind] ||
        labels.update
      );
    }

    escape(value) {
      if (
        App.utils &&
        typeof App.utils.escapeHtml ===
          'function'
      ) {
        return App.utils.escapeHtml(
          String(value || '')
        );
      }

      return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    }

    /* =====================================================
       BINDINGS
       ===================================================== */

    bind() {
      if (!this.root) return;

      this.applyDock();

      /*
       * COLLAPSED:
       * click opens
       * drag moves
       */
      const collapsedOpen =
        this.root.querySelector(
          '[data-relay-action="open"]'
        );

      collapsedOpen?.addEventListener('click', () => this.setOpen(true));

      /*
       * COLLAPSED → FOCUS
       */
      this.root
        .querySelector(
          '[data-relay-action="focus-open"]'
        )
        ?.addEventListener(
          'click',
          () => {
            this.open = true;
            this.expanded = true;

            localStorage.setItem(
              'quest:relay:open',
              '1'
            );

            this.render();
            this.bind();
          }
        );

      /*
       * CLOSE:
       * focus → console
       * console → collapsed
       */
      this.root
        .querySelector(
          '[data-relay-action="close"]'
        )
        ?.addEventListener(
          'click',
          () => {
            if (this.expanded) {
              this.setExpanded(false);
            } else {
              this.setOpen(false);
            }
          }
        );

      /*
       * EXPAND / RESTORE
       */
      this.root
        .querySelector(
          '[data-relay-action="expand"]'
        )
        ?.addEventListener(
          'click',
          () => {
            this.toggleExpanded();
          }
        );

      /*
       * RELAY MODES
       */
      this.root
        .querySelectorAll(
          '[data-relay-mode]'
        )
        .forEach(btn => {
          btn.addEventListener(
            'click',
            () => {
              this.setMode(
                btn.dataset.relayMode
              );
            }
          );
        });

      /*
       * COMPOSE TYPE
       */
      this.root
        .querySelectorAll(
          '[data-compose-kind]'
        )
        .forEach(btn => {
          btn.addEventListener(
            'click',
            () => {
              this.composeKind =
                btn.dataset.composeKind;

              this.render();
              this.bind();

              requestAnimationFrame(
                () => {
                  this.root
                    .querySelector(
                      '.relay-v2-input'
                    )
                    ?.focus();
                }
              );
            }
          );
        });

      /*
       * SEND
       */
      this.root
        .querySelector(
          '[data-relay-action="send"]'
        )
        ?.addEventListener(
          'click',
          () => {
            this.submitComposer();
          }
        );

      /*
       * FIND
       */
      this.root
        .querySelector(
          '[data-relay-action="global-search"]'
        )
        ?.addEventListener(
          'click',
          () => {
            if (!this.openGlobalSearch()) {
              this.flash(
                'Global search not found on this screen'
              );
            }
          }
        );

      /*
       * CLOCK
       */
      this.root
        .querySelector(
          '[data-relay-action="clock"]'
        )
        ?.addEventListener(
          'click',
          () => {
            if (!this.triggerClock()) {
              this.flash(
                'Clock control not found'
              );
            }
          }
        );

      /*
       * WALLBOARD
       */
      this.root
        .querySelector(
          '[data-relay-action="wallboard"]'
        )
        ?.addEventListener(
          'click',
          () => {
            if (
              !this.triggerWallboard()
            ) {
              this.flash(
                'Wallboard unavailable'
              );
            }
          }
        );

      /*
       * OLD INBOX BRIDGE
       * only used by "View all" inside Relay inbox.
       */
      this.root
        .querySelector(
          '[data-relay-action="notifications"]'
        )
        ?.addEventListener(
          'click',
          () => {
            if (
              !this.triggerNotifications()
            ) {
              this.flash(
                'No additional inbox view available'
              );
            }
          }
        );

      /*
       * SEARCH KEYBOARD
       */
      const search =
        this.root.querySelector(
          '.relay-v2-search'
        );

      search?.addEventListener(
        'keydown',
        event => {
          if (event.key !== 'Enter') {
            return;
          }

          event.preventDefault();

          if (!this.openGlobalSearch()) {
            this.flash(
              'Global search not found on this screen'
            );
          }
        }
      );

      /*
       * COMPOSER KEYBOARD
       */
      const input =
        this.root.querySelector(
          '.relay-v2-input'
        );

      input?.addEventListener(
        'keydown',
        event => {
          if (
            (event.metaKey ||
              event.ctrlKey) &&
            event.key === 'Enter'
          ) {
            event.preventDefault();

            this.submitComposer();
          }
        }
      );

      /*
       * RESIZE
       */
      if (!this._resizeBound) {
        this._resizeBound = true;

        window.addEventListener(
          'resize',
          () => {
            this.applyDock();
          }
        );
      }

      /*
       * ESCAPE:
       * focus → console
       */
      if (!this._escapeBound) {
        this._escapeBound = true;

        window.addEventListener(
          'keydown',
          event => {
            if (
              event.key !== 'Escape'
            ) {
              return;
            }

            if (this.expanded) {
              event.preventDefault();

              this.setExpanded(false);
            }
          }
        );
      }

      // Relay is fixed at bottom center.

      /*
       * After each render, claim the old shell
       * controls so Relay can become authoritative.
       */
      requestAnimationFrame(() => {
        this.claimGlobalControls();
      });
    }

    /* =====================================================
       DRAG / MOTION / MAGNETIC SETTLE
       ===================================================== */

    bindDrag() {
      /*
       * Focus is a working surface.
       */
      if (this.expanded) return;

      const handle =
        this.root.querySelector(
          '[data-relay-drag-handle]'
        );

      if (!handle) return;

      handle.addEventListener(
        'pointerdown',
        event => {
          if (
            event.target.closest('button')
          ) {
            return;
          }

          const rect =
            this.root.getBoundingClientRect();

          this._drag = {
            offsetX:
              event.clientX -
              rect.left,

            offsetY:
              event.clientY -
              rect.top
          };

          this.root.classList.add(
            'is-dragging'
          );

          this.root
            .setPointerCapture?.(
              event.pointerId
            );

          const move = e => {
            this.dragMove(e);
          };

          const end = e => {
            window.removeEventListener(
              'pointermove',
              move
            );

            window.removeEventListener(
              'pointerup',
              end
            );

            this.finishDrag(e);
          };

          window.addEventListener(
            'pointermove',
            move
          );

          window.addEventListener(
            'pointerup',
            end,
            { once: true }
          );
        }
      );
    }

    emitTrail(x, y) {
      const now =
        performance.now();

      if (
        now - this._trailAt <
        34
      ) {
        return;
      }

      this._trailAt = now;

      const dot =
        document.createElement('i');

      dot.className =
        'relay-motion-trail';

      dot.style.left =
        x + 'px';

      dot.style.top =
        y + 'px';

      document.body.appendChild(dot);

      requestAnimationFrame(() => {
        dot.classList.add(
          'is-leaving'
        );
      });

      setTimeout(() => {
        dot.remove();
      }, 760);
    }

    dragMove(event) {
      if (!this._drag) return;

      const width =
        this.root.offsetWidth;

      const height =
        this.root.offsetHeight;

      const maxX = Math.max(
        8,
        window.innerWidth -
          width -
          8
      );

      const maxY = Math.max(
        8,
        window.innerHeight -
          height -
          8
      );

      const x = Math.min(
        maxX,
        Math.max(
          8,
          event.clientX -
            this._drag.offsetX
        )
      );

      const y = Math.min(
        maxY,
        Math.max(
          8,
          event.clientY -
            this._drag.offsetY
        )
      );

      this.root.dataset.relayDock =
        'free';

      this.root.style.left =
        x + 'px';

      this.root.style.top =
        y + 'px';

      this.root.style.right =
        'auto';

      this.root.style.bottom =
        'auto';

      this.root.style.transform =
        'none';

      this.emitTrail(
        x + width / 2,
        y + height / 2
      );
    }

    finishDrag() {
      this._drag = null;

      this.root.classList.remove(
        'is-dragging'
      );

      const rect =
        this.root.getBoundingClientRect();

      const vw =
        window.innerWidth;

      const vh =
        window.innerHeight;

      const centerX =
        rect.left +
        rect.width / 2;

      const centerY =
        rect.top +
        rect.height / 2;

      /*
       * Do not settle to the top because that would
       * collide with primary navigation.
       */
      const distances = {
        left: rect.left,
        right:
          vw - rect.right,
        bottom:
          vh - rect.bottom
      };

      const nearest =
        Object.entries(distances)
          .sort(
            (a, b) =>
              a[1] - b[1]
          )[0][0];

      if (nearest === 'left') {
        this.position = {
          edge: 'left',
          along:
            centerY /
            Math.max(1, vh)
        };
      } else if (
        nearest === 'right'
      ) {
        this.position = {
          edge: 'right',
          along:
            centerY /
            Math.max(1, vh)
        };
      } else {
        this.position = {
          edge: 'bottom',
          along:
            centerX /
            Math.max(1, vw)
        };
      }

      localStorage.setItem(
        'quest:relay:position',
        JSON.stringify(
          this.position
        )
      );

      this.applyDock();
    }
  }

  App.RelayDock = RelayDock;

  function bootRelay() {
    if (window.__questRelay) {
      return;
    }

    window.__questRelay =
      new RelayDock();

    window.__questRelay.mount();
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      bootRelay,
      { once: true }
    );
  } else {
    bootRelay();
  }
})();