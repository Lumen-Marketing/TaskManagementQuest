// supabase/functions/checkins/lib/schedule.mjs
// Pure HQ-time scheduling helpers for the checkins engine. HQ = America/Phoenix,
// fixed UTC-7 (no DST): HQ wall-clock = UTC shifted back 7 hours. No I/O.

export const MODE_HOUR = { morning: 8, eod: 16, stalled: 9 };

// UTC instant -> HQ calendar parts. Subtract 7h, then read UTC fields.
export function hqParts(nowMs) {
  const d = new Date(nowMs - 7 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  return { y, m, d: day, hour: d.getUTCHours(), minute: d.getUTCMinutes(),
    dateKey: `${y}-${pad(m)}-${pad(day)}` };
}

// HQ-Monday of the week containing dateKey (YYYY-MM-DD), via UTC math.
export function weekKey(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  const dow = dt.getUTCDay();             // 0 Sun .. 6 Sat
  const diff = dow === 0 ? -6 : 1 - dow;  // shift back to Monday
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

export function firesNow(mode, nowMs) {
  const hour = MODE_HOUR[mode];
  if (hour == null) return false;
  return hqParts(nowMs).hour === hour;
}
