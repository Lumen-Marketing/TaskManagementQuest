window.App = window.App || {};

/* Settings → Roles & permissions. Read-only reference matrix of what each role
   can do, reached from the account menu. Renders into the shared #timeViewWrap
   like the other admin surfaces, activated on the 'admin:permissions' view.

   Cells are DERIVED from App.ROLE_PERMISSIONS at render time (capabilities with
   a `perm` key), so the matrix can never drift from the real permission table.
   Row-scope rules that live in RLS/controller branches (not App.can) are the
   few `cells:`-literal rows, each with a hint explaining the nuance.
   Roles are fixed in code + RLS — there is no editing here by design. */
App.PermissionsAdminView = class PermissionsAdminView {
  constructor({ controller }) {
    this.controller = controller;
    this.wrap = document.getElementById('timeViewWrap');
    this.activeRole = 'worker';
    this.query = '';
    this.diffOnly = false;

    App.EventBus.on('view:changed', (view) => { if (view === 'admin:permissions') this.render(); });
    App.EventBus.on('role:changed', () => { if (this.visible()) this.render(); });
  }

  visible() {
    return this.controller.uiState.view === 'admin:permissions'
      && this.wrap && !this.wrap.classList.contains('hidden');
  }

  /* ---------- data ---------- */
  roles() {
    return [
      { id: 'worker',     tone: 'blue',   desc: 'Own tasks and time. Sees only work assigned to or created by them.' },
      { id: 'sales',      tone: 'peach',  desc: 'Worker permissions with a distinct roster label.' },
      { id: 'supervisor', tone: 'green',  desc: 'Adds team workload, reports, and task setup.' },
      { id: 'admin',      tone: 'yellow', desc: 'Adds approvals, member roles, and clock admin.' },
      { id: 'developer',  tone: 'lilac',  desc: 'Everything, plus debug tools and role preview.' },
    ].map(r => ({
      ...r,
      name: (App.ROLES[r.id] || { label: r.id }).label,
      members: this._memberCount(r.id),
    }));
  }

  _memberCount(roleId) {
    const profiles = App.PROFILES;
    if (!Array.isArray(profiles) || !profiles.length) return null;
    return profiles.filter(p => p && p.role === roleId).length;
  }

  groups() {
    return [
      { id: 'tasks', label: 'Tasks', capabilities: [
        { id: 'tasks.view', label: 'View tasks', perm: 'tasks.view',
          hint: 'Workers and Sales see only tasks assigned to or created by them.' },
        { id: 'tasks.write', label: 'Create & edit tasks', perm: 'tasks.write',
          hint: 'Assignment is limited to approved members of the same company.' },
        { id: 'tasks.delete', label: 'Delete tasks',
          hint: 'Workers and Sales can delete only tasks they created.',
          cells: { worker: 'yes', sales: 'yes', supervisor: 'yes', admin: 'yes', developer: 'yes' } },
        { id: 'task-setup.manage', label: 'Task setup (types, statuses, labels)', perm: 'task-setup.manage' },
      ]},
      { id: 'time', label: 'Time', capabilities: [
        { id: 'clock.use', label: 'Clock in / out', perm: 'clock.use' },
        { id: 'time.own', label: 'My time', perm: 'time.own' },
        { id: 'time.team', label: 'Team workload', perm: 'time.team',
          hint: 'Supervisors see themselves plus their direct reports.' },
        { id: 'clock.admin', label: 'Clock admin', perm: 'clock.admin' },
      ]},
      { id: 'team', label: 'Team', capabilities: [
        { id: 'team.view', label: 'Team directory & hierarchy', perm: 'team.view' },
        { id: 'approvals', label: 'Approve new members', perm: 'roles.manage' },
        { id: 'member-roles', label: 'Change member roles', perm: 'roles.manage',
          hint: 'Enforced by RLS as well — the UI is only a hint.' },
      ]},
      { id: 'insights', label: 'Insights', capabilities: [
        { id: 'home.view', label: 'Home dashboard', perm: 'home.view' },
        { id: 'reports.view', label: 'Reports', perm: 'reports.view' },
      ]},
      { id: 'developer', label: 'Developer', capabilities: [
        { id: 'debug.access', label: 'Debug access', perm: 'debug.access', devOnly: true },
        { id: 'bug-reports.manage', label: 'Bug report admin', perm: 'bug-reports.manage', devOnly: true },
        { id: 'view-as', label: 'View as (role preview)', devOnly: true,
          hint: 'Always follows the real account, never the previewed role.',
          cells: { worker: 'na', sales: 'na', supervisor: 'na', admin: 'na', developer: 'yes' } },
      ]},
    ];
  }

  /* yes/no/na for one capability × role. Derived caps read the live permission
     table; dev-only caps show "not applicable" for roles that can never hold
     them (developer tooling, not a grantable permission). */
  _state(cap, roleId) {
    if (cap.cells) return cap.cells[roleId] || 'no';
    // 'sales' reads its own ROLE_PERMISSIONS row (kept in lockstep with worker),
    // so a future divergence would show up here automatically.
    const has = (App.ROLE_PERMISSIONS[roleId] || []).includes(cap.perm);
    if (has) return 'yes';
    return cap.devOnly ? 'na' : 'no';
  }

  _filteredGroups() {
    const q = this.query.trim().toLowerCase();
    const roleIds = this.roles().map(r => r.id);
    return this.groups().map(g => ({
      ...g,
      capabilities: g.capabilities.filter(cap => {
        if (q && !cap.label.toLowerCase().includes(q)) return false;
        if (this.diffOnly) {
          const states = roleIds.map(id => this._state(cap, id));
          if (states.every(s => s === states[0])) return false;
        }
        return true;
      }),
    })).filter(g => g.capabilities.length > 0);
  }

  /* ---------- render ---------- */
  render() {
    if (!this.wrap) this.wrap = document.getElementById('timeViewWrap');
    if (!this.wrap) return;
    if (!App.can('roles.manage')) {
      this.wrap.innerHTML = `<div class="permx"><div class="empty"><i class="ti ti-lock"></i><p>Only admins can view role permissions.</p></div></div>`;
      return;
    }

    const esc = App.utils.escapeHtml;
    const roles = this.roles();
    const groups = this.groups();
    const filtered = this._filteredGroups();
    const total = groups.reduce((n, g) => n + g.capabilities.length, 0);
    const visibleCount = filtered.reduce((n, g) => n + g.capabilities.length, 0);
    const active = roles.find(r => r.id === this.activeRole) || roles[0];

    const cellHtml = (state) => {
      if (state === 'yes') return `<span class="permx-cell yes" title="Allowed"><i class="ti ti-check"></i></span>`;
      if (state === 'na')  return `<span class="permx-cell na" title="Not applicable for this role"><i class="ti ti-lock"></i></span>`;
      return `<span class="permx-cell no" title="Not allowed"><i class="ti ti-x"></i></span>`;
    };

    const rowsHtml = filtered.map(g => `
      <tr class="permx-group-row"><td colspan="${roles.length + 1}">${esc(g.label)}</td></tr>
      ${g.capabilities.map(cap => `
        <tr class="permx-row">
          <td class="permx-cap">
            <span class="permx-cap-label">${esc(cap.label)}</span>
            ${cap.hint ? `<span class="permx-cap-hint">${esc(cap.hint)}</span>` : ''}
          </td>
          ${roles.map(r => `
            <td class="permx-td ${r.id === active.id ? 'is-active' : ''}">${cellHtml(this._state(cap, r.id))}</td>
          `).join('')}
        </tr>
      `).join('')}
    `).join('');

    this.wrap.innerHTML = `
      <div class="permx">
        <div class="permx-kicker">Settings · Permissions</div>
        <h2 class="permx-title">Roles &amp; permissions</h2>
        <p class="permx-sub">${roles.length} roles · ${total} capabilities across ${groups.length} groups</p>

        <div class="permx-body">
          <aside class="permx-roles">
            <div class="permx-roles-label">Roles</div>
            ${roles.map(r => `
              <button type="button" class="permx-role ${r.id === active.id ? 'is-active' : ''}" data-role="${esc(r.id)}">
                <span class="permx-role-top">
                  <span class="permx-role-chip tone-${esc(r.tone)}"><i class="ti ti-user"></i></span>
                  <span class="permx-role-name">${esc(r.name)}</span>
                  ${r.members !== null ? `<span class="permx-role-count">${r.members}</span>` : ''}
                </span>
                <span class="permx-role-desc">${esc(r.desc)}</span>
              </button>
            `).join('')}
            <div class="permx-roles-note"><i class="ti ti-lock"></i>Roles are fixed — enforced by database policies (RLS), not this screen.</div>
          </aside>

          <section class="permx-main">
            <div class="permx-toolbar">
              <label class="permx-search">
                <i class="ti ti-search"></i>
                <input type="search" data-act="query" placeholder="Filter capabilities…" value="${esc(this.query)}" aria-label="Filter capabilities">
                ${this.query.trim() ? `<span class="permx-search-count">${visibleCount}/${total}</span>` : ''}
              </label>
              <label class="permx-diff">
                <input type="checkbox" data-act="diff" ${this.diffOnly ? 'checked' : ''}>
                <span class="permx-diff-track" aria-hidden="true"></span>
                <span class="permx-diff-label">Only differences</span>
              </label>
            </div>

            <div class="permx-matrix">
              <div class="permx-scroll">
                <table class="permx-table">
                  <thead>
                    <tr>
                      <th class="permx-cap-h" scope="col">Capability</th>
                      ${roles.map(r => `
                        <th class="permx-role-h ${r.id === active.id ? 'is-active' : ''}" scope="col">
                          <button type="button" data-role="${esc(r.id)}">
                            <span>${esc(r.name)}</span>
                            ${r.members !== null ? `<em>${r.members}</em>` : ''}
                          </button>
                        </th>
                      `).join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml || `<tr><td class="permx-empty" colspan="${roles.length + 1}">No capabilities match &ldquo;${esc(this.query)}&rdquo;.</td></tr>`}
                  </tbody>
                </table>
              </div>
              <div class="permx-legend">
                <span class="permx-legend-item">${cellHtml('yes')}Allowed</span>
                <span class="permx-legend-item">${cellHtml('no')}Not allowed</span>
                <span class="permx-legend-item">${cellHtml('na')}Not applicable</span>
                <span class="permx-legend-viewing">Viewing: <b>${esc(active.name)}</b></span>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
    this._bind();
  }

  _bind() {
    this.wrap.querySelectorAll('[data-role]').forEach(el => {
      el.addEventListener('click', () => {
        this.activeRole = el.dataset.role;
        this.render();
      });
    });
    const search = this.wrap.querySelector('[data-act="query"]');
    if (search) {
      search.addEventListener('input', (e) => {
        this.query = e.target.value;
        const pos = e.target.selectionStart;
        this.render();
        const again = this.wrap.querySelector('[data-act="query"]');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) {} }
      });
    }
    const diff = this.wrap.querySelector('[data-act="diff"]');
    if (diff) {
      diff.addEventListener('change', (e) => {
        this.diffOnly = !!e.target.checked;
        this.render();
      });
    }
  }
};
