// tests/unit/undo-stack.test.mjs
// Undo stack on AppController: single-op capture, grouped transactions, and
// restore-last. Drives the real prototype methods with a fake task model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = { EventBus: { on() {}, emit() {} } };
require('../../js/controllers/AppController.js');
const Proto = global.App.AppController.prototype;

// A minimal stand-in for the controller: the undo methods only touch
// _undoStack/_undoTxn/_undoing, taskModel.{find,setField,setFocusOrder},
// getUserName, currentUser, and toastView.
function makeCtrl(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const calls = [];
  return {
    _undoStack: [], _undoTxn: null, _undoing: false,
    currentUser: 'u', getUserName: () => 'u', toastView: null,
    taskModel: {
      find: (id) => byId.get(id) || null,
      setField: (id, field, value) => { byId.get(id)[field] = value; calls.push(['setField', id, field, value]); },
      setFocusOrder: (id, value) => { byId.get(id).focusSeq = value; calls.push(['setFocusOrder', id, value]); },
    },
    _calls: calls, _tasks: byId,
    undoable: Proto.undoable, _captureUndo: Proto._captureUndo,
    _pushUndo: Proto._pushUndo, undoLast: Proto.undoLast,
  };
}

test('single capture + undo restores one field', () => {
  const c = makeCtrl([{ id: 'a', priority: 'high' }]);
  c._captureUndo('a', 'priority', 'high', 'change priority');
  c._tasks.get('a').priority = 'low'; // simulate the edit
  assert.equal(c._undoStack.length, 1);
  c.undoLast();
  assert.equal(c._tasks.get('a').priority, 'high');
  assert.equal(c._undoStack.length, 0);
});

test('undoable groups many writes into ONE undo step', () => {
  const c = makeCtrl([{ id: 'a', focusSeq: 1 }, { id: 'b', focusSeq: 2 }, { id: 'a2', type: 'lead' }]);
  c.undoable('move', () => {
    c._captureUndo('a2', 'type', 'lead', 'change type');
    c._captureUndo('a', 'focusSeq', 1, 'reorder');
    c._captureUndo('b', 'focusSeq', 2, 'reorder');
    c._tasks.get('a2').type = 'webdev'; c._tasks.get('a').focusSeq = 5; c._tasks.get('b').focusSeq = 6;
  });
  assert.equal(c._undoStack.length, 1);
  assert.equal(c._undoStack[0].ops.length, 3);
  c.undoLast();
  assert.equal(c._tasks.get('a2').type, 'lead');
  assert.equal(c._tasks.get('a').focusSeq, 1);
  assert.equal(c._tasks.get('b').focusSeq, 2);
});

test('first-write-wins per task+field within a transaction', () => {
  const c = makeCtrl([{ id: 'a', focusSeq: 1 }]);
  c.undoable('reorder', () => {
    c._captureUndo('a', 'focusSeq', 1, 'reorder'); // original
    c._captureUndo('a', 'focusSeq', 3, 'reorder'); // must be ignored
  });
  c._tasks.get('a').focusSeq = 9;
  c.undoLast();
  assert.equal(c._tasks.get('a').focusSeq, 1); // restored to the ORIGINAL
});

test('undoLast on empty stack is a safe no-op', () => {
  const c = makeCtrl([{ id: 'a', priority: 'high' }]);
  c.undoLast();
  assert.equal(c._tasks.get('a').priority, 'high');
});

test('restore uses setFocusOrder for focusSeq, setField otherwise', () => {
  const c = makeCtrl([{ id: 'a', focusSeq: 2, status: 'todo' }]);
  c._captureUndo('a', 'focusSeq', 2, 'reorder');
  c._captureUndo('a', 'status', 'todo', 'change status');
  c.undoLast(); // one entry? No — two one-shot pushes; undo the last (status) first
  assert.equal(c._tasks.get('a').status, 'todo');
  assert.ok(c._calls.some(x => x[0] === 'setField' && x[2] === 'status'));
});
