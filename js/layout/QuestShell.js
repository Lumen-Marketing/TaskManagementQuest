(function () {
  'use strict';

  window.App = window.App || {};

  const QUEST_PATH = [
    {
      key: 'query',
      letter: 'Q',
      label: 'QUERY',
      line: 'Listen before moving'
    },
    {
      key: 'unit',
      letter: 'U',
      label: 'UNIT',
      line: 'Lock the structure'
    },
    {
      key: 'execute',
      letter: 'E',
      label: 'EXECUTE',
      line: 'Move with speed'
    },
    {
      key: 'sight',
      letter: 'S',
      label: 'SIGHT',
      line: 'Bring the work into alignment'
    },
    {
      key: 'total',
      letter: 'T',
      label: 'TOTAL',
      line: 'Prove what the work became'
    }
  ];

  const DOMAIN_STAGES = {
    home: ['query'],
    projects: ['unit'],
    tasks: ['execute'],
    workforce: ['execute'],
    reports: ['sight'],
    transform: ['total']
  };

  const DOMAIN_PRIMARY_STAGE = {
    home: 'query',
    projects: 'unit',
    tasks: 'execute',
    workforce: 'execute',
    reports: 'sight',
    transform: 'total'
  };

  const SURFACES = [
    'listPane',
    'homeWrap',
    'reportsWrap',
    'projectsWrap',
    'wallboardWrap',
    'taskDetailWrap',
    'newTaskWrap'
  ];

  function decodedHash() {
    const raw = String(window.location.hash || '');
    try {
      return decodeURIComponent(raw).toLowerCase();
    } catch (_) {
      return raw.toLowerCase();
    }
  }

  function domainFromHash() {
    const hash = decodedHash();

    if (
      !hash ||
      hash === '#/' ||
      hash === '#/home' ||
      hash === '#/view/query'
    ) return 'home';

    if (hash.includes('/view/unit')) return 'projects';
    if (hash.includes('/view/execute')) return 'tasks';
    if (hash.includes('/view/sight')) return 'reports';
    if (hash.includes('/view/total')) return 'transform';

    if (
      hash === '#/new' ||
      hash.includes('/new')
    ) return 'new';

    if (
      hash.includes('/view/projects') ||
      hash.includes('/projects')
    ) return 'projects';

    if (
      hash.includes('/view/transform') ||
      hash.includes('/transform')
    ) return 'transform';

    if (
      hash.includes('/view/reports') ||
      hash.includes('/reports')
    ) return 'reports';

    if (
      hash.includes('time:resource') ||
      hash.includes('team:hierarchy') ||
      hash.includes('admin:clock') ||
      hash.includes('/view/approvals')
    ) return 'workforce';

    return 'tasks';
  }

  const LEFT = {
    home: [
      ['System', '#/home'],
      ['Your orbit', '#/home'],
      ['Attention', '#/home'],
      ['Movement', '#/home']
    ],

    tasks: [
      ['All', '#/tasks'],
      ['Today', '#/view/today'],
      ['Urgent', '#/view/hot'],
      ['Overdue', '#/view/overdue'],
      ['Watching', '#/view/watching']
    ],

    projects: [
      ['All projects', '#/view/projects']
    ],

    workforce: [
      ['Workload', '#/view/time%3Aresource'],
      ['Org Chart', '#/view/team%3Ahierarchy'],
      ['Time & Attendance', '#/view/admin%3Aclock'],
      ['Roles & Access', '#/view/approvals']
    ],

    reports: [
      ['Company reports', '#/view/reports']
    ]
  };

  class QuestShell {
    constructor() {
      this.frame = null;
      this.left = null;
      this.core = null;
      this.right = null;
      this.signal = null;
    }

    ensureFrame() {
      if (this.frame && this.frame.isConnected) {
        return this.frame;
      }

      const main = document.getElementById('mainPane');
      const first = document.getElementById('listPane');

      if (!main || !first) return null;

      const frame = document.createElement('section');

      frame.id = 'questFrame';
      frame.className = 'quest-frame';

      frame.innerHTML = `
        <aside id="questLeftZone" class="quest-frame-zone quest-frame-left"></aside>

        <section id="questCoreZone" class="quest-frame-zone quest-frame-core"></section>

        <aside id="questRightZone" class="quest-frame-zone quest-frame-right"></aside>

        <section id="questSignalZone" class="quest-frame-zone quest-frame-signal"></section>
      `;

      main.insertBefore(frame, first);

      this.frame = frame;
      this.left = frame.querySelector('#questLeftZone');
      this.core = frame.querySelector('#questCoreZone');
      this.right = frame.querySelector('#questRightZone');
      this.signal = frame.querySelector('#questSignalZone');

      SURFACES.forEach(id => {
        const surface = document.getElementById(id);
        if (!surface) return;

        surface.classList.add('quest-frame-surface');
        this.core.appendChild(surface);
      });

      return frame;
    }

    restoreTaskScope() {
      const scope =
        document.getElementById('scopeSeg');

      const anchor =
        document.getElementById('questScopeAnchor');

      if (
        scope &&
        anchor &&
        anchor.parentNode &&
        scope.parentElement === this.left
      ) {
        anchor.parentNode.insertBefore(
          scope,
          anchor.nextSibling
        );
      }
    }

    mountTaskScope() {
      const scope =
        document.getElementById('scopeSeg');

      if (!scope || !this.left) return;

      let anchor =
        document.getElementById('questScopeAnchor');

      if (!anchor) {
        anchor =
          document.createElement('span');

        anchor.id = 'questScopeAnchor';
        anchor.hidden = true;

        scope.parentNode.insertBefore(
          anchor,
          scope
        );
      }

      const slot =
        this.left.querySelector(
          '#questTaskScopeSlot'
        );

      if (slot) {
        slot.appendChild(scope);
      }
    }

    renderLeft(domain) {
      /*
       * scopeSeg is a real existing control with live handlers.
       * Restore it before replacing left-rail markup so it can
       * never be destroyed by innerHTML.
       */
      this.restoreTaskScope();

      const items = LEFT[domain] || [];
      const hash = decodedHash();

      this.left.innerHTML = `
        <section class="qf-rail-module qf-orientation-module">
          <div class="qf-kicker">${domain.toUpperCase()}</div>

          <nav class="qf-lens-list" aria-label="${domain} views">
            ${items.map(([label, route]) => {
            let routeHash = route.toLowerCase();

            try {
              routeHash = decodeURIComponent(route).toLowerCase();
            } catch (_) {}

            const active =
              hash === routeHash ||
              (
                domain === 'tasks' &&
                route === '#/tasks' &&
                (
                  hash === '#/tasks' ||
                  hash === '#/view/all'
                )
              );

            return `
              <button
                type="button"
                class="qf-lens${active ? ' is-active' : ''}"
                data-qf-route="${route}"
              >
                ${label}
              </button>
            `;
            }).join('')}
          </nav>
        </section>

        ${domain === 'tasks' ? `
          <section class="qf-rail-module qf-scope-module">
            <div class="qf-kicker">SCOPE</div>

            <div
              id="questTaskScopeSlot"
              class="qf-scope-slot"
            ></div>
          </section>
        ` : ''}
      `;

      if (domain === 'tasks') {
        this.mountTaskScope();
      }

      this.left
        .querySelectorAll('[data-qf-route]')
        .forEach(button => {
          button.addEventListener('click', () => {
            window.location.hash =
              button.dataset.qfRoute.replace(/^#/, '');
          });
        });
    }

    renderRight(domain) {
      if (domain === 'tasks') {
        this.right.innerHTML = `
          <div class="qf-kicker">COMMAND</div>
          <div class="qf-zone-title">Task control</div>

          <div class="qf-command-stack">
            <button type="button" data-qf-action="new">
              <i class="ti ti-plus"></i>
              <span>New task</span>
            </button>

            <button type="button" data-qf-action="filter">
              <i class="ti ti-filter"></i>
              <span>Filter</span>
            </button>

            <button type="button" data-qf-action="sort">
              <i class="ti ti-arrows-sort"></i>
              <span>Sort</span>
            </button>

            <button type="button" data-qf-action="group">
              <i class="ti ti-layout-rows"></i>
              <span>Group</span>
            </button>

            <button type="button" data-qf-action="done">
              <i class="ti ti-eye"></i>
              <span>Show done</span>
            </button>
          </div>

          <div class="qf-representation">
            <div class="qf-mini-label">VIEW</div>

            <div class="qf-view-strip">
              <button type="button" data-qf-layout="table">Table</button>
              <button type="button" data-qf-layout="lanes">Flow</button>
              <button type="button" data-qf-layout="calendar">Calendar</button>
            </div>
          </div>
        `;

        const proxy = {
          new: 'newTaskBtn',
          filter: 'filterBtn',
          sort: 'sortBtn',
          group: 'groupBtn',
          done: 'showDoneBtn'
        };

        this.right
          .querySelectorAll('[data-qf-action]')
          .forEach(button => {
            button.addEventListener('click', () => {
              const original =
                document.getElementById(
                  proxy[button.dataset.qfAction]
                );

              if (original) original.click();
            });
          });

        this.right
          .querySelectorAll('[data-qf-layout]')
          .forEach(button => {
            button.addEventListener('click', () => {
              const layout =
                button.dataset.qfLayout;

              if (
                App.controller &&
                typeof App.controller.setLayout === 'function'
              ) {
                App.controller.setLayout(layout);
                return;
              }

              const original =
                document.getElementById('viewBtn');

              if (original) {
                original.dataset.qfRequestedLayout = layout;
                original.click();
              }
            });
          });

        return;
      }

      const content = {
        home: [
          'QUEST',
          'Query clearly. Execute decisively.',
          'Query the real condition, unify the path, execute with speed, steward integrity, and transform the baseline.'
        ],

        projects: [
          'UNIFY → EXECUTE',
          'Direction into execution',
          'Translate a defined direction into coordinated execution and keep it moving toward form.'
        ],

        workforce: [
          'EXECUTION CAPACITY',
          'People make execution possible',
          'See ownership, workload, presence and responsibility clearly enough to keep the Run phase moving.'
        ],

        reports: [
          'STEWARD → TRANSFORM',
          'Did the work become whole?',
          'Verify integrity, mastery, and the evidence of impact instead of only counting completed activity.'
        ]
      };

      const [kicker, title, copy] = content[domain];

      this.right.innerHTML = `
        <div class="qf-kicker">${kicker}</div>
        <div class="qf-zone-title">${title}</div>
        <p class="qf-zone-copy">${copy}</p>
      `;
    }

    questPathHtml(domain) {
      const active =
        DOMAIN_STAGES[domain] || [];

      return `
        <div class="quest-path" aria-label="Quest operating path">
          ${QUEST_PATH.map((stage, index) => `
            <div class="quest-path-stage${active.includes(stage.key) ? ' is-active' : ''}">
              <span class="quest-path-index">${String(index + 1).padStart(2, '0')}</span>

              <div class="quest-path-copy">
                <strong>${stage.label}</strong>
                <small>${stage.line}</small>
              </div>
            </div>

            ${index < QUEST_PATH.length - 1
              ? `<span class="quest-path-arrow" aria-hidden="true">→</span>`
              : ''
            }
          `).join('')}
        </div>
      `;
    }

    renderSignal(domain) {
      if (!this.signal) return;

      if (domain !== 'tasks') {
        this.signal.hidden = true;
        this.signal.innerHTML = '';
        return;
      }

      this.signal.hidden = false;

      if (domain === 'tasks') {
        const upNext =
          document.getElementById('upNextWidget');

        const progress =
          document.getElementById('progressWidget');

        this.signal.innerHTML = `
          <div class="qf-task-signal-head">
            <div class="qf-kicker">RUN</div>
            <div class="qf-zone-title">Execution</div>
          </div>

          <div class="qf-task-path">
            ${this.questPathHtml(domain)}
          </div>

          <div
            id="qfUpNextSlot"
            class="qf-task-signal-slot"
          ></div>

          <div
            id="qfProgressSlot"
            class="qf-task-signal-slot"
          ></div>
        `;

        if (upNext) {
          this.signal
            .querySelector('#qfUpNextSlot')
            .appendChild(upNext);
        }

        if (progress) {
          this.signal
            .querySelector('#qfProgressSlot')
            .appendChild(progress);
        }

        return;
      }

      const labels = {
        home: 'Quest path',
        projects: 'Unify → Execute',
        workforce: 'Execution capacity',
        reports: 'Steward',
        transform: 'Transform'
      };

      this.signal.innerHTML = `
        <div class="qf-path-heading">
          <div class="qf-kicker">QUEST</div>
          <div class="qf-zone-title">${labels[domain]}</div>
        </div>

        ${this.questPathHtml(domain)}
      `;
    }

    ensureWorkspaceShelf(domain) {
      const topbar =
        document.querySelector('.topbar');

      if (!topbar) return;

      let left =
        document.getElementById('questShelfLeft');

      let right =
        document.getElementById('questShelfRight');

      if (!left) {
        left = document.createElement('div');
        left.id = 'questShelfLeft';
        left.className = 'quest-shelf-side quest-shelf-left';
        topbar.appendChild(left);
      }

      if (!right) {
        right = document.createElement('div');
        right.id = 'questShelfRight';
        right.className = 'quest-shelf-side quest-shelf-right';
        topbar.appendChild(right);
      }

      const isTasks =
        domain === 'tasks';

      left.hidden = !isTasks;
      right.hidden = !isTasks;

      /*
       * Execute now renders directly inside the canonical Quest canvas.
       * Do not move its title/scope/actions into the legacy workspace shelf.
       * That shelf is visually retired in Quest OS.
       */
      if (isTasks) return;

      if (!isTasks) return;

      const title =
        document.getElementById('pageTitle');

      const scope =
        document.getElementById('scopeSeg');

      const more =
        document.getElementById('moreBtn');

      const newTask =
        document.getElementById('newTaskBtn');

      if (title && title.parentElement !== left) {
        left.appendChild(title);
      }

      if (scope && scope.parentElement !== left) {
        left.appendChild(scope);
      }

      if (more && more.parentElement !== right) {
        right.appendChild(more);
      }

      if (newTask && newTask.parentElement !== right) {
        right.appendChild(newTask);
      }
    }

    ensureGlobalActions() {
      const topbar =
        document.querySelector('.topbar');

      if (!topbar) return;

      let actions =
        document.getElementById('questGlobalActions');

      if (!actions) {
        actions =
          document.createElement('div');

        actions.id =
          'questGlobalActions';

        actions.className =
          'quest-global-actions';

        (this.frame || topbar).appendChild(actions);
      }

      if (
        this.frame &&
        actions.parentElement !== this.frame
      ) {
        this.frame.appendChild(actions);
      }

      /*
       * Preserve the actual existing New Task button.
       * Moving the node keeps its current event handlers,
       * permissions, and creation flow intact.
       */
      const newTask =
        document.getElementById('newTaskBtn');

      if (
        newTask &&
        newTask.parentElement !== actions
      ) {
        actions.appendChild(newTask);
      }

      if (newTask) {
        newTask.classList.add(
          'quest-global-new-task'
        );

        newTask.classList.remove('hidden');
      }

      /*
       * Restore the existing signed-in account control.
       * Move the live node rather than duplicating it so
       * TopbarView keeps its profile painting + menu behavior.
       */
      const accountChip =
        document.getElementById('userChip');

      if (
        accountChip &&
        accountChip.parentElement !== topbar
      ) {
        topbar.appendChild(accountChip);
      }

      if (accountChip) {
        accountChip.classList.remove(
          'quest-global-account'
        );

        accountChip.classList.add(
          'quest-origin-account'
        );
      }

      let openTasks =
        document.getElementById(
          'questOpenTasksBtn'
        );

      if (!openTasks) {
        openTasks =
          document.createElement('button');

        openTasks.type =
          'button';

        openTasks.id =
          'questOpenTasksBtn';

        openTasks.className =
          'quest-global-open-tasks';

        openTasks.textContent =
          'Open tasks';

        openTasks.addEventListener(
          'click',
          () => this.controller?.setView?.('all')
        );

        actions.appendChild(openTasks);
      }
    }

    ensureQuestPhaseChrome(domain) {
      const beacon =
        document.getElementById('questPhaseBeacon');

      if (beacon) {
        beacon.remove();
      }

      const rail =
        document.getElementById('questLifecycleRail');

      if (rail) {
        rail.remove();
      }
    }

    ensureQueryCleanup(domain) {
      const home =
        document.getElementById('homeWrap');

      if (!home) return;

      /*
       * Global task actions now live permanently in the top rail.
       * Query must not render a second copy inside its canvas.
       */
      home
        .querySelectorAll('button, a')
        .forEach(el => {
          const label =
            (el.textContent || '')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();

          if (
            label === 'new task' ||
            label === '+ new task' ||
            label === 'open tasks'
          ) {
            el.style.setProperty(
              'display',
              'none',
              'important'
            );
          }
        });
    }

    ensureReportsProofMode(domain) {
      const reports =
        document.getElementById('reportsWrap');

      if (!reports) return;

      if (domain !== 'reports' && domain !== 'transform') {
        reports.dataset.questReportMode = 'steward';
        return;
      }

      let modeBar =
        reports.querySelector('#questReportModeBar');

      let transformPanel =
        reports.querySelector('#questTransformPanel');

      if (!modeBar) {
        modeBar =
          document.createElement('div');

        modeBar.id =
          'questReportModeBar';

        modeBar.className =
          'quest-report-mode-bar';

        modeBar.innerHTML = `
          <div class="quest-report-mode-copy">
            <div class="qf-kicker">QUEST OUTCOME</div>

            <div class="quest-report-mode-title">
              <strong>Steward the work.</strong>
              <span>Prove the change.</span>
            </div>
          </div>

          <div
            class="quest-report-mode-switch"
            role="tablist"
            aria-label="Reports mode"
          >
            <button
              type="button"
              class="quest-report-mode is-active"
              data-report-mode="steward"
              role="tab"
              aria-selected="true"
            >
              <span class="quest-report-mode-letter">S</span>

              <span>
                <strong>Steward</strong>
                <small>Integrity</small>
              </span>
            </button>

            <button
              type="button"
              class="quest-report-mode"
              data-report-mode="transform"
              role="tab"
              aria-selected="false"
            >
              <span class="quest-report-mode-letter">T</span>

              <span>
                <strong>Transform</strong>
                <small>Proof of change</small>
              </span>
            </button>
          </div>
        `;

        reports.prepend(modeBar);
      }

      if (!transformPanel) {
        transformPanel =
          document.createElement('section');

        transformPanel.id =
          'questTransformPanel';

        transformPanel.className =
          'quest-transform-panel';

        transformPanel.hidden = true;

        transformPanel.innerHTML = `
          <div class="quest-transform-head">
            <div>
              <div class="qf-kicker">TOTAL</div>

              <h2>Proof of Change</h2>

              <p>
                Transformation is not completion.
                It is evidence that the starting condition
                became materially different.
              </p>
            </div>

            <div class="quest-transform-state">
              <span class="quest-transform-state-dot"></span>

              <div>
                <small>QUEST STATE</small>
                <strong>Evidence required</strong>
              </div>
            </div>
          </div>

          <div class="quest-proof-spine">
            <article class="quest-proof-card quest-proof-goal">
              <div class="quest-proof-number">01</div>

              <div class="quest-proof-label">GOAL</div>

              <h3>What were we trying to change?</h3>

              <p class="quest-proof-value">
                Not defined yet
              </p>

              <small>
                The intended outcome established when the Quest began.
              </small>
            </article>

            <article class="quest-proof-card">
              <div class="quest-proof-number">02</div>

              <div class="quest-proof-label">BASELINE</div>

              <h3>Where did we start?</h3>

              <p class="quest-proof-value">
                Not captured yet
              </p>

              <small>
                The measurable condition before intervention.
              </small>
            </article>

            <article class="quest-proof-card">
              <div class="quest-proof-number">03</div>

              <div class="quest-proof-label">CURRENT</div>

              <h3>Where are we now?</h3>

              <p class="quest-proof-value">
                Awaiting evidence
              </p>

              <small>
                The observed condition after execution and stewardship.
              </small>
            </article>

            <article class="quest-proof-card quest-proof-delta">
              <div class="quest-proof-number">04</div>

              <div class="quest-proof-label">DELTA</div>

              <h3>What materially changed?</h3>

              <p class="quest-proof-value">
                —
              </p>

              <small>
                Baseline compared with the current measurable condition.
              </small>
            </article>
          </div>

          <div class="quest-proof-lower">
            <article class="quest-proof-evidence">
              <div class="quest-proof-section-head">
                <div>
                  <div class="qf-kicker">EVIDENCE</div>
                  <h3>What proves the change?</h3>
                </div>

                <span>Proof before claim</span>
              </div>

              <div class="quest-proof-empty">
                <strong>No transformation evidence recorded yet.</strong>

                <p>
                  Future evidence can include cycle-time changes,
                  fewer handoff failures, reduced rework,
                  owner visibility, revenue movement,
                  response-time improvement, acceptance,
                  or another observable outcome tied to the Goal.
                </p>
              </div>
            </article>

            <article class="quest-proof-impact">
              <div class="qf-kicker">IMPACT</div>

              <h3>Why did the change matter?</h3>

              <div class="quest-impact-empty">
                <span>↗</span>

                <div>
                  <strong>Not established yet</strong>

                  <p>
                    Impact belongs here only after the
                    transformation can be demonstrated.
                  </p>
                </div>
              </div>
            </article>
          </div>


        `;

        reports.appendChild(transformPanel);
      }

      /*
       * Total is a lifecycle phase now, not a Reports sub-mode.
       * Sight owns Company Reports; Total owns Proof of Change.
       */
      if (domain === 'transform') {
        reports.dataset.questReportMode = 'transform';

        if (modeBar) {
          modeBar.hidden = true;
        }

        if (transformPanel) {
          transformPanel.hidden = false;
        }
      }

      const setMode = mode => {
        const next =
          mode === 'transform'
            ? 'transform'
            : 'steward';

        reports.dataset.questReportMode =
          next;

        modeBar
          .querySelectorAll('[data-report-mode]')
          .forEach(button => {
            const active =
              button.dataset.reportMode === next;

            button.classList.toggle(
              'is-active',
              active
            );

            button.setAttribute(
              'aria-selected',
              active ? 'true' : 'false'
            );
          });

        transformPanel.hidden =
          next !== 'transform';

        try {
          sessionStorage.setItem(
            'quest.reportMode',
            next
          );
        } catch {}
      };

      modeBar
        .querySelectorAll('[data-report-mode]')
        .forEach(button => {
          if (button.dataset.questBound === '1') {
            return;
          }

          button.dataset.questBound = '1';

          button.addEventListener(
            'click',
            () => setMode(
              button.dataset.reportMode
            )
          );
        });

      setMode(
        domain === 'transform'
          ? 'transform'
          : 'steward'
      );
    }

    ensureConsoleTopbar() {
      const topbar = document.querySelector('.topbar');
      if (!topbar) return;

      /*
       * Relay now owns operator identity.
       * Delegation survives Relay's open/close re-renders.
       */
      if (!document.documentElement.dataset.questRelayAccountBound) {
        document.documentElement.dataset.questRelayAccountBound = '1';

        document.addEventListener('click', event => {
          const trigger =
            event.target.closest('[data-relay-account]');

          if (!trigger) return;

          event.preventDefault();
          event.stopPropagation();

          if (
            this.controller?.profileView &&
            typeof this.controller.profileView.open === 'function'
          ) {
            this.controller.profileView.open();
            return;
          }

          const account =
            document.getElementById('userChip');

          if (account) account.click();
        });
      }

      let brand = document.getElementById('questConsoleBrand');

      if (!brand) {
        brand = document.createElement('button');
        brand.type = 'button';
        brand.id = 'questConsoleBrand';
        brand.className = 'quest-console-brand';
        brand.setAttribute('aria-label', 'Quest HQ — system overview');

        brand.innerHTML = `
          <span class="quest-console-mark" aria-hidden="true">
            <span class="quest-console-mark-core"></span>
          </span>

          <span class="quest-console-brand-name">
            Quest HQ
          </span>
        `;

        brand.addEventListener('click', () => {
          this.controller?.setView?.('home');
        });

        topbar.appendChild(brand);
      }

      const account = document.getElementById('userChip');

      if (account) {
        account.classList.add('quest-console-account');

        const accountWidth =
          Math.ceil(
            account.getBoundingClientRect().width
          );

        if (accountWidth > 0) {
          document.documentElement.style.setProperty(
            '--quest-engine-w',
            `${accountWidth}px`
          );
        }
      }
    }


    renderConsoleLeft(domain) {
      if (!this.left) return;

      /*
       * PrimaryNav already owns:
       * - permission gating
       * - Query / Unit / Execute / Sight / Total
       * - active state
       * - route handlers
       *
       * Move the live node rather than cloning it.
       */
      const primaryNav =
        document.getElementById('primaryNav');

      /*
       * If PrimaryNav is already inside left, detach it before
       * replacing rail markup so innerHTML never destroys it.
       */
      if (
        primaryNav &&
        primaryNav.parentElement === this.left
      ) {
        primaryNav.remove();
      }

      this.restoreTaskScope();

      this.left.innerHTML = `
        <div class="quest-console-engine">

          <div class="quest-engine-label">
            ENGINE
          </div>

          <div
            id="questConsoleLifecycle"
            class="quest-console-lifecycle"
          ></div>

          ${
            domain === 'tasks'
              ? `
                <div class="quest-console-scope">
                  <div class="quest-engine-label">
                    SCOPE
                  </div>

                  <div
                    id="questTaskScopeSlot"
                    class="qf-scope-slot"
                  ></div>
                </div>
              `
              : ''
          }

        </div>
      `;

      const mount =
        this.left.querySelector(
          '#questConsoleLifecycle'
        );

      if (primaryNav && mount) {
        mount.appendChild(primaryNav);
      }

      /*
       * Quest operating tools.
       * Visible now as shell tabs; implementation routes come later.
       * These are intentionally separate from lifecycle state.
       */
      const engine =
        this.left.querySelector('.quest-console-engine');

      if (engine) {
        const tools = document.createElement('div');

        tools.className = 'quest-console-tools';

        tools.innerHTML = `
          <div class="quest-console-tools-label">
            TOOLS
          </div>

          <button
            type="button"
            class="quest-tool-tab"
            data-quest-tool="underwriting"
            aria-disabled="true"
            title="Underwriting — shell ready, workflow wiring next"
          >
            <span class="quest-tool-icon">◫</span>
            <span>Underwriting</span>
          </button>

          <button
            type="button"
            class="quest-tool-tab"
            data-quest-tool="proposal"
            aria-disabled="true"
            title="Proposal Generator — shell ready, workflow wiring next"
          >
            <span class="quest-tool-icon">↗</span>
            <span>Proposal</span>
          </button>
        `;

        engine.appendChild(tools);
      }

      if (domain === 'tasks') {
        this.mountTaskScope();
      }
    }


    bindExecutableSidecar(domain) {
      if (!this.right) return;

      const rail =
        this.right.querySelector(
          '.quest-intelligence-rail'
        );

      const tabs =
        rail?.querySelector(
          '.quest-sidecar-tabs'
        );

      if (!rail || !tabs) return;


      /*
       * Intelligence content is the canonical default state.
       * Wrap it once so Search/Open can replace ONLY the body,
       * never the surrounding sidecar geometry.
       */
      let body =
        rail.querySelector(
          '.quest-sidecar-content'
        );

      if (!body) {
        body =
          document.createElement('div');

        body.className =
          'quest-sidecar-content';

        [...rail.children]
          .filter(child => child !== tabs)
          .forEach(child => {
            body.appendChild(child);
          });

        rail.appendChild(body);
      }


      const intelligenceHTML =
        body.innerHTML;


      const esc = value =>
        App.utils?.escapeHtml
          ? App.utils.escapeHtml(
              String(value ?? '')
            )
          : String(value ?? '');


      const getTasks = () => {
        const candidates = [
          this.controller?.taskModel,
          App.taskModel,
          App.tasksModel
        ];

        for (const model of candidates) {
          if (
            model &&
            typeof model.all === 'function'
          ) {
            try {
              return model.all() || [];
            } catch (_) {}
          }
        }

        return [];
      };


      const isDone = task => {
        try {
          return !!App.taxonomy?.isDone?.(task);
        } catch (_) {
          return false;
        }
      };


      const activate = mode => {
        tabs
          .querySelectorAll(
            '[data-sidecar-tool]'
          )
          .forEach(button => {
            button.classList.toggle(
              'is-active',
              button.dataset.sidecarTool === mode
            );
          });

        rail.dataset.sidecarMode = mode;
      };


      const renderIntel = () => {
        activate('intel');
        body.innerHTML = intelligenceHTML;
      };


      const taskMeta = task => {
        const parts = [];

        if (task.status) {
          const st =
            App.STATUSES?.[task.status];

          parts.push(
            st?.label || task.status
          );
        }

        if (task.due) {
          parts.push(
            String(task.due)
          );
        }

        return parts.join(' · ');
      };


      const renderOpen = () => {
        activate('open');

        const tasks =
          getTasks()
            .filter(task => !isDone(task))
            .slice(0, 24);

        body.innerHTML = `
          <section class="quest-sidecar-work">

            <header class="quest-sidecar-view-head">
              <div>
                <span>OPEN TASKS</span>
                <h2>Current work</h2>
              </div>

              <b>${tasks.length}</b>
            </header>

            ${
              tasks.length
                ? `
                  <div class="quest-sidecar-task-list">
                    ${tasks.map(task => `
                      <button
                        type="button"
                        class="quest-sidecar-task"
                        data-sidecar-task="${esc(task.id)}"
                      >
                        <strong>
                          ${esc(task.title || 'Untitled task')}
                        </strong>

                        <small>
                          ${esc(taskMeta(task))}
                        </small>
                      </button>
                    `).join('')}
                  </div>
                `
                : `
                  <div class="quest-sidecar-empty">
                    <strong>No open tasks.</strong>
                    <span>The current queue is clear.</span>
                  </div>
                `
            }

          </section>
        `;
      };


      const renderSearch = () => {
        activate('search');

        body.innerHTML = `
          <section class="quest-sidecar-work">

            <header class="quest-sidecar-view-head">
              <div>
                <span>SEARCH</span>
                <h2>Find anything.</h2>
              </div>
            </header>

            <div class="quest-sidecar-search">
              <span aria-hidden="true">⌕</span>

              <input
                type="search"
                data-sidecar-search-input
                placeholder="Tasks, units, people…"
                autocomplete="off"
              />
            </div>

            <div
              class="quest-sidecar-search-results"
              data-sidecar-search-results
            ></div>

          </section>
        `;

        const input =
          body.querySelector(
            '[data-sidecar-search-input]'
          );

        const results =
          body.querySelector(
            '[data-sidecar-search-results]'
          );


        const paint = query => {
          const q =
            String(query || '')
              .trim()
              .toLowerCase();

          if (!q) {
            results.innerHTML = `
              <div class="quest-sidecar-empty">
                <strong>Search Quest.</strong>
                <span>Start typing to find current work.</span>
              </div>
            `;

            return;
          }


          const taskMatches =
            getTasks()
              .filter(task =>
                String(task.title || '')
                  .toLowerCase()
                  .includes(q)
              )
              .slice(0, 10);


          const projects =
            Object.values(
              App.projects || {}
            )
              .filter(project =>
                String(project.name || '')
                  .toLowerCase()
                  .includes(q)
              )
              .slice(0, 6);


          results.innerHTML = `
            ${taskMatches.map(task => `
              <button
                class="quest-search-result"
                type="button"
                data-sidecar-task="${esc(task.id)}"
              >
                <span>TASK</span>
                <strong>${esc(task.title)}</strong>
              </button>
            `).join('')}

            ${projects.map(project => `
              <button
                class="quest-search-result"
                type="button"
                data-sidecar-project="${esc(project.id)}"
              >
                <span>UNIT</span>
                <strong>${esc(project.name)}</strong>
              </button>
            `).join('')}

            ${
              !taskMatches.length &&
              !projects.length
                ? `
                  <div class="quest-sidecar-empty">
                    <strong>No match.</strong>
                    <span>Try another term.</span>
                  </div>
                `
                : ''
            }
          `;
        };


        input?.addEventListener(
          'input',
          event => {
            /*
             * Keep the existing global search model synchronized
             * as well as painting local sidecar results.
             */
            const global =
              document.getElementById(
                'searchInput'
              );

            if (global) {
              global.value =
                event.target.value;

              global.dispatchEvent(
                new Event(
                  'input',
                  { bubbles: true }
                )
              );
            }

            paint(
              event.target.value
            );
          }
        );

        paint('');
        input?.focus();
      };


      const openNew = () => {
        activate('new');

        /*
         * Use the existing mobile task sheet on desktop too.
         * It preserves the current Quest phase instead of
         * navigating away to #/new.
         */
        if (App.TaskSheetView) {
          this.controller._taskSheet =
            this.controller._taskSheet ||
            new App.TaskSheetView({
              controller:
                this.controller
            });

          this.controller._taskSheet.openNew();
          return;
        }

        /*
         * Last-resort fallback only.
         */
        this.controller
          ?.openNewTaskPage
          ?.();
      };


      /*
       * Replace old inline onclick behavior with one
       * authoritative delegated controller.
       */
      tabs
        .querySelectorAll(
          '[data-sidecar-tool]'
        )
        .forEach(button => {
          button.removeAttribute(
            'onclick'
          );
        });


      tabs.onclick = event => {
        const button =
          event.target.closest(
            '[data-sidecar-tool]'
          );

        if (!button) return;

        event.preventDefault();

        const tool =
          button.dataset.sidecarTool;

        if (tool === 'intel') {
          renderIntel();
          return;
        }

        if (tool === 'search') {
          renderSearch();
          return;
        }

        if (tool === 'open') {
          renderOpen();
          return;
        }

        if (tool === 'new') {
          openNew();
        }
      };


      body.onclick = event => {
        const task =
          event.target.closest(
            '[data-sidecar-task]'
          );

        if (task) {
          this.controller
            ?.selectTask
            ?.(task.dataset.sidecarTask);

          return;
        }


        const project =
          event.target.closest(
            '[data-sidecar-project]'
          );

        if (
          project &&
          typeof this.controller?.openProject === 'function'
        ) {
          this.controller.openProject(
            project.dataset.sidecarProject
          );
        }
      };


      /*
       * Intel is always the resting/default state
       * whenever the active lifecycle phase changes.
       */
      renderIntel();
    }


    renderConsoleRight(domain) {
      if (!this.right) return;

      const phase = {
        home: {
          label: 'QUERY',
          title: 'See what matters first.',
          suggestions: [
            'Start with the operating area carrying the most pressure.',
            'Clarify the condition before creating more work.',
            'Enter only where the current signals show attention is needed.'
          ]
        },

        projects: {
          label: 'UNIT',
          title: 'Make the work executable.',
          suggestions: [
            'Confirm scope before the unit moves into execution.',
            'Check estimate, resources, and timeline for missing structure.',
            'Resolve structural gaps before adding more downstream activity.'
          ]
        },

        tasks: {
          label: 'EXECUTE',
          title: 'Keep the work moving.',
          suggestions: [
            'Surface blockers and ownership gaps.',
            'Protect the next action.',
            'Prioritize overdue and stalled work.'
          ]
        },

        reports: {
          label: 'SIGHT',
          title: 'Verify before declaring progress.',
          suggestions: [
            'Check whether completed work actually meets the intended condition.',
            'Surface mismatches, QA gaps, and unresolved closeout items.',
            'Use evidence to distinguish movement from alignment.'
          ]
        },

        transform: {
          label: 'TOTAL',
          title: 'Prove what changed.',
          suggestions: [
            'Connect the final condition back to the original goal.',
            'Capture evidence before claiming impact.',
            'Do not lock [ True ] until the outcome is supported.'
          ]
        }
      }[domain] || {
        label: 'QUEST',
        title: 'Maintain operating clarity.',
        suggestions: [
          'Surface what requires attention.',
          'Preserve ownership and next action.',
          'Reduce noise before creating more work.'
        ]
      };

      /*
       * Pinned messages are intentionally empty for this first pass.
       * This gives us the real presentation + interaction surface
       * without pretending mock content came from the team.
       *
       * Later this can be backed by an actual pinned-signals model.
       */
      const pinned = [];

      this.right.innerHTML = `
        <aside class="quest-intelligence-rail">

          <nav class="quest-sidecar-tabs" aria-label="Context tools">

            <button
              type="button"
              class="quest-sidecar-tab quest-sidecar-tab-icon"
              data-sidecar-tool="search"
              onclick="document.getElementById('searchInput')?.focus()"
              aria-label="Search"
              title="Search"
            >
              <span class="quest-sidecar-search-glyph" aria-hidden="true">⌕</span>
              <small>Search</small>
            </button>

            <button
              type="button"
              class="quest-sidecar-tab quest-sidecar-tab-icon is-active"
              data-sidecar-tool="intel"
              aria-label="Intelligence"
              title="Intelligence"
            >
              <span class="quest-sidecar-intel-glyph" aria-hidden="true">✦</span>
              <small>Intel</small>
            </button>

            <button
              type="button"
              class="quest-sidecar-tab"
              data-sidecar-tool="open"
              onclick="document.getElementById('questOpenTasksBtn')?.click()"
            >
              Open tasks
            </button>

            <button
              type="button"
              class="quest-sidecar-tab quest-sidecar-tab-new"
              data-sidecar-tool="new"
              onclick="document.getElementById('newTaskBtn')?.click()"
            >
              <span aria-hidden="true">+</span>
              New task
            </button>

          </nav>

          <header class="quest-intelligence-head">
            <div class="quest-intelligence-kicker">
              INTELLIGENCE
            </div>

            <h2>
              ${phase.title}
            </h2>

            <div class="quest-intelligence-phase">
              ${phase.label}
            </div>
          </header>


          <section class="quest-intelligence-section">

            <div class="quest-intelligence-section-head">
              <span>PINNED</span>
              <b>${pinned.length}</b>
            </div>

            ${
              pinned.length
                ? `
                  <div class="quest-pin-stack">
                    ${pinned.map(item => `
                      <article class="quest-pin">
                        <div class="quest-pin-dot"></div>
                        <p>${item}</p>
                      </article>
                    `).join('')}
                  </div>
                `
                : `
                  <div class="quest-pin-empty">
                    <span class="quest-pin-empty-mark">
                      <i class="ti ti-pin"></i>
                    </span>

                    <div>
                      <strong>Nothing pinned yet</strong>
                      <p>
                        Pin a decision, handoff, note,
                        or signal here when it needs to
                        stay in orbit.
                      </p>
                    </div>
                  </div>
                `
            }

          </section>


          <section class="quest-intelligence-section">

            <div class="quest-intelligence-section-head">
              <span>AI SUGGESTIONS</span>

              <em>
                PREVIEW
              </em>
            </div>

            <div class="quest-ai-suggestion-stack">

              ${phase.suggestions.map((suggestion, index) => `
                <article class="quest-ai-suggestion">

                  <div class="quest-ai-index">
                    0${index + 1}
                  </div>

                  <div class="quest-ai-copy">
                    <p>${suggestion}</p>
                  </div>

                  <div
                    class="quest-ai-signal"
                    aria-hidden="true"
                  ></div>

                </article>
              `).join('')}

            </div>

          </section>


          <footer class="quest-intelligence-footer">

            <div class="quest-intelligence-pulse">
              <span></span>

              <div>
                <strong>Quest intelligence</strong>
                <small>Context follows the active phase.</small>
              </div>
            </div>

          </footer>

        </aside>
      `;
    }


    ensureUtilityDock() {
      let dock =
        document.getElementById('questUtilityDock');

      if (!dock) {
        dock = document.createElement('div');

        dock.id = 'questUtilityDock';
        dock.className = 'quest-utility-dock';

        dock.innerHTML = `
          <button
            type="button"
            class="quest-utility-btn"
            data-quest-utility="theme"
            aria-label="Toggle light or dark theme"
            title="Toggle theme"
          >
            <span class="quest-utility-glyph" aria-hidden="true">◐</span>
          </button>

          <button
            type="button"
            class="quest-utility-btn"
            data-quest-utility="settings"
            aria-label="Open settings"
            title="Settings"
          >
            <span class="quest-utility-glyph" aria-hidden="true">⚙</span>
          </button>

          <button
            type="button"
            class="quest-utility-btn"
            data-quest-utility="signout"
            aria-label="Sign out"
            title="Sign out"
          >
            <span class="quest-utility-glyph" aria-hidden="true">↪</span>
          </button>
        `;

        document.body.appendChild(dock);

        dock.addEventListener('click', event => {
          const button =
            event.target.closest('[data-quest-utility]');

          if (!button) return;

          const action =
            button.dataset.questUtility;

          if (action === 'settings') {
            if (
              this.controller?.profileView &&
              typeof this.controller.profileView.open === 'function'
            ) {
              this.controller.profileView.open();
            }

            return;
          }


          if (action === 'theme') {
            /*
             * Reuse the existing ProfileView theme controls.
             * We open the real settings surface, then activate
             * whichever theme is opposite the current document state.
             */
            if (
              this.controller?.profileView &&
              typeof this.controller.profileView.open === 'function'
            ) {
              this.controller.profileView.open();
            }

            requestAnimationFrame(() => {
              const root =
                document.documentElement;

              const body =
                document.body;

              const current =
                String(
                  root.dataset.theme ||
                  body.dataset.theme ||
                  root.getAttribute('data-theme') ||
                  body.getAttribute('data-theme') ||
                  ''
                ).toLowerCase();

              const target =
                current === 'dark'
                  ? 'Light'
                  : 'Dark';

              const candidates =
                [...document.querySelectorAll('button')];

              const themeButton =
                candidates.find(candidate =>
                  candidate.textContent
                    ?.trim()
                    ?.toLowerCase() ===
                  target.toLowerCase()
                );

              if (themeButton) {
                themeButton.click();
              }
            });

            return;
          }


          if (action === 'signout') {
            /*
             * Keep the existing sign-out flow authoritative.
             * ProfileView already owns session cleanup.
             */
            if (
              this.controller?.profileView &&
              typeof this.controller.profileView.open === 'function'
            ) {
              this.controller.profileView.open();
            }

            requestAnimationFrame(() => {
              const signOut =
                [...document.querySelectorAll('button')]
                  .find(button =>
                    button.textContent
                      ?.trim()
                      ?.toLowerCase() ===
                    'sign out'
                  );

              if (signOut) {
                signOut.click();
              }
            });
          }
        });
      }
    }


    apply() {
      const frame = this.ensureFrame();
      if (!frame) return;

      /*
       * Canonical lifecycle routes win over legacy domain inference.
       * The recovered shell still understands home/projects/tasks/reports/
       * transform internally, but the browser URL is authoritative.
       */
      const hash = decodedHash();

      const lifecycleDomain = {
        '#/view/query': 'home',
        '#/view/unit': 'projects',
        '#/view/execute': 'tasks',
        '#/view/sight': 'reports',
        '#/view/total': 'transform'
      }[hash];

      const domain = lifecycleDomain || domainFromHash();

      frame.dataset.domain = domain;
      document.body.dataset.questDomain = domain;

      /*
       * RUN / Execution instrumentation only exists during Execute.
       * Use the actual DOM hidden state as the authority so stale CSS or
       * an earlier render cannot leave the shelf visible on another phase.
       */
      if (this.signal) {
        this.signal.hidden = domain !== 'tasks';
      }

      this.ensureQuestPhaseChrome(domain);
      this.ensureGlobalActions();
      this.ensureQueryCleanup(domain);
      this.ensureReportsProofMode(domain);

      this.ensureWorkspaceShelf(domain);

      this.ensureConsoleTopbar();
      this.ensureUtilityDock();
      this.renderConsoleLeft(domain);
      this.renderConsoleRight(domain);

      /*
       * Canonical Quest frame:
       * lifecycle | active canvas | contextual sidecar.
       *
       * Right-side context is a sibling of Mission Control,
       * never nested inside it.
       */
      if (
        this.right &&
        this.frame &&
        this.right.parentElement !== this.frame
      ) {
        if (
          this.signal &&
          this.signal.parentElement === this.frame
        ) {
          this.frame.insertBefore(
            this.right,
            this.signal
          );
        } else {
          this.frame.appendChild(this.right);
        }
      }

      this.bindExecutableSidecar(domain);
      this.renderSignal(domain);
    }
  }

  App.QuestShell = new QuestShell();

  let applyQueued = false;

  const apply = () => {
    if (applyQueued) return;

    applyQueued = true;

    requestAnimationFrame(() => {
      applyQueued = false;
      App.QuestShell.apply();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      apply,
      { once: true }
    );
  } else {
    apply();
  }

  window.addEventListener('hashchange', apply);
  window.addEventListener('popstate', apply);

  /*
   * Controller navigation can update visible surfaces before/without
   * a reliable hashchange in every path. Reconcile after navigation
   * clicks so the frame always follows the actual workspace.
   */
  document.addEventListener(
    'click',
    event => {
      if (
        event.target.closest(
          '.pnav-item, [data-view], [data-nav], [data-qf-route]'
        )
      ) {
        setTimeout(apply, 0);
        setTimeout(apply, 50);
      }
    },
    true
  );

  /*
   * The app already toggles .hidden on the top-level surfaces.
   * Watching that state gives QuestFrame one authoritative signal
   * even when routing internals change later.
   */
  const observeSurfaces = () => {
    const observer = new MutationObserver(apply);

    SURFACES.forEach(id => {
      const el = document.getElementById(id);

      if (el) {
        observer.observe(el, {
          attributes: true,
          attributeFilter: ['class']
        });
      }
    });

    const time = document.getElementById('timeViewWrap');

    if (time) {
      observer.observe(time, {
        attributes: true,
        attributeFilter: ['class']
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      observeSurfaces,
      { once: true }
    );
  } else {
    observeSurfaces();
  }

  if (
    App.EventBus &&
    typeof App.EventBus.on === 'function'
  ) {
    App.EventBus.on('view:changed', apply);
  }
})();
