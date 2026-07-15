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
