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
  roofing:  { id: 'roofing',  label: 'Roofing',  pill: 'pill-roof'  },
  drafting: { id: 'drafting', label: 'Drafting', pill: 'pill-draft' },
  lumen:    { id: 'lumen',    label: 'Lumen',    pill: 'pill-lumen' },
};

App.STATUSES = {
  todo:    { label: 'Active',  cls: 'status-doing' },
  pending: { label: 'Pending', cls: 'status-pending' },
  hold:    { label: 'On hold', cls: 'status-hold' },
  review:  { label: 'Review',  cls: 'status-review' },
  done:    { label: 'Done',    cls: 'status-done' },
};

App.URGENCIES = {
  critical: { label: 'Critical', cls: 'urgency-critical', order: 0 },
  urgent:   { label: 'Urgent',   cls: 'urgency-urgent',   order: 1 },
  high:     { label: 'High',     cls: 'urgency-high',     order: 2 },
  medium:   { label: 'Medium',   cls: 'urgency-medium',   order: 3 },
  low:      { label: 'Low',      cls: 'urgency-low',      order: 4 },
  chill:    { label: 'Whenever', cls: 'urgency-chill',    order: 5 },
};

App.STORAGE_KEY = 'quest-hq-state-v3';
App.CURRENT_USER = 'abraham';
