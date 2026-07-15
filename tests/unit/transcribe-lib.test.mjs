// tests/unit/transcribe-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAudioPayload, decodeBase64, pickAudioName, TRANSCRIBE_MAX_B64,
} from '../../supabase/functions/ai-assistant/lib/transcribe.mjs';

test('validateAudioPayload rejects missing audio', () => {
  assert.deepEqual(validateAudioPayload({}), { ok: false, error: 'No audio.' });
  assert.deepEqual(validateAudioPayload({ audio: '' }), { ok: false, error: 'No audio.' });
});

test('validateAudioPayload rejects oversized audio', () => {
  const big = 'a'.repeat(11);
  assert.deepEqual(validateAudioPayload({ audio: big }, { maxB64: 10 }),
    { ok: false, error: 'Audio too large.' });
});

test('validateAudioPayload defaults mime and passes valid audio', () => {
  assert.deepEqual(validateAudioPayload({ audio: 'AAAA' }),
    { ok: true, audio: 'AAAA', mime: 'audio/webm' });
  assert.equal(validateAudioPayload({ audio: 'AAAA', mime: 'audio/mp4' }).mime, 'audio/mp4');
});

test('decodeBase64 round-trips bytes and strips data prefix', () => {
  const b64 = Buffer.from([1, 2, 3, 255]).toString('base64');
  assert.deepEqual([...decodeBase64(b64)], [1, 2, 3, 255]);
  assert.deepEqual([...decodeBase64('data:audio/webm;base64,' + b64)], [1, 2, 3, 255]);
});

test('pickAudioName maps mime to an accepted extension', () => {
  assert.equal(pickAudioName('audio/webm;codecs=opus'), 'audio.webm');
  assert.equal(pickAudioName('audio/mp4'), 'audio.mp4');
  assert.equal(pickAudioName('audio/mpeg'), 'audio.mp3');
  assert.equal(pickAudioName('audio/wav'), 'audio.wav');
  assert.equal(pickAudioName(''), 'audio.webm');
});

test('TRANSCRIBE_MAX_B64 is about 5MB', () => {
  assert.equal(TRANSCRIBE_MAX_B64, 5 * 1024 * 1024);
});
