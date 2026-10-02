(function () {
  'use strict';
  App.Sidecar = class Sidecar {
    constructor({ controller, right }) {
      this.controller = controller;
      this.right = right;
      ['tasks:changed', 'projects:changed', 'people:changed'].forEach(name =>
        App.EventBus.on(name, () => { this.stamp = null; this.render(this.controller.activePhase); }));
    }
    bindExecutableSidecar() {
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


      const getTasks = () => this.controller.visibleTasks({ includeDone: true });

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
            Object.values(App.projects || {}).filter(project => {
              const company = this.controller.uiState.currentCompany;
              return (!company || company === '*' || project.companyId === company) &&
                this.controller.uiState.companies.includes(project.companyId);
            })
              .filter(project =>
                String(project.name || '')
                  .toLowerCase()
                  .includes(q)
              )
              .slice(0, 6);


          const people = App.utils.peopleInCompany(this.controller.uiState.currentCompany)
            .filter(person => String(person.full || person.name || '').toLowerCase().includes(q))
            .slice(0, 6);
          results.innerHTML = `
            ${people.map(person => `<article class="quest-search-result"><span>PERSON</span><strong>${esc(person.full || person.name)}</strong></article>`).join('')}
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
              !projects.length && !people.length
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
            paint(
              event.target.value
            );
          }
        );

        paint('');
        input?.focus();
      };


      const openNew = () => {
        if (!App.can('tasks.write')) return;

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
      this.refresh = () => { if (rail.dataset.sidecarMode === 'open') renderOpen(); };
      renderIntel();
    }


    render(phase) {
      const stamp = [phase.key, this.controller.uiState.currentCompany, App.effectiveRole()].join(':');
      if (this.stamp === stamp) return;
      this.stamp = stamp;
      this.renderConsoleRight(phase);
      this.bindExecutableSidecar();
      const create = this.right.querySelector('[data-sidecar-tool="new"]');
      if (create) create.disabled = !App.can('tasks.write');
    }

    renderConsoleRight(config) {
      const phase = { label: config.label.toUpperCase(), title: config.intelTitle, suggestions: config.suggestions };
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
            >
              Open tasks
            </button>

            <button
              type="button"
              class="quest-sidecar-tab quest-sidecar-tab-new"
              data-sidecar-tool="new"
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

  };
})();
