// js/views/newtask/WorkOrderRail.js
// Pure render of the dark work-order ticket. No DOM reads; the view passes a
// plain model and swaps innerHTML. Styling is all class-driven (see the
// #newTaskWrap.wo-mode CSS); this only emits structure + text.
(function (root) {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var TICK_KEYS = ['co', 'who', 'pri', 'due', 'rem', 'lab', 'proj', 'sub', 'wat'];

  function qh(n) { return (n === null || n === undefined) ? '—' : 'QH-' + String(n).padStart(4, '0'); }

  function line(k, label, valueHtml, show) {
    return '<div class="wo-line" data-k="' + k + '"' + (show ? '' : ' style="display:none"') +
      '><span class="k">' + label + '</span><span class="v">' + valueHtml + '</span></div>';
  }

  function render(m) {
    m = m || {};
    var a = m.assignees || [];
    var avatars = a.map(function (p) {
      return '<span class="wo-mini" style="--sw:' + esc(p.color) + '">' + esc(p.init) + '</span>';
    }).join('');
    var names = a.map(function (p) { return esc(p.name); }).join(', ');
    var due = m.due ? (esc(m.due) + (m.time ? ' · ' + esc(m.time) : '')) : '<span class="dim">—</span>';
    var ready = m.ready || {};
    var rline = function (r, label) {
      return '<div class="rline' + (ready[r] ? ' ok' : '') + '" data-r="' + r + '">' +
        '<span class="rdot">' + (ready[r] ? '✓' : '') + '</span>' + label + '</div>';
    };
    var ch = m.channels || {};
    var isHigh = !!(m.priority && m.priority.key === 'high');
    var dtag = function (chk, label, on, locked) {
      return '<span class="dtag' + (on ? ' on' : '') + (locked ? ' locked' : '') + '" data-ch="' + chk + '">' + label + '</span>';
    };
    var titleEmpty = !m.title;
    return '' +
      '<div class="wo' + (m.dispatched ? ' dispatched' : '') + '">' +
        '<div class="wo-stamp"><span>DISPATCHED</span></div>' +
        '<div class="wo-top"><div class="wo-brand"><div class="wo-mark">Q</div>' +
          '<div><b>Quest HQ</b><small>WORK ORDER</small></div></div>' +
          '<div class="wo-no"><div class="lbl">NO.</div><div class="v">' + qh(m.woNumber) + '</div></div></div>' +
        '<div class="wo-title' + (titleEmpty ? ' empty' : '') + '">' + (titleEmpty ? 'Untitled task' : esc(m.title)) + '</div>' +
        '<hr class="wo-rule">' +
        line('co', 'COMPANY', '<span class="wo-sw" style="--sw:' + esc(m.company && m.company.color) + '"></span>' + esc(m.company && m.company.label), true) +
        line('who', 'ASSIGNED', a.length ? (avatars + names) : '<span class="dim">—</span>', true) +
        line('pri', 'PRIORITY', '<span class="' + (isHigh ? 'hi' : '') + '">' + esc((m.priority && m.priority.label || '').toUpperCase()) + '</span>', true) +
        line('due', 'DUE', due, true) +
        line('rem', 'REMINDER', esc((m.reminderText || '').toUpperCase()), true) +
        line('lab', 'LABEL', esc(m.label || ''), !!m.label) +
        line('proj', 'PROJECT', esc(m.project || ''), !!m.project) +
        line('sub', 'CHECKLIST', (m.subtaskCount || 0) + ' STEPS', (m.subtaskCount || 0) > 0) +
        line('wat', 'WATCHERS', (m.watchers || []).map(esc).join(', ').toUpperCase(), (m.watchers || []).length > 0) +
        '<hr class="wo-rule">' +
        '<div class="wo-dispatch"><div class="dh">DISPATCH VIA</div><div class="dtags">' +
          dtag('email', 'EMAIL', ch.email, false) +
          dtag('inapp', 'IN-APP', ch.inapp, false) +
          dtag('watchers', 'CC WATCHERS', ch.watchers, false) +
          dtag('wa', isHigh ? 'WHATSAPP' : 'WHATSAPP · HIGH ONLY', ch.wa, !isHigh) +
        '</div></div>' +
        '<div class="wo-ready">' + rline('title', 'Title') + rline('who', 'Assignee') + rline('due', 'Due date') + '</div>' +
      '</div>';
  }

  var api = { render: render, tickKeys: TICK_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.App = root.App || {};
  root.App.WorkOrderRail = api;
})(typeof window !== 'undefined' ? window : globalThis);
