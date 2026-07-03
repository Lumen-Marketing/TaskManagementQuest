// tests/unit/workOrderRail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { render } = require('../../js/views/newtask/WorkOrderRail.js');

const base = () => ({
  woNumber: null, title: '', company: { label: 'Quest Roofing', color: '#ED4E0D' },
  assignees: [], priority: { key: 'medium', label: 'Medium' }, due: '', time: '',
  reminderText: 'AT DUE TIME', label: null, project: null, subtaskCount: 0,
  watchers: [], channels: { email: true, inapp: true, watchers: false, wa: false },
  ready: { title: false, who: false, due: false }, dispatched: false,
});

test('empty state shows placeholder title and no QH number', () => {
  const html = render(base());
  assert.match(html, /Untitled task/);
  assert.doesNotMatch(html, /QH-\d/); // no number yet
});

test('renders assignees, priority, and QH number when present', () => {
  const html = render({ ...base(), woNumber: 42, title: 'Reroof',
    assignees: [{ name: 'Alkeith', init: 'AL', color: '#0E7C86' }, { name: 'Andres', init: 'AN', color: '#5B6472' }],
    priority: { key: 'high', label: 'High' }, ready: { title: true, who: true, due: true } });
  assert.match(html, /QH-0042/);
  assert.match(html, /Alkeith/);
  assert.match(html, /Andres/);
  assert.match(html, /HIGH/i);
});

test('WhatsApp tag is locked unless priority is high', () => {
  assert.match(render(base()), /class="dtag[^"]*locked[^"]*" data-ch="wa"/);
  const hi = render({ ...base(), priority: { key: 'high', label: 'High' }, channels: { email: true, inapp: true, watchers: false, wa: true } });
  assert.doesNotMatch(hi, /class="dtag[^"]*locked[^"]*" data-ch="wa"/);
});

test('dispatched adds the dispatched class (stamp text is always present, toggled by class)', () => {
  assert.match(render({ ...base(), dispatched: true }), /class="wo dispatched"/);
  assert.doesNotMatch(render(base()), /class="wo dispatched"/);
});

test('escapes title text', () => {
  assert.match(render({ ...base(), title: '<script>x</script>' }), /&lt;script&gt;/);
});
