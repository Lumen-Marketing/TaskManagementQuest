/* Input validation. Each validator returns a cleaned/coerced value, or throws
   App.errors.ValidationError with a user-safe message and the offending field.
   Validators here are defense-in-depth: SQL CHECK constraints + RLS are the
   final wall, this layer just stops obvious junk from reaching the network. */
window.App = window.App || {};

App.validate = (function () {
  const { ValidationError } = App.errors;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const ISO_TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

  const LIMITS = {
    email: 254,        // RFC 5321
    name: 80,
    title: 200,
    description: 5000,
    watchers: 25,
    subtasks: 50,      // max checklist items per task
    passwordMin: 6,
    passwordStrongMin: 8,
    passwordMax: 128,
  };

  function email(value, { field = 'email' } = {}) {
    const v = String(value == null ? '' : value).trim().toLowerCase();
    if (!v) throw new ValidationError('Email is required.', { field });
    if (v.length > LIMITS.email) throw new ValidationError('Email is too long.', { field });
    if (!EMAIL_RE.test(v)) throw new ValidationError('Enter a valid email address.', { field });
    return v;
  }

  function password(value, { field = 'password', min = LIMITS.passwordMin, max = LIMITS.passwordMax } = {}) {
    const v = String(value == null ? '' : value);
    if (!v) throw new ValidationError('Password is required.', { field });
    if (v.length < min) throw new ValidationError(`Password must be at least ${min} characters.`, { field });
    if (v.length > max) throw new ValidationError(`Password is too long (max ${max}).`, { field });
    return v;
  }

  /* Stricter password policy for setting/changing a password (sign-up,
     change-password). At least `passwordStrongMin` chars with a lowercase AND
     uppercase letter, a number, and a special character. This matches Supabase
     Auth's strongest server-side preset ("lower, upper, digits and symbols") so
     a password that passes here is never rejected by the server afterwards.
     Throws on the FIRST unmet rule so the message says exactly what's missing. */
  function strongPassword(value, { field = 'password', min = LIMITS.passwordStrongMin } = {}) {
    const v = String(value == null ? '' : value);
    if (!v) throw new ValidationError('Password is required.', { field });
    if (v.length < min) throw new ValidationError(`Password must be at least ${min} characters.`, { field });
    if (v.length > LIMITS.passwordMax) throw new ValidationError(`Password is too long (max ${LIMITS.passwordMax}).`, { field });
    if (!/[a-z]/.test(v)) throw new ValidationError('Password must include a lowercase letter.', { field });
    if (!/[A-Z]/.test(v)) throw new ValidationError('Password must include an uppercase letter.', { field });
    if (!/[0-9]/.test(v)) throw new ValidationError('Password must include a number.', { field });
    if (!/[^A-Za-z0-9]/.test(v)) throw new ValidationError('Password must include a special character.', { field });
    return v;
  }

  function displayName(value, { field = 'name' } = {}) {
    const v = String(value == null ? '' : value).trim();
    if (!v) throw new ValidationError('Enter a display name.', { field });
    if (v.length > LIMITS.name) throw new ValidationError(`Name is too long (max ${LIMITS.name}).`, { field });
    return v;
  }

  function nonEmpty(value, label, { field, max } = {}) {
    const v = String(value == null ? '' : value).trim();
    if (!v) throw new ValidationError(`${label} is required.`, { field });
    if (max && v.length > max) throw new ValidationError(`${label} is too long (max ${max}).`, { field });
    return v;
  }

  function oneOf(value, allowed, { field, label } = {}) {
    if (!allowed.includes(value)) {
      const name = label || field || 'Value';
      throw new ValidationError(`${name} is not one of the allowed values.`, { field });
    }
    return value;
  }

  function isoDate(value, { field = 'due', required = false } = {}) {
    const v = String(value == null ? '' : value).trim();
    if (!v) {
      if (required) throw new ValidationError('Date is required.', { field });
      return null;
    }
    if (!ISO_DATE_RE.test(v)) throw new ValidationError('Date must be in YYYY-MM-DD format.', { field });
    const ts = Date.parse(v + 'T00:00:00Z');
    if (Number.isNaN(ts)) throw new ValidationError('Invalid date.', { field });
    return v;
  }

  function isoTime(value, { field = 'dueTime' } = {}) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return null;
    if (!ISO_TIME_RE.test(v)) throw new ValidationError('Time must be in HH:MM format.', { field });
    return v;
  }

  /* Validate the payload coming out of NewTaskPageView. Returns a frozen,
     cleaned object — callers should use the return value, not the input. */
  function newTask(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('Task data is missing.');
    }
    const title = nonEmpty(payload.title, 'Title', { field: 'title', max: LIMITS.title });
    const description = String(payload.description || '').slice(0, LIMITS.description);
    const type = oneOf(payload.type || 'admin', Object.keys(App.TASK_TYPES || {}), { field: 'type', label: 'Type' });
    const label = oneOf(payload.label || 'roof', Object.keys(App.TASK_LABELS || {}), { field: 'label', label: 'Label' });
    const company = oneOf(payload.company, Object.keys(App.COMPANIES || {}), { field: 'company', label: 'Company' });
    const priority = oneOf(payload.priority || 'medium', Object.keys(App.PRIORITIES || {}), { field: 'priority', label: 'Priority' });
    const status = oneOf(payload.status || 'todo', Object.keys(App.STATUSES || {}), { field: 'status', label: 'Status' });
    // Assignees: prefer the ordered multi-assignee array (whos); fall back to the
    // legacy single `assignee`. Lead = index 0. Dedupe, preserve order, validate each.
    const rawWhos = Array.isArray(payload.whos) && payload.whos.length
      ? payload.whos
      : (payload.assignee ? [payload.assignee] : []);
    const assigneeIds = [];
    for (const w of rawWhos) {
      const id = String(w == null ? '' : w).trim();
      if (!id) continue;
      if (!(App.PEOPLE || {})[id]) throw new ValidationError(`Unknown assignee: ${id}`, { field: 'assignee' });
      if (!assigneeIds.includes(id)) assigneeIds.push(id);
    }
    if (!assigneeIds.length) throw new ValidationError('Assign at least one person.', { field: 'assignee' });
    const assignee = assigneeIds[0];

    const watchers = Array.isArray(payload.watchers) ? payload.watchers : [];
    if (watchers.length > LIMITS.watchers) {
      throw new ValidationError(`Too many watchers (max ${LIMITS.watchers}).`, { field: 'watchers' });
    }
    for (const w of watchers) {
      if (!(App.PEOPLE || {})[w]) throw new ValidationError(`Unknown watcher: ${w}`, { field: 'watchers' });
    }

    // Subtasks (optional). Accept either plain strings (from the New task
    // modal) or {t,d} objects; drop blanks, trim, cap the count and text length.
    const subtasks = (Array.isArray(payload.subtasks) ? payload.subtasks : [])
      .map(s => (typeof s === 'string' ? { t: s, d: false } : { t: s && s.t, d: !!(s && s.d) }))
      .filter(s => s.t != null && String(s.t).trim() !== '')
      .slice(0, LIMITS.subtasks)
      .map(s => ({ t: String(s.t).trim().slice(0, LIMITS.title), d: !!s.d }));

    const due = isoDate(payload.due, { field: 'due' });
    const dueTime = isoTime(payload.dueTime, { field: 'dueTime' });

    return Object.freeze({
      title, description, type, label, company, priority, status,
      assignee, assigneeIds, watchers: watchers.slice(), subtasks, due, dueTime,
    });
  }

  return {
    email, password, strongPassword, displayName, nonEmpty, oneOf, isoDate, isoTime, newTask,
    EMAIL_RE, LIMITS,
  };
})();
