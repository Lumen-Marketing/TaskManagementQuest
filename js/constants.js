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
  website:  { id: 'website',  label: 'Website',  pill: 'pill-website' },
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
  member: { label: 'Member' },
  worker: { label: 'Worker' },
  sales: { label: 'Sales' },
  supervisor: { label: 'Supervisor' },
  construction_supervisor: { label: 'Construction supervisor' },
  admin: { label: 'Admin' },
  developer: { label: 'Developer' },
};

App.ROLE_PERMISSIONS = {
  member: [],
  worker: ['app.use', 'clock.use', 'time.own', 'tasks.view', 'tasks.write'],
  sales: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own'],
  supervisor: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'team.view'],
  construction_supervisor: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'roles.manage', 'team.view'],
  admin: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'roles.manage', 'clock.admin', 'team.view'],
  developer: ['app.use', 'tasks.view', 'tasks.write', 'clock.use', 'time.own', 'time.team', 'roles.manage', 'clock.admin', 'team.view', 'debug.access'],
};

App.DEFAULT_CLOCK_TASK_ID = 'general-shift';
App.CURRENT_USER = 'abraham';

// Forgotten clock-ins are auto-closed (and their live display capped) at this length.
App.MAX_SHIFT_MS = 12 * 60 * 60 * 1000; // 12 hours

App.can = function can(permission) {
  const role = (App.currentProfile && App.currentProfile.role) || 'member';
  return (App.ROLE_PERMISSIONS[role] || []).includes(permission);
};
