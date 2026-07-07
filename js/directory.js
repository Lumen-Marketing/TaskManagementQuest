window.App = window.App || {};

/* Directory (CONTEXT.md) — the roster of people, companies, and projects that
   tasks reference. This is the interface in front of the App.PEOPLE /
   App.COMPANIES / App.projects globals (wrap phase of C4): views ask the
   directory, so a shape change to the underlying rows stops at this seam
   instead of touching every render site. Modeled on js/taxonomy.js.

   Lookups return the underlying object or null — call sites keep their own
   unknown-person fallbacks for now (deliberately NOT unified: the fallback
   colors differ per surface and unifying them is a visual change).

   avatarStack is the one shared render helper the deletion test justified:
   the same overlapping-circles cluster was hand-rolled in TaskDetailView and
   NewTaskPageView. companyPill/statusChip were considered and rejected — one
   call site, and three visually-distinct "status chips" respectively (see the
   C4 plan's scope discipline note). */
App.directory = {
  person(id) { return (id && App.PEOPLE && App.PEOPLE[id]) || null; },
  people() { return Object.values(App.PEOPLE || {}); },
  company(id) { return (id && App.COMPANIES && App.COMPANIES[id]) || null; },
  companies() { return Object.values(App.COMPANIES || {}); },
  project(id) { return (id && App.projects && App.projects[id]) || null; },
  projects() { return Object.values(App.projects || {}); },

  /* Stacked-avatar cluster (lead first): overlapping circles with a ring so
     they read as one group. Accepts person objects or ids; unknown ids render
     with the id as the name. */
  avatarStack(peopleOrIds, opts = {}) {
    const max = opts.max == null ? 4 : opts.max;
    const list = (peopleOrIds || []).map(p =>
      (typeof p === 'string' ? (this.person(p) || { name: p, full: p, color: 'var(--ink-3)' }) : p)
    ).filter(Boolean);
    if (!list.length) {
      return `<span class="td2-av-stack"><span class="avatar-xs td2-av" style="background:var(--ink-3);">?</span></span>`;
    }
    const shown = list.slice(0, max);
    const extra = list.length - shown.length;
    const avs = shown.map(p => App.utils.avatarHtml(p, 'td2-av')).join('');
    const more = extra > 0 ? `<span class="avatar-xs td2-av td2-av-more">+${extra}</span>` : '';
    return `<span class="td2-av-stack">${avs}${more}</span>`;
  },
};
