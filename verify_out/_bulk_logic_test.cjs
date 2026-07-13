/* Headless logic test for the new bulk-select + keyboard-nav controller code.
   Loads the REAL EventBus + AppController against stubbed models. No browser,
   no Supabase. Verifies the riskiest additions: bulk complete/delete + undo,
   selection toggles, select-all, and j/k navigation. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// --- minimal browser/App globals the controller touches ---
global.window = global;
global.CSS = { escape: (s) => String(s) };
global.document = { querySelector: () => null };           // selectAdjacentTask scrollIntoView lookup
global.setTimeout = setTimeout; global.clearTimeout = clearTimeout;

let ROLE = 'admin';
global.App = {
  can: () => true,
  effectiveRole: () => ROLE,
  realRole: () => ROLE,
  PEOPLE: { me: { name: 'Me' } },
  currentProfile: { member_id: 'me' },
};

// --- load real modules ---
eval(fs.readFileSync(path.join(ROOT, 'js/EventBus.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'js/controllers/AppController.js'), 'utf8'));

// --- stub task model backed by a plain array ---
function makeTasks() {
  return [
    { id: 'a', title: 'Alpha', status: 'todo',   creator: 'me' },
    { id: 'b', title: 'Bravo', status: 'todo',   creator: 'someone' },
    { id: 'c', title: 'Charlie', status: 'done', creator: 'me' },
    { id: 'd', title: 'Delta', status: 'todo',   creator: 'me' },
  ];
}
let store = makeTasks();
const taskModel = {
  all: () => store,
  find: (id) => store.find(t => t.id === id) || null,
  getFiltered: () => store.slice(),
  toggleDone: (id) => { const t = store.find(x => x.id === id); if (!t) return null; const becomingDone = t.status !== 'done'; t.status = becomingDone ? 'done' : 'todo'; App.EventBus.emit('tasks:changed'); return { becomingDone }; },
  remove: (id) => { store = store.filter(t => t.id !== id); App.EventBus.emit('tasks:changed'); },
  add: (t) => { store.push(t); App.EventBus.emit('tasks:changed'); },
};
const toasts = [];
const toastView = { show: (o) => { toasts.push(o); return o; } };
const timeModel = { activeFor: () => null };

const c = new App.AppController({ taskModel, timeModel, notifModel: {}, currentUser: 'me', dataStore: {} });
c.attachViews({ toastView });

// --- tiny assert harness ---
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}` + (ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`));
  ok ? pass++ : fail++;
};
const openCount = () => store.filter(t => t.status !== 'done').length;

// 1. enter bulk mode seeds selection + sets flag
c.enterBulkMode('a');
eq('enterBulkMode sets bulkMode', c.uiState.bulkMode, true);
eq('enterBulkMode seeds selection', [...c.uiState.bulkSelected], ['a']);

// 2. toggle selection on/off
c.toggleBulkSelect('b'); eq('toggle adds b', c.uiState.bulkSelected.has('b'), true);
c.toggleBulkSelect('b'); eq('toggle removes b', c.uiState.bulkSelected.has('b'), false);

// 3. select-all then clear (toggle semantics)
c.bulkSelectAllVisible(); eq('select-all selects every visible', c.uiState.bulkSelected.size, store.length);
c.bulkSelectAllVisible(); eq('select-all again clears', c.uiState.bulkSelected.size, 0);

// 4. bulk complete: select two open tasks, complete, expect them done + undo toast
c.enterBulkMode(); c.uiState.bulkSelected = new Set(['a', 'd']);
const openBefore = openCount();
c.bulkComplete();
eq('bulkComplete marks a done', taskModel.find('a').status, 'done');
eq('bulkComplete marks d done', taskModel.find('d').status, 'done');
eq('bulkComplete reduced open count by 2', openCount(), openBefore - 2);
eq('bulkComplete exits bulk mode', c.uiState.bulkMode, false);
const completeToast = toasts[toasts.length - 1];
eq('bulkComplete shows Undo', !!(completeToast.action && completeToast.action.label === 'Undo'), true);
// undo restores them to not-done
completeToast.action.onClick();
eq('undo reopens a', taskModel.find('a').status, 'todo');
eq('undo reopens d', taskModel.find('d').status, 'todo');

// 5. bulk delete as admin (can delete all): a + b removed, undo restores
store = makeTasks(); toasts.length = 0; ROLE = 'admin';
c.enterBulkMode(); c.uiState.bulkSelected = new Set(['a', 'b']);
c.bulkDelete();
eq('bulkDelete removed a', taskModel.find('a'), null);
eq('bulkDelete removed b', taskModel.find('b'), null);
const delToast = toasts[toasts.length - 1];
delToast.action.onClick();
eq('undo restores a', !!taskModel.find('a'), true);
eq('undo restores b', !!taskModel.find('b'), true);

// 6. worker can only delete own-created tasks; b (creator 'someone') is skipped
store = makeTasks(); toasts.length = 0; ROLE = 'worker';
c.enterBulkMode(); c.uiState.bulkSelected = new Set(['a', 'b']);  // a=mine, b=someone
c.bulkDelete();
eq('worker bulkDelete removes own task a', taskModel.find('a'), null);
eq('worker bulkDelete keeps others-task b', !!taskModel.find('b'), true);
const wToast = toasts[toasts.length - 1];
eq('worker delete toast notes 1 skipped', /1 skipped/.test(wToast.sub || ''), true);

// 7. selectAdjacentTask wraps through visible order
store = makeTasks(); ROLE = 'admin';
c.exitBulkMode(); c.uiState.selectedTaskId = null;
c.selectAdjacentTask(1); eq('j from none -> first', c.uiState.selectedTaskId, 'a');
c.selectAdjacentTask(1); eq('j -> next', c.uiState.selectedTaskId, 'b');
c.selectAdjacentTask(-1); eq('k -> prev', c.uiState.selectedTaskId, 'a');
c.selectAdjacentTask(-1); eq('k wraps to last', c.uiState.selectedTaskId, 'd');

// 8. handleEscape exits bulk mode first, then closes detail
c.enterBulkMode('a'); c.handleEscape(); eq('escape exits bulk mode', c.uiState.bulkMode, false);
c.uiState.selectedTaskId = 'a'; c.handleEscape(); eq('escape then closes detail', c.uiState.selectedTaskId, null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
