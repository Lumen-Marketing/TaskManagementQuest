# No --sidebar-w CSS custom property — body.sidebar-minimized already adjusts the grid

A future architecture review may notice that `.app { grid-template-columns: 240px minmax(0, 1fr) }` is hard-coded and propose replacing `240px` with a `var(--sidebar-w, 240px)` custom property so the sidebar column can be collapsed. The mechanism already exists.

`SidebarView._setMinimized()` toggles `body.sidebar-minimized`, and the CSS already overrides the grid template:

```css
/* taskmanagement.css */
body.sidebar-minimized .app { grid-template-columns: 68px minmax(0, 1fr); }
```

The `.deck` element also has `transition: width var(--dur-short) var(--ease-out)` so the collapse animates. The class toggle is the right tool here: the sidebar has exactly two fixed states (240px full, 68px icon-strip) with no drag-resize, so a custom property adds no leverage over the existing class-based override.

The `--detail-width` custom property is different: it is JS-driven by a drag handle and requires arbitrary intermediate values. The sidebar does not.

Status: accepted (2026-07-08). Do not introduce `--sidebar-w` without re-reading this.

Consequences: if a third sidebar state is ever needed (e.g. fully hidden at 0px), add a new body class and a new CSS override — do not reach for a custom property unless the width becomes drag-resizable.
