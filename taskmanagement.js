/* ================================================================
   DATA MODEL + STATE
   ================================================================ */
const PEOPLE = {
  abraham:  { id: 'abraham',  name: 'Abraham',  full: 'Abraham Maldonado',  email: 'abraham@quest.com',         color: '#E8A03A' },
  alkeith:  { id: 'alkeith',  name: 'Alkeith',  full: 'Alkeith Cabezzas',   email: 'alkeith@questroofing.com',  color: '#993C1D' },
  kristine: { id: 'kristine', name: 'Kristine', full: 'Kristine',           email: 'kristine@questroofing.com', color: '#185FA5' },
  jesus:    { id: 'jesus',    name: 'Jesus',    full: 'Jesus',              email: 'jesus@questroofing.com',    color: '#BA7517' },
  andres:   { id: 'andres',   name: 'Andres',   full: 'Andres',             email: 'andres@questdrafting.com',  color: '#3B6D11' },
  adrian:   { id: 'adrian',   name: 'Adrian',   full: 'Adrian Alegria',     email: 'adrian@lumen.com',          color: '#6E430A' },
};

const COMPANIES = {
  roofing:  { id: 'roofing',  label: 'Roofing',  pill: 'pill-roof'  },
  drafting: { id: 'drafting', label: 'Drafting', pill: 'pill-draft' },
  lumen:    { id: 'lumen',    label: 'Lumen',    pill: 'pill-lumen' },
};

const STATUSES = {
  todo:    { label: 'Active',  cls: 'status-doing' },
  pending: { label: 'Pending', cls: 'status-pending' },
  hold:    { label: 'On hold', cls: 'status-hold' },
  review:  { label: 'Review',  cls: 'status-review' },
  done:    { label: 'Done',    cls: 'status-done' },
};

const URGENCIES = {
  critical: { label: 'Critical', cls: 'urgency-critical', order: 0 },
  urgent:   { label: 'Urgent',   cls: 'urgency-urgent',   order: 1 },
  high:     { label: 'High',     cls: 'urgency-high',     order: 2 },
  medium:   { label: 'Medium',   cls: 'urgency-medium',   order: 3 },
  low:      { label: 'Low',      cls: 'urgency-low',      order: 4 },
  chill:    { label: 'Whenever', cls: 'urgency-chill',    order: 5 },
};

const initials = (name) => name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function defaultTasks() {
  return [
    { id:'t1', title:'Lien filing — CNL job', company:'roofing', creator:'abraham', assignee:'abraham', watchers:['kristine'], due:todayISO(-4), priority:'high', urgency:'urgent', status:'todo', description:'Mechanic\'s lien paperwork prepped. Need to file with Maricopa County recorder before end of week.', subtasks:[{t:'Pull deed info',d:true},{t:'Notarize',d:false}], activity:[{who:'Abraham',what:'created this task',when:'5d ago'}] },
    { id:'t2', title:'Update QR ROC complaint draft', company:'roofing', creator:'abraham', assignee:'kristine', watchers:[], due:todayISO(-2), priority:'medium', urgency:'high', status:'pending', description:'Add the contract excerpt and email chain as exhibits before sending.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Kristine',when:'3d ago'}] },
    { id:'t3', title:'CNL demand letter follow-up', company:'roofing', creator:'abraham', assignee:'abraham', watchers:['kristine'], due:todayISO(0), priority:'high', urgency:'critical', status:'todo', description:'Call CNL accounting by EOD. If no commitment, file mechanic\'s lien tomorrow + Justice Court small claims by Friday.', subtasks:[{t:'Send certified letter',d:true},{t:'Call accounting',d:false},{t:'Prep lien paperwork',d:false}], activity:[{who:'Kristine',what:'uploaded letter.pdf',when:'2h ago'},{who:'Abraham',what:'set due date today',when:'yesterday'}] },
    { id:'t4', title:'Paradise Valley demo punch list', company:'roofing', creator:'abraham', assignee:'alkeith', watchers:['abraham'], due:todayISO(0), priority:'high', urgency:'urgent', status:'todo', description:'Final walkthrough items. See photos in shared album.', subtasks:[{t:'Tear-off west slope',d:true},{t:'Replace decking 2 sheets',d:true},{t:'Drip edge install',d:false},{t:'Final cleanup + photos',d:false}], activity:[{who:'Abraham',what:'assigned this to Alkeith',when:'yesterday'}] },
    { id:'t5', title:'Jesus week-2 KPI review', company:'roofing', creator:'abraham', assignee:'abraham', watchers:['jesus'], due:todayISO(0), priority:'medium', urgency:'high', status:'review', description:'Review against 90-day vesting milestones. Doors knocked, appts set, contracts signed.', subtasks:[], activity:[] },
    { id:'t6', title:'Send Andres weekly QA brief', company:'drafting', creator:'abraham', assignee:'abraham', watchers:[], due:todayISO(0), priority:'low', urgency:'medium', status:'todo', description:'', subtasks:[], activity:[] },
    { id:'t7', title:'Adrian — confirm trial milestones', company:'lumen', creator:'abraham', assignee:'abraham', watchers:['adrian'], due:todayISO(0), priority:'medium', urgency:'high', status:'todo', description:'3-month trial KPIs need to be in writing before next sync.', subtasks:[], activity:[] },
    { id:'t8', title:'Lumen pitch deck v3 sign-off', company:'lumen', creator:'abraham', assignee:'adrian', watchers:['abraham'], due:todayISO(1), priority:'medium', urgency:'medium', status:'review', description:'Final review of HVAC pitch deck before client outreach.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Adrian',when:'2d ago'}] },
    { id:'t9', title:'DraftTrack markup tool QA', company:'drafting', creator:'abraham', assignee:'andres', watchers:[], due:todayISO(1), priority:'medium', urgency:'medium', status:'todo', description:'Test all markup tools on Safari + Chrome. Document any issues.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Andres',when:'2d ago'}] },
    { id:'t10', title:'Schedule monsoon ad shoot', company:'lumen', creator:'abraham', assignee:'adrian', watchers:[], due:todayISO(3), priority:'medium', urgency:'medium', status:'todo', description:'Friday morning, blue sky. Confirm location + crew.', subtasks:[], activity:[] },
    { id:'t11', title:'Supabase auth wiring', company:'drafting', creator:'abraham', assignee:'abraham', watchers:[], due:todayISO(4), priority:'high', urgency:'high', status:'hold', description:'DraftTrack client portal — add auth + persistent storage.', subtasks:[], activity:[] },
    { id:'t12', title:'GC outreach v2 script', company:'roofing', creator:'abraham', assignee:'jesus', watchers:['abraham'], due:todayISO(5), priority:'medium', urgency:'medium', status:'todo', description:'Hormozi-style warm follow-up. Lead with the ROC + insurance angle.', subtasks:[], activity:[{who:'Abraham',what:'assigned this to Jesus',when:'today'}] },
    { id:'t13', title:'Order shingles, Gilbert job', company:'roofing', creator:'abraham', assignee:'kristine', watchers:[], due:todayISO(-1), priority:'medium', urgency:'medium', status:'done', description:'', subtasks:[], activity:[] },
    { id:'t14', title:'Send Adrian operating agreement', company:'lumen', creator:'abraham', assignee:'abraham', watchers:['adrian'], due:todayISO(-2), priority:'high', urgency:'high', status:'done', description:'', subtasks:[], activity:[] },
    { id:'t15', title:'Material handoff — Mesa job', company:'roofing', creator:'alkeith', assignee:'kristine', watchers:['abraham'], due:todayISO(2), priority:'low', urgency:'chill', status:'todo', description:'Voice note from Alkeith: confirm metal flashing arrives at yard by Thursday.', subtasks:[], activity:[{who:'Alkeith',what:'created via voice note',when:'1h ago'}] },
  ];
}

// Seed a few historical time entries so analytics aren't empty on first load.
function defaultTimeEntries() {
  const now = Date.now();
  const H = 60 * 60 * 1000;
  return [
    { id:'e1', userId:'abraham',  taskId:'t3',  start: now - 26*H, end: now - 24.2*H, durationMs: 1.8*H, note:'CNL call prep' },
    { id:'e2', userId:'abraham',  taskId:'t1',  start: now - 50*H, end: now - 48.5*H, durationMs: 1.5*H, note:'Lien paperwork' },
    { id:'e3', userId:'kristine', taskId:'t2',  start: now - 28*H, end: now - 25*H,   durationMs: 3*H,   note:'ROC complaint draft' },
    { id:'e4', userId:'alkeith',  taskId:'t4',  start: now - 8*H,  end: now - 3.5*H,  durationMs: 4.5*H, note:'Paradise Valley demo' },
    { id:'e5', userId:'andres',   taskId:'t9',  start: now - 6*H,  end: now - 3*H,    durationMs: 3*H,   note:'Markup QA Safari' },
    { id:'e6', userId:'adrian',   taskId:'t8',  start: now - 30*H, end: now - 27.5*H, durationMs: 2.5*H, note:'Pitch deck review' },
    { id:'e7', userId:'jesus',    taskId:'t12', start: now - 4*H,  end: now - 2.2*H,  durationMs: 1.8*H, note:'GC outreach draft' },
  ];
}

let state = {
  tasks: [],
  notifications: [],
  timeEntries: [],
  activeTimers: {}, // keyed by userId: { taskId, startedAt }
  selectedTaskId: null,
  view: 'all',
  searchQuery: '',
  currentUser: 'abraham',
};

/* ================================================================
   PERSISTENCE
   ================================================================ */
const STORAGE_KEY = 'quest-hq-state-v2';
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tasks: state.tasks,
      notifications: state.notifications,
      timeEntries: state.timeEntries,
      activeTimers: state.activeTimers,
    }));
  } catch (e) { /* ignore */ }
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.tasks = parsed.tasks || defaultTasks();
      state.notifications = parsed.notifications || [];
      state.timeEntries = parsed.timeEntries || defaultTimeEntries();
      state.activeTimers = parsed.activeTimers || {};
      return;
    }
  } catch (e) { /* ignore */ }
  state.tasks = defaultTasks();
  state.notifications = [];
  state.timeEntries = defaultTimeEntries();
  state.activeTimers = {};
}

/* ================================================================
   FILTERING / GROUPING
   ================================================================ */
function getFilteredTasks() {
  let tasks = state.tasks;
  const v = state.view;

  if (v === 'mine') tasks = tasks.filter(t => t.assignee === state.currentUser);
  else if (v === 'hot') tasks = tasks.filter(t => (t.urgency === 'critical' || t.urgency === 'urgent') && t.status !== 'done');
  else if (v === 'today') tasks = tasks.filter(t => t.due === todayISO(0) && t.status !== 'done');
  else if (v === 'overdue') tasks = tasks.filter(t => t.due < todayISO(0) && t.status !== 'done');
  else if (v === 'watching') tasks = tasks.filter(t => (t.watchers || []).includes(state.currentUser));
  else if (v.startsWith('company:')) {
    const c = v.split(':')[1];
    tasks = tasks.filter(t => t.company === c);
  } else if (v.startsWith('person:')) {
    const p = v.split(':')[1];
    tasks = tasks.filter(t => t.assignee === p);
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    tasks = tasks.filter(t => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
  }

  return tasks;
}

function groupTasks(tasks) {
  const groups = { overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], done: [] };
  const t0 = todayISO(0), t1 = todayISO(1), t7 = todayISO(7);
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
      const aOrd = (URGENCIES[a.urgency] || URGENCIES.medium).order;
      const bOrd = (URGENCIES[b.urgency] || URGENCIES.medium).order;
      return aOrd - bOrd || a.due.localeCompare(b.due);
    });
  });
  return groups;
}

/* ================================================================
   TIME UTILITIES
   ================================================================ */
function formatDuration(ms) {
  if (!ms || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function formatHours(ms) {
  const hours = (ms || 0) / (60 * 60 * 1000);
  if (hours < 0.1) return '0h';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}
function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function totalTimeForTask(taskId) {
  let total = state.timeEntries
    .filter(e => e.taskId === taskId)
    .reduce((sum, e) => sum + (e.durationMs || 0), 0);
  Object.entries(state.activeTimers).forEach(([, timer]) => {
    if (timer.taskId === taskId) total += Date.now() - timer.startedAt;
  });
  return total;
}
function totalTimeForUser(userId, sinceMs = null) {
  let total = state.timeEntries
    .filter(e => e.userId === userId && (!sinceMs || e.start >= sinceMs))
    .reduce((sum, e) => sum + (e.durationMs || 0), 0);
  const active = state.activeTimers[userId];
  if (active) total += Date.now() - active.startedAt;
  return total;
}
function totalTimeForCompany(companyId) {
  const taskIds = new Set(state.tasks.filter(t => t.company === companyId).map(t => t.id));
  let total = state.timeEntries
    .filter(e => taskIds.has(e.taskId))
    .reduce((sum, e) => sum + (e.durationMs || 0), 0);
  Object.entries(state.activeTimers).forEach(([, timer]) => {
    if (taskIds.has(timer.taskId)) total += Date.now() - timer.startedAt;
  });
  return total;
}

/* ================================================================
   TIMER ACTIONS (Clock-in / Clock-out)
   ================================================================ */
function startTimer(userId, taskId) {
  // Stop any existing timer for this user first.
  if (state.activeTimers[userId]) stopTimer(userId, { silent: true });
  state.activeTimers[userId] = { taskId, startedAt: Date.now() };
  const t = state.tasks.find(x => x.id === taskId);
  if (t) {
    t.activity = t.activity || [];
    t.activity.unshift({ who: PEOPLE[userId].name, what: 'clocked in on this task', when: 'just now' });
  }
  showToast({ title: 'Clocked in', sub: t ? `Tracking time on "${t.title}"` : 'Timer started' });
  renderAll();
}

function stopTimer(userId, opts = {}) {
  const active = state.activeTimers[userId];
  if (!active) return;
  const durationMs = Date.now() - active.startedAt;
  state.timeEntries.unshift({
    id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6),
    userId,
    taskId: active.taskId,
    start: active.startedAt,
    end: Date.now(),
    durationMs,
    note: '',
  });
  const t = state.tasks.find(x => x.id === active.taskId);
  if (t) {
    t.activity = t.activity || [];
    t.activity.unshift({ who: PEOPLE[userId].name, what: `clocked ${formatHours(durationMs)} on this task`, when: 'just now' });
  }
  delete state.activeTimers[userId];
  if (!opts.silent) {
    showToast({ title: 'Clocked out', sub: `${formatHours(durationMs)} logged` });
  }
  renderAll();
}

function toggleTimerForTask(taskId) {
  const active = state.activeTimers[state.currentUser];
  if (active && active.taskId === taskId) {
    stopTimer(state.currentUser);
  } else {
    startTimer(state.currentUser, taskId);
  }
}

function toggleGlobalClock() {
  const active = state.activeTimers[state.currentUser];
  if (active) {
    stopTimer(state.currentUser);
    return;
  }
  // No active task — clock in on the selected task, or the first open task assigned to me.
  let target = state.selectedTaskId
    ? state.tasks.find(t => t.id === state.selectedTaskId)
    : state.tasks.find(t => t.assignee === state.currentUser && t.status !== 'done');
  if (!target) {
    showToast({ title: 'No task selected', sub: 'Open a task or assign yourself one to clock in.' });
    return;
  }
  startTimer(state.currentUser, target.id);
}

/* ================================================================
   RENDERING — TASK LIST + DETAIL
   ================================================================ */
function renderSidebarCounts() {
  const all = state.tasks.filter(t => t.status !== 'done');
  document.getElementById('cnt-all').textContent = all.length;
  document.getElementById('cnt-mine').textContent = all.filter(t => t.assignee === state.currentUser).length;
  document.getElementById('cnt-hot').textContent = all.filter(t => t.urgency === 'critical' || t.urgency === 'urgent').length;
  document.getElementById('cnt-today').textContent = all.filter(t => t.due === todayISO(0)).length;
  document.getElementById('cnt-overdue').textContent = all.filter(t => t.due < todayISO(0)).length;
  document.getElementById('cnt-watching').textContent = all.filter(t => (t.watchers || []).includes(state.currentUser)).length;
  ['roofing', 'drafting', 'lumen'].forEach(c => {
    document.getElementById('cnt-' + c).textContent = all.filter(t => t.company === c).length;
  });
  // Time-section sidebar counts
  document.getElementById('cnt-time-mine').textContent = formatHours(totalTimeForUser(state.currentUser));
  document.getElementById('cnt-time-active').textContent = Object.keys(state.activeTimers).length;
}

function renderPeopleList() {
  const ul = document.getElementById('peopleList');
  ul.innerHTML = '';
  Object.values(PEOPLE).forEach(p => {
    const item = document.createElement('div');
    item.className = 'side-item';
    item.dataset.view = 'person:' + p.id;
    item.innerHTML = `<span class="avatar-xs" style="background:${p.color};">${initials(p.full)}</span>${p.name}`;
    item.addEventListener('click', () => setView('person:' + p.id));
    ul.appendChild(item);
  });
}

function renderStats() {
  const tasks = state.tasks;
  document.getElementById('stat-open').textContent = tasks.filter(t => t.status !== 'done').length;
  document.getElementById('stat-today').textContent = tasks.filter(t => t.due === todayISO(0) && t.status !== 'done').length;
  document.getElementById('stat-review').textContent = tasks.filter(t => t.status === 'review').length;
  document.getElementById('stat-done').textContent = tasks.filter(t => t.status === 'done').length;
}

function formatDue(iso) {
  const t0 = todayISO(0), t1 = todayISO(1);
  if (iso === t0) return { text: 'Today', cls: 'due-today' };
  if (iso === t1) return { text: 'Tomorrow', cls: '' };
  const d = new Date(iso);
  if (iso < t0) {
    return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: 'due-overdue' };
  }
  return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: '' };
}

function renderTaskRow(t) {
  const person = PEOPLE[t.assignee];
  const company = COMPANIES[t.company];
  const status = STATUSES[t.status] || STATUSES.todo;
  const urgency = URGENCIES[t.urgency] || URGENCIES.medium;
  const due = formatDue(t.due);
  const selected = state.selectedTaskId === t.id;
  const isDone = t.status === 'done';
  const myTimerOnThis = state.activeTimers[state.currentUser]?.taskId === t.id;

  const row = document.createElement('div');
  row.className = 'list-row' + (selected ? ' selected' : '');
  row.dataset.id = t.id;
  row.innerHTML = `
    <input type="checkbox" ${isDone ? 'checked' : ''} onclick="event.stopPropagation(); toggleDone('${t.id}')" />
    <div class="task-title-cell ${isDone ? 'done' : ''}">${escapeHtml(t.title)}</div>
    <div><span class="pill ${company.pill}">${company.label}</span></div>
    <div class="meta-cell" style="display:flex; align-items:center; gap:6px;">
      <span class="avatar-xs" style="background:${person.color};">${initials(person.full)}</span>${person.name}
    </div>
    <div><span class="urgency-block ${urgency.cls}" onclick="event.stopPropagation(); cycleUrgency('${t.id}')" title="Click to change urgency">${urgency.label}</span></div>
    <div class="due-cell ${due.cls}">${due.text}</div>
    <div><span class="pill-status ${status.cls}">${status.label}</span></div>
    <button class="timer-btn ${myTimerOnThis ? 'active' : ''}" onclick="event.stopPropagation(); toggleTimerForTask('${t.id}')" title="${myTimerOnThis ? 'Stop timer' : 'Start timer'}">
      <i class="ti ${myTimerOnThis ? 'ti-player-stop-filled' : 'ti-player-play'}"></i>
    </button>
    <button class="more-btn" onclick="event.stopPropagation()" aria-label="More"><i class="ti ti-dots"></i></button>
  `;
  row.addEventListener('click', () => selectTask(t.id));
  return row;
}

function renderList() {
  const body = document.getElementById('listBody');
  body.innerHTML = '';

  const tasks = getFilteredTasks();
  if (tasks.length === 0) {
    body.innerHTML = `<div class="empty"><i class="ti ti-checks"></i><div class="empty-title">Nothing here</div><div class="empty-sub">No tasks match this view.</div></div>`;
    return;
  }

  const groups = groupTasks(tasks);
  const sections = [
    { key: 'overdue',  label: 'Overdue',  icon: 'ti-alert-triangle', danger: true  },
    { key: 'today',    label: 'Due today', icon: 'ti-flame',         danger: false },
    { key: 'tomorrow', label: 'Tomorrow',  icon: 'ti-arrow-narrow-right' },
    { key: 'thisWeek', label: 'This week', icon: 'ti-calendar' },
    { key: 'later',    label: 'Later',     icon: 'ti-clock' },
    { key: 'done',     label: 'Done',      icon: 'ti-circle-check' },
  ];

  sections.forEach(s => {
    if (groups[s.key].length === 0) return;
    const head = document.createElement('div');
    head.className = 'group-head' + (s.danger ? ' danger' : '');
    head.innerHTML = `<i class="ti ${s.icon}"></i>${s.label} <span class="group-count">· ${groups[s.key].length}</span>`;
    body.appendChild(head);
    groups[s.key].forEach(t => body.appendChild(renderTaskRow(t)));
  });
}

function renderDetail() {
  const pane = document.getElementById('detailPane');
  const mainEl = document.getElementById('mainPane');
  if (!state.selectedTaskId) {
    pane.classList.add('hidden');
    mainEl.classList.remove('with-detail');
    return;
  }
  const t = state.tasks.find(x => x.id === state.selectedTaskId);
  if (!t) {
    pane.classList.add('hidden');
    mainEl.classList.remove('with-detail');
    return;
  }

  pane.classList.remove('hidden');
  mainEl.classList.add('with-detail');

  const creator = PEOPLE[t.creator];
  const assignee = PEOPLE[t.assignee];
  const company = COMPANIES[t.company];
  const delegated = t.creator !== t.assignee;
  const myTimerOnThis = state.activeTimers[state.currentUser]?.taskId === t.id;
  const totalMs = totalTimeForTask(t.id);

  const watchersHtml = (t.watchers || []).map(w => {
    const p = PEOPLE[w];
    return `<span style="display:inline-flex; align-items:center; gap:4px; background:var(--bg-2); padding:2px 7px; border-radius:10px; font-size:11px; margin-right:4px;"><span class="avatar-xs" style="background:${p.color};">${initials(p.full)}</span>${p.name}</span>`;
  }).join('') || `<span style="color:var(--ink-3); font-size:11px;">No watchers</span>`;

  const subtasksHtml = (t.subtasks || []).map((s, i) =>
    `<div class="subtask ${s.d ? 'done' : ''}" onclick="toggleSubtask('${t.id}', ${i})">
       <i class="ti ${s.d ? 'ti-circle-check-filled' : 'ti-circle'}"></i>${escapeHtml(s.t)}
     </div>`
  ).join('') || `<div style="font-size:11.5px; color:var(--ink-3);">No subtasks yet</div>`;

  const activityHtml = (t.activity || []).map(a =>
    `<div class="activity-item"><span class="who">${escapeHtml(a.who)}</span> ${escapeHtml(a.what)} · ${escapeHtml(a.when)}</div>`
  ).join('') || `<div style="font-size:11.5px; color:var(--ink-3);">No activity yet</div>`;

  // List recent entries for this task
  const recentEntries = state.timeEntries.filter(e => e.taskId === t.id).slice(0, 5);
  const entriesHtml = recentEntries.length
    ? recentEntries.map(e =>
        `<div class="activity-item">
           <span class="who">${PEOPLE[e.userId]?.name || e.userId}</span> logged
           <strong style="color:var(--ink-2);">${formatHours(e.durationMs)}</strong>
           · ${timeAgo(e.end)}
         </div>`
      ).join('')
    : `<div style="font-size:11.5px; color:var(--ink-3);">No time logged yet</div>`;

  pane.innerHTML = `
    <div class="detail-head">
      <div class="detail-head-top">
        <span class="pill ${company.pill}">${company.label}</span>
        <button class="icon-btn" onclick="closeDetail()" aria-label="Close"><i class="ti ti-x"></i></button>
      </div>
      <div class="detail-title">${escapeHtml(t.title)}</div>
    </div>
    <div class="detail-body">
      ${delegated ? `
        <div class="delegation-banner">
          <i class="ti ti-send"></i>
          <span><strong>${assignee.name}</strong> assigned by <strong>${creator.name}</strong></span>
        </div>
      ` : ''}

      ${myTimerOnThis ? `
        <div class="timer-banner">
          <i class="ti ti-player-record-filled"></i>
          <span>Tracking time on this task</span>
          <span class="live-time" id="detail-live-timer">${formatDuration(Date.now() - state.activeTimers[state.currentUser].startedAt)}</span>
        </div>
      ` : ''}

      <div style="display:flex; gap:6px; margin-bottom:14px;">
        <button class="btn ${myTimerOnThis ? 'btn-danger' : 'btn-primary'}" style="flex:1;" onclick="toggleTimerForTask('${t.id}')">
          <i class="ti ${myTimerOnThis ? 'ti-player-stop-filled' : 'ti-player-play-filled'}"></i>
          ${myTimerOnThis ? 'Clock out' : 'Clock in on this task'}
        </button>
      </div>

      <div class="detail-row">
        <span class="label">Status</span>
        <select onchange="updateField('${t.id}', 'status', this.value)" style="font-size:12px; padding:4px 8px;">
          ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="detail-row">
        <span class="label">Owner</span>
        <select onchange="reassign('${t.id}', this.value)" style="font-size:12px; padding:4px 8px;">
          ${Object.values(PEOPLE).map(p => `<option value="${p.id}" ${t.assignee === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="detail-row">
        <span class="label">Created by</span>
        <span style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-2);">
          <span class="avatar-xs" style="background:${creator.color};">${initials(creator.full)}</span>${creator.name}
        </span>
      </div>
      <div class="detail-row">
        <span class="label">Due</span>
        <input type="date" value="${t.due}" onchange="updateField('${t.id}', 'due', this.value)" style="font-size:12px; padding:4px 8px;" />
      </div>
      <div class="detail-row">
        <span class="label">Priority</span>
        <select onchange="updateField('${t.id}', 'priority', this.value)" style="font-size:12px; padding:4px 8px;">
          <option value="low"    ${t.priority === 'low'    ? 'selected' : ''}>Low</option>
          <option value="medium" ${(t.priority || 'medium') === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high"   ${t.priority === 'high'   ? 'selected' : ''}>High</option>
          <option value="urgent" ${t.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
        </select>
      </div>
      <div class="detail-row">
        <span class="label">Urgency</span>
        <select onchange="updateField('${t.id}', 'urgency', this.value)" style="font-size:12px; padding:4px 8px;">
          ${Object.entries(URGENCIES).map(([k, v]) => `<option value="${k}" ${(t.urgency || 'medium') === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="detail-row">
        <span class="label">Time spent</span>
        <span style="font-family:'SFMono-Regular',monospace; font-size:12px; color:var(--ink-2);">${formatHours(totalMs)} total</span>
      </div>
      <div class="detail-row">
        <span class="label">Watchers</span>
        <div>${watchersHtml}</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Description</div>
        <div class="detail-desc">${escapeHtml(t.description || '—')}</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Subtasks</div>
        ${subtasksHtml}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Time entries</div>
        ${entriesHtml}
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Activity</div>
        ${activityHtml}
      </div>
    </div>
  `;
}

/* ================================================================
   RENDERING — TIME TRACKING VIEWS
   ================================================================ */
function renderTimeView() {
  const wrap = document.getElementById('timeViewWrap');
  const view = state.view;

  if (view === 'time:mine') {
    wrap.innerHTML = renderMyTimeView();
  } else if (view === 'time:resource') {
    wrap.innerHTML = renderResourceView();
  } else if (view === 'time:analytics') {
    wrap.innerHTML = renderAnalyticsView();
  }
}

function renderMyTimeView() {
  const me = state.currentUser;
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const week0 = new Date(); week0.setDate(week0.getDate() - 7); week0.setHours(0, 0, 0, 0);

  const todayMs = totalTimeForUser(me, today0.getTime());
  const weekMs = totalTimeForUser(me, week0.getTime());
  const allMs = totalTimeForUser(me);
  const active = state.activeTimers[me];

  const myEntries = state.timeEntries
    .filter(e => e.userId === me)
    .slice(0, 20);

  const rows = myEntries.map(e => {
    const t = state.tasks.find(x => x.id === e.taskId);
    const company = t ? COMPANIES[t.company] : null;
    return `
      <tr>
        <td>${t ? escapeHtml(t.title) : '<em>unknown task</em>'}</td>
        <td>${company ? `<span class="pill ${company.pill}">${company.label}</span>` : '—'}</td>
        <td class="mono">${new Date(e.start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
        <td class="mono">${formatHours(e.durationMs)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="time-page">
      ${active ? `
        <div class="timer-banner" style="margin: 16px 0 0;">
          <i class="ti ti-player-record-filled"></i>
          <span>Currently tracking: <strong>${escapeHtml(state.tasks.find(t => t.id === active.taskId)?.title || 'task')}</strong></span>
          <span class="live-time" data-live-timer="${me}">${formatDuration(Date.now() - active.startedAt)}</span>
          <button class="btn btn-danger btn-sm" onclick="stopTimer('${me}')"><i class="ti ti-player-stop-filled"></i>Clock out</button>
        </div>
      ` : ''}

      <div class="time-section">
        <div class="time-card-grid">
          <div class="time-card">
            <div class="time-card-label">Today</div>
            <div class="time-card-value">${formatHours(todayMs)}</div>
            <div class="time-card-sub">${active ? 'Clock running' : 'Clocked out'}</div>
          </div>
          <div class="time-card">
            <div class="time-card-label">Last 7 days</div>
            <div class="time-card-value">${formatHours(weekMs)}</div>
          </div>
          <div class="time-card">
            <div class="time-card-label">All time</div>
            <div class="time-card-value">${formatHours(allMs)}</div>
          </div>
          <div class="time-card">
            <div class="time-card-label">Entries</div>
            <div class="time-card-value">${state.timeEntries.filter(e => e.userId === me).length}</div>
          </div>
        </div>
      </div>

      <div class="time-section">
        <div class="time-section-title">Recent entries</div>
        ${myEntries.length ? `
          <table class="time-table">
            <thead><tr><th>Task</th><th>Project</th><th>Started</th><th>Hours</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        ` : `<div class="empty"><i class="ti ti-clock"></i><div class="empty-title">No entries yet</div><div class="empty-sub">Hit play on a task or press <kbd>T</kbd> to clock in.</div></div>`}
      </div>
    </div>
  `;
}

function renderResourceView() {
  // Resource allocation — who is working on what right now,
  // plus each person's hours today / last 7 days.
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const week0 = new Date(); week0.setDate(week0.getDate() - 7); week0.setHours(0, 0, 0, 0);

  const liveRows = Object.entries(state.activeTimers).map(([userId, timer]) => {
    const p = PEOPLE[userId];
    const t = state.tasks.find(x => x.id === timer.taskId);
    const company = t ? COMPANIES[t.company] : null;
    return `
      <tr class="live">
        <td>
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span class="avatar-xs" style="background:${p.color};">${initials(p.full)}</span>${p.name}
          </span>
        </td>
        <td>${t ? escapeHtml(t.title) : '—'}</td>
        <td>${company ? `<span class="pill ${company.pill}">${company.label}</span>` : '—'}</td>
        <td class="mono" data-live-timer="${userId}">${formatDuration(Date.now() - timer.startedAt)}</td>
        <td><span style="display:inline-flex; align-items:center; gap:4px; color:var(--green-ink); font-size:11px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--green);"></span>Live</span></td>
      </tr>
    `;
  }).join('');

  const peopleRows = Object.values(PEOPLE).map(p => {
    const todayMs = totalTimeForUser(p.id, today0.getTime());
    const weekMs = totalTimeForUser(p.id, week0.getTime());
    const isActive = !!state.activeTimers[p.id];
    return `
      <tr>
        <td>
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span class="avatar-xs" style="background:${p.color};">${initials(p.full)}</span>${p.name}
          </span>
        </td>
        <td class="mono">${formatHours(todayMs)}</td>
        <td class="mono">${formatHours(weekMs)}</td>
        <td>${isActive
            ? '<span style="color:var(--green-ink); font-size:11px;">● Clocked in</span>'
            : '<span style="color:var(--ink-3); font-size:11px;">Off the clock</span>'}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="time-page">
      <div class="time-section">
        <div class="time-section-title">Active right now</div>
        ${Object.keys(state.activeTimers).length ? `
          <table class="time-table">
            <thead><tr><th>Person</th><th>Task</th><th>Project</th><th>Elapsed</th><th></th></tr></thead>
            <tbody>${liveRows}</tbody>
          </table>
        ` : `<div class="empty"><i class="ti ti-zzz"></i><div class="empty-title">Nobody is clocked in</div><div class="empty-sub">When someone starts a timer it'll show up here.</div></div>`}
      </div>

      <div class="time-section">
        <div class="time-section-title">This team</div>
        <table class="time-table">
          <thead><tr><th>Person</th><th>Today</th><th>Last 7 days</th><th>Status</th></tr></thead>
          <tbody>${peopleRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAnalyticsView() {
  const companyTotals = Object.keys(COMPANIES).map(c => ({
    id: c,
    label: COMPANIES[c].label,
    ms: totalTimeForCompany(c),
  }));
  const grand = companyTotals.reduce((s, c) => s + c.ms, 0);

  const companyBars = companyTotals.map(c => {
    const pct = grand > 0 ? Math.max(2, Math.round((c.ms / grand) * 100)) : 0;
    return `
      <div class="bar-row">
        <div>${c.label}</div>
        <div class="bar-track"><div class="bar-fill ${c.id}" style="width:${pct}%;"></div></div>
        <div class="bar-value">${formatHours(c.ms)}</div>
      </div>
    `;
  }).join('');

  // Top tasks by hours logged
  const taskTotals = state.tasks.map(t => ({ t, ms: totalTimeForTask(t.id) }))
    .filter(x => x.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10);

  const topTaskRows = taskTotals.map(x => {
    const company = COMPANIES[x.t.company];
    const person = PEOPLE[x.t.assignee];
    return `
      <tr>
        <td>${escapeHtml(x.t.title)}</td>
        <td><span class="pill ${company.pill}">${company.label}</span></td>
        <td>
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span class="avatar-xs" style="background:${person.color};">${initials(person.full)}</span>${person.name}
          </span>
        </td>
        <td class="mono">${formatHours(x.ms)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="time-page">
      <div class="time-section">
        <div class="time-card-grid">
          ${companyTotals.map(c => `
            <div class="time-card">
              <div class="time-card-label">${c.label}</div>
              <div class="time-card-value">${formatHours(c.ms)}</div>
              <div class="time-card-sub">${grand > 0 ? Math.round(c.ms / grand * 100) : 0}% of total</div>
            </div>
          `).join('')}
          <div class="time-card">
            <div class="time-card-label">Total tracked</div>
            <div class="time-card-value">${formatHours(grand)}</div>
            <div class="time-card-sub">All projects, all time</div>
          </div>
        </div>
      </div>

      <div class="time-section">
        <div class="time-section-title">Hours by project</div>
        <div class="time-card" style="padding:18px;">
          ${companyBars}
        </div>
      </div>

      <div class="time-section">
        <div class="time-section-title">Top tasks by time spent</div>
        ${taskTotals.length ? `
          <table class="time-table">
            <thead><tr><th>Task</th><th>Project</th><th>Owner</th><th>Hours</th></tr></thead>
            <tbody>${topTaskRows}</tbody>
          </table>
        ` : `<div class="empty"><i class="ti ti-chart-bar"></i><div class="empty-title">No data yet</div><div class="empty-sub">Track time on a few tasks to see the breakdown.</div></div>`}
      </div>
    </div>
  `;
}

/* ================================================================
   RENDERING — NOTIFICATIONS + CLOCK WIDGET
   ================================================================ */
function renderNotifs() {
  const list = document.getElementById('notifList');
  const dot = document.getElementById('notifDot');
  const unread = state.notifications.filter(n => !n.read).length;

  if (unread === 0) dot.classList.add('hidden');
  else dot.classList.remove('hidden');

  if (state.notifications.length === 0) {
    list.innerHTML = `<div class="notif-empty">You're all caught up.</div>`;
    return;
  }

  list.innerHTML = state.notifications.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="openNotif('${n.id}', '${n.taskId}')">
      <div class="notif-meta">${escapeHtml(n.meta)}</div>
      <div class="notif-text">${n.html}</div>
    </div>
  `).join('');
}

function renderClockWidget() {
  const widget = document.getElementById('clockWidget');
  const label = document.getElementById('clockLabel');
  const timer = document.getElementById('clockTimer');
  const active = state.activeTimers[state.currentUser];
  const icon = widget.querySelector('i');

  if (active) {
    widget.classList.add('running');
    const t = state.tasks.find(x => x.id === active.taskId);
    label.textContent = t ? t.title.slice(0, 18) + (t.title.length > 18 ? '…' : '') : 'Tracking';
    timer.classList.remove('hidden');
    timer.textContent = formatDuration(Date.now() - active.startedAt);
    icon.className = 'ti ti-player-stop-filled';
  } else {
    widget.classList.remove('running');
    label.textContent = 'Clock in';
    timer.classList.add('hidden');
    icon.className = 'ti ti-player-play-filled';
  }
}

/* ================================================================
   MASTER RENDER
   ================================================================ */
function renderAll() {
  renderSidebarCounts();
  renderClockWidget();
  renderNotifs();

  const isTimeView = state.view.startsWith('time:');
  const taskWrap = document.getElementById('taskViewWrap');
  const timeWrap = document.getElementById('timeViewWrap');

  if (isTimeView) {
    taskWrap.classList.add('hidden');
    timeWrap.classList.remove('hidden');
    renderTimeView();
    // Time views don't use the detail pane
    document.getElementById('detailPane').classList.add('hidden');
    document.getElementById('mainPane').classList.remove('with-detail');
  } else {
    taskWrap.classList.remove('hidden');
    timeWrap.classList.add('hidden');
    renderStats();
    renderList();
    renderDetail();
  }

  save();
}

/* ================================================================
   ACTIONS
   ================================================================ */
function setView(view) {
  state.view = view;
  state.selectedTaskId = null;
  document.querySelectorAll('.side-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  const titles = {
    'all':            { eyebrow: 'This week',          title: 'All tasks' },
    'mine':           { eyebrow: 'Assigned to you',    title: 'My tasks' },
    'hot':            { eyebrow: 'Critical + Urgent',  title: 'Hot list' },
    'today':          { eyebrow: 'Today',              title: 'Due today' },
    'overdue':        { eyebrow: 'Past due',           title: 'Overdue' },
    'watching':       { eyebrow: 'Tasks you\'re watching', title: 'Watching' },
    'time:mine':      { eyebrow: 'Time tracking',      title: 'My time' },
    'time:resource':  { eyebrow: 'Time tracking',      title: 'Resource allocation' },
    'time:analytics': { eyebrow: 'Time tracking',      title: 'Project analytics' },
  };
  let t = titles[view];
  if (!t && view.startsWith('company:')) {
    const c = COMPANIES[view.split(':')[1]];
    t = { eyebrow: 'Company', title: c.label };
  }
  if (!t && view.startsWith('person:')) {
    const p = PEOPLE[view.split(':')[1]];
    t = { eyebrow: 'Assigned to', title: p.name };
  }
  if (t) {
    document.getElementById('pageEyebrow').textContent = t.eyebrow;
    document.getElementById('pageTitle').textContent = t.title;
  }
  renderAll();
}

function selectTask(id) {
  state.selectedTaskId = (state.selectedTaskId === id) ? null : id;
  renderAll();
}

function closeDetail() {
  state.selectedTaskId = null;
  renderAll();
}

function toggleDone(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = t.status === 'done' ? 'todo' : 'done';
  t.activity = t.activity || [];
  t.activity.unshift({
    who: PEOPLE[state.currentUser].name,
    what: t.status === 'done' ? 'marked this complete' : 'reopened this task',
    when: 'just now',
  });
  renderAll();
}

function toggleSubtask(taskId, idx) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t || !t.subtasks) return;
  t.subtasks[idx].d = !t.subtasks[idx].d;
  renderAll();
}

function updateField(id, field, value) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t[field] = value;
  t.activity = t.activity || [];
  t.activity.unshift({ who: PEOPLE[state.currentUser].name, what: `changed ${field}`, when: 'just now' });
  renderAll();
}

function cycleUrgency(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const keys = Object.keys(URGENCIES);
  const currentIdx = keys.indexOf(t.urgency || 'medium');
  const nextIdx = (currentIdx + 1) % keys.length;
  t.urgency = keys[nextIdx];
  t.activity = t.activity || [];
  t.activity.unshift({ who: PEOPLE[state.currentUser].name, what: `set urgency to ${URGENCIES[t.urgency].label}`, when: 'just now' });
  renderAll();
}

function reassign(id, newAssignee) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const oldA = t.assignee;
  if (oldA === newAssignee) return;
  t.assignee = newAssignee;
  t.activity = t.activity || [];
  t.activity.unshift({
    who: PEOPLE[state.currentUser].name,
    what: `reassigned this from ${PEOPLE[oldA].name} to ${PEOPLE[newAssignee].name}`,
    when: 'just now',
  });

  if (newAssignee !== state.currentUser) {
    addNotification({
      taskId: t.id,
      meta: 'Reassigned · just now',
      html: `<strong>${PEOPLE[state.currentUser].name}</strong> reassigned <em>${escapeHtml(t.title)}</em> to <strong>${PEOPLE[newAssignee].name}</strong>`,
    });
    showToast({
      title: `Reassigned to ${PEOPLE[newAssignee].name}`,
      sub: `Email sent to ${PEOPLE[newAssignee].email}`,
    });
  }
  renderAll();
}

function addNotification(n) {
  state.notifications.unshift({
    id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6),
    read: false,
    ...n,
  });
  state.notifications = state.notifications.slice(0, 50);
}

function showToast({ title, sub }) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <i class="ti ti-mail icon-main"></i>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${sub ? `<div class="toast-sub">${escapeHtml(sub)}</div>` : ''}
    </div>
    <i class="ti ti-x toast-close"></i>
  `;
  document.getElementById('toastContainer').appendChild(el);
  el.querySelector('.toast-close').addEventListener('click', () => el.remove());
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s, transform 0.3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

function openNotif(notifId, taskId) {
  const n = state.notifications.find(x => x.id === notifId);
  if (n) n.read = true;
  if (taskId && taskId !== 'undefined') {
    state.selectedTaskId = taskId;
    // If we're in a time view, jump back to All tasks so detail can render
    if (state.view.startsWith('time:')) setView('all');
  }
  document.getElementById('notifPanel').classList.add('hidden');
  renderAll();
}

/* ================================================================
   NEW TASK MODAL
   ================================================================ */
function openNewTaskModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'newTaskModal';
  modal.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-head">
        <div class="modal-title">New task</div>
        <button class="icon-btn" onclick="closeNewTaskModal()" aria-label="Close"><i class="ti ti-x"></i></button>
      </div>
      <div class="modal-body">
        <div class="field field-title">
          <input type="text" id="nt-title" placeholder="What needs to happen?" autofocus />
        </div>

        <div class="field">
          <textarea id="nt-desc" placeholder="Add details, links, context..." rows="3" style="resize: vertical;"></textarea>
        </div>

        <div class="field-row" style="margin-bottom: 14px;">
          <div>
            <div class="field-label">Created by <i class="ti ti-lock"></i></div>
            <div class="locked-field">
              <span class="avatar-xs" style="background:${PEOPLE.abraham.color};">AM</span>You (Abraham)
            </div>
          </div>
          <div>
            <div class="field-label">Assigned to</div>
            <select id="nt-assignee" class="assigned-field" style="width:100%; padding: 6px 10px; font-size: 12px;">
              ${Object.values(PEOPLE).map(p => `<option value="${p.id}" ${p.id === state.currentUser ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
          </div>
        </div>

        <div id="nt-delegation-banner" class="hidden" style="padding: 8px 12px; background: var(--blue-bg); border-left: 2px solid var(--blue); border-radius: 4px; font-size: 11.5px; color: var(--blue-ink); margin-bottom: 14px; display: flex; align-items: center; gap: 8px;">
          <i class="ti ti-send" style="font-size: 14px;"></i>
          <span id="nt-delegation-text"></span>
        </div>

        <div class="field">
          <div class="field-label">Also notify (watchers)</div>
          <div class="watcher-picker">
            <div class="watcher-tags" id="nt-watchers"></div>
            <div class="watcher-dropdown hidden" id="nt-watcher-dropdown"></div>
          </div>
        </div>

        <div class="field-row-3">
          <div>
            <div class="field-label">Company</div>
            <select id="nt-company" style="width:100%; padding: 6px 10px; font-size: 12px;">
              <option value="roofing">Roofing</option>
              <option value="drafting">Drafting</option>
              <option value="lumen">Lumen</option>
            </select>
          </div>
          <div>
            <div class="field-label">Due</div>
            <input type="date" id="nt-due" value="${todayISO(1)}" style="width:100%; padding: 6px 10px; font-size: 12px;" />
          </div>
          <div>
            <div class="field-label">Urgency</div>
            <select id="nt-urgency" style="width:100%; padding: 6px 10px; font-size: 12px;">
              ${Object.entries(URGENCIES).map(([k, v]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="field-row" style="margin-top:14px;">
          <div>
            <div class="field-label">Priority</div>
            <select id="nt-priority" style="width:100%; padding: 6px 10px; font-size: 12px;">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <div class="field-label">Initial status</div>
            <select id="nt-status" style="width:100%; padding: 6px 10px; font-size: 12px;">
              <option value="todo" selected>Active</option>
              <option value="pending">Pending</option>
              <option value="hold">On hold</option>
            </select>
          </div>
        </div>

        <div class="notify-box" style="margin-top: 14px;">
          <div class="notify-title"><i class="ti ti-bell"></i>Notify on create</div>
          <label class="notify-option">
            <input type="checkbox" id="nt-notify-email" checked />
            <i class="ti ti-mail"></i>
            <span id="nt-notify-email-label">Email assignee</span>
            <span class="email-hint" id="nt-notify-email-addr"></span>
          </label>
          <label class="notify-option">
            <input type="checkbox" id="nt-notify-inapp" checked />
            <i class="ti ti-app-window"></i>
            <span>In-app notification</span>
          </label>
          <label class="notify-option">
            <input type="checkbox" id="nt-notify-watchers" checked />
            <i class="ti ti-users"></i>
            <span>Also email watchers</span>
          </label>
          <label class="notify-option">
            <input type="checkbox" id="nt-notify-whatsapp" />
            <i class="ti ti-brand-whatsapp"></i>
            <span>WhatsApp ping (urgent only)</span>
          </label>
        </div>
      </div>
      <div class="modal-foot">
        <span style="font-size:10.5px; color: var(--ink-3);">Press <kbd>Ctrl ↵</kbd> to create</span>
        <div style="display:flex; gap:6px;">
          <button class="btn" onclick="closeNewTaskModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitNewTask()">Create &amp; notify</button>
        </div>
      </div>
    </div>
  `;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeNewTaskModal(); });
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('nt-title').focus(), 50);

  // Watcher picker state
  const ntWatchers = new Set();
  const watchersEl = document.getElementById('nt-watchers');
  const dropdown = document.getElementById('nt-watcher-dropdown');

  function renderWatcherChips() {
    watchersEl.innerHTML = '';
    ntWatchers.forEach(id => {
      const p = PEOPLE[id];
      const chip = document.createElement('span');
      chip.className = 'watcher-tag';
      chip.innerHTML = `<span class="avatar-xs" style="background:${p.color};">${initials(p.full)}</span>${p.name} <i class="ti ti-x remove"></i>`;
      chip.querySelector('.remove').addEventListener('click', (e) => {
        e.stopPropagation();
        ntWatchers.delete(id);
        renderWatcherChips();
      });
      watchersEl.appendChild(chip);
    });
    const addBtn = document.createElement('span');
    addBtn.className = 'watcher-add';
    addBtn.textContent = ntWatchers.size ? '+ add' : '+ Add watcher';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const assigneeId = document.getElementById('nt-assignee').value;
      dropdown.innerHTML = '';
      Object.values(PEOPLE).filter(p => p.id !== assigneeId && !ntWatchers.has(p.id)).forEach(p => {
        const item = document.createElement('div');
        item.className = 'watcher-dropdown-item';
        item.innerHTML = `<span class="avatar-xs" style="background:${p.color};">${initials(p.full)}</span>${p.full}`;
        item.addEventListener('click', () => {
          ntWatchers.add(p.id);
          dropdown.classList.add('hidden');
          renderWatcherChips();
        });
        dropdown.appendChild(item);
      });
      if (dropdown.children.length === 0) {
        dropdown.innerHTML = '<div style="padding: 8px 10px; font-size: 11px; color: var(--ink-3);">No more people to add</div>';
      }
      dropdown.classList.toggle('hidden');
    });
    watchersEl.appendChild(addBtn);
  }
  renderWatcherChips();

  // Delegation banner + email label updater
  function updateDelegationBanner() {
    const assigneeId = document.getElementById('nt-assignee').value;
    const banner = document.getElementById('nt-delegation-banner');
    const emailAddr = document.getElementById('nt-notify-email-addr');
    const emailLabel = document.getElementById('nt-notify-email-label');
    if (assigneeId !== state.currentUser) {
      banner.classList.remove('hidden');
      document.getElementById('nt-delegation-text').textContent =
        `${PEOPLE[assigneeId].name} will see "Assigned by Abraham" on this task.`;
      emailLabel.textContent = `Email ${PEOPLE[assigneeId].name}`;
      emailAddr.textContent = PEOPLE[assigneeId].email;
    } else {
      banner.classList.add('hidden');
      emailLabel.textContent = 'Email assignee';
      emailAddr.textContent = '';
    }
  }
  document.getElementById('nt-assignee').addEventListener('change', updateDelegationBanner);
  updateDelegationBanner();

  modal._getWatchers = () => Array.from(ntWatchers);

  modal.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submitNewTask();
    } else if (e.key === 'Escape') {
      closeNewTaskModal();
    }
  });
}

function closeNewTaskModal() {
  const m = document.getElementById('newTaskModal');
  if (m) m.remove();
}

function submitNewTask() {
  const title = document.getElementById('nt-title').value.trim();
  if (!title) {
    const t = document.getElementById('nt-title');
    t.focus();
    t.style.borderBottom = '1px solid var(--rust)';
    return;
  }
  const modal = document.getElementById('newTaskModal');
  const desc = document.getElementById('nt-desc').value.trim();
  const assignee = document.getElementById('nt-assignee').value;
  const company = document.getElementById('nt-company').value;
  const due = document.getElementById('nt-due').value;
  const urgency = document.getElementById('nt-urgency').value;
  const priority = document.getElementById('nt-priority').value;
  const status = document.getElementById('nt-status').value;
  const watchers = modal._getWatchers();

  const notifyEmail = document.getElementById('nt-notify-email').checked;
  const notifyInapp = document.getElementById('nt-notify-inapp').checked;
  const notifyWatchers = document.getElementById('nt-notify-watchers').checked;
  const notifyWhatsapp = document.getElementById('nt-notify-whatsapp').checked;

  const task = {
    id: 't' + Date.now(),
    title, description: desc,
    company, due, urgency, priority,
    creator: state.currentUser,
    assignee, watchers,
    status,
    subtasks: [],
    activity: [{
      who: PEOPLE[state.currentUser].name,
      what: assignee === state.currentUser ? 'created this task' : `assigned this to ${PEOPLE[assignee].name}`,
      when: 'just now',
    }],
  };
  state.tasks.unshift(task);

  const delegated = assignee !== state.currentUser;
  if (delegated && notifyInapp) {
    addNotification({
      taskId: task.id,
      meta: 'Task assigned · just now',
      html: `<strong>${PEOPLE[state.currentUser].name}</strong> assigned <em>${escapeHtml(title)}</em> to <strong>${PEOPLE[assignee].name}</strong>`,
    });
  }
  if (notifyWatchers && watchers.length) {
    watchers.forEach(w => {
      addNotification({
        taskId: task.id,
        meta: 'Watching · just now',
        html: `You're now watching <em>${escapeHtml(title)}</em> (assigned to ${PEOPLE[assignee].name})`,
      });
    });
  }

  if (delegated) {
    showToast({
      title: `Task assigned to ${PEOPLE[assignee].name}`,
      sub: notifyEmail ? `Email sent to ${PEOPLE[assignee].email}` : 'No email sent',
    });
  } else {
    showToast({
      title: 'Task created',
      sub: watchers.length ? `${watchers.length} watcher${watchers.length > 1 ? 's' : ''} notified` : '',
    });
  }

  if (notifyWhatsapp) {
    // Visual-only confirmation; real integration would go here.
    showToast({ title: 'WhatsApp queued', sub: 'Ping will fire if marked urgent.' });
  }

  closeNewTaskModal();
  state.selectedTaskId = task.id;
  // If we're in a time view, switch back to a task view so the new task is visible
  if (state.view.startsWith('time:')) setView('all');
  renderAll();
}

/* ================================================================
   UTIL
   ================================================================ */
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ================================================================
   LIVE TIMER TICK (updates running clocks every second)
   ================================================================ */
function tickLiveTimers() {
  // Topbar widget
  const active = state.activeTimers[state.currentUser];
  const timerEl = document.getElementById('clockTimer');
  if (active && timerEl && !timerEl.classList.contains('hidden')) {
    timerEl.textContent = formatDuration(Date.now() - active.startedAt);
  }
  // Detail-pane banner
  const detailLive = document.getElementById('detail-live-timer');
  if (detailLive && active) {
    detailLive.textContent = formatDuration(Date.now() - active.startedAt);
  }
  // Any live timer rendered in tables (data-live-timer="<userId>")
  document.querySelectorAll('[data-live-timer]').forEach(el => {
    const uid = el.getAttribute('data-live-timer');
    const at = state.activeTimers[uid];
    if (at) el.textContent = formatDuration(Date.now() - at.startedAt);
  });
}

/* ================================================================
   INIT
   ================================================================ */
function init() {
  load();
  renderPeopleList();
  renderAll();

  // Sidebar clicks
  document.querySelectorAll('.side-item[data-view]').forEach(el => {
    if (el.dataset.view.startsWith('person:')) return;
    el.addEventListener('click', () => setView(el.dataset.view));
  });

  // New task
  document.getElementById('newTaskBtn').addEventListener('click', openNewTaskModal);

  // Clock widget
  document.getElementById('clockWidget').addEventListener('click', toggleGlobalClock);

  // Notifications panel
  document.getElementById('notifBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('notifPanel').classList.toggle('hidden');
  });
  document.getElementById('markAllRead').addEventListener('click', (e) => {
    e.stopPropagation();
    state.notifications.forEach(n => n.read = true);
    renderAll();
  });
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notifPanel');
    const btn = document.getElementById('notifBtn');
    if (!panel.contains(e.target) && !btn.contains(e.target)) {
      panel.classList.add('hidden');
    }
  });

  // Hotkeys
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'n' || e.key === 'N') {
      if (document.getElementById('newTaskModal')) return;
      e.preventDefault();
      openNewTaskModal();
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      toggleGlobalClock();
    } else if (e.key === 'Escape') {
      state.selectedTaskId = null;
      renderAll();
    }
  });

  // Search
  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    if (!state.view.startsWith('time:')) renderList();
  });

  // Filter button placeholder
  document.getElementById('filterBtn').addEventListener('click', () => {
    showToast({ title: 'Filters', sub: 'Use the sidebar views, search, or click urgency to cycle.' });
  });

  // Live-tick running timers
  setInterval(tickLiveTimers, 1000);
}

document.addEventListener('DOMContentLoaded', init);
