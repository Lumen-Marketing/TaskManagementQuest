(function () {
  'use strict';

  window.App = window.App || {};

  const WORKFLOWS = {
    bid: [
      { key: 'lead', label: 'Lead' },
      { key: 'bid', label: 'Bid' },
      { key: 'underwriting', label: 'Underwriting' },
      { key: 'proposal', label: 'Proposal' },
      { key: 'approval', label: 'Approval' }
    ],
    lead: [
      { key: 'lead', label: 'Lead' },
      { key: 'followup', label: 'Follow-up' },
      { key: 'qualified', label: 'Qualified' },
      { key: 'bid', label: 'Bid / Estimate' }
    ],
    field_work: [
      { key: 'ready', label: 'Ready' },
      { key: 'active', label: 'Field Work' },
      { key: 'review', label: 'Review' },
      { key: 'done', label: 'Complete' }
    ]
  };

  function workflowFor(task) {
    return WORKFLOWS[task && task.type] || [
      { key: 'active', label: 'Active' },
      { key: 'review', label: 'Review' },
      { key: 'done', label: 'Complete' }
    ];
  }

  function currentStep(task, controller) {
    if (!task) return 'active';
    if (App.taxonomy.isDone(task)) return 'done';
    if (task.status === 'review') return 'review';

    if (task.type === 'bid') {
      const uw = controller && controller.underwriting;
      const entry = uw && uw.entry ? uw.entry(task.id) : null;
      const record = entry && entry.record;

      if (!record) return 'bid';
      if (record.status === 'approved') return 'proposal';
      return 'underwriting';
    }

    if (task.type === 'lead') return 'lead';
    if (task.type === 'field_work') return 'active';

    return 'active';
  }

  function nextAction(task, controller) {
    if (!task) return null;

    if (App.taxonomy.isDone(task)) {
      return {
        label: 'Completed',
        kind: 'done'
      };
    }

    if (task.status === 'hold') {
      return { label: 'Resolve blocker', kind: 'task' };
    }

    if (task.status === 'review') {
      return { label: 'Review work', kind: 'task' };
    }

    if (task.type === 'bid') {
      const uw = controller && controller.underwriting;
      const entry = uw && uw.entry ? uw.entry(task.id) : null;
      const record = entry && entry.record;

      if (!record) return { label: 'Start underwriting', kind: 'underwriting' };
      if (record.status === 'ready_for_review') return { label: 'Review underwriting', kind: 'underwriting' };
      if (record.status === 'approved') return { label: 'Open proposal', kind: 'underwriting' };

      return { label: 'Continue underwriting', kind: 'underwriting' };
    }

    if (task.due && task.due <= App.utils.todayISO(0)) {
      return { label: 'Move this forward', kind: 'task' };
    }

    return { label: 'Continue work', kind: 'task' };
  }

  function model(task, controller) {
    const workflow = workflowFor(task);
    const current = currentStep(task, controller);
    const found = workflow.findIndex(step => step.key === current);
    const currentIndex = found >= 0 ? found : 0;

    return {
      workflow,
      current,
      currentIndex,
      next: nextAction(task, controller)
    };
  }

  App.TaskCoherence = { model };
})();
