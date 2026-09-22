/* Due/time quick picks for the mobile task sheet.
   Pure: every date is derived from the ISO day handed in, with UTC arithmetic,
   so a device in another zone can never shift a pick. The caller passes
   App.utils.todayISO(), which already resolves the calendar day in the HQ zone.

   This is deliberately NOT `new Date()` + toISOString: that combination reads a
   day early everywhere west of UTC, which is the bug in the handoff prototype. */
(function () {
  'use strict';
  window.App = window.App || {};
  const TS = (App.TaskSheet = App.TaskSheet || {});

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function parts(iso) {
    const p = String(iso).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }
  function fmtIso(d) {
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }
  function addDays(iso, n) {
    const d = parts(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return fmtIso(d);
  }
  // Strictly the NEXT such weekday: asking for Wednesday on a Wednesday jumps a
  // full week rather than returning today, which matches tokenParser.js.
  function nextDow(iso, dow) {
    const cur = parts(iso).getUTCDay();
    let delta = (dow - cur + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(iso, delta);
  }
  // "Fri, Sep 25" — formatted from the UTC parts, never via toLocaleDateString,
  // which would re-interpret the day in the viewer's zone.
  function dowLabel(iso) {
    const d = parts(iso);
    return DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  function quickPicks(todayIso) {
    const fri = nextDow(todayIso, 5);
    const mon = nextDow(todayIso, 1);
    return [
      { key: 'today',    label: 'Today',       iso: todayIso },
      { key: 'tomorrow', label: 'Tomorrow',    iso: addDays(todayIso, 1) },
      { key: 'fri',      label: dowLabel(fri), iso: fri },
      { key: 'mon',      label: dowLabel(mon), iso: mon },
      { key: 'none',     label: 'No date',     iso: '' },
    ];
  }

  function timePicks() {
    return [
      { key: 'none', label: 'No time',  value: '' },
      { key: 't7',   label: '7:00 AM',  value: '07:00' },
      { key: 't9',   label: '9:00 AM',  value: '09:00' },
      { key: 't12',  label: '12:00 PM', value: '12:00' },
      { key: 't14',  label: '2:00 PM',  value: '14:00' },
      { key: 't16',  label: '4:00 PM',  value: '16:00' },
    ];
  }

  TS.dates = { quickPicks, timePicks, nextDow, addDays, dowLabel };
})();
