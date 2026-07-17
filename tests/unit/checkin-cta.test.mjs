// tests/unit/checkin-cta.test.mjs
// Covers App.utils.checkinCta — the client's map from a check-in notification's
// stored `meta` to its deep-link CTA (label + route), rendered in the bell.
// Also cross-checks that it stays in lockstep with the edge function's
// MODE_SUBJECT / MODE_CTA_LABEL / MODE_ROUTE (the two halves have no shared
// import — content.mjs is Deno-only — so drift is exactly the failure mode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

import { MODE_SUBJECT, MODE_CTA_LABEL, MODE_ROUTE } from '../../supabase/functions/checkins/lib/content.mjs';

// Minimal browser-global stub so utils.js can load under node.
global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/utils.js');
const { checkinCta } = global.App.utils;

// The edge function writes the notification meta as `Check-in · <subject>`.
const metaFor = (mode) => `Check-in · ${MODE_SUBJECT[mode]}`;

test('morning meta → execution-order CTA', () => {
  assert.deepEqual(checkinCta(metaFor('morning')), {
    mode: 'morning', label: "Set today's focus", route: '#/tasks/execution',
  });
});

test('eod meta → review-today CTA', () => {
  assert.deepEqual(checkinCta(metaFor('eod')), {
    mode: 'eod', label: 'Review today', route: '#/tasks',
  });
});

test('stalled meta → CTA with no route (acts on the linked task)', () => {
  assert.deepEqual(checkinCta(metaFor('stalled')), {
    mode: 'stalled', label: 'Review stalled tasks', route: null,
  });
});

test('non-check-in metas return null', () => {
  assert.equal(checkinCta('Assigned to you · Fix the sink'), null);
  assert.equal(checkinCta('Check-in'), null);          // prefix only, no subject
  assert.equal(checkinCta(''), null);
  assert.equal(checkinCta(null), null);
  assert.equal(checkinCta(undefined), null);
});

// Lockstep: for every mode the edge fn knows about, the client resolves the
// SAME label. Routes match too, except stalled — the client deliberately routes
// null (open the task) while the email links to the list.
test('client CTA labels match the edge function for every mode', () => {
  for (const mode of Object.keys(MODE_SUBJECT)) {
    const cta = checkinCta(metaFor(mode));
    assert.ok(cta, `checkinCta returned null for mode ${mode}`);
    assert.equal(cta.mode, mode);
    assert.equal(cta.label, MODE_CTA_LABEL[mode], `label drift for ${mode}`);
    if (mode === 'stalled') assert.equal(cta.route, null);
    else assert.equal(cta.route, MODE_ROUTE[mode], `route drift for ${mode}`);
  }
});
