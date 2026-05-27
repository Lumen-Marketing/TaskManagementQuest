window.App = window.App || {};

/* TaskModel — owns the tasks array.
   Mutating methods emit 'tasks:changed'. Pure query methods do not. */
App.TaskModel = class TaskModel {
  constructor() {
    this.tasks = [];
  }

  /* ---------- hydration / seed ---------- */
  hydrate(arr) {
    this.tasks = Array.isArray(arr) ? arr : [];
  }

  seedDefaults() {
    const iso = App.utils.todayISO;
    this.tasks = [
      { id:'t1',  title:'Lien filing — CNL job', company:'roofing', creator:'abraham', assignee:'abraham', watchers:['kristine'], due:iso(-4), priority:'high',   urgency:'urgent',   status:'todo',    description:'Mechanic\'s lien paperwork prepped. Need to file with Maricopa County recorder before end of week.', subtasks:[{t:'Pull deed info',d:true},{t:'Notarize',d:false}], activity:[{who:'Abraham',what:'created this task',when:'5d ago'}] },
      { id:'t2',  title:'Update QR ROC complaint draft', company:'roofing', creator:'abraham', assignee:'kristine', watchers:[], due:iso(-2), priority:'medium', urgency:'high', status:'pending', description:'Add the contract excerpt and email chain as exhibits before sending.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Kristine',when:'3d ago'}] },
      { id:'t3',  title:'CNL demand letter follow-up', company:'roofing', creator:'abraham', assignee:'abraham', watchers:['kristine'], due:iso(0), priority:'high', urgency:'critical', status:'todo', description:'Call CNL accounting by EOD. If no commitment, file mechanic\'s lien tomorrow + Justice Court small claims by Friday.', subtasks:[{t:'Send certified letter',d:true},{t:'Call accounting',d:false},{t:'Prep lien paperwork',d:false}], activity:[{who:'Kristine',what:'uploaded letter.pdf',when:'2h ago'},{who:'Abraham',what:'set due date today',when:'yesterday'}] },
      { id:'t4',  title:'Paradise Valley demo punch list', company:'roofing', creator:'abraham', assignee:'alkeith', watchers:['abraham'], due:iso(0), priority:'high', urgency:'urgent', status:'todo', description:'Final walkthrough items. See photos in shared album.', subtasks:[{t:'Tear-off west slope',d:true},{t:'Replace decking 2 sheets',d:true},{t:'Drip edge install',d:false},{t:'Final cleanup + photos',d:false}], activity:[{who:'Abraham',what:'assigned this to Alkeith',when:'yesterday'}] },
      { id:'t5',  title:'Jesus week-2 KPI review', company:'roofing', creator:'abraham', assignee:'abraham', watchers:['jesus'], due:iso(0), priority:'medium', urgency:'high', status:'review', description:'Review against 90-day vesting milestones. Doors knocked, appts set, contracts signed.', subtasks:[], activity:[] },
      { id:'t6',  title:'Send Andres weekly QA brief', company:'drafting', creator:'abraham', assignee:'abraham', watchers:[], due:iso(0), priority:'low', urgency:'medium', status:'todo', description:'', subtasks:[], activity:[] },
      { id:'t7',  title:'Adrian — confirm trial milestones', company:'lumen', creator:'abraham', assignee:'abraham', watchers:['adrian'], due:iso(0), priority:'medium', urgency:'high', status:'todo', description:'3-month trial KPIs need to be in writing before next sync.', subtasks:[], activity:[] },
      { id:'t8',  title:'Lumen pitch deck v3 sign-off', company:'lumen', creator:'abraham', assignee:'adrian', watchers:['abraham'], due:iso(1), priority:'medium', urgency:'medium', status:'review', description:'Final review of HVAC pitch deck before client outreach.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Adrian',when:'2d ago'}] },
      { id:'t9',  title:'DraftTrack markup tool QA', company:'drafting', creator:'abraham', assignee:'andres', watchers:[], due:iso(1), priority:'medium', urgency:'medium', status:'todo', description:'Test all markup tools on Safari + Chrome. Document any issues.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Andres',when:'2d ago'}] },
      { id:'t10', title:'Schedule monsoon ad shoot', company:'lumen', creator:'abraham', assignee:'adrian', watchers:[], due:iso(3), priority:'medium', urgency:'medium', status:'todo', description:'Friday morning, blue sky. Confirm location + crew.', subtasks:[], activity:[] },
      { id:'t11', title:'Supabase auth wiring', company:'drafting', creator:'abraham', assignee:'abraham', watchers:[], due:iso(4), priority:'high', urgency:'high', status:'hold', description:'DraftTrack client portal — add auth + persistent storage.', subtasks:[], activity:[] },
      { id:'t12', title:'GC outreach v2 script', company:'roofing', creator:'abraham', assignee:'jesus', watchers:['abraham'], due:iso(5), priority:'medium', urgency:'medium', status:'todo', description:'Hormozi-style warm follow-up. Lead with the ROC + insurance angle.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Jesus',when:'today'}] },
      { id:'t13', title:'Order shingles, Gilbert job', company:'roofing', creator:'abraham', assignee:'kristine', watchers:[], due:iso(-1), priority:'medium', urgency:'medium', status:'done', description:'', subtasks:[], activity:[] },
      { id:'t14', title:'Send Adrian operating agreement', company:'lumen', creator:'abraham', assignee:'abraham', watchers:['adrian'], due:iso(-2), priority:'high', urgency:'high', status:'done', description:'', subtasks:[], activity:[] },
      { id:'t15', title:'Material handoff — Mesa job', company:'roofing', creator:'alkeith', assignee:'kristine', watchers:['abraham'], due:iso(2), priority:'low', urgency:'chill', status:'todo', description:'Voice note from Alkeith: confirm metal flashing arrives at yard by Thursday.', subtasks:[], activity:[{who:'Alkeith',what:'created via voice note',when:'1h ago'}] },
    ];
  }

  /* ---------- queries ---------- */
  all() { return this.tasks; }
  find(id) { return this.tasks.find(t => t.id === id); }
  byCompany(companyId) { return this.tasks.filter(t => t.company === companyId); }
  byAssignee(userId) { return this.tasks.filter(t => t.assignee === userId); }

  getFiltered({ view, searchQuery, currentUser }) {
    let tasks = this.tasks;
    const t0 = App.utils.todayISO(0);

    if (view === 'mine') tasks = tasks.filter(t => t.assignee === currentUser);
    else if (view === 'hot') tasks = tasks.filter(t => (t.urgency === 'critical' || t.urgency === 'urgent') && t.status !== 'done');
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
    return tasks;
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
        const aOrd = (App.URGENCIES[a.urgency] || App.URGENCIES.medium).order;
        const bOrd = (App.URGENCIES[b.urgency] || App.URGENCIES.medium).order;
        return aOrd - bOrd || a.due.localeCompare(b.due);
      });
    });
    return groups;
  }

  /* ---------- mutations ---------- */
  add(task) {
    this.tasks.unshift(task);
    App.EventBus.emit('tasks:changed');
  }

  update(id, updates) {
    const t = this.find(id);
    if (!t) return;
    Object.assign(t, updates);
    App.EventBus.emit('tasks:changed');
  }

  toggleDone(id, userName) {
    const t = this.find(id);
    if (!t) return;
    t.status = t.status === 'done' ? 'todo' : 'done';
    this.pushActivity(t, userName, t.status === 'done' ? 'marked this complete' : 'reopened this task');
    App.EventBus.emit('tasks:changed');
  }

  cycleUrgency(id, userName) {
    const t = this.find(id);
    if (!t) return;
    const keys = Object.keys(App.URGENCIES);
    const i = keys.indexOf(t.urgency || 'medium');
    t.urgency = keys[(i + 1) % keys.length];
    this.pushActivity(t, userName, `set urgency to ${App.URGENCIES[t.urgency].label}`);
    App.EventBus.emit('tasks:changed');
  }

  reassign(id, newAssignee, userName) {
    const t = this.find(id);
    if (!t || t.assignee === newAssignee) return null;
    const oldAssignee = t.assignee;
    t.assignee = newAssignee;
    this.pushActivity(t, userName, `reassigned this from ${App.PEOPLE[oldAssignee].name} to ${App.PEOPLE[newAssignee].name}`);
    App.EventBus.emit('tasks:changed');
    return { oldAssignee, newAssignee };
  }

  setField(id, field, value, userName) {
    const t = this.find(id);
    if (!t) return;
    t[field] = value;
    this.pushActivity(t, userName, `changed ${field}`);
    App.EventBus.emit('tasks:changed');
  }

  toggleSubtask(taskId, idx) {
    const t = this.find(taskId);
    if (!t || !t.subtasks || !t.subtasks[idx]) return;
    t.subtasks[idx].d = !t.subtasks[idx].d;
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
    App.EventBus.emit('tasks:changed');
  }
};
