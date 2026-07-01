window.App = window.App || {};

/* Solar (bold-duotone) icon bodies, inlined so they theme via currentColor in
   light + dark with no runtime dependency. 24×24 viewBox; the secondary layer
   rides an opacity for the duotone read. Swap a glyph by replacing its body. */
const HOME_ICONS = {
  inbox: `<path fill="currentColor" d="M1 12c0-5.185 0-7.778 1.61-9.39C4.223 1 6.816 1 12 1s7.778 0 9.39 1.61C23 4.223 23 6.816 23 12s0 7.778-1.61 9.39C19.777 23 17.184 23 12 23s-7.778 0-9.39-1.61C1 19.777 1 17.184 1 12" opacity=".5"/><path fill="currentColor" d="M2.61 21.389c1.612 1.61 4.205 1.61 9.39 1.61s7.778 0 9.39-1.61c1.492-1.493 1.601-3.829 1.61-8.29h-3.476c-.996 0-1.494 0-1.931.202c-.438.201-.762.58-1.41 1.335l-.666.777c-.648.756-.972 1.134-1.41 1.335s-.935.202-1.93.202h-.353c-.996 0-1.494 0-1.931-.202c-.438-.2-.762-.579-1.41-1.335l-.666-.777c-.648-.756-.972-1.134-1.41-1.335s-.935-.201-1.93-.201H1c.008 4.46.118 6.796 1.61 8.289"/>`,
  calendar: `<path fill="currentColor" d="M6.94 2c.416 0 .753.324.753.724v1.46c.668-.012 1.417-.012 2.26-.012h4.015c.842 0 1.591 0 2.259.013v-1.46c0-.4.337-.725.753-.725s.753.324.753.724V4.25c1.445.111 2.394.384 3.09 1.055c.698.67.982 1.582 1.097 2.972L22 9H2v-.724c.116-1.39.4-2.302 1.097-2.972s1.645-.944 3.09-1.055V2.724c0-.4.337-.724.753-.724"/><path fill="currentColor" d="M22 14v-2c0-.839-.004-2.335-.017-3H2.01c-.013.665-.01 2.161-.01 3v2c0 3.771 0 5.657 1.172 6.828S6.228 22 10 22h4c3.77 0 5.656 0 6.828-1.172S22 17.772 22 14" opacity=".5"/><path fill="currentColor" d="M18 17a1 1 0 1 1-2 0a1 1 0 0 1 2 0m0-4a1 1 0 1 1-2 0a1 1 0 0 1 2 0m-5 4a1 1 0 1 1-2 0a1 1 0 0 1 2 0m0-4a1 1 0 1 1-2 0a1 1 0 0 1 2 0m-5 4a1 1 0 1 1-2 0a1 1 0 0 1 2 0m0-4a1 1 0 1 1-2 0a1 1 0 0 1 2 0"/>`,
  fire: `<path fill="currentColor" d="M12.832 21.801c3.126-.626 7.168-2.875 7.168-8.69c0-5.291-3.873-8.815-6.658-10.434c-.619-.36-1.342.113-1.342.828v1.828c0 1.442-.606 4.074-2.29 5.169c-.86.559-1.79-.278-1.894-1.298l-.086-.838c-.1-.974-1.092-1.565-1.87-.971C4.461 8.46 3 10.33 3 13.11C3 20.221 8.289 22 10.933 22q.232 0 .484-.015c.446-.056 0 .099 1.415-.185" opacity=".5"/><path fill="currentColor" d="M8 18.444c0 2.62 2.111 3.43 3.417 3.542c.446-.056 0 .099 1.415-.185C13.871 21.434 15 20.492 15 18.444c0-1.297-.819-2.098-1.46-2.473c-.196-.115-.424.03-.441.256c-.056.718-.746 1.29-1.215.744c-.415-.482-.59-1.187-.59-1.638v-.59c0-.354-.357-.59-.663-.408C9.495 15.008 8 16.395 8 18.445"/>`,
  done: `<path fill="currentColor" d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10" opacity=".5"/><path fill="currentColor" d="M16.03 8.97a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 1 1 1.06-1.06l1.47 1.47l2.235-2.235L14.97 8.97a.75.75 0 0 1 1.06 0"/>`,
  layers: `<path fill="currentColor" d="M4.979 9.685C2.993 8.891 2 8.494 2 8s.993-.89 2.979-1.685l2.808-1.123C9.773 4.397 10.767 4 12 4s2.227.397 4.213 1.192l2.808 1.123C21.007 7.109 22 7.506 22 8s-.993.89-2.979 1.685l-2.808 1.124C14.227 11.603 13.233 12 12 12s-2.227-.397-4.213-1.191z"/><path fill="currentColor" fill-rule="evenodd" d="M2 8c0 .494.993.89 2.979 1.685l2.808 1.124C9.773 11.603 10.767 12 12 12s2.227-.397 4.213-1.191l2.808-1.124C21.007 8.891 22 8.494 22 8s-.993-.89-2.979-1.685l-2.808-1.123C14.227 4.397 13.233 4 12 4s-2.227.397-4.213 1.192L4.98 6.315C2.993 7.109 2 7.506 2 8" clip-rule="evenodd"/><path fill="currentColor" d="m5.766 10l-.787.315C2.993 11.109 2 11.507 2 12s.993.89 2.979 1.685l2.808 1.124C9.773 15.603 10.767 16 12 16s2.227-.397 4.213-1.191l2.808-1.124C21.007 12.891 22 12.493 22 12s-.993-.89-2.979-1.685L18.234 10l-2.021.809C14.227 11.603 13.233 12 12 12s-2.227-.397-4.213-1.191z" opacity=".7"/><path fill="currentColor" d="m5.766 14l-.787.315C2.993 15.109 2 15.507 2 16s.993.89 2.979 1.685l2.808 1.124C9.773 19.603 10.767 20 12 20s2.227-.397 4.213-1.192l2.808-1.123C21.007 16.891 22 16.494 22 16c0-.493-.993-.89-2.979-1.685L18.234 14l-2.021.809C14.227 15.603 13.233 16 12 16s-2.227-.397-4.213-1.191z" opacity=".4"/>`,
  donut: `<path fill="currentColor" fill-rule="evenodd" d="M14 20.5V4.25c0-.728-.002-1.2-.048-1.546c-.044-.325-.115-.427-.172-.484s-.159-.128-.484-.172C12.949 2.002 12.478 2 11.75 2s-1.2.002-1.546.048c-.325.044-.427.115-.484.172s-.128.159-.172.484c-.046.347-.048.818-.048 1.546V20.5z" clip-rule="evenodd"/><path fill="currentColor" d="M8 8.75A.75.75 0 0 0 7.25 8h-3a.75.75 0 0 0-.75.75V20.5H8zm12 5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75v6.75H20z" opacity=".7"/><path fill="currentColor" d="M1.75 20.5a.75.75 0 0 0 0 1.5h20a.75.75 0 0 0 0-1.5z" opacity=".5"/>`,
  warning: `<path fill="currentColor" d="M12 3c-2.31 0-3.77 2.587-6.688 7.762l-.364.644c-2.425 4.3-3.638 6.45-2.542 8.022S6.214 21 11.636 21h.728c5.422 0 8.134 0 9.23-1.572s-.117-3.722-2.542-8.022l-.364-.645C15.77 5.587 14.311 3 12 3" opacity=".5"/><path fill="currentColor" d="M12 7.25a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0V8a.75.75 0 0 1 .75-.75M12 17a1 1 0 1 0 0-2a1 1 0 0 0 0 2"/>`,
  activity: `<path fill="currentColor" d="M2 12c0-4.714 0-7.071 1.464-8.536C4.93 2 7.286 2 12 2s7.071 0 8.535 1.464C22 4.93 22 7.286 22 12s0 7.071-1.465 8.535C19.072 22 16.714 22 12 22s-7.071 0-8.536-1.465C2 19.072 2 16.714 2 12" opacity=".5"/><path fill="currentColor" d="M15.1 12.094c-.185-.302-.366-.597-.542-.807c-.187-.224-.515-.532-1.017-.512s-.804.353-.973.591c-.159.225-.315.532-.475.848l-1.988 3.92q-.11.22-.193.377l-.238-.351l-.176-.266a11 11 0 0 0-.557-.788a2.2 2.2 0 0 0-.682-.59a2.2 2.2 0 0 0-.87-.24a11 11 0 0 0-.964-.026H5a.75.75 0 1 0 0 1.5h1.394c.407 0 .661 0 .856.019c.18.017.254.044.301.07c.047.025.111.07.225.211c.123.152.265.363.49.702l.187.279c.188.283.373.56.553.759c.192.213.522.497 1.01.468c.486-.029.78-.35.947-.584c.154-.219.305-.517.459-.82l1.987-3.918q.117-.23.203-.395q.1.158.233.377l.654 1.068c.2.327.378.616.55.844c.186.247.399.469.692.633s.593.23.901.26c.284.027.623.027 1.006.027H19a.75.75 0 0 0 0-1.5h-1.32c-.424 0-.69 0-.894-.02c-.188-.019-.264-.049-.312-.076c-.049-.027-.114-.076-.227-.227a11 11 0 0 1-.485-.752z"/>`,
  pause: `<path fill="currentColor" d="M2 6c0-1.886 0-2.828.586-3.414S4.114 2 6 2s2.828 0 3.414.586S10 4.114 10 6v12c0 1.886 0 2.828-.586 3.414S7.886 22 6 22s-2.828 0-3.414-.586S2 19.886 2 18z"/><path fill="currentColor" d="M14 6c0-1.886 0-2.828.586-3.414S16.114 2 18 2s2.828 0 3.414.586S22 4.114 22 6v12c0 1.886 0 2.828-.586 3.414S19.886 22 18 22s-2.828 0-3.414-.586S14 19.886 14 18z" opacity=".5"/>`,
  date: `<path fill="currentColor" d="M6.96 2c.418 0 .756.31.756.692V4.09c.67-.012 1.422-.012 2.268-.012h4.032c.846 0 1.597 0 2.268.012V2.692c0-.382.338-.692.756-.692s.756.31.756.692V4.15c1.45.106 2.403.368 3.103 1.008c.7.641.985 1.513 1.101 2.842v1H2V8c.116-1.329.401-2.2 1.101-2.842c.7-.64 1.652-.902 3.103-1.008V2.692c0-.382.339-.692.756-.692"/><path fill="currentColor" d="M22 14v-2c0-.839-.013-2.335-.026-3H2.006c-.013.665 0 2.161 0 3v2c0 3.771 0 5.657 1.17 6.828C4.349 22 6.234 22 10.004 22h4c3.77 0 5.654 0 6.826-1.172S22 17.771 22 14" opacity=".5"/><path fill="currentColor" fill-rule="evenodd" d="M14 12.25A1.75 1.75 0 0 0 12.25 14v2a1.75 1.75 0 1 0 3.5 0v-2A1.75 1.75 0 0 0 14 12.25m0 1.5a.25.25 0 0 0-.25.25v2a.25.25 0 1 0 .5 0v-2a.25.25 0 0 0-.25-.25" clip-rule="evenodd"/><path fill="currentColor" d="M11.25 13a.75.75 0 0 0-1.28-.53l-1.5 1.5a.75.75 0 0 0 1.06 1.06l.22-.22V17a.75.75 0 0 0 1.5 0z"/>`,
  coffee: `<path fill="currentColor" fill-rule="evenodd" d="M6.977 1.327a.75.75 0 0 1 .175 1.046l-.386.541c.626.474.765 1.364.306 2.007l-.41.576a.75.75 0 0 1-1.222-.871l.386-.542a1.457 1.457 0 0 1-.306-2.007l.411-.575a.75.75 0 0 1 1.046-.175m4 0a.75.75 0 0 1 .175 1.046l-.386.541c.626.474.765 1.364.306 2.007l-.41.576a.75.75 0 1 1-1.222-.871l.386-.542a1.457 1.457 0 0 1-.306-2.007l.411-.575a.75.75 0 0 1 1.046-.175m4 0a.75.75 0 0 1 .175 1.046l-.386.541c.626.474.765 1.364.306 2.007l-.41.576a.75.75 0 1 1-1.222-.871l.386-.542a1.457 1.457 0 0 1-.306-2.007l.411-.575a.75.75 0 0 1 1.046-.175" clip-rule="evenodd" opacity=".5"/><path fill="currentColor" d="M9.613 22h.774c2.66 0 3.991 0 4.856-.81c.67-.626.874-1.564 1.015-3.19H3.742c.14 1.626.344 2.564 1.014 3.19c.865.81 2.196.81 4.856.81" opacity=".5"/><path fill="currentColor" fill-rule="evenodd" d="M3.284 11.266c-.133-2-.2-2.999.393-3.632C4.27 7 5.272 7 7.276 7h5.449c2.003 0 3.005 0 3.598.634c.162.173.275.374.35.616H17a4.75 4.75 0 1 1 0 9.5h-.722l-.02.25H3.742a86 86 0 0 1-.116-1.6zm13.1 4.984H17a3.25 3.25 0 0 0 0-6.5h-.2c-.012.43-.045.93-.084 1.516z" clip-rule="evenodd"/>`,
};

/* HomeView — the personal landing screen (every role). Greeting + quick actions,
   a 4-chip stat strip, an "Up next" card (Focus order then soonest-due), the live
   "At risk" list, and a "Recents" activity feed built from each task's persisted
   activity[]. Renders into #homeWrap when view is 'home'. */
App.HomeView = class HomeView {
  constructor({ controller }) {
    this.controller = controller;
    this.wrap = document.getElementById('homeWrap');
    this.period = 'week';           // trend-card window: 'week' | 'month'
    App.homeView = this;            // handy for tests + debugging
    this.subscribe();
    if (this.visible()) this.render();
  }

  subscribe() {
    const rerender = () => {
      if (this.visible()) this.render();
      else this._rendered = false; // re-arm the entrance reveal for the next visit
    };
    App.EventBus.on('view:changed', rerender);
    App.EventBus.on('tasks:changed', rerender);
    App.EventBus.on('company:changed', rerender);
    App.EventBus.on('people:changed', rerender);
  }

  visible() { return this.wrap && !this.wrap.classList.contains('hidden'); }

  _firstName() {
    const p = App.currentProfile || {};
    const full = p.full_name || (App.PEOPLE[this.controller.currentUser] || {}).name || 'there';
    return String(full).trim().split(/\s+/)[0];
  }

  _greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  _longDate(iso) {
    // iso is YYYY-MM-DD; parse as local midnight so the weekday/day are correct.
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // Status mix over the current user's tasks, mapped to the donut's three bands:
  // In progress (pending/review), Completed (done), Not started (todo/hold).
  _statusMix() {
    const me = this.controller.currentUser;
    const all = this.controller.visibleTasks({ includeDone: true }).filter(t => t.assignee === me);
    const inProg = all.filter(t => t.status === 'pending' || t.status === 'review').length;
    const done = all.filter(t => t.status === 'done').length;
    const notStarted = all.length - inProg - done; // todo / hold / unset
    return { inProg, done, notStarted, total: all.length };
  }

  // Rolling window for the trend cards. `end` is tomorrow 00:00 so "current"
  // includes today; current = [curStart, end), previous = [prevStart, curStart).
  _periodWindow(mode) {
    const L = mode === 'month' ? 30 : 7;
    const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1);
    const curStart = new Date(end); curStart.setDate(end.getDate() - L);
    const prevStart = new Date(end); prevStart.setDate(end.getDate() - 2 * L);
    return { L, end, curStart, prevStart };
  }

  // 3 viewer-scoped trend cards: value (current period), prev (previous period),
  // goodWhen (which direction is "good", for the badge color), and an 8-bucket
  // sparkline series (oldest -> newest).
  _trendMetrics(mode) {
    const me = this.controller.currentUser;
    const all = this.controller.visibleTasks({ includeDone: true }).filter(t => t.assignee === me);
    const { L, end, curStart, prevStart } = this._periodWindow(mode);
    const today = App.utils.todayISO(0);
    const doneMs = t => (t.completedAt ? new Date(t.completedAt).getTime() : null);
    const createdMs = t => (t.createdAt ? new Date(t.createdAt).getTime() : 0);
    const completedIn = (a, b) => all.filter(t => { const c = doneMs(t); return c != null && c >= a.getTime() && c < b.getTime(); }).length;
    const openAt = T => all.filter(t => { const c = doneMs(t); return createdMs(t) <= T && (c == null || c > T); }).length;
    const openNow = all.filter(t => t.status !== 'done').length;
    const dueBetween = (fromISO, toISO) => all.filter(t => t.status !== 'done' && t.due && t.due >= fromISO && t.due < toISO).length;

    // 8 buckets of length L days, oldest -> newest.
    const buckets = fn => {
      const out = [];
      for (let i = 7; i >= 0; i--) {
        const b1 = new Date(end); b1.setDate(end.getDate() - (i + 1) * L);
        const b2 = new Date(end); b2.setDate(end.getDate() - i * L);
        out.push(fn(b1, b2));
      }
      return out;
    };

    return [
      { key: 'completed', label: 'Completed', icon: 'done', tone: 'tone-green', goodWhen: 'up',
        value: completedIn(curStart, end), prev: completedIn(prevStart, curStart),
        spark: buckets((a, b) => completedIn(a, b)) },
      { key: 'openload', label: 'Open workload', icon: 'inbox', tone: 'tone-blue', goodWhen: 'down',
        value: openNow, prev: openAt(curStart.getTime()),
        spark: buckets((a, b) => openAt(b.getTime() - 1)) },
      { key: 'dueweek', label: 'Due this week', icon: 'calendar', tone: 'tone-amber', goodWhen: 'down',
        value: dueBetween(today, App.utils.todayISO(7)), prev: dueBetween(App.utils.todayISO(-7), today),
        spark: buckets((a, b) => all.filter(t => t.status !== 'done' && t.due &&
          t.due >= App.utils.toISODate(a) && t.due < App.utils.toISODate(b)).length) },
    ];
  }

  // SVG polyline points for an 8-value sparkline in a 100x28 box.
  _sparklinePath(series, w = 100, h = 28) {
    const n = series.length;
    if (!n) return '';
    const max = Math.max(1, ...series);
    const stepX = n > 1 ? w / (n - 1) : 0;
    return series.map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
  }

  // Current-month grid (Monday-first) with per-day open-task due counts.
  _miniCalendar() {
    const me = this.controller.currentUser;
    const open = this.controller.visibleTasks({ includeDone: false }).filter(t => t.assignee === me);
    const today = App.utils.todayISO(0);
    const dueByDay = {};
    open.forEach(t => { if (t.due) dueByDay[t.due] = (dueByDay[t.due] || 0) + 1; });
    // Derive the month from the HQ "today" (not new Date()) so the grid and the
    // highlighted today-cell stay consistent with the rest of the app's clock.
    const [ty, tm] = today.split('-').map(Number);
    const y = ty, mo = tm - 1;
    const first = new Date(y, mo, 1);
    const startDow = (first.getDay() + 6) % 7;               // Monday = 0
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = App.utils.toISODate(new Date(y, mo, d));
      const due = dueByDay[iso] || 0;
      cells.push({ d, iso, due, today: iso === today, overdue: due > 0 && iso < today });
    }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { label: first.toLocaleDateString('en-US', { month: 'long' }), weeks };
  }

  // My open tasks: Focus order first (focusSeq set), then soonest due. Top 5.
  _upNext() {
    const me = this.controller.currentUser;
    const today = App.utils.todayISO(0);
    return this.controller.visibleTasks({ includeDone: false })
      .filter(t => t.assignee === me)
      .sort((a, b) => {
        const fa = a.focusSeq == null ? Infinity : a.focusSeq;
        const fb = b.focusSeq == null ? Infinity : b.focusSeq;
        if (fa !== fb) return fa - fb;
        return String(a.due || '9999').localeCompare(String(b.due || '9999'));
      })
      .slice(0, 5)
      .map(t => ({ t, overdue: !!(t.due && t.due < today) }));
  }

  // Flatten activity[] across the role-scoped task set into one feed. Managers
  // (reports.view) see all company-scoped activity; everyone else sees their
  // own world (assignee/creator/watcher).
  _recents() {
    const me = this.controller.currentUser;
    const manager = App.can('reports.view');
    let tasks = this.controller.visibleTasks({ includeDone: true });
    if (!manager) {
      tasks = tasks.filter(t =>
        t.assignee === me || t.creator === me || (t.watchers || []).includes(me));
    }
    const feed = [];
    for (const t of tasks) {
      for (const a of (t.activity || [])) {
        if (!a || (!a.at && !a.what)) continue;
        // `at` is a real timestamp on app-written activity; legacy/seed rows only
        // carry a `when` label. Keep both — timestamped first, labelled after.
        feed.push({ who: a.who || '', what: a.what || '', at: a.at || null, when: a.when || '', title: t.title, id: t.id });
      }
    }
    feed.sort((x, y) => {
      if (x.at && y.at) return String(y.at).localeCompare(String(x.at));
      if (x.at) return -1;
      if (y.at) return 1;
      return 0;
    });
    return feed.slice(0, 12);
  }

  render() {
    const esc = App.utils.escapeHtml;
    const today = App.utils.todayISO(0);
    const upNext = this._upNext();
    const atRisk = this._atRisk();
    const recents = this._recents();

    // Inline Solar duotone glyph; colors itself from the chip's currentColor.
    // The ic-<name> class lets each glyph carry its own signature animation.
    const icon = name => `<svg class="qhq-ic ic-${name}" viewBox="0 0 24 24" aria-hidden="true">${HOME_ICONS[name] || ''}</svg>`;

    // A consistent, scannable section heading: tinted glyph + bold title + caption.
    const cardHead = (glyph, tone, title, meta) => `
      <div class="qhq-card-h">
        <span class="qhq-hicon ${tone}">${icon(glyph)}</span>
        <span class="qhq-htext"><span class="ct">${esc(title)}</span><span class="meta">${esc(meta)}</span></span>
      </div>`;

    // Deterministic monogram + tone for the activity feed, so each actor reads
    // as a person at a glance without pulling avatars over the wire.
    const TONES = ['tone-amber', 'tone-blue', 'tone-green', 'tone-slate'];
    const initials = name => (String(name || '?').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('') || '?').toUpperCase();
    const toneFor = s => TONES[[...String(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];

    const PRIO = { critical: 'critical', urgent: 'urgent', high: 'high', medium: 'medium', low: 'low' };
    const unHtml = upNext.length ? upNext.map(r => `
      <div class="qhq-un-row" data-id="${esc(r.t.id)}" role="button" tabindex="0">
        <span class="qhq-un-dot ${PRIO[r.t.priority] || 'medium'}"></span>
        <span class="qhq-un-t">${esc(r.t.title)}</span>
        <span class="qhq-un-due ${r.overdue ? 'over' : ''}">${r.t.due ? esc(r.t.due.slice(5)) : '—'}</span>
      </div>`).join('')
      : `<div class="qhq-empty qhq-empty-lg">
          <span class="qhq-empty-hero tone-amber">${icon('coffee')}</span>
          <span class="qhq-empty-tx"><b>You're all caught up</b><span>No open tasks in your queue.</span></span>
        </div>`;

    const riskRows = atRisk.length ? atRisk.map(r => `
      <div class="qhq-ar-row">
        <div class="qhq-ar-ic ${r.chip.cls}">${icon(r.overdue ? 'warning' : 'pause')}</div>
        <div class="qhq-ar-b">
          <div class="qhq-ar-t">${esc(r.t.title)}</div>
          <div class="qhq-ar-s">${esc(this.controller.getUserName(r.t.assignee))} · ${esc(r.reason)}</div>
        </div>
        <span class="qhq-chip ${r.chip.cls}">${esc(r.chip.label)}</span>
      </div>`).join('')
      : `<div class="qhq-empty qhq-empty-lg">
          <span class="qhq-empty-hero tone-green">${icon('done')}</span>
          <span class="qhq-empty-tx"><b>Nothing at risk</b><span>Everything's on track right now.</span></span>
        </div>`;

    // Projects-overview: a progress ring (center = % complete) over per-status
    // progress bars, sized to fill the whole card.
    const mix = this._statusMix();
    const pct = n => (mix.total ? (n / mix.total) * 100 : 0);
    const a = pct(mix.inProg), b = pct(mix.done);
    const donePct = mix.total ? Math.round((mix.done / mix.total) * 100) : 0;
    const donutStyle = mix.total
      ? `background: conic-gradient(var(--blue) 0 ${a}%, var(--amber) ${a}% ${a + b}%, var(--bg-3) ${a + b}% 100%);`
      : `background: var(--bg-3);`;
    const bar = (label, n, color) => `
      <div class="qhq-pbar">
        <div class="qhq-pbar-top"><span class="qhq-pbar-l"><span class="d" style="background:${color}"></span>${esc(label)}</span><span class="qhq-pbar-v tnum">${n}</span></div>
        <div class="qhq-pbar-track"><i style="width:${Math.round(pct(n))}%;background:${color}"></i></div>
      </div>`;
    const donutHtml = `
      <div class="qhq-card qhq-donut-card">
        ${cardHead('donut', 'tone-blue', 'Projects overview', 'your tasks')}
        <div class="qhq-donut-wrap">
          <div class="qhq-donut" style="${donutStyle}"><div class="qhq-donut-hole">
            <div class="qhq-donut-fig"><span class="qhq-donut-num tnum">${donePct}</span><span class="qhq-donut-pct">%</span></div>
            <div class="qhq-donut-lbl">complete</div>
          </div></div>
          <div class="qhq-donut-bars">
            ${bar('In progress', mix.inProg, 'var(--blue)')}
            ${bar('Completed', mix.done, 'var(--amber)')}
            ${bar('Not started', mix.notStarted, '#C7CCD3')}
          </div>
        </div>
      </div>`;

    // --- Command-center pieces: section header, trend cards, mini calendar, period toggle ---
    const sectionHead = (title, sub, control = '') => `
      <div class="qhq-sec-h">
        <div class="qhq-sec-htext"><div class="qhq-sec-title">${esc(title)}</div><div class="qhq-sec-sub">${esc(sub)}</div></div>
        ${control}
      </div>`;

    const metrics = this._trendMetrics(this.period);
    const trendCardHtml = m => {
      const up = m.value >= m.prev;
      const good = (m.goodWhen === 'up') === up;                    // improving?
      const deltaTxt = m.prev === 0 ? (m.value === 0 ? '—' : '+' + m.value)
        : (up ? '+' : '−') + Math.round(Math.abs((m.value - m.prev) / m.prev) * 100) + '%';
      return `
        <div class="qhq-trend ${m.tone}">
          <span class="qhq-trend-ic">${icon(m.icon)}</span>
          <div class="qhq-trend-body">
            <div class="qhq-trend-top"><span class="qhq-trend-v tnum">${m.value}</span>
              <span class="qhq-trend-badge ${m.value === m.prev ? 'flat' : good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${esc(deltaTxt)}</span></div>
            <div class="qhq-trend-l">${esc(m.label)}</div>
          </div>
          <svg class="qhq-tspark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
            <polyline points="${this._sparklinePath(m.spark)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>`;
    };

    const cal = this._miniCalendar();
    const calHtml = `
      <div class="qhq-cal">
        <div class="qhq-cal-head">${esc(cal.label)}</div>
        <div class="qhq-cal-grid qhq-cal-dow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span>${d}</span>`).join('')}</div>
        ${cal.weeks.map(w => `<div class="qhq-cal-grid">${w.map(c => c
          ? `<button type="button" class="qhq-cal-day ${c.today ? 'today' : ''} ${c.due ? 'has-due' : ''} ${c.overdue ? 'overdue' : ''}" data-day="${c.iso}">${c.d}${c.due ? '<span class="qhq-cal-dot"></span>' : ''}</button>`
          : '<span class="qhq-cal-day empty"></span>').join('')}</div>`).join('')}
      </div>`;

    const periodCtl = `<div class="qhq-period" role="tablist">${['week', 'month']
      .map(p => `<button type="button" data-p="${p}" class="${p === this.period ? 'on' : ''}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>`;

    const recHtml = recents.length ? recents.map(r => `
      <div class="qhq-rec-row" data-id="${esc(r.id)}" role="button" tabindex="0">
        <span class="qhq-rec-av ${toneFor(r.who)}" aria-hidden="true">${esc(initials(r.who))}</span>
        <span class="qhq-rec-tx"><b>${esc(r.who)}</b> ${esc(r.what)} · <span class="qhq-rec-task">${esc(r.title)}</span></span>
        <span class="qhq-rec-ago">${esc((r.at && App.utils.timeAgo(r.at)) || r.when || 'recently')}</span>
      </div>`).join('')
      : `<div class="qhq-empty">No recent activity yet.</div>`;

    // Animate the entrance only on the first paint after landing on Home, not on
    // every data-driven re-render (re-armed in subscribe when the view is hidden).
    const enter = this._rendered ? '' : ' qhq-enter';
    this._rendered = true;

    this.wrap.innerHTML = `
      <div class="qhq-home qhq-cc${enter}">
        <div class="qhq-head">
          <div>
            <div class="qhq-greet">${this._greeting()}, <span class="em">${esc(this._firstName())}</span></div>
            <div class="qhq-dateline">${icon('date')} ${esc(this._longDate(today))}</div>
          </div>
          <div class="qhq-actions">
            <button type="button" class="qhq-act primary" data-act="new"><i class="ti ti-plus"></i> New task</button>
            <button type="button" class="qhq-act" data-act="all">All tasks</button>
            <button type="button" class="qhq-act" data-act="calendar">Calendar</button>
          </div>
        </div>

        <div class="qhq-cc-grid">
          <div class="qhq-cc-main">
            ${sectionHead('Your work', 'what needs you now')}
            <div class="qhq-card">
              ${cardHead('layers', 'tone-amber', 'Up next', 'your queue')}
              <div class="qhq-unlist">${unHtml}</div>
            </div>
            <div class="qhq-card">
              ${cardHead('warning', 'tone-rust', 'At risk', 'needs attention')}
              <div class="qhq-arlist">${riskRows}</div>
            </div>
          </div>
          <div class="qhq-cc-rail">
            ${sectionHead('Your performance', this.period === 'month' ? 'this month' : 'this week', periodCtl)}
            <div class="qhq-trend-list">${metrics.map(trendCardHtml).join('')}</div>
            ${calHtml}
            ${donutHtml}
          </div>
        </div>

        <div class="qhq-card qhq-recents">
          ${cardHead('activity', 'tone-slate', 'Recents', App.can('reports.view') ? 'team activity' : 'your activity')}
          <div class="qhq-reclist">${recHtml}</div>
        </div>
      </div>`;

    // Wire interactions.
    this.wrap.querySelectorAll('.qhq-act').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'new') this.controller.openNewTaskPage();
      else if (a === 'all') this.controller.setView('all');
      else if (a === 'calendar') {
        // "Calendar" isn't a view — it's a layout of the task list. Open the
        // All-tasks view, then switch its layout to the calendar.
        this.controller.setView('all');
        this.controller.setLayout('calendar');
      }
    }));
    this.wrap.querySelectorAll('.qhq-period button').forEach(b => b.addEventListener('click', () => {
      this.period = b.dataset.p;
      this.render();
    }));
    this.wrap.querySelectorAll('.qhq-cal-day[data-day]').forEach(b => b.addEventListener('click', () => {
      this.controller.openCalendarOn(b.dataset.day);
    }));
    const open = el => { const id = el.dataset.id; if (id) this.controller.selectTask(id); };
    this.wrap.querySelectorAll('.qhq-un-row, .qhq-rec-row').forEach(el => {
      el.addEventListener('click', () => open(el));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(el); } });
    });

    // Count the headline figures up on the entrance paint only (never on a
    // background data refresh, and never when the user prefers reduced motion).
    if (enter && !this._reduceMotion()) {
      this.wrap.querySelectorAll('.qhq-trend-v').forEach((el, i) => this._countUp(el, metrics[i] && metrics[i].value));
      this._countUp(this.wrap.querySelector('.qhq-donut-num'), donePct);
    }
  }

  _reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Tween an integer element from 0 → target with an ease-out cubic.
  _countUp(el, target) {
    const to = Number(target) || 0;
    if (!el || to <= 0) return;
    const dur = 700, t0 = performance.now();
    const tick = now => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = String(Math.round((1 - Math.pow(1 - p, 3)) * to));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Open tasks (scoped) that are at risk, with a reason + chip.
  _atRisk() {
    const today = App.utils.todayISO(0);
    const tasks = this.controller.visibleTasks({ includeDone: false });
    const out = [];
    for (const t of tasks) {
      const overdue = !!(t.due && t.due < today);
      const parked = t.status === 'hold';
      const hot = (t.priority === 'critical' || t.priority === 'high');
      if (!overdue && !parked) continue;
      const reason = overdue && hot ? 'Overdue + high priority'
        : overdue ? 'Past due'
        : 'On hold';
      const chip = overdue && hot ? { cls: 'risk', label: 'at risk' }
        : overdue ? { cls: 'risk', label: 'late' }
        : { cls: 'hold', label: 'blocked' };
      out.push({ t, reason, chip, overdue });
    }
    out.sort((a, b) => (b.overdue - a.overdue) || String(a.t.due).localeCompare(String(b.t.due)));
    return out.slice(0, 6);
  }
};
