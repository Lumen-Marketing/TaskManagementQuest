// tests/unit/voice-capture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

global.window = global.window || {};
global.App = global.window.App = {};
require('../../js/services/VoiceCapture.js');
const VC = global.App.VoiceCapture;

test('isSupported is false when browser globals are absent', () => {
  const savedNav = global.navigator, savedMR = global.window.MediaRecorder;
  delete global.navigator; delete global.window.MediaRecorder;
  assert.equal(VC.isSupported(), false);
  if (savedNav !== undefined) global.navigator = savedNav;
  if (savedMR !== undefined) global.window.MediaRecorder = savedMR;
});

test('isSupported is true when getUserMedia and MediaRecorder exist', () => {
  global.navigator = { mediaDevices: { getUserMedia: () => {} } };
  global.window.MediaRecorder = function () {};
  assert.equal(VC.isSupported(), true);
  delete global.navigator; delete global.window.MediaRecorder;
});

test('pickMimeType returns the first supported preference', () => {
  global.window.MediaRecorder = function () {};
  global.window.MediaRecorder.isTypeSupported = (t) => t === 'audio/mp4';
  assert.equal(VC.pickMimeType(), 'audio/mp4');
  global.window.MediaRecorder.isTypeSupported = () => false;
  assert.equal(VC.pickMimeType(), '');
  delete global.window.MediaRecorder;
});

test('blobToBase64 strips the data-URL prefix', async () => {
  const saved = global.FileReader;
  global.FileReader = class {
    readAsDataURL() { this.result = 'data:audio/webm;base64,QUJD'; this.onload(); }
  };
  const out = await VC.blobToBase64({});
  assert.equal(out, 'QUJD');
  global.FileReader = saved;
});
