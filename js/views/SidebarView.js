window.App = window.App || {};

App.SidebarView = class SidebarView {
  constructor({ taskModel, timeModel, controller, currentUser }) {
    this.taskModel = taskModel;
    this.timeModel = timeModel;
    this.controller = controller;
    this.currentUser = currentUser;

    this.peopleList = document.getElementById('peopleList');
    this.applyRoleVisibility();
    this.renderPeopleList();
    this.bindStaticItems();
    this.subscribe();
    this.renderCounts();
  }

  bindStaticItems() {
    document.querySelectorAll('.side-item[data-view]').forEach(el => {
      if (el.dataset.view.startsWith('person:')) return;
      if (!this.controller.canView(el.dataset.view)) {
        el.classList.add('hidden');
        return;
      }
      el.addEventListener('click', () => this.controller.setView(el.dataset.view));
    });
  }

  applyRoleVisibility() {
    const adminGroup = document.getElementById('adminSideGroup');
    if (adminGroup) adminGroup.classList.toggle('hidden', !App.can('roles.manage'));

    const groups = Array.from(document.querySelectorAll('.sidebar .side-group'));
    const viewsGroup = groups[0];
    const companiesGroup = groups[1];
    const peopleGroup = groups.find(group => group.querySelector('#peopleList'));
    if (viewsGroup) viewsGroup.classList.toggle('hidden', !App.can('tasks.view'));
    if (companiesGroup) companiesGroup.classList.toggle('hidden', !App.can('tasks.view'));
    if (peopleGroup) peopleGroup.classList.toggle('hidden', !App.can('tasks.view'));
  }

  renderPeopleList() {
    this.peopleList.innerHTML = '';
    Object.values(App.PEOPLE).forEach(p => {
      const item = document.createElement('div');
      item.className = 'side-item';
      item.dataset.view = 'person:' + p.id;
      item.innerHTML = `<span class="avatar-xs" style="background:${p.color};">${App.utils.initials(p.full)}</span>${p.name}`;
      item.addEventListener('click', () => this.controller.setView('person:' + p.id));
      this.peopleList.appendChild(item);
    });
  }

  subscribe() {
    App.EventBus.on('tasks:changed', () => this.renderCounts());
    App.EventBus.on('time:changed', () => this.renderCounts());
    App.EventBus.on('view:changed', (view) => this.updateActive(view));
  }

  updateActive(view) {
    document.querySelectorAll('.side-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });
  }

  renderCounts() {
    const all = this.taskModel.all().filter(t => t.status !== 'done');
    const today = App.utils.todayISO(0);

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    set('cnt-all', App.can('tasks.view') ? all.length : 0);
    set('cnt-mine', all.filter(t => t.assignee === this.currentUser).length);
    set('cnt-hot', all.filter(t => t.urgency === 'critical' || t.urgency === 'urgent').length);
    set('cnt-today', all.filter(t => t.due === today).length);
    set('cnt-overdue', all.filter(t => t.due < today).length);
    set('cnt-watching', all.filter(t => (t.watchers || []).includes(this.currentUser)).length);

    ['roofing', 'drafting', 'lumen'].forEach(c => {
      set('cnt-' + c, all.filter(t => t.company === c).length);
    });

    set('cnt-time-mine', App.utils.formatHours(this.timeModel.totalForUser(this.currentUser)));
    set('cnt-time-active', this.timeModel.allActive().length);
  }
};
