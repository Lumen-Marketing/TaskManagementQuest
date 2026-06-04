window.App = window.App || {};

App.utils = {
  initials(name) {
    return String(name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  },

  /* Returns a self-contained <span class="avatar-xs ..."> element for
     the given person. Prefers the uploaded avatar_url over the colored
     initials fallback. Pass `extraClass` to merge additional classes
     onto the span (defaults to none). All callers should use this in
     place of hand-rolled `<span class="avatar-xs" style="background:
     ${color}">${initials}</span>` so uploaded photos appear everywhere
     the same way. */
  avatarHtml(person, extraClass = '') {
    const cls = `avatar-xs${extraClass ? ' ' + extraClass : ''}`;
    if (!person) {
      return `<span class="${cls}" style="background:var(--ink-3);">?</span>`;
    }
    if (person.avatar_url) {
      // avatar_url is escaped to be safe inside an attribute even if
      // the migration-022 CHECK constraint were ever bypassed.
      return `<span class="${cls}" style="background:transparent; padding:0;"><img src="${App.utils.escapeHtml(person.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" /></span>`;
    }
    const bg = person.color ? App.utils.safeColor(person.color) : 'var(--ink-3)';
    return `<span class="${cls}" style="background:${bg};">${App.utils.initials(person.full || person.name || '')}</span>`;
  },

  /* A minimal stand-in for someone who has tracked time but isn't in
     App.PEOPLE (left the roster, demo seed, or the current developer account).
     Centralises the synthesized shape so every board agrees on the fields —
     notably `id`, which earlier hand-rolled copies sometimes omitted, breaking
     any later totalForUser(p.id, ...) call. */
  unknownPerson(id) {
    return { id, name: id, full: id, color: '#E8A03A' };
  },

  /* The set of people to show on a team time board: the approved roster
     (activePeople) unioned with anyone who has actual activity in the window —
     a live timer now, or a completed entry since `sinceMs` — so their hours
     always surface even if they're not on the (company-scoped, approval-
     filtered) roster. People with activity but absent from App.PEOPLE are
     synthesized via unknownPerson() so they still appear and count.

     Shared by TimeView.renderResource and ClockDashboardView.render; keep the
     union semantics here so the two boards can't drift. */
  rosterWithActivity(timeModel, sinceMs) {
    const activityIds = new Set();
    timeModel.allActive().forEach(t => activityIds.add(t.userId));
    timeModel.entries.forEach(e => { if (e.start >= sinceMs) activityIds.add(e.userId); });
    const roster = App.utils.activePeople([...activityIds]);
    const rosterIds = new Set(roster.map(p => p.id));
    const orphans = [...activityIds]
      .filter(id => !rosterIds.has(id))
      .map(id => App.PEOPLE[id] || App.utils.unknownPerson(id));
    return [...roster, ...orphans];
  },

  /* People eligible to appear in assignment pickers and team dashboards:
     team_members (App.PEOPLE) that are backed by an approved profile.

     The roster accumulates rows that no longer map to a login — leftover
     demo seeds and members whose profile was deleted from Approvals (their
     team_members row is kept so historical tasks don't break). Those
     shouldn't show up as assignable people, which is why the picker and
     the clock dashboard otherwise drift from the Approvals list.

     Falls back to the full roster when profiles aren't loaded (non-manager
     sessions don't fetch them) so a picker never renders empty. Pass
     `includeIds` (e.g. a task's current assignee) to keep an existing
     selection visible even if it's no longer backed by a profile. */
  activePeople(includeIds) {
    const all = Object.values(App.PEOPLE || {});
    const profiles = App.PROFILES || [];
    if (!profiles.length) return all;
    const allowed = new Set(
      profiles.filter(p => p.approved !== false && p.member_id).map(p => p.member_id)
    );
    const keep = Array.isArray(includeIds) ? includeIds : (includeIds ? [includeIds] : []);
    keep.forEach(id => { if (id) allowed.add(id); });
    const list = all.filter(p => allowed.has(p.id));
    return list.length ? list : all;
  },

  /* Active people who belong to a given company, for company-scoped pickers
     (e.g. assignee/watcher lists in the New task modal). Builds on
     activePeople() and intersects with profiles whose company_ids include the
     company. Falls back to activePeople() when profiles aren't loaded
     (non-manager sessions) so the picker never renders empty. Pass includeIds
     to keep an existing selection visible. */
  peopleInCompany(companyId, includeIds) {
    const base = this.activePeople(includeIds);
    const profiles = App.PROFILES || [];
    if (!companyId || !profiles.length) return base;
    const inCompany = new Set(
      profiles
        .filter(p => p.member_id && Array.isArray(p.company_ids) && p.company_ids.includes(companyId))
        .map(p => p.member_id)
    );
    const keep = Array.isArray(includeIds) ? includeIds : (includeIds ? [includeIds] : []);
    keep.forEach(id => { if (id) inCompany.add(id); });
    const list = base.filter(p => inCompany.has(p.id));
    return list.length ? list : base;
  },

  todayISO(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  formatDuration(ms) {
    if (!ms || ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  },

  formatHours(ms) {
    const hours = (ms || 0) / (60 * 60 * 1000);
    if (hours < 0.1) return '0h';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    return `${hours.toFixed(1)}h`;
  },

  timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  },

  formatDue(iso) {
    const t0 = App.utils.todayISO(0);
    const t1 = App.utils.todayISO(1);
    if (iso === t0) return { text: 'Today', cls: 'due-today' };
    if (iso === t1) return { text: 'Tomorrow', cls: '' };
    const d = new Date(iso);
    if (iso < t0) {
      return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: 'due-overdue' };
    }
    return { text: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: '' };
  },

  formatClock(hhmm) {
    if (!hhmm) return '';
    const parts = String(hhmm).split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1] || 0);
    if (Number.isNaN(h)) return '';
    const period = h >= 12 ? 'PM' : 'AM';
    const hr = ((h + 11) % 12) + 1;
    return `${hr}:${String(m).padStart(2, '0')} ${period}`;
  },

  escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  // Allowlist sanitizer for the notification html column. Legit notifications
  // are built by AppController as "<strong>name</strong> reassigned <em>task</em> ..."
  // so we keep <strong>/<em>/<b>/<i> with no attributes and escape everything
  // else as text. The DB also has a CHECK constraint blocking <script> /
  // javascript: / on*= patterns — this is the render-side belt-and-braces.
  sanitizeNotificationHtml(s) {
    const allowed = new Set(['STRONG', 'EM', 'B', 'I']);
    const doc = new DOMParser().parseFromString(String(s == null ? '' : s), 'text/html');
    const walk = (node) => {
      let out = '';
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          out += App.utils.escapeHtml(child.nodeValue);
        } else if (child.nodeType === 1 && allowed.has(child.tagName)) {
          const tag = child.tagName.toLowerCase();
          out += `<${tag}>${walk(child)}</${tag}>`;
        } else if (child.nodeType === 1) {
          out += walk(child);
        }
      });
      return out;
    };
    return walk(doc.body);
  },

  // Return color only if it's a 3- or 6-digit hex literal; otherwise fall back
  // to the amber accent. Used wherever a user-controlled color value is
  // interpolated into a style="..." attribute. (The DB constraint on
  // team_members.color is the primary defense; this stops a stale row or
  // a hand-edited App.PEOPLE entry from breaking out of the attribute.)
  safeColor(c) {
    return /^#([0-9A-Fa-f]{3}){1,2}$/.test(String(c || '')) ? c : '#E8A03A';
  },

  uid(prefix = '') {
    return prefix + Date.now() + Math.random().toString(36).slice(2, 6);
  },
};
