// tests/unit/task-in-company.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/utils.js');
const U = global.App.utils;

const roofing = { company: 'roofing' };
const overall = { company: 'overall' };

test("'*' and empty match everything (no filter)", () => {
  assert.equal(U.taskInCompany(roofing, '*'), true);
  assert.equal(U.taskInCompany(overall, '*'), true);
  assert.equal(U.taskInCompany(roofing, ''), true);
  assert.equal(U.taskInCompany(roofing, null), true);
});

test('a real-company scope matches that company AND overall tasks', () => {
  assert.equal(U.taskInCompany(roofing, 'roofing'), true);
  assert.equal(U.taskInCompany(overall, 'roofing'), true);   // spans all
  assert.equal(U.taskInCompany({ company: 'drafting' }, 'roofing'), false);
});

test("the 'overall' scope matches only overall tasks", () => {
  assert.equal(U.taskInCompany(overall, 'overall'), true);
  assert.equal(U.taskInCompany(roofing, 'overall'), false);
});
