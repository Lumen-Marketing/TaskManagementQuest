window.App = window.App || {};

/* TaskModel — owns the tasks array.
   Mutating methods emit 'tasks:changed'. Pure query methods do not. */
App.TaskModel = class TaskModel {
  constructor() {
    this.tasks = [];
    this._dirty = new Set(); // ids of tasks changed since last successful save
  }

  /* ---------- hydration / seed ---------- */
  hydrate(arr) {
    this.tasks = Array.isArray(arr) ? arr : [];
    this._dirty.clear();
  }

  /* ---------- dirty tracking (drives delta saves) ---------- */
  _markDirty(id) { if (id) this._dirty.add(id); }
  // Returns the changed task objects and clears the dirty set (optimistic).
  takeDirty() {
    const ids = [...this._dirty];
    this._dirty.clear();
    return ids.map(id => this.find(id)).filter(Boolean);
  }
  // Re-flag ids as dirty (e.g. when a save failed and must be retried).
  markDirty(ids) { (ids || []).forEach(id => this._markDirty(id)); }
  // Replace a task with the authoritative server version (conflict resolution).
  applyServer(task) {
    if (!task) return;
    const i = this.tasks.findIndex(t => t.id === task.id);
    if (i === -1) this.tasks.push(task); else this.tasks[i] = task;
    this._dirty.delete(task.id);
    App.EventBus.emit('tasks:changed');
  }

  seedDefaults() {
    const iso = App.utils.todayISO;
    this.tasks = [
      { id:'t1',  title:'Lien filing — CNL job', type:'admin', company:'roofing', creator:'abraham', assignee:'abraham', watchers:['kristine'], due:iso(-4), priority:'urgent',   status:'todo',    description:'Mechanic\'s lien paperwork prepped. Need to file with Maricopa County recorder before end of week.', subtasks:[{t:'Pull deed info',d:true},{t:'Notarize',d:false}], activity:[{who:'Abraham',what:'created this task',when:'5d ago'}] },
      { id:'t2',  title:'Update QR ROC complaint draft', type:'admin', company:'roofing', creator:'abraham', assignee:'kristine', watchers:[], due:iso(-2), priority:'high', status:'pending', description:'Add the contract excerpt and email chain as exhibits before sending.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Kristine',when:'3d ago'}] },
      { id:'t3',  title:'CNL demand letter follow-up', type:'ar', company:'roofing', creator:'abraham', assignee:'abraham', watchers:['kristine'], due:iso(0), priority:'critical', status:'todo', description:'Call CNL accounting by EOD. If no commitment, file mechanic\'s lien tomorrow + Justice Court small claims by Friday.', subtasks:[{t:'Send certified letter',d:true},{t:'Call accounting',d:false},{t:'Prep lien paperwork',d:false}], activity:[{who:'Kristine',what:'uploaded letter.pdf',when:'2h ago'},{who:'Abraham',what:'set due date today',when:'yesterday'}] },
      { id:'t4',  title:'Paradise Valley demo punch list', type:'bid', bidStatus:'started', company:'roofing', creator:'abraham', assignee:'alkeith', watchers:['abraham'], due:iso(0), priority:'urgent', status:'todo', description:'Final walkthrough items. See photos in shared album.', subtasks:[{t:'Tear-off west slope',d:true},{t:'Replace decking 2 sheets',d:true},{t:'Drip edge install',d:false},{t:'Final cleanup + photos',d:false}], activity:[{who:'Abraham',what:'assigned this to Alkeith',when:'yesterday'}] },
      { id:'t5',  title:'Jesus week-2 KPI review', type:'meeting', company:'roofing', creator:'abraham', assignee:'abraham', watchers:['jesus'], due:iso(0), priority:'high', status:'review', description:'Review against 90-day vesting milestones. Doors knocked, appts set, contracts signed.', subtasks:[], activity:[] },
      { id:'t6',  title:'Send Andres weekly QA brief', type:'admin', company:'drafting', creator:'abraham', assignee:'abraham', watchers:[], due:iso(0), priority:'medium', status:'todo', description:'', subtasks:[], activity:[] },
      { id:'t7',  title:'Adrian — confirm trial milestones', type:'meeting', company:'lumen', creator:'abraham', assignee:'abraham', watchers:['adrian'], due:iso(0), priority:'high', status:'todo', description:'3-month trial KPIs need to be in writing before next sync.', subtasks:[], activity:[] },
      { id:'t8',  title:'Lumen pitch deck v3 sign-off', type:'lead', company:'lumen', creator:'abraham', assignee:'adrian', watchers:['abraham'], due:iso(1), priority:'medium', status:'review', description:'Final review of HVAC pitch deck before client outreach.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Adrian',when:'2d ago'}] },
      { id:'t9',  title:'DraftTrack markup tool QA', type:'admin', company:'drafting', creator:'abraham', assignee:'andres', watchers:[], due:iso(1), priority:'medium', status:'todo', description:'Test all markup tools on Safari + Chrome. Document any issues.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Andres',when:'2d ago'}] },
      { id:'t10', title:'Schedule monsoon ad shoot', type:'admin', company:'lumen', creator:'abraham', assignee:'adrian', watchers:[], due:iso(3), priority:'medium', status:'todo', description:'Friday morning, blue sky. Confirm location + crew.', subtasks:[], activity:[] },
      { id:'t11', title:'Supabase auth wiring', type:'admin', company:'drafting', creator:'abraham', assignee:'abraham', watchers:[], due:iso(4), priority:'high', status:'hold', description:'DraftTrack client portal — add auth + persistent storage.', subtasks:[], activity:[] },
      { id:'t12', title:'GC outreach v2 script', type:'lead', company:'roofing', creator:'abraham', assignee:'jesus', watchers:['abraham'], due:iso(5), priority:'medium', status:'todo', description:'Hormozi-style warm follow-up. Lead with the ROC + insurance angle.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Jesus',when:'today'}] },
      { id:'t13', title:'Order shingles, Gilbert job', type:'admin', company:'roofing', creator:'abraham', assignee:'kristine', watchers:[], due:iso(-1), priority:'medium', status:'done', description:'', subtasks:[], activity:[] },
      { id:'t14', title:'Send Adrian operating agreement', type:'admin', company:'lumen', creator:'abraham', assignee:'abraham', watchers:['adrian'], due:iso(-2), priority:'high', status:'done', description:'', subtasks:[], activity:[] },
      { id:'t15', title:'Material handoff — Mesa job', type:'admin', company:'roofing', creator:'alkeith', assignee:'kristine', watchers:['abraham'], due:iso(2), priority:'low', status:'todo', description:'Voice note from Alkeith: confirm metal flashing arrives at yard by Thursday.', subtasks:[], activity:[{who:'Alkeith',what:'created via voice note',when:'1h ago'}] },
    ];
  }

  /* ---------- queries ---------- */
  all() { return this.tasks; }
  find(id) { return this.tasks.find(t => t.id === id); }
  byCompany(companyId) { return this.tasks.filter(t => t.company === companyId); }
  byAssignee(userId) { return this.tasks.filter(t => t.assignee === userId); }

  getFiltered({ view, searchQuery, currentUser, activeFilters }) {
    let tasks = this.tasks;
    const t0 = App.utils.todayISO(0);

    if (view === 'mine') tasks = tasks.filter(t => t.assignee === currentUser);
    else if (view === 'hot') tasks = tasks.filter(t => (t.priority === 'critical' || t.priority === 'urgent') && t.status !== 'done');
    else if (view === 'today') tasks = tasks.filter(t => t.due === t0 && t.status !== 'done');
    else if (view === 'overdue') tasks = tasks.filter(t => t.due < t0 && t.status !== 'done');
    else if (view === 'watching') tasks = tasks.filter(t => (t.watchers || []).includes(currentUser));
    else if (view.startsWith('company:')) {
      const c = view.split(':')[1];
      tasks = tasks.filter(t => t.company === c);
    } else if (view.startsWith('person:')) {
      const p = view.split(':')[1];
      tasks = tasks.filter(t => t.assignee === p);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      tasks = tasks.filter(t => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
    }

    if (activeFilters) {
      const f = activeFilters;
      if (f.assignees && f.assignees.length) tasks = tasks.filter(t => f.assignees.includes(t.assignee));
      if (f.companies && f.companies.length) tasks = tasks.filter(t => f.companies.includes(t.company));
      if (f.statuses  && f.statuses.length)  tasks = tasks.filter(t => f.statuses.includes(t.status || 'todo'));
      if (f.priorities && f.priorities.length) tasks = tasks.filter(t => f.priorities.includes(t.priority || 'medium'));
      if (f.types && f.types.length) tasks = tasks.filter(t => f.types.includes(t.type || 'admin'));
      if (f.dueRange && f.dueRange !== 'all') {
        const t1 = App.utils.todayISO(1);
        const t7 = App.utils.todayISO(7);
        const t30 = App.utils.todayISO(30);
        tasks = tasks.filter(t => {
          if (!t.due) return false;
          if (f.dueRange === 'overdue') return t.due < t0 && t.status !== 'done';
          if (f.dueRange === 'today')   return t.due === t0;
          if (f.dueRange === 'tomorrow')return t.due === t1;
          if (f.dueRange === 'week')    return t.due >= t0 && t.due <= t7;
          if (f.dueRange === 'month')   return t.due >= t0 && t.due <= t30;
          return true;
        });
      }
    }
    return tasks;
  }

  /* Generic Monday-style grouping. Returns an ordered list of buckets:
        [{ key, label, color, items[] }, ...]
     - groupBy: 'due' | 'status' | 'assignee' | 'company' | 'priority' | 'type' | 'none'
     - sortBy + sortDir control the order INSIDE each bucket.
     Empty buckets are dropped so the table doesn't show dead sections. */
  groupTasks(tasks, { groupBy = 'due', sortBy = 'priority', sortDir = 'asc' } = {}) {
    const t0 = App.utils.todayISO(0);
    const t1 = App.utils.todayISO(1);
    const t7 = App.utils.todayISO(7);

    const buckets = new Map();
    const ensure = (key, label, color, order) => {
      if (!buckets.has(key)) buckets.set(key, { key, label, color, order, items: [] });
      return buckets.get(key);
    };

    const colorVar = (v) => `var(${v})`;
    const colorFor = (key) => ({
      overdue:  colorVar('--rust'),
      today:    colorVar('--amber'),
      tomorrow: colorVar('--blue'),
      thisWeek: colorVar('--green'),
      later:    colorVar('--ink-3'),
      done:     colorVar('--ink-3'),
    }[key]);

    tasks.forEach(t => {
      if (groupBy === 'due') {
        if (t.status === 'done') ensure('done', 'Done', colorFor('done'), 6).items.push(t);
        else if (!t.due)         ensure('later', 'No due date', colorFor('later'), 5).items.push(t);
        else if (t.due < t0)     ensure('overdue', 'Overdue', colorFor('overdue'), 0).items.push(t);
        else if (t.due === t0)   ensure('today', 'Due today', colorFor('today'), 1).items.push(t);
        else if (t.due === t1)   ensure('tomorrow', 'Tomorrow', colorFor('tomorrow'), 2).items.push(t);
        else if (t.due <= t7)    ensure('thisWeek', 'This week', colorFor('thisWeek'), 3).items.push(t);
        else                     ensure('later', 'Later', colorFor('later'), 4).items.push(t);
      } else if (groupBy === 'status') {
        const k = t.status || 'todo';
        const s = App.STATUSES[k] || App.STATUSES.todo;
        const colorMap = { todo: '--blue', doing: '--blue', pending: '--ink-3', hold: '--rust', review: '--amber', done: '--green' };
        ensure(k, s.label, colorVar(colorMap[s.cls.replace('status-', '')] || '--ink-3'), Object.keys(App.STATUSES).indexOf(k)).items.push(t);
      } else if (groupBy === 'assignee') {
        const k = t.assignee || 'unassigned';
        const p = App.PEOPLE[k];
        ensure(k, p ? p.name : 'Unassigned', p ? p.color : 'var(--ink-3)', k).items.push(t);
      } else if (groupBy === 'company') {
        const k = t.company || 'none';
        const c = App.COMPANIES[k];
        const cMap = { roofing: '--rust', drafting: '--green', lumen: '--blue' };
        ensure(k, c ? c.label : 'No company', colorVar(cMap[k] || '--ink-3'), Object.keys(App.COMPANIES).indexOf(k)).items.push(t);
      } else if (groupBy === 'priority') {
        const k = t.priority || 'medium';
        const p = App.PRIORITIES[k] || App.PRIORITIES.medium;
        ensure(k, p.label, colorVar(`--u-${k}`), p.order).items.push(t);
      } else if (groupBy === 'type') {
        const k = t.type || 'admin';
        const ty = App.TASK_TYPES[k] || App.TASK_TYPES.admin;
        ensure(k, ty.label, colorVar(`--type-${k}`), Object.keys(App.TASK_TYPES).indexOf(k)).items.push(t);
      } else {
        ensure('all', 'All tasks', colorVar('--amber'), 0).items.push(t);
      }
    });

    const cmp = this._comparator(sortBy, sortDir);
    const out = [...buckets.values()].sort((a, b) => a.order - b.order);
    out.forEach(b => b.items.sort(cmp));
    return out;
  }

  _comparator(sortBy, sortDir) {
    const dir = sortDir === 'desc' ? -1 : 1;
    const prioOrd = (t) => (App.PRIORITIES[t.priority] || App.PRIORITIES.medium).order;
    const statusOrd = (t) => Object.keys(App.STATUSES).indexOf(t.status || 'todo');
    const assigneeName = (t) => (App.PEOPLE[t.assignee] && App.PEOPLE[t.assignee].name) || t.assignee || '';
    const dueKey = (t) => t.due || '9999-12-31';
    return (a, b) => {
      let c = 0;
      if (sortBy === 'priority') c = prioOrd(a) - prioOrd(b);
      else if (sortBy === 'due')      c = dueKey(a).localeCompare(dueKey(b));
      else if (sortBy === 'title')    c = (a.title || '').localeCompare(b.title || '');
      else if (sortBy === 'assignee') c = assigneeName(a).localeCompare(assigneeName(b));
      else if (sortBy === 'status')   c = statusOrd(a) - statusOrd(b);
      else if (sortBy === 'created')  c = (a.id || '').localeCompare(b.id || '');
      // Stable tiebreaker by due
      if (c === 0) c = dueKey(a).localeCompare(dueKey(b));
      return c * dir;
    };
  }

  groupByDue(tasks) {
    const groups = { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], done: [] };
    const t0 = App.utils.todayISO(0);
    const t1 = App.utils.todayISO(1);
    const t7 = App.utils.todayISO(7);
    tasks.forEach(t => {
      if (t.status === 'done') groups.done.push(t);
      else if (t.due < t0) groups.overdue.push(t);
      else if (t.due === t0) groups.today.push(t);
      else if (t.due === t1) groups.tomorrow.push(t);
      else if (t.due <= t7) groups.thisWeek.push(t);
      else groups.later.push(t);
    });
    Object.keys(groups).forEach(k => {
      groups[k].sort((a, b) => {
        const aOrd = (App.PRIORITIES[a.priority] || App.PRIORITIES.medium).order;
        const bOrd = (App.PRIORITIES[b.priority] || App.PRIORITIES.medium).order;
        return aOrd - bOrd || a.due.localeCompare(b.due);
      });
    });
    return groups;
  }

  /* ---------- mutations ---------- */
  add(task) {
    this.tasks.unshift(task);
    this._markDirty(task.id);
    App.EventBus.emit('tasks:changed');
  }

  update(id, updates) {
    const t = this.find(id);
    if (!t) return;
    Object.assign(t, updates);
    this._markDirty(id);
    App.EventBus.emit('tasks:changed');
  }

  toggleDone(id, userName) {
    const t = this.find(id);
    if (!t) return;
    const becomingDone = t.status !== 'done';
    t.status = becomingDone ? 'done' : 'todo';
    if (becomingDone) t._completedAt = App.utils.todayISO(0);
    else delete t._completedAt;
    this.pushActivity(t, userName, becomingDone ? 'marked this complete' : 'reopened this task');
    this._markDirty(id);
    App.EventBus.emit('tasks:changed');
    return { becomingDone };
  }

  cyclePriority(id, userName) {
    const t = this.find(id);
    if (!t) return;
    const keys = Object.keys(App.PRIORITIES);
    const i = keys.indexOf(t.priority || 'medium');
    t.priority = keys[(i + 1) % keys.length];
    this.pushActivity(t, userName, `set priority to ${App.PRIORITIES[t.priority].label}`);
    this._markDirty(id);
    App.EventBus.emit('tasks:changed');
  }

  reassign(id, newAssignee, userName) {
    const t = this.find(id);
    if (!t || t.assignee === newAssignee) return null;
    const oldAssignee = t.assignee;
    t.assignee = newAssignee;
    this.pushActivity(t, userName, `reassigned this from ${App.PEOPLE[oldAssignee].name} to ${App.PEOPLE[newAssignee].name}`);
    this._markDirty(id);
    App.EventBus.emit('tasks:changed');
    return { oldAssignee, newAssignee };
  }

  setField(id, field, value, userName) {
    const t = this.find(id);
    if (!t) return;
    t[field] = value;
    this.pushActivity(t, userName, `changed ${field}`);
    this._markDirty(id);
    App.EventBus.emit('tasks:changed');
  }

  toggleSubtask(taskId, idx) {
    const t = this.find(taskId);
    if (!t || !t.subtasks || !t.subtasks[idx]) return;
    t.subtasks[idx].d = !t.subtasks[idx].d;
    this._markDirty(taskId);
    App.EventBus.emit('tasks:changed');
  }

  pushActivity(task, who, what) {
    task.activity = task.activity || [];
    task.activity.unshift({ who, what, when: 'just now' });
  }

  addActivity(taskId, entry) {
    const t = this.find(taskId);
    if (!t) return;
    t.activity = t.activity || [];
    t.activity.unshift(entry);
    this._markDirty(taskId);
    App.EventBus.emit('tasks:changed');
  }
};
