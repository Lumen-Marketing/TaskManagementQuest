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
    this._autoStop = null;
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
    this._timer = setTimeout(() => { if (this._autoStop) this._autoStop(); }, this.maxMs);
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
