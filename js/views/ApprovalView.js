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

  render() {
    if (!App.can('roles.manage')) {
      this.wrap.innerHTML = `<div class="empty"><i class="ti ti-lock"></i><div class="empty-title">No access</div><div class="empty-sub">Only admins and construction supervisors can manage users.</div></div>`;
      return;
    }

    const rows = (App.PROFILES || []).map(profile => this.renderRow(profile)).join('');
    this.wrap.innerHTML = `
      <div class="time-page">
        <div class="time-section">
          <div class="time-section-title">User approvals</div>
          <table class="time-table approval-table">
            <thead>
              <tr><th>Person</th><th>Role</th><th>Status</th><th>Email</th><th></th></tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="5">No accounts found.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
    this.bind();
  }

  renderRow(profile) {
    const person = App.PEOPLE[profile.member_id] || {
      name: profile.full_name || profile.email || 'Member',
      full: profile.full_name || profile.email || 'Member',
      email: profile.email || '',
      color: '#E8A03A',
    };
    const roles = Object.entries(App.ROLES).map(([id, role]) =>
      `<option value="${id}" ${profile.role === id ? 'selected' : ''}>${role.label}</option>`
    ).join('');
    return `
      <tr data-profile-id="${profile.id}">
        <td>
          <span style="display:inline-flex;align-items:center;gap:8px;">
            <span class="avatar-xs" style="background:${person.color};">${App.utils.initials(person.full)}</span>
            ${App.utils.escapeHtml(person.full)}
          </span>
        </td>
        <td><select data-field="role">${roles}</select></td>
        <td>
          <label class="approval-toggle">
            <input type="checkbox" data-field="approved" ${profile.approved ? 'checked' : ''} />
            <span>${profile.approved ? 'Approved' : 'Pending'}</span>
          </label>
        </td>
        <td>${App.utils.escapeHtml(profile.email || '')}</td>
        <td><button class="btn btn-sm btn-primary" data-action="save-access">Save</button></td>
      </tr>
    `;
  }

  bind() {
    this.wrap.querySelectorAll('[data-action="save-access"]').forEach(button => {
      button.addEventListener('click', async () => {
        const row = button.closest('[data-profile-id]');
        const profileId = row.dataset.profileId;
        const role = row.querySelector('[data-field="role"]').value;
        const approved = row.querySelector('[data-field="approved"]').checked;
        button.disabled = true;
        button.textContent = 'Saving';
        try {
          const updated = await this.dataStore.updateProfileAccess(profileId, { role, approved });
          App.PROFILES = (App.PROFILES || []).map(profile => profile.id === updated.id ? updated : profile);
          this.controller.toastView.show({ title: 'Access updated', sub: updated.email || '' });
          this.render();
        } catch (err) {
          this.controller.toastView.show({ title: 'Access update failed', sub: (err && err.message) || 'Try again.' });
          button.disabled = false;
          button.textContent = 'Save';
        }
      });
    });
  }
};
