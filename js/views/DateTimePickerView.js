window.App = window.App || {};

/* Shared date/time/reminder picking kit (stream-c owns this component).
   Two pieces:

   - App.timeField — mask/parse/format helpers for free-typed 12-hour times,
     the same grammar the New-task page's Time field established:
     "9" → 09:00, "230p" → 14:30, "10:30" → 10:30, "9 pm" → 21:00.

   - App.reminderPicker — an anchored popover with a real month grid and a
     typeable time input. Replaces the native datetime-local flow, whose
     squeezed segment text overlapped its own calendar icon in narrow field
     cells and only offered click-hunting through the browser dropdown.

   Commit semantics match the detail page's auto-save contract: Enter or
   click-away commits, Escape cancels, Clear commits null. No confirm button. */

App.timeField = {
  /* Live input mask: auto-insert the colon as digits are typed, expand a typed
     "a"/"p" into " AM"/" PM". e.g. "230" → "2:30", "230p" → "2:30 PM". */
  mask(raw) {
    let s = String(raw == null ? '' : raw).toLowerCase();
    let ap = '';
    if (s.includes('p')) ap = ' PM';
    else if (s.includes('a')) ap = ' AM';
    const digits = s.replace(/\D/g, '').slice(0, 4);
    if (!digits) return ap ? digits + ap : '';
    let body;
    if (digits.length <= 2) body = digits;
    else if (digits.length === 3) body = digits.slice(0, 1) + ':' + digits.slice(1);
    else body = digits.slice(0, 2) + ':' + digits.slice(2);
    return body + ap;
  },

  /* Parse a loosely-typed time into strict 24h "HH:MM", or null if unusable.
     A bare hour with no AM/PM is read as business hours: "9" → 09:00,
     "10:30" → 10:30 (13–23 stay 24-hour: "17" → 17:00). */
  parse(raw) {
    let s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!s) return null;
    let ap = null;
    const apMatch = s.match(/\s*([ap])\.?\s*m?\.?$/);
    if (apMatch) { ap = apMatch[1]; s = s.slice(0, apMatch.index).trim(); }
    let h, min = 0;
    if (s.includes(':')) {
      const parts = s.split(':');
      if (parts.length !== 2 || parts[1].length !== 2) return null;
      h = parseInt(parts[0], 10);
      min = parseInt(parts[1], 10);
    } else {
      if (!/^\d+$/.test(s)) return null;
      if (s.length <= 2) { h = parseInt(s, 10); min = 0; }
      else if (s.length === 3) { h = parseInt(s.slice(0, 1), 10); min = parseInt(s.slice(1), 10); }
      else if (s.length === 4) { h = parseInt(s.slice(0, 2), 10); min = parseInt(s.slice(2), 10); }
      else return null;
    }
    if (isNaN(h) || isNaN(min) || min > 59) return null;
    if (ap) {
      if (h < 1 || h > 12) return null;
      if (ap === 'p' && h !== 12) h += 12;
      if (ap === 'a' && h === 12) h = 0;
    } else if (h > 23) {
      return null;
    }
    return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  },

  /* Wire the mask onto a text input. Caller handles commit (blur/Enter). */
  attachMask(input) {
    input.addEventListener('input', () => {
      const formatted = App.timeField.mask(input.value);
      if (formatted !== input.value) {
        input.value = formatted;
        input.setSelectionRange(formatted.length, formatted.length);
      }
    });
  },
};

App.reminderPicker = {
  _el: null,
  _cleanup: null,

  /* "YYYY-MM-DDTHH:MM" → "Jul 8, 9:00 AM" (wall-clock text, no zone math). */
  format(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v || ''));
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  },

  /* Open the popover near `anchor`. onCommit(value|null) fires once, on Enter /
     click-away (value changed) or Clear (null). onCancel fires on Escape or
     click-away with nothing changed. */
  open({ anchor, value = null, onCommit, onCancel }) {
    this.close();

    const initial = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
    const today = new Date();
    const state = {
      date: initial ? `${initial[1]}-${initial[2]}-${initial[3]}` : null,
      time: initial ? `${initial[4]}:${initial[5]}` : null,
      viewY: initial ? +initial[1] : today.getFullYear(),
      viewM: initial ? +initial[2] - 1 : today.getMonth(), // 0-based
    };

    const el = document.createElement('div');
    el.className = 'rp-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Set reminder');
    document.body.appendChild(el);
    this._el = el;

    let settled = false;
    const settle = (fn) => { if (settled) return; settled = true; this.close(); fn && fn(); };

    const commit = () => {
      const timeInput = el.querySelector('.rp-time');
      const typed = timeInput ? timeInput.value.trim() : '';
      let time = typed ? App.timeField.parse(typed) : state.time;
      if (typed && !time) {
        // Unreadable time — keep the popover open and flag the field.
        if (timeInput) {
          timeInput.setAttribute('aria-invalid', 'true');
          timeInput.classList.add('rp-time-bad');
          timeInput.focus();
        }
        return;
      }
      let date = state.date;
      if (!date && time) date = App.utils.toISODate(new Date()); // time typed alone → today
      if (!date) { settle(onCancel); return; } // nothing chosen
      if (!time) time = '09:00'; // date picked alone → a sane morning default
      const next = `${date}T${time}`;
      if (next === (value || null)) { settle(onCancel); return; }
      settle(() => onCommit && onCommit(next));
    };

    const render = () => {
      const y = state.viewY, m = state.viewM;
      const monthName = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const firstDow = new Date(y, m, 1).getDay();
      const daysIn = new Date(y, m + 1, 0).getDate();
      const todayIso = App.utils.toISODate(new Date());
      let cells = '';
      for (let i = 0; i < firstDow; i++) cells += '<span class="rp-day rp-day-pad" aria-hidden="true"></span>';
      for (let d = 1; d <= daysIn; d++) {
        const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cls = ['rp-day'];
        if (iso === todayIso) cls.push('is-today');
        if (iso === state.date) cls.push('is-selected');
        cells += `<button type="button" class="${cls.join(' ')}" data-date="${iso}">${d}</button>`;
      }
      el.innerHTML = `
        <div class="rp-head">
          <button type="button" class="rp-nav" data-nav="-1" aria-label="Previous month"><i class="ti ti-chevron-left"></i></button>
          <span class="rp-month">${App.utils.escapeHtml(monthName)}</span>
          <button type="button" class="rp-nav" data-nav="1" aria-label="Next month"><i class="ti ti-chevron-right"></i></button>
        </div>
        <div class="rp-dow" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
        <div class="rp-grid">${cells}</div>
        <div class="rp-timerow">
          <i class="ti ti-clock" aria-hidden="true"></i>
          <input type="text" class="rp-time" inputmode="text" autocomplete="off" spellcheck="false"
                 placeholder="9:00 AM" aria-label="Reminder time"
                 value="${state.time ? App.utils.escapeHtml(App.utils.formatClock(state.time)) : ''}" />
        </div>
        <div class="rp-foot">
          <button type="button" class="rp-clear">Clear reminder</button>
          <span class="rp-hint">Enter saves</span>
        </div>`;

      el.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = new Date(state.viewY, state.viewM + Number(b.dataset.nav), 1);
        state.viewY = d.getFullYear(); state.viewM = d.getMonth();
        render();
      }));
      el.querySelectorAll('.rp-day[data-date]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        state.date = b.dataset.date;
        // Snapshot any half-typed time before the re-render replaces the input.
        const ti = el.querySelector('.rp-time');
        if (ti && ti.value.trim()) {
          const parsed = App.timeField.parse(ti.value);
          if (parsed) state.time = parsed;
        }
        render();
      }));
      const timeInput = el.querySelector('.rp-time');
      App.timeField.attachMask(timeInput);
      timeInput.addEventListener('input', () => {
        timeInput.removeAttribute('aria-invalid');
        timeInput.classList.remove('rp-time-bad');
      });
      timeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); settle(onCancel); }
      });
      el.querySelector('.rp-clear').addEventListener('click', (e) => {
        e.stopPropagation();
        settle(() => { if (value) onCommit && onCommit(null); else onCancel && onCancel(); });
      });
    };

    render();

    // Position: below the anchor, clamped to the viewport (fixed, so it works
    // inside any scrolling pane). On very narrow screens it hugs the edges.
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight, pad = 8;
      let left = Math.min(Math.max(pad, r.left), window.innerWidth - w - pad);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - pad) top = Math.max(pad, r.top - h - 6);
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
    };
    place();

    // Click-away commits (auto-save contract); Escape cancels (bound on the
    // popover's inputs above, and document-wide here for day-grid focus).
    const onDocClick = (e) => {
      if (el.contains(e.target) || (anchor && anchor.contains(e.target))) return;
      commit();
      // commit() may keep the popover open on an unreadable time; if it
      // settled, listeners are already gone.
    };
    const onDocKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); settle(onCancel); }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', onDocClick, true);
      document.addEventListener('keydown', onDocKey, true);
    }, 0);
    window.addEventListener('resize', place);
    this._cleanup = () => {
      document.removeEventListener('mousedown', onDocClick, true);
      document.removeEventListener('keydown', onDocKey, true);
      window.removeEventListener('resize', place);
    };

    const ti = el.querySelector('.rp-time');
    if (ti) ti.focus();
  },

  close() {
    if (this._cleanup) { this._cleanup(); this._cleanup = null; }
    if (this._el) { this._el.remove(); this._el = null; }
  },
};
