# Voice → Task (speech input on the New Task page)

**Date:** 2026-07-16
**Status:** Approved design, ready for implementation plan

## Problem

The New Task page already turns a typed sentence ("assign the logo redesign to
abraham for lumen, high priority, due friday") into filled fields via the
`draft_task` action on the `ai-assistant` edge function. There is no way to
*speak* a task. The goal is to let a user dictate the task title and have the
same auto-fill happen — hands-free capture that reuses the entire existing
draft pipeline.

## Non-goals / constraints

- **Do NOT use the browser `SpeechRecognition` API.** Transcription runs
  server-side through Groq so the behaviour is consistent across browsers and
  the key never leaves the server (same posture as every other AI action).
- No new provider or key: reuse the existing `GROQ_API_KEY` and
  `api.groq.com`. Model: `whisper-large-v3-turbo` (Groq audio transcription
  endpoint `/openai/v1/audio/transcriptions`).
- No changes to `draft_task` itself — voice feeds it unchanged.
- Voice is additive: typing must keep working exactly as today, and the mic
  never blocks the title input.

## User flow

1. On the New Task page, the title box shows a mic button **only if the browser
   supports `navigator.mediaDevices.getUserMedia` and `window.MediaRecorder`**.
   Otherwise it is not rendered (no fallback, no error).
2. The user **presses and holds** the mic (walkie-talkie style). On press,
   `MediaRecorder` starts capturing; the button shows a recording state.
3. On **release**, recording stops. The clip is base64-encoded and sent to the
   `transcribe` action.
4. The returned transcript text is written into `#nt-title` (replacing current
   title text — the mic is a "dictate the title" affordance).
5. Writing the title runs the same path as typing: `_applyParse(false)`,
   `_scheduleDraft()`, `sync()`. So `@ # ! date` tokens parse, and the debounced
   `draft_task` fires and fills fields with the ✨ AI markers, which the user
   can then edit.
6. Any failure (permission denied, unsupported, empty transcript, provider
   error) surfaces a short message in the existing `#nt-flash` line and leaves
   the title untouched. Typing is never blocked.

## Guards

- **Recording length:** hard cap ~60 s (auto-stop). Bounds payload size and
  Groq cost.
- **Payload size:** the existing `MAX_PAYLOAD_BYTES = 32 * 1024` stays for the
  text actions. `transcribe` gets its own larger cap (~5 MB) checked before
  decoding, so a 60 s Opus/webm clip (base64-inflated) fits with margin.
- **Daily cap:** per-user, per-UTC-day in-memory counter mirroring the other
  actions (`TRANSCRIBE_DAILY_CAP`, e.g. 60). Best-effort, resets on cold start.
- **Auth:** reuse the existing approved-caller gate at the top of the handler —
  no new authz.

## Architecture

### 1. Edge function — new `transcribe` branch

File: `supabase/functions/ai-assistant/index.ts`.

- Add `"transcribe"` to the allowed-action check.
- Because the audio payload can exceed 32 KB, the payload-size guard must not
  reject `transcribe` before its branch runs. Approach: read the raw body, and
  only enforce the 32 KB cap for the non-transcribe actions; the transcribe
  branch enforces its own ~5 MB cap. (The action is discoverable by a cheap
  `raw.includes('"transcribe"')`/JSON parse before the size gate, or by moving
  the generic 32 KB check to the text branches. Implementation plan picks the
  cleanest seam; the requirement is: 32 KB stays for text actions, transcribe
  allows ~5 MB.)
- Branch logic:
  1. Daily-cap check + increment (mirror `draftUsage`).
  2. Parse `{ audio: <base64 string>, mime: <string> }`. Enforce ~5 MB on the
     base64 length. Reject empty.
  3. Decode base64 → `Uint8Array`.
  4. Build `FormData`: `file` = a `Blob([bytes], { type: mime })` named e.g.
     `audio.webm`, `model` = `"whisper-large-v3-turbo"`,
     `response_format` = `"json"`, optionally `temperature=0`.
  5. `fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method:
     "POST", headers: { Authorization: Bearer ${groqKey} }, body: form })`.
     (No `Content-Type` header — let `fetch` set the multipart boundary.)
  6. On success return `{ ok: true, text: data.text || "" }`. On provider error
     or thrown fetch, log and return `{ ok: false, error: "..." }` with an
     appropriate status. Never throw past the outer try/catch.
- Add a `GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo"` constant next to the
  existing provider-seam constants so the provider swap stays in one place.

### 2. Client datastore seam

File: `js/services/SupabaseDataStore.js`.

Add `async transcribe({ audio, mime })` mirroring `draftTask`: invoke
`ai-assistant` with `{ action: 'transcribe', audio, mime }`, return
`{ ok, text?, error? }`, never throw.

### 3. VoiceCapture helper

New file: `js/services/VoiceCapture.js`, `App.VoiceCapture`. Keeps all
MediaRecorder glue out of the view and exposes pure, unit-testable seams:

- `static isSupported()` → boolean (`mediaDevices?.getUserMedia` &&
  `window.MediaRecorder`).
- `static blobToBase64(blob)` → Promise<string> (strips the `data:` prefix).
  Pure enough to unit-test with a fake blob/FileReader.
- instance `start()` → requests the mic, starts recording, begins the ~60 s
  auto-stop timer.
- instance `stop()` → Promise<{ blob, mime }> resolving when the recorder
  flushes; stops the mic tracks.
- Picks a supported mime type via `MediaRecorder.isTypeSupported` preferring
  `audio/webm;codecs=opus`, falling back to `audio/mp4` (Safari) or default.

### 4. View wiring

File: `js/views/NewTaskPageView.js` (+ `css/newtask.css`).

- Render the mic button inside `.nt-titlebox` (after `#nt-title`) only when
  `App.VoiceCapture?.isSupported()`.
- Press/hold handlers using pointer events (`pointerdown`/`pointerup`/
  `pointercancel`, plus `pointerleave`) so it works on desktop and touch;
  `touch-action: none` on the button to avoid scroll/gesture interference.
  `preventDefault` to keep hold from stealing input focus/selection.
- On press: `VoiceCapture.start()`; add a recording CSS class + `aria-pressed`.
- On release/cancel/timeout: `stop()` → `blobToBase64` → `dataStore.transcribe`
  → on `ok` write `text` to `#nt-title.value`, then `_applyParse(false)`,
  `_scheduleDraft()`, `sync()`. On failure set `#nt-flash` text.
- Guard against re-entrancy (ignore press while already recording/transcribing);
  show a "Transcribing…" state on the button while awaiting the fn.

## Error handling

| Case | Behaviour |
|------|-----------|
| Browser unsupported | Mic button not rendered. |
| Mic permission denied | `#nt-flash`: "Microphone access was blocked." Title untouched. |
| Recording too short / empty transcript | `#nt-flash`: "Didn't catch that — try again." |
| Provider / network error | `#nt-flash`: "Voice is unavailable right now." |
| Daily cap hit (429) | `#nt-flash`: fn's message. |

In every failure case, typing continues to work and the auto-draft still fires
on typed input.

## Testing

- **Unit (`tests/unit/`):**
  - `VoiceCapture.isSupported()` returns false when globals absent.
  - `VoiceCapture.blobToBase64` strips the data-URL prefix (fake FileReader).
  - Optionally a small pure helper for choosing the mime type given a fake
    `MediaRecorder.isTypeSupported`.
- **Edge fn:** if a testable seam is extracted (e.g. a `buildTranscribeForm` or
  base64-decode helper in `lib/`), unit-test it like `lib/draft.mjs`. The Groq
  call itself is integration-only.
- **Manual:** real mic on desktop Chrome + mobile Safari — hold, speak a task
  sentence, confirm title fills and fields auto-draft with ✨ markers; confirm
  permission-denied and unsupported paths degrade quietly.

## Deploy

- Deploy the edge function **from repo source** via Supabase MCP
  `deploy_edge_function` (the paste bundle is dead — see AI assistant program
  memory). No new secret required (`GROQ_API_KEY` already set).
- Client is static: ships to Vercel on push to `main`. `VoiceCapture.js` must be
  added to the script includes (same place the other `js/services/*.js` load).
