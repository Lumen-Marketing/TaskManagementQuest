// js/views/newtask/tokenParser.js
// Pure title token parser for the New-Task screen. No DOM, no App globals — the
// caller injects team/companies/today so it is deterministic and unit-testable.
(function (root) {
  var PRI = { c: 'critical', u: 'urgent', h: 'high', m: 'medium', l: 'low' };
  var DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  function iso(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function addDays(todayIso, n) {
    var p = todayIso.split('-');
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    dt.setUTCDate(dt.getUTCDate() + n);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  function nextDow(todayIso, dow) {
    var p = todayIso.split('-');
    var cur = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    var delta = (dow - cur + 7) % 7; if (delta === 0) delta = 7; // strictly next
    return addDays(todayIso, delta);
  }
  // Exactly one match across id + display name (prefix, case-insensitive). Else null.
  function uniquePrefix(list, frag, keyName) {
    var f = frag.toLowerCase();
    var hits = list.filter(function (x) {
      return x.id.toLowerCase().indexOf(f) === 0 || String(x[keyName]).toLowerCase().indexOf(f) === 0;
    });
    return hits.length === 1 ? hits[0] : null;
  }

  function parseTaskTitle(text, ctx) {
    ctx = ctx || {};
    var team = ctx.team || [], companies = ctx.companies || [], today = ctx.today, atEnd = !!ctx.atEnd;
    var patches = {}, hits = [], addWhos = [];
    var out = [];
    // Walk tokens. A token resolves only when a trailing boundary follows it:
    // whitespace anywhere, or end-of-string when atEnd. Survivors rebuild the title
    // so resolved tokens are removed.
    var re = /(\S+)(\s+|$)/g, m;
    while ((m = re.exec(text)) !== null) {
      var tok = m[1], trailing = m[2];
      var boundary = /\s/.test(trailing) || (trailing === '' && atEnd);
      var resolved = boundary ? tryToken(tok) : false;
      if (!resolved) out.push(tok + (trailing || ''));
    }
    function tryToken(tok) {
      var c0 = tok[0], rest = tok.slice(1);
      if (c0 === '@' && rest) {
        var p = uniquePrefix(team, rest, 'name');
        if (p && addWhos.indexOf(p.id) === -1) { addWhos.push(p.id); hits.push({ kind: 'assignee', label: p.name }); return true; }
        return false;
      }
      if (c0 === '#' && rest) {
        var co = uniquePrefix(companies, rest, 'label');
        if (co) { patches.company = co.id; hits.push({ kind: 'company', label: co.label }); return true; }
        return false;
      }
      if (c0 === '!' && rest) {
        var pk = PRI[rest[0].toLowerCase()];
        if (pk) { patches.pri = pk; hits.push({ kind: 'pri', label: pk }); return true; }
        return false;
      }
      var low = tok.toLowerCase();
      if (low === 'tmrw' || low === 'tomorrow') { patches.date = addDays(today, 1); hits.push({ kind: 'date', label: 'tomorrow' }); return true; }
      if (low === 'today') { patches.date = today; hits.push({ kind: 'date', label: 'today' }); return true; }
      var dm = low.match(/^(sun|mon|tue|wed|thu|fri|sat)(day|nesday|rsday|urday)?$/);
      if (dm && DOW[dm[1]] !== undefined) { patches.date = nextDow(today, DOW[dm[1]]); hits.push({ kind: 'date', label: dm[1] }); return true; }
      var tm = low.match(/^(\d{1,2})(:(\d{2}))?(a|am|p|pm)$/);
      if (tm) {
        var h = parseInt(tm[1], 10), min = tm[3] ? parseInt(tm[3], 10) : 0, ap = tm[4][0];
        if (h >= 1 && h <= 12 && min <= 59) {
          if (ap === 'p' && h !== 12) h += 12;
          if (ap === 'a' && h === 12) h = 0;
          patches.time = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
          hits.push({ kind: 'time', label: patches.time }); return true;
        }
      }
      return false;
    }
    if (addWhos.length) patches.addWhos = addWhos;
    var cleanTitle = out.join('').replace(/\s+/g, ' ').trim();
    return { cleanTitle: cleanTitle, patches: patches, hits: hits };
  }

  var api = { parseTaskTitle: parseTaskTitle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.App = root.App || {};
  root.App.parseTaskTitle = parseTaskTitle;
})(typeof window !== 'undefined' ? window : globalThis);
