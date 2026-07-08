/* UiStatePolicy (CONTEXT.md: Commit) — the single policy for how a uiState
   change becomes observable: which EventBus event each field fires, whether
   the change persists into the last-state blob, and whether the route hash
   re-syncs. AppController._commit(patch) is the only production caller;
   planCommit is pure so Node tests exercise the full policy without a DOM.

   Field facts mirror the pre-seam setters:
   - persisted === the field appears in AppController._persistUiState()'s blob
   - routed === the field is read by AppController._routeFromState()
   - payload === listeners today receive the new value (view/scope/layout/
     search/filtersOpen); the rest emit bare signals.

   Contract: change detection is Object.is per field, so object/Set-valued
   fields (filters, collapsedGroups) must arrive as FRESH instances — in-place
   mutation is invisible. A setter wanting "no event when semantically
   unchanged" for those fields must omit the field from the patch (see
   setGroupBy's collapsedGroups.size check).

   Excluded from _commit by design:
   - setCompany / role preview: emit view:changed as a deliberate force-refresh
     although uiState.view did not change — derived emission would drop it.
   - restoreUiState: silent bulk restore before views first render.
   - initCompanyContext boot path: runs before views exist.
   - creatingTask / bulkMode toggles: tails are pane/DOM choreography, not
     field→event policy. Candidates for a later pass. */

// Declaration order below is the emit order for multi-field commits.
const UI_STATE_POLICY = {
  view:                { event: 'view:changed',            payload: true,  persisted: true,  routed: true  },
  scope:               { event: 'scope:changed',           payload: true,  persisted: true,  routed: false },
  layout:              { event: 'layout:changed',          payload: true,  persisted: true,  routed: true  },
  calendarMode:        { event: 'calendar:changed',        payload: false, persisted: true,  routed: false },
  calendarAnchor:      { event: 'calendar:changed',        payload: false, persisted: false, routed: false },
  calendarSelectedDay: { event: 'calendar:changed',        payload: false, persisted: false, routed: true  },
  sortBy:              { event: 'sort:changed',            payload: false, persisted: true,  routed: false },
  sortDir:             { event: 'sort:changed',            payload: false, persisted: true,  routed: false },
  groupBy:             { event: 'group:changed',           payload: false, persisted: true,  routed: false },
  collapsedGroups:     { event: 'group:collapsed-changed', payload: false, persisted: false, routed: false },
  searchQuery:         { event: 'search:changed',          payload: true,  persisted: false, routed: false },
  selectedTaskId:      { event: 'selection:changed',       payload: false, persisted: false, routed: true  },
  filters:             { event: 'filters:changed',         payload: false, persisted: true,  routed: true  },
  filtersOpen:         { event: 'filters:toggled',         payload: true,  persisted: false, routed: false },
};

const UI_STATE_FIELD_ORDER = Object.keys(UI_STATE_POLICY);

function planCommit(prev, patch) {
  const changed = {};
  for (const k of Object.keys(patch)) {
    if (!UI_STATE_POLICY[k]) throw new Error('[UiStatePolicy] unknown field: ' + k);
    if (!Object.is(prev[k], patch[k])) changed[k] = patch[k];
  }
  const keys = Object.keys(changed);
  const events = [];
  const seen = new Set();
  for (const field of UI_STATE_FIELD_ORDER) {
    if (!(field in changed)) continue;
    const p = UI_STATE_POLICY[field];
    if (seen.has(p.event)) continue;
    seen.add(p.event);
    events.push({ name: p.event, payload: p.payload ? changed[field] : undefined });
  }
  return {
    dirty: keys.length > 0,
    changed,
    events,
    persist: keys.some(k => UI_STATE_POLICY[k].persisted),
    route: keys.some(k => UI_STATE_POLICY[k].routed),
  };
}

if (typeof window !== 'undefined') {
  window.App = window.App || {};
  App.uiStatePolicy = { POLICY: UI_STATE_POLICY, planCommit };
}
if (typeof module !== 'undefined') module.exports = { POLICY: UI_STATE_POLICY, planCommit };
