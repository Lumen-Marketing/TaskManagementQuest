window.App = window.App || {};

App.PEOPLE = {
  abraham:  { id: 'abraham',  name: 'Abraham',  full: 'Abraham Maldonado', email: 'abraham@quest.com',         color: '#E8A03A' },
  alkeith:  { id: 'alkeith',  name: 'Alkeith',  full: 'Alkeith Cabezzas',  email: 'alkeith@questroofing.com',  color: '#993C1D' },
  kristine: { id: 'kristine', name: 'Kristine', full: 'Kristine',          email: 'kristine@questroofing.com', color: '#185FA5' },
  jesus:    { id: 'jesus',    name: 'Jesus',    full: 'Jesus',             email: 'jesus@questroofing.com',    color: '#BA7517' },
  andres:   { id: 'andres',   name: 'Andres',   full: 'Andres',            email: 'andres@questdrafting.com',  color: '#3B6D11' },
  adrian:   { id: 'adrian',   name: 'Adrian',   full: 'Adrian Alegria',    email: 'adrian@lumen.com',          color: '#6E430A' },
};

App.COMPANIES = {
  roofing:  { id: 'roofing',  label: 'Roofing',  pill: 'pill-roof'    },
  drafting: { id: 'drafting', label: 'Drafting', pill: 'pill-draft'   },
  lumen:    { id: 'lumen',    label: 'Lumen',    pill: 'pill-lumen'   },
};

App.TASK_TYPES = {
  lead:      { id: 'lead',      label: 'Lead',            cls: 'type-lead'      },
  bid:       { id: 'bid',       label: 'Bid / Estimate',  cls: 'type-bid'       },
  admin:     { id: 'admin',     label: 'Admin',           cls: 'type-admin'     },
  invoicing: { id: 'invoicing', label: 'Invoicing',       cls: 'type-invoicing' },
  ar:        { id: 'ar',        label: 'AR',              cls: 'type-ar'        },
  meeting:   { id: 'meeting',   label: 'Meeting',         cls: 'type-meeting'   },
  web_dev:   { id: 'web_dev',   label: 'Web development', cls: 'type-web-dev'   },
};

// Job scope tag shown alongside Type. Combo-box choices in the New task popup.
// 'none' is the explicit "no job-scope tag" choice — it renders as empty (—)
// everywhere a label would show, so a task can opt out of a scope tag entirely.
App.TASK_LABELS = {
  none:         { id: 'none',         label: 'No label' },
  roof:         { id: 'roof',         label: 'Roof' },
  roof_framing: { id: 'roof_framing', label: 'Roof & Framing' },
  framing:      { id: 'framing',      label: 'Framing' },
};

App.BID_STATUSES = {
  queue:    { id: 'queue',    label: 'In queue',          cls: 'bid-queue'    },
  started:  { id: 'started',  label: 'Started',           cls: 'bid-started'  },
  supplier: { id: 'supplier', label: 'Waiting supplier',  cls: 'bid-supplier' },
  ready:    { id: 'ready',    label: 'Ready to submit',   cls: 'bid-ready'    },
};

App.STATUSES = {
  todo:    { label: 'Working on it', cls: 'status-doing' },
  pending: { label: 'Pending',       cls: 'status-pending' },
  hold:    { label: 'Stuck',         cls: 'status-hold' },
  review:  { label: 'In review',     cls: 'status-review' },
  done:    { label: 'Done',          cls: 'status-done' },
};

App.PRIORITIES = {
  critical: { label: 'Critical', cls: 'priority-critical', order: 0 },
  urgent:   { label: 'Urgent',   cls: 'priority-urgent',   order: 1 },
  high:     { label: 'High',     cls: 'priority-high',     order: 2 },
  medium:   { label: 'Medium',   cls: 'priority-medium',   order: 3 },
  low:      { label: 'Low',      cls: 'priority-low',      order: 4 },
};

App.SORT_OPTIONS = {
  priority: { label: 'Priority' },
  due:      { label: 'Due date' },
  title:    { label: 'Title' },
  assignee: { label: 'Assignee' },
  status:   { label: 'Status' },
  created:  { label: 'Created' },
  focus:    { label: 'Execution order' },
};

App.GROUP_OPTIONS = {
  due:      { label: 'Due date' },
  status:   { label: 'Status' },
  assignee: { label: 'Assignee' },
  company:  { label: 'Company' },
  priority: { label: 'Priority' },
  type:     { label: 'Type' },
  none:     { label: 'No grouping' },
};

App.ROLES = {
  worker: { label: 'Worker' },
  // 'sales' is a worker by another name — identical permissions, distinct label
  // so salespeople can be tagged in the roster. At the DB layer the
  // current_profile_role() helper resolves sales -> worker (migration 048), so
  // RLS treats them the same; this list keeps the two perm sets in lockstep.
  sales: { label: 'Sales' },
  supervisor: { label: 'Supervisor' },
  admin: { label: 'Admin' },
  developer: { label: 'Developer' },
};

App.ROLE_PERMISSIONS = {
  worker: ['app.use', 'clock.use', 'time.own', 'tasks.view', 'tasks.write'],
  // Identical to worker — keep these two arrays in sync.
  sales: ['app.use', 'clock.use', 'time.own', 'tasks.view', 'tasks.write'],
  supervisor: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'team.view'],
  admin: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'roles.manage', 'clock.admin', 'team.view'],
  developer: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'roles.manage', 'clock.admin', 'team.view', 'debug.access'],
};

App.DEFAULT_CLOCK_TASK_ID = 'general-shift';
App.CURRENT_USER = 'abraham';

// Shared display timezone for true points-in-time — clock-in/out moments and
// time-entry timestamps (stored as timestamptz / real instants). Rendering these
// in ONE fixed zone keeps everyone in sync: a timer started at 2:00 PM reads the
// same for every viewer regardless of their device's location, instead of each
// browser showing its own local clock.
//
// Use an IANA zone id (e.g. 'America/Denver', 'America/Chicago', 'America/New_York')
// so daylight-saving is handled automatically — NOT a fixed offset like 'UTC-6'.
// >>> Set this to your HQ's timezone. <<<
//
// Per-user override (profiles.timezone) is read first when it exists; until that
// column + picker ship, everyone resolves to this HQ default. NOTE: this only
// affects display of instants — due dates and reminders are intentionally left on
// wall-clock semantics and are untouched by this setting.
// Arizona: America/Phoenix is UTC-7 year-round (no daylight saving) — do NOT use
// America/Denver, which would be an hour off during DST.
App.HQ_TIMEZONE = 'America/Phoenix';

App.timezone = function timezone() {
  return (App.currentProfile && App.currentProfile.timezone) || App.HQ_TIMEZONE;
};

// Forgotten clock-ins are auto-closed (and their live display capped) at this length.
App.MAX_SHIFT_MS = 12 * 60 * 60 * 1000; // 12 hours

// Developer "view as": when a developer previews the app as another role,
// App.viewAsRole holds that role and every permission/scoping check reads the
// EFFECTIVE role below. realRole() always reflects the actual account, so the
// view-as switcher itself never disappears.
App.viewAsRole = null;
App.realRole = function realRole() {
  return (App.currentProfile && App.currentProfile.role) || 'member';
};
App.effectiveRole = function effectiveRole() {
  const r = App.viewAsRole || App.realRole();
  // 'sales' is a worker by another name: resolve it to 'worker' for all
  // permission/scoping checks (App.can + the `=== 'worker'` row-scope branches in
  // TaskModel/AppController/etc.), mirroring the server-side current_profile_role()
  // alias (migration 048). realRole() still returns the literal 'sales' so the
  // roster/labels show it distinctly.
  return r === 'sales' ? 'worker' : r;
};

App.can = function can(permission) {
  return (App.ROLE_PERMISSIONS[App.effectiveRole()] || []).includes(permission);
};
