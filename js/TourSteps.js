/* TourSteps — the ordered, role-gated step table for the onboarding tour, split
   out from TourView so the (pure) selection logic is unit-testable without a
   DOM (mirrors the UiStatePolicy seam). TourView owns the DOM + navigation; this
   module owns "which steps, in what order, for whom".

   Each step:
     { view?, sel, title, body, gate? }
   - view : a controller.setView key. When present the tour NAVIGATES here before
            spotlighting — this is what makes the tour "walk into" each section.
     - sel : element to spotlight once on screen (a section's content container),
             or null for a centered welcome/closing card.
   - gate : optional predicate ({ can, canView }) => boolean deciding INCLUSION.
            Navigation (view) and inclusion (gate) are independent: "Create a
            task" navigates to the task list but is included only with
            tasks.write.

   Inclusion (selectSteps → includeStep), in priority order:
     1. explicit gate()          — permission-gated chrome (Create a task, Clock)
     2. else view → canView(view)— section walks (role-aware by design)
     3. else sel  → isVisible(sel)— always-present chrome (Notifications, Account)
     4. else true                — centered welcome / closing cards
   Order is preserved, so the output is always a subsequence of STEPS. */
(function () {
  const STEPS = [
    { sel: null, title: 'Welcome to Quest HQ',
      body: 'A quick tour of every area — about a minute. You can leave anytime with Skip or Esc, and replay it later from the ? menu.' },

    // Everyday task chrome — shown while on the task list.
    { view: 'home', sel: '#homeWrap', title: 'Home',
      body: 'Your dashboard — key numbers, what’s due, and what to do next.' },
    { view: 'all', sel: '#listPane', title: 'Your task list',
      body: 'Every task with its due date, time and status. Tap a row to open it.' },
    // Desktop navigation lives in the top bar (#primaryNav). This is plain chrome
    // — no forced view — so it's gated by live visibility and skips on layouts
    // where the top nav isn't shown (e.g. the mobile drawer).
    { sel: '#primaryNav', title: 'Getting around',
      body: 'Your areas live up here — Home, Tasks, Projects and Reports. Quick views like Urgent and Today are under Tasks.' },
    { view: 'all', sel: '#newTaskBtn', title: 'Create a task',
      body: 'Add a task, set a date and optional time, choose who it’s for, and notify them.',
      gate: ({ can }) => can('tasks.write') },
    { view: 'all', sel: '#clockWidget', title: 'Clock in & out',
      body: 'Start and stop your timer here. A forgotten timer auto-closes after 12 hours.',
      gate: ({ can }) => can('clock.use') },

    // Persistent top-bar chrome — visible in every view.
    { sel: '#notifBtn', title: 'Notifications',
      body: 'Assignments and watcher updates show up here.' },
    { sel: '#userAvatar', title: 'Your account',
      body: 'Light and dark mode, roles & permissions, and sign out live in this menu.' },

    // Walk each remaining section in sidebar order.
    { view: 'projects', sel: '#projectsWrap', title: 'Projects',
      body: 'Group related tasks into projects and track them together.' },
    { view: 'reports', sel: '#reportsWrap', title: 'Reports',
      body: 'Charts on workload and completion across the team.' },
    { view: 'time:mine', sel: '#timeViewWrap', title: 'My time',
      body: 'Your clock-ins and hours.' },
    { view: 'time:resource', sel: '#timeViewWrap', title: 'Team workload',
      body: 'See who’s on the clock across your team right now.' },
    { view: 'team:hierarchy', sel: '#timeViewWrap', title: 'Team chart',
      body: 'See who reports to whom.' },
    { view: 'approvals', sel: '#timeViewWrap', title: 'Approvals',
      body: 'Approve new accounts, set each person’s role, and choose who they report to.' },
    { view: 'admin:clock', sel: '#timeViewWrap', title: 'Clock dashboard',
      body: 'Everyone’s live timers — and fix forgotten clock-outs.' },
    { view: 'admin:task-setup', sel: '#timeViewWrap', title: 'Task setup',
      body: 'Customize the task types and labels your team uses.' },
    { view: 'admin:permissions', sel: '#timeViewWrap', title: 'Roles & permissions',
      body: 'Fine-tune exactly what each role can do.' },
    { view: 'admin:reports', sel: '#timeViewWrap', title: 'Problem reports',
      body: 'Bugs and suggestions people have submitted.' },

    { sel: null, title: 'You’re all set',
      body: 'That’s the tour. Reopen it anytime from the ? menu. Welcome aboard!' },
  ];

  function includeStep(step, preds) {
    if (typeof step.gate === 'function') return !!step.gate(preds);
    if (step.view) return !!preds.canView(step.view);
    if (step.sel) return !!preds.isVisible(step.sel);
    return true;
  }

  function selectSteps(steps, preds) {
    return steps.filter((s) => includeStep(s, preds));
  }

  if (typeof window !== 'undefined') {
    window.App = window.App || {};
    App.TourSteps = { STEPS, selectSteps, includeStep };
  }
  if (typeof module !== 'undefined') module.exports = { STEPS, selectSteps, includeStep };
})();
