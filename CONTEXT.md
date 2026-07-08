# Quest HQ

Task management for the Quest/Lumen companies: tasks flow between managers and workers across companies, with time tracking, watching, and approvals. Zero-build static SPA on Supabase.

## Language

**Task**:
The unit of work — created, assigned, watched, timed, and completed. Belongs to one company and one type.

**Visible tasks**:
The tasks the current user can see right now, after role/company scope, view, search, and filters are applied — one ordering shared by the list, the badges, and prev/next navigation.
_Avoid_: filtered tasks, task list (ambiguous)

**Layout**:
One of the five presentations of the visible tasks: Table, Kanban, Cards, Calendar, Watching.
_Avoid_: view (collides with app views), mode

**Directory**:
The roster of people, companies, and projects that tasks reference.
_Avoid_: globals, PEOPLE/COMPANIES (as concepts)

**Menu**:
A transient contextual chooser — presented either anchored to its control or as a bottom sheet.
_Avoid_: popover, dropdown, picker (as separate concepts)

**Dirty**:
A locally changed row that has not yet reached storage.
_Avoid_: unsaved, pending

**PersistenceEngine**:
The one pipeline through which dirty rows reach storage — nothing saves around it.
_Avoid_: save loop, autosave, doSave

**Commit (UI state)**:
The single step where a uiState patch becomes observable — diffed, persisted, emitted (one event per field group), and route-synced per the UiStatePolicy table. Setters assemble patches; `_commit` applies them.
_Avoid_: dispatch, setState, reducer

**Taxonomy**:
The per-company catalogue of task types, statuses, and labels. (Already modeled in code as `App.taxonomy`.)
