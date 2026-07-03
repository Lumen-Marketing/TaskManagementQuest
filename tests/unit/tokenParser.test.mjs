// tests/unit/tokenParser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseTaskTitle } = require('../../js/views/newtask/tokenParser.js');

const TEAM = [
  { id: 'abraham', name: 'Abraham' }, { id: 'alkeith', name: 'Alkeith' },
  { id: 'andres', name: 'Andres' }, { id: 'sean', name: 'Sean' },
];
const COMPANIES = [{ id: 'roofing', label: 'Quest Roofing' }, { id: 'drafting', label: 'Quest Drafting' }];
const ctx = (over = {}) => ({ team: TEAM, companies: COMPANIES, today: '2026-07-04', atEnd: false, ...over });

test('unambiguous @alkeith followed by space adds to whos and strips token', () => {
  const r = parseTaskTitle('Fix roof @alkeith ', ctx());
  assert.deepEqual(r.patches.addWhos, ['alkeith']);
  assert.equal(r.cleanTitle, 'Fix roof');
});

test('ambiguous @a does nothing (Abraham/Alkeith/Andres)', () => {
  const r = parseTaskTitle('Job @a ', ctx());
  assert.deepEqual(r.patches.addWhos || [], []);
  assert.equal(r.cleanTitle.includes('@a'), true);
});

test('token only resolves when followed by whitespace, unless atEnd', () => {
  assert.equal(parseTaskTitle('Job @alkeith', ctx()).patches.addWhos, undefined);        // still typing
  assert.deepEqual(parseTaskTitle('Job @alkeith', ctx({ atEnd: true })).patches.addWhos, ['alkeith']); // blur/create
});

test('!high sets priority high; first letter decides', () => {
  assert.equal(parseTaskTitle('Roof !high ', ctx()).patches.pri, 'high');
  assert.equal(parseTaskTitle('Roof !med ', ctx()).patches.pri, 'medium');
  assert.equal(parseTaskTitle('Roof !l ', ctx()).patches.pri, 'low');
});

test('date words map to today-relative ISO', () => {
  assert.equal(parseTaskTitle('Ship tmrw ', ctx()).patches.date, '2026-07-05');
  assert.equal(parseTaskTitle('Ship today ', ctx()).patches.date, '2026-07-04');
});

test('time token 9:30a -> 09:30, 2p -> 14:00', () => {
  assert.equal(parseTaskTitle('Call 9:30a ', ctx()).patches.time, '09:30');
  assert.equal(parseTaskTitle('Call 2p ', ctx()).patches.time, '14:00');
});

test('combined: tmrw 9:30a !high @alkeith #drafting', () => {
  const r = parseTaskTitle('Reroof tmrw 9:30a !high @alkeith #drafting ', ctx());
  assert.equal(r.patches.date, '2026-07-05');
  assert.equal(r.patches.time, '09:30');
  assert.equal(r.patches.pri, 'high');
  assert.deepEqual(r.patches.addWhos, ['alkeith']);
  assert.equal(r.patches.company, 'drafting');
  assert.equal(r.cleanTitle, 'Reroof');
});
