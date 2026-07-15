# Voice → Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user press-and-hold a mic on the New Task page, speak a task, and have the transcript fill the title and auto-draft the fields — reusing the existing `draft_task` pipeline.

**Architecture:** Browser `MediaRecorder` captures audio → base64 → new `transcribe` action on the `ai-assistant` edge function → Groq `whisper-large-v3-turbo` transcription endpoint → returned text is written into `#nt-title`, which runs the same `_applyParse` + `_scheduleDraft` path as typing. A small pure lib (`lib/transcribe.mjs`) and a client helper (`js/services/VoiceCapture.js`) isolate the testable seams from the browser/network glue.

**Tech Stack:** Deno edge function (TypeScript), Groq OpenAI-compatible audio API, vanilla-JS static SPA (`window.App` namespace), `node --test` unit tests (`.mjs`).

## Global Constraints

- **No browser `SpeechRecognition`.** Transcription is server-side via Groq only.
- Reuse the existing `GROQ_API_KEY` secret and `api.groq.com`. No new secret.
- Transcription model: `whisper-large-v3-turbo`.
- The 32 KB payload cap (`MAX_PAYLOAD_BYTES`) stays for the text actions; the `transcribe` action gets its own ~5 MB base64 cap.
- Recording auto-stops at ~60 s.
- Feature-detect support; if unsupported, the mic button is never rendered — no fallback, no error.
- Voice never blocks typing; every failure degrades quietly into `#nt-flash`.
- Unit tests are `node --test "tests/unit/*.test.mjs"` (`npm run test:unit`). Browser `window.App` modules are loaded in tests via `createRequire`.
- Never `git add -A`/`.` — stage explicit paths only.
- Deploy the edge function from repo source via Supabase MCP `deploy_edge_function` (the paste bundle is dead). Client ships to Vercel on push to `main`.

---

### Task 1: Pure transcribe helpers (`lib/transcribe.mjs`)

**Files:**
- Create: `supabase/functions/ai-assistant/lib/transcribe.mjs`
- Test: `tests/unit/transcribe-lib.test.mjs`

**Interfaces:**
- Consumes: nothing (uses global `atob`, available in Deno and Node ≥18).
- Produces:
  - `TRANSCRIBE_MAX_B64` — number, default max base64 length (~5 MB).
  - `validateAudioPayload(payload, opts?) → { ok: true, audio, mime } | { ok: false, error }` — `opts.maxB64` overrides the cap; defaults `mime` to `'audio/webm'`.
  - `decodeBase64(b64) → Uint8Array` — strips any `data:` prefix defensively.
  - `pickAudioName(mime) → string` — a filename with an extension Groq accepts.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/unit/transcribe-lib.test.mjs"`
Expected: FAIL — cannot resolve `lib/transcribe.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// supabase/functions/ai-assistant/lib/transcribe.mjs
// Pure, runtime-agnostic helpers for the "transcribe" action. Kept free of
// Deno/Groq specifics so they unit-test under node --test.

export const TRANSCRIBE_MAX_B64 = 5 * 1024 * 1024; // ~5MB of base64 characters

// Validate + normalize the incoming { audio, mime } payload. Never throws.
export function validateAudioPayload(payload, opts = {}) {
  const maxB64 = opts.maxB64 || TRANSCRIBE_MAX_B64;
  const audio = typeof payload?.audio === 'string' ? payload.audio : '';
  const mime = typeof payload?.mime === 'string' && payload.mime ? payload.mime : 'audio/webm';
  if (!audio) return { ok: false, error: 'No audio.' };
  if (audio.length > maxB64) return { ok: false, error: 'Audio too large.' };
  return { ok: true, audio, mime };
}

// Decode a base64 string (with or without a data: URL prefix) to bytes.
export function decodeBase64(b64) {
  const clean = String(b64 || '').replace(/^data:[^,]*,/, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Groq infers the codec from the filename extension, so give it a sane one.
export function pickAudioName(mime) {
  const m = String(mime || '');
  if (m.includes('mp4') || m.includes('m4a')) return 'audio.mp4';
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio.mp3';
  if (m.includes('wav')) return 'audio.wav';
  if (m.includes('ogg')) return 'audio.ogg';
  return 'audio.webm';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/unit/transcribe-lib.test.mjs"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ai-assistant/lib/transcribe.mjs tests/unit/transcribe-lib.test.mjs
git commit -m "feat(voice): pure transcribe payload/base64 helpers"
```

---

### Task 2: Edge function `transcribe` branch

**Files:**
- Modify: `supabase/functions/ai-assistant/index.ts`

**Interfaces:**
- Consumes: `validateAudioPayload`, `decodeBase64`, `pickAudioName` from Task 1.
- Produces: HTTP action `{ action: 'transcribe', audio, mime }` → `{ ok: true, text }` or `{ ok: false, error }`.

- [ ] **Step 1: Import the helpers**

At the top of `index.ts`, alongside the other lib imports (after the `digest.mjs` import on line 29), add:

```ts
import { validateAudioPayload, decodeBase64, pickAudioName } from "./lib/transcribe.mjs";
```

- [ ] **Step 2: Add the provider-model constant and daily-cap state**

After `const GROQ_MODEL = "llama-3.3-70b-versatile";` (line 33) add:

```ts
const GROQ_TRANSCRIBE_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
```

Near the other `*Usage` maps (after the `digestUsage` line, line 54) add:

```ts
const TRANSCRIBE_DAILY_CAP = 60;
const transcribeUsage = new Map<string, { day: string; n: number }>();
```

- [ ] **Step 3: Let large `transcribe` payloads through the size gate**

The current guard (line 111) is:

```ts
    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) return json(req, { error: "Payload too large." }, 413);
```

Replace it with a version that exempts the transcribe action (its own ~5 MB cap is enforced inside the branch):

```ts
    const raw = await req.text();
    const isTranscribe = raw.includes('"transcribe"');
    if (!isTranscribe && raw.length > MAX_PAYLOAD_BYTES) {
      return json(req, { error: "Payload too large." }, 413);
    }
```

- [ ] **Step 4: Allow the new action**

Change the action allow-check (line 115) from:

```ts
    if (action !== "briefing" && action !== "draft_task" && action !== "chat" && action !== "weekly_digest") {
```

to:

```ts
    if (action !== "briefing" && action !== "draft_task" && action !== "chat" && action !== "weekly_digest" && action !== "transcribe") {
```

- [ ] **Step 5: Add the transcribe branch**

Immediately after the `draft_task` branch closes (after line 170, its `return json(req, { ok: true, draft });` and closing `}`), insert:

```ts
    // -------- transcribe: audio → text (feeds draft_task on the client) -----
    if (action === "transcribe") {
      const tday = new Date().toISOString().slice(0, 10);
      const tu = transcribeUsage.get(uid);
      const tn = tu && tu.day === tday ? tu.n : 0;
      if (tn >= TRANSCRIBE_DAILY_CAP) return json(req, { ok: false, error: "Daily voice limit reached. Try again tomorrow." }, 429);
      transcribeUsage.set(uid, { day: tday, n: tn + 1 });

      const v = validateAudioPayload(payload as { audio?: unknown; mime?: unknown });
      if (!v.ok) return json(req, { ok: false, error: v.error }, 400);

      let bytes: Uint8Array;
      try { bytes = decodeBase64(v.audio); }
      catch { return json(req, { ok: false, error: "Invalid audio." }, 400); }
      if (!bytes.length) return json(req, { ok: false, error: "Empty audio." }, 400);

      const form = new FormData();
      form.append("file", new Blob([bytes], { type: v.mime }), pickAudioName(v.mime));
      form.append("model", GROQ_TRANSCRIBE_MODEL);
      form.append("response_format", "json");
      form.append("temperature", "0");

      try {
        const res = await fetch(GROQ_TRANSCRIBE_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${groqKey}` }, // no Content-Type: fetch sets the multipart boundary
          body: form,
        });
        if (!res.ok) {
          console.error("[ai-assistant] transcribe provider rejected", { status: res.status });
          return json(req, { ok: false, error: "Voice is unavailable right now." }, 502);
        }
        const data = await res.json().catch(() => ({}));
        const text = typeof data?.text === "string" ? data.text.trim() : "";
        return json(req, { ok: true, text });
      } catch (e) {
        console.error("[ai-assistant] transcribe fetch threw", e);
        return json(req, { ok: false, error: "Voice is unavailable right now." }, 502);
      }
    }
```

- [ ] **Step 6: Verify the whole unit suite still passes**

Run: `npm run test:unit`
Expected: PASS (existing tests + Task 1's 6 tests). No edge-fn runtime test here — the branch is exercised manually in Task 5's verification and by the deploy step.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ai-assistant/index.ts
git commit -m "feat(voice): transcribe action on ai-assistant (Groq whisper-large-v3-turbo)"
```

---

### Task 3: Client datastore seam (`SupabaseDataStore.transcribe`)

**Files:**
- Modify: `js/services/SupabaseDataStore.js` (after the `draftTask` method, around line 757)

**Interfaces:**
- Consumes: the `transcribe` action from Task 2.
- Produces: `async transcribe({ audio, mime }) → { ok, text?, error? }` — never throws.

- [ ] **Step 1: Add the method**

Immediately after the `draftTask` method's closing `}` (line 757), insert:

```js
  /* Speech → text via the ai-assistant Edge Function. Returns
     { ok, text?, error? } and never throws so the New Task page degrades quietly. */
  async transcribe({ audio, mime }) {
    try {
      const { data, error } = await this.supabase.functions.invoke('ai-assistant', {
        body: { action: 'transcribe', audio, mime },
      });
      if (error) return { ok: false, error: (error && error.message) || 'Voice unavailable.' };
      if (!data || data.ok === false) return { ok: false, error: (data && data.error) || 'Voice unavailable.' };
      return { ok: true, text: (data && data.text) || '' };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }
```

- [ ] **Step 2: Verify it parses (no syntax break)**

Run: `node -e "require('fs').readFileSync('js/services/SupabaseDataStore.js','utf8')" && node --check js/services/SupabaseDataStore.js`
Expected: no output, exit 0 (syntactically valid).

- [ ] **Step 3: Commit**

```bash
git add js/services/SupabaseDataStore.js
git commit -m "feat(voice): SupabaseDataStore.transcribe seam"
```

---

### Task 4: VoiceCapture helper (`js/services/VoiceCapture.js`)

**Files:**
- Create: `js/services/VoiceCapture.js`
- Test: `tests/unit/voice-capture.test.mjs`

**Interfaces:**
- Consumes: browser globals `navigator.mediaDevices`, `MediaRecorder`, `FileReader`, `Blob`.
- Produces: `App.VoiceCapture` with:
  - `static isSupported() → boolean`
  - `static pickMimeType() → string` (`''` if none/unknown)
  - `static blobToBase64(blob) → Promise<string>` (no `data:` prefix)
  - `new App.VoiceCapture({ maxMs? })`, `async start()`, `stop() → Promise<{ blob, mime }>`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/unit/voice-capture.test.mjs"`
Expected: FAIL — cannot find `js/services/VoiceCapture.js`.

- [ ] **Step 3: Write the implementation**

```js
// js/services/VoiceCapture.js
// Thin MediaRecorder wrapper for the New Task voice button. Pure static seams
// (isSupported / pickMimeType / blobToBase64) are unit-tested; start/stop hold
// the browser-only recorder + stream lifecycle. Never used unless isSupported().
window.App = window.App || {};

App.VoiceCapture = class VoiceCapture {
  static isSupported() {
    return !!(typeof navigator !== 'undefined'
      && navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function'
      && typeof window !== 'undefined'
      && window.MediaRecorder);
  }

  static pickMimeType() {
    const MR = (typeof window !== 'undefined' && window.MediaRecorder) || null;
    if (!MR || typeof MR.isTypeSupported !== 'function') return '';
    const prefs = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const t of prefs) { if (MR.isTypeSupported(t)) return t; }
    return '';
  }

  static blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || '');
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  }

  constructor(opts = {}) {
    this.maxMs = opts.maxMs || 60000;
    this._chunks = [];
    this._rec = null;
    this._stream = null;
    this._timer = null;
    this._mime = 'audio/webm';
  }

  // Requests the mic and starts recording. Rejects if permission is denied.
  async start() {
    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = VoiceCapture.pickMimeType();
    this._mime = mime || 'audio/webm';
    this._chunks = [];
    this._rec = mime
      ? new MediaRecorder(this._stream, { mimeType: mime })
      : new MediaRecorder(this._stream);
    this._rec.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
    this._rec.start();
    this._timer = setTimeout(() => { this._autoStop && this._autoStop(); }, this.maxMs);
  }

  // Resolves with the finished clip once the recorder flushes. Safe to call once.
  stop() {
    return new Promise((resolve, reject) => {
      const rec = this._rec;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (!rec) { resolve({ blob: null, mime: this._mime }); return; }
      rec.onstop = () => {
        const blob = new Blob(this._chunks, { type: this._mime });
        this._cleanup();
        resolve({ blob, mime: this._mime });
      };
      try { rec.stop(); } catch (e) { this._cleanup(); reject(e); }
    });
  }

  // Lets the view register a callback for the 60s auto-stop (it calls stop()).
  onAutoStop(fn) { this._autoStop = fn; }

  _cleanup() {
    if (this._stream) { this._stream.getTracks().forEach((t) => t.stop()); this._stream = null; }
    this._rec = null;
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/unit/voice-capture.test.mjs"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add js/services/VoiceCapture.js tests/unit/voice-capture.test.mjs
git commit -m "feat(voice): VoiceCapture MediaRecorder wrapper + unit tests"
```

---

### Task 5: New Task view wiring + CSS + script include

**Files:**
- Modify: `app.html` (script includes, around line 283)
- Modify: `js/views/NewTaskPageView.js` (titlebox markup ~line 135; event binding ~line 380; new methods near `_scheduleDraft` ~line 685)
- Modify: `css/newtask.css` (mic button styles)

**Interfaces:**
- Consumes: `App.VoiceCapture` (Task 4), `this.controller.dataStore.transcribe` (Task 3), existing `this._applyParse`, `this._scheduleDraft`, `this.sync`, `this._flash`.
- Produces: no new public interface — a self-contained UI behavior.

- [ ] **Step 1: Add the script include**

In `app.html`, after the `TaskDraftClient.js` include (line 283):

```html
<script defer src="js/services/TaskDraftClient.js"></script>
<script defer src="js/services/VoiceCapture.js"></script>
```

- [ ] **Step 2: Render the mic button in the title box**

In `js/views/NewTaskPageView.js`, change the titlebox markup (lines 135-139) so the mic renders only when supported. Replace:

```js
            <div class="nt-titlebox">
              <input id="nt-title" class="nt-title-in" placeholder="What needs to get done?" autocomplete="off" aria-label="Task title" />
              <div id="nt-flash" class="nt-flash" aria-live="polite"></div>
```

with:

```js
            <div class="nt-titlebox">
              <div class="nt-title-row">
                <input id="nt-title" class="nt-title-in" placeholder="What needs to get done?" autocomplete="off" aria-label="Task title" />
                ${(App.VoiceCapture && App.VoiceCapture.isSupported()) ? '<button id="nt-mic" class="nt-mic" type="button" aria-label="Hold to dictate" title="Hold to dictate"><i class="ti ti-microphone"></i></button>' : ''}
              </div>
              <div id="nt-flash" class="nt-flash" aria-live="polite"></div>
```

- [ ] **Step 3: Bind the press-and-hold handlers**

In `js/views/NewTaskPageView.js`, right after the title parsing bindings (after line 381, the `blur` listener), add:

```js
    // Voice: press-and-hold the mic to dictate the title.
    this._bindMic();
```

- [ ] **Step 4: Add the mic methods**

In `js/views/NewTaskPageView.js`, immediately before `_scheduleDraft()` (line 687), add:

```js
  // Wire the hold-to-talk mic. No-op if the button wasn't rendered.
  _bindMic() {
    const btn = document.getElementById('nt-mic');
    if (!btn || !App.VoiceCapture) return;
    this._recording = false;
    this._busyVoice = false;
    const begin = (e) => { e.preventDefault(); this._startVoice(btn); };
    const end = (e) => { if (e) e.preventDefault(); this._stopVoice(btn); };
    btn.addEventListener('pointerdown', begin);
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointerleave', end);
    btn.addEventListener('pointercancel', end);
  }

  async _startVoice(btn) {
    if (this._recording || this._busyVoice) return;
    this._cap = new App.VoiceCapture({ maxMs: 60000 });
    this._cap.onAutoStop(() => this._stopVoice(btn));
    try {
      await this._cap.start();
      this._recording = true;
      btn.classList.add('rec');
      btn.setAttribute('aria-pressed', 'true');
    } catch (_e) {
      this._cap = null;
      this._flash('Microphone access was blocked.');
    }
  }

  async _stopVoice(btn) {
    if (!this._recording || this._busyVoice || !this._cap) return;
    this._recording = false;
    this._busyVoice = true;
    btn.classList.remove('rec');
    btn.classList.add('busy');
    btn.removeAttribute('aria-pressed');
    let clip = null;
    try { clip = await this._cap.stop(); } catch (_e) { /* fall through */ }
    this._cap = null;
    try {
      if (!clip || !clip.blob || !clip.blob.size) { this._flash("Didn't catch that — try again."); return; }
      const audio = await App.VoiceCapture.blobToBase64(clip.blob);
      const res = await this.controller.dataStore.transcribe({ audio, mime: clip.mime });
      if (!res || !res.ok) { this._flash(res && res.error ? res.error : 'Voice is unavailable right now.'); return; }
      const text = (res.text || '').trim();
      if (!text) { this._flash("Didn't catch that — try again."); return; }
      const el = document.getElementById('nt-title');
      if (el) {
        el.value = text;
        this._applyParse(false);
        this._scheduleDraft();
        this.sync();
        el.focus();
      }
    } finally {
      this._busyVoice = false;
      btn.classList.remove('busy');
    }
  }

```

- [ ] **Step 5: Add the mic button CSS**

In `css/newtask.css`, append:

```css
/* Voice dictation button in the title box */
.nt-title-row { display: flex; align-items: center; gap: 10px; }
.nt-title-row .nt-title-in { flex: 1 1 auto; min-width: 0; }
.nt-mic {
  flex: 0 0 auto;
  width: 40px; height: 40px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 12px;
  background: #f2efe9; color: #1b1a17;
  cursor: pointer; touch-action: none;
  transition: background .15s ease, transform .1s ease, color .15s ease;
}
.nt-mic:hover { background: #e8e4dc; }
.nt-mic:active { transform: scale(.96); }
.nt-mic.rec { background: #ED4E0D; color: #fff; animation: nt-mic-pulse 1s ease-in-out infinite; }
.nt-mic.busy { opacity: .6; cursor: default; }
.nt-mic i { font-size: 20px; }
@keyframes nt-mic-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(237, 78, 13, .45); } 50% { box-shadow: 0 0 0 6px rgba(237, 78, 13, 0); } }
@media (prefers-reduced-motion: reduce) { .nt-mic.rec { animation: none; } }
```

- [ ] **Step 6: Verify the view still parses and the unit suite is green**

Run: `node --check js/views/NewTaskPageView.js && npm run test:unit`
Expected: no syntax error; all unit tests PASS.

- [ ] **Step 7: Manual verification (real browser)**

Deploy the edge function from repo source (Supabase MCP `deploy_edge_function`, project `qqvmcsvdxhgjooirznrj`), then on desktop Chrome:
1. Open New Task. Confirm the mic button appears next to the title.
2. Hold the mic, speak "assign the logo redesign to abraham for lumen high priority due friday", release.
3. Confirm the title fills with the transcript and fields auto-draft with ✨ markers.
4. Block mic permission → confirm the "Microphone access was blocked." flash and that typing still drafts.
5. In a browser without `MediaRecorder` (or with it stubbed out), confirm the mic button does not render.

- [ ] **Step 8: Commit**

```bash
git add app.html js/views/NewTaskPageView.js css/newtask.css
git commit -m "feat(voice): hold-to-talk mic on New Task, transcript feeds auto-draft"
```

---

## Self-Review

**Spec coverage:**
- Server-side transcription via Groq whisper-large-v3-turbo → Task 2. ✓
- No `SpeechRecognition` → nowhere used; feature-detect gates on `MediaRecorder`/`getUserMedia` (Task 4/5). ✓
- 32 KB stays for text, ~5 MB for transcribe → Task 2 Step 3 + Task 1 `TRANSCRIBE_MAX_B64`. ✓
- ~60 s cap → Task 4 `maxMs: 60000` + `onAutoStop`. ✓
- Per-user daily cap → Task 2 `TRANSCRIBE_DAILY_CAP`. ✓
- Approved-caller gate reused → Task 2 sits below the existing gate. ✓
- Mic in title box, press-and-hold, replaces title, reuses `_applyParse`/`_scheduleDraft`/`sync` → Task 5. ✓
- Errors → `#nt-flash`, typing never blocked → Task 5 `_stopVoice` + `_startVoice`. ✓
- Client seam never throws → Task 3. ✓
- VoiceCapture helper with pure seams + unit tests → Task 4. ✓
- Deploy from repo source; script include added → Task 5 Step 1 + Step 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `validateAudioPayload`/`decodeBase64`/`pickAudioName` names match between Task 1 (definition), its test, and Task 2 (import). `transcribe({ audio, mime })` matches between Task 3 (datastore) and Task 5 (`_stopVoice` caller). `VoiceCapture.blobToBase64`/`pickMimeType`/`isSupported`/`onAutoStop`/`start`/`stop` match between Task 4 (definition) and Task 5 (callers). Edge fn returns `{ ok, text }`; Task 3 reads `data.text`; Task 5 reads `res.text`. ✓
