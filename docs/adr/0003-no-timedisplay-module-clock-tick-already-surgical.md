# No TimeDisplay module — clock:tick subscribers already do surgical patches

A future architecture review may notice that `setInterval(() => App.EventBus.emit('clock:tick'), 1000)` fires every second and propose extracting a `TimeDisplay` module to prevent full re-renders. Do not build it.

All four `clock:tick` subscribers — `TopbarView.tickLive()`, `TimeView.tickLive()`, `ClockDashboardView.tickLive()`, `TaskDetailView.tickLive()` — already do surgical DOM patches:

```js
// TimeView — representative example
this.wrap.querySelectorAll('[data-live-timer]').forEach(el => {
  el.textContent = App.utils.formatDuration(...);
});
```

Each handler queries only the timer `<span>` elements that need updating and writes `textContent` directly. No layout recalculation; no full re-render. Handlers early-return when their view is not visible. The deletion test fails: delete `tickLive()` from each view and the complexity does not reappear across callers — it disappears. That is good locality, not a problem.

Status: accepted (2026-07-08). Do not add a TimeDisplay module without re-reading this.

Consequences: anyone adding a new live-timer display to a view must implement their own `tickLive()` that patches only the affected `textContent` nodes and subscribes to `clock:tick` via EventBus. The pattern is well-established in the four existing subscribers.
