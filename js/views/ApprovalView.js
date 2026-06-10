window.App = window.App || {};

App.ApprovalView = class ApprovalView {
  constructor({ controller, dataStore }) {
    this.controller = controller;
    this.dataStore = dataStore;
    this.wrap = document.getElementById('timeViewWrap');
    this.subscribe();
  }

  subscribe() {
    App.EventBus.on('view:changed', (view) => {
      if (view === 'approvals') this.render();
    });
  }

  // People who can be picked as a supervisor (have an overseeing role + a member id).
  supervisorOptions(excludeMemberId) {
    const overseeing = ['supervisor', 'admin', 'developer'];
    return (App.PROFILES || [])
      .filter(p => p.member_id && p.member_id !== excludeMemberId && overseeing.includes(p.role))
      .map(p => {
        const person = App.PEOPLE[p.member_id];
        return { id: p.member_id, name: (person && person.full) || p.full_name || p.email || p.member_id };
      });
  }

  render() {
    if (!App.can('roles.manage')) {
      this.wrap.innerHTML = `<div class="empty"><i class="ti ti-lock"></i><div class="empty-title">No access</div><div class="empty-sub">Only admins and construction supervisors can manage users.</div></div>`;
      return;
    }

    const rows = (App.PROFILES || []).map(profile => this.renderRow(profile)).join('');
    this.wrap.innerHTML = `
      <div class="time-page">
        <div class="time-section">
          <div class="approval-head">
            <div class="time-section-title">User approvals</div>
            <button class="btn btn-sm" data-action="refresh-profiles"><i class="ti ti-refresh"></i>Refresh</button>
          </div>
          <div class="approval-scroll">
            <table class="time-table approval-table">
              <thead>
                <tr><th>Person</th><th>Role</th><th>Company</th><th>Reports to</th><th>Status</th><th>Email</th><th></th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="7">No accounts found.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    this.bind();
  }

  renderRow(profile) {
    // You can't delete your own account — hide the button and RLS blocks it too.
    const isSelf = !!(App.currentAuthUser && App.currentAuthUser.id === profile.id);
    const person = App.PEOPLE[profile.member_id] || {
      name: profile.full_name || profile.email || 'Member',
      full: profile.full_name || profile.email || 'Member',
      email: profile.email || '',
      color: '#E8A03A',
      avatar_url: profile.avatar_url || null,
    };
    // Assignable roles. If this profile still holds a retired/unknown role
    // (e.g. a pending "member", or one not yet migrated), show it as the
    // current selection so simply saving the row won't silently reassign them.
    const roleEntries = Object.entries(App.ROLES);
    if (profile.role && !App.ROLES[profile.role]) {
      const retiredLabels = { member: 'Member', construction_supervisor: 'Construction supervisor' };
      roleEntries.unshift([profile.role, { label: `${retiredLabels[profile.role] || profile.role} (retired)` }]);
    }
    const roles = roleEntries.map(([id, role]) =>
      `<option value="${id}" ${profile.role === id ? 'selected' : ''}>${role.label}</option>`
    ).join('');
    const supervisorOpts = ['<option value="">— None —</option>']
      .concat(this.supervisorOptions(profile.member_id).map(s =>
        `<option value="${s.id}" ${profile.supervisor_id === s.id ? 'selected' : ''}>${App.utils.escapeHtml(s.name)}</option>`
      )).join('');
    const companyIds = Array.isArray(profile.company_ids) ? profile.company_ids : [];
    const companyChecks = Object.values(App.COMPANIES).map(c => `
      <label class="company-chk">
        <input type="checkbox" value="${App.utils.escapeHtml(c.id)}" ${companyIds.includes(c.id) ? 'checked' : ''} />
        <span>${App.utils.escapeHtml(c.label)}</span>
      </label>
    `).join('');
    return `
      <tr data-profile-id="${profile.id}" data-member-id="${profile.member_id || ''}" data-person-name="${App.utils.escapeHtml(person.full)}">
        <td>
          <span style="display:inline-flex;align-items:center;gap:8px;">
            ${App.utils.avatarHtml(person)}
            <span style="font-size:12px;">${App.utils.escapeHtml(person.full)}</span>
          </span>
        </td>
        <td><select data-field="role">${roles}</select></td>
        <td><div class="company-multi" data-field="companies">${companyChecks}</div></td>
        <td><select data-field="supervisor">${supervisorOpts}</select></td>
        <td>
          <label class="approval-toggle">
            <input type="checkbox" data-field="approved" ${profile.approved ? 'checked' : ''} />
            <span>${profile.approved ? 'Approved' : 'Pending'}</span>
          </label>
        </td>
        <td>${App.utils.escapeHtml(profile.email || '')}</td>
        <td>
          <div class="approval-actions">
            <button class="btn btn-sm btn-primary" data-action="save-access">Save</button>
            ${isSelf ? '' : `<button class="btn btn-sm btn-danger" data-action="delete-user" title="Remove this user's access"><i class="ti ti-trash"></i></button>`}
          </div>
        </td>
      </tr>
    `;
  }

  bind() {
    const refreshBtn = this.wrap.querySelector('[data-action="refresh-profiles"]');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.reloadAndRender(refreshBtn));

    // Keep the Approved/Pending label in sync as the box is toggled (before save).
    this.wrap.querySelectorAll('[data-field="approved"]').forEach(box => {
      box.addEventListener('change', () => {
        const label = box.parentElement.querySelector('span');
        if (label) label.textContent = box.checked ? 'Approved' : 'Pending';
      });
    });

    this.wrap.querySelectorAll('[data-action="save-access"]').forEach(button => {
      button.addEventListener('click', async () => {
        const row = button.closest('[data-profile-id]');
        const profileId = row.dataset.profileId;
        const role = row.querySelector('[data-field="role"]').value;
        const approved = row.querySelector('[data-field="approved"]').checked;
        const supervisorId = row.querySelector('[data-field="supervisor"]').value || null;
        const companyIds = Array.from(
          row.querySelectorAll('[data-field="companies"] input[type="checkbox"]:checked')
        ).map(el => el.value);
        button.disabled = true;
        button.textContent = 'Saving';
        try {
          await this.dataStore.updateProfileAccess(profileId, { role, approved, supervisorId, companyIds });
          this.controller.toastView.show({ title: 'Access updated', sub: approved ? 'Account approved' : 'Account set to pending' });
          // Reload from the server so the table reflects the saved state without a manual refresh.
          await this.reloadAndRender();
        } catch (err) {
          this.controller.toastView.show({ title: 'Access update failed', sub: (err && err.message) || 'Try again.' });
          button.disabled = false;
          button.textContent = 'Save';
        }
      });
    });

    this.wrap.querySelectorAll('[data-action="delete-user"]').forEach(button => {
      button.addEventListener('click', async () => {
        const row = button.closest('[data-profile-id]');
        const profileId = row.dataset.profileId;
        const memberId = row.dataset.memberId || null;
        const name = row.dataset.personName || 'this user';
        const ok = window.confirm(
          `Delete ${name}?\n\nThey'll be signed out, removed from this list, and their login email freed so it can be used to sign up again. Their past tasks are kept.`
        );
        if (!ok) return;
        button.disabled = true;
        try {
          const result = await this.dataStore.deleteProfile(profileId, memberId);
          this.controller.toastView.show(
            (result && result.emailFreed)
              ? { title: 'User deleted', sub: 'Access revoked and the email is free to reuse.' }
              : { title: 'Access revoked', sub: 'Email stays reserved until the delete-user function is deployed.' }
          );
          await this.reloadAndRender();
        } catch (err) {
          this.controller.toastView.show({ title: 'Delete failed', sub: (err && err.message) || 'Try again.' });
          button.disabled = false;
        }
      });
    });
  }

  async reloadAndRender(btn) {
    if (btn) { btn.disabled = true; }
    try {
      const profiles = await this.dataStore.loadProfiles();
      App.PROFILES = profiles;
      App.EventBus.emit('people:changed');
    } catch (err) {
      this.controller.toastView.show({ title: 'Could not refresh', sub: (err && err.message) || 'Try again.' });
    }
    this.render();
  }
};
