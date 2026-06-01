/* Typed error hierarchy for Quest HQ. The two important properties on every
   error are `code` (stable machine string) and `expose` (whether the message
   is safe to surface to the end user — true means it was authored for users).
   Anything thrown internally that doesn't extend AppError is treated as
   non-exposable and surfaced as a generic "Something went wrong." */
window.App = window.App || {};

App.errors = (function () {
  class AppError extends Error {
    constructor(message, { code = 'app/unknown', cause = null, expose = true } = {}) {
      super(message);
      this.name = 'AppError';
      this.code = code;
      this.expose = expose;
      if (cause) this.cause = cause;
    }
  }

  class ValidationError extends AppError {
    constructor(message, { field = null, code = 'validation/invalid', cause = null } = {}) {
      super(message, { code, cause, expose: true });
      this.name = 'ValidationError';
      this.field = field;
    }
  }

  class AuthError extends AppError {
    constructor(message, { code = 'auth/error', cause = null, expose = true } = {}) {
      super(message, { code, cause, expose });
      this.name = 'AuthError';
    }
  }

  class PermissionError extends AppError {
    constructor(message = 'You do not have permission to do that.', { code = 'auth/forbidden', cause = null } = {}) {
      super(message, { code, cause, expose: true });
      this.name = 'PermissionError';
    }
  }

  class NetworkError extends AppError {
    constructor(message = 'Network error — check your connection and retry.', { code = 'net/unreachable', cause = null } = {}) {
      super(message, { code, cause, expose: true });
      this.name = 'NetworkError';
    }
  }

  class TimeoutError extends AppError {
    constructor(message = 'The server took too long to respond.', { cause = null } = {}) {
      super(message, { code: 'net/timeout', cause, expose: true });
      this.name = 'TimeoutError';
    }
  }

  class ConflictError extends AppError {
    constructor(message = 'Someone else changed this first — please reload.', { cause = null } = {}) {
      super(message, { code: 'data/conflict', cause, expose: true });
      this.name = 'ConflictError';
    }
  }

  class ServerError extends AppError {
    constructor(message = 'Server error — the team has been notified.', { code = 'server/error', cause = null } = {}) {
      super(message, { code, cause, expose: true });
      this.name = 'ServerError';
    }
  }

  /* Translate a raw Supabase / Postgrest / network error into a typed AppError.
     `label` is a short verb phrase ("saving task", "loading time entries") so
     surface messages can read naturally. */
  function fromSupabase(error, label) {
    if (!error) return new AppError('Unknown error', { code: 'app/unknown' });
    const msg = error.message || String(error);
    const code = error.code || error.status || '';

    if (error.name === 'AbortError' || /timeout|aborted/i.test(msg)) {
      return new TimeoutError(undefined, { cause: error });
    }
    if (/typeerror.*fetch|failed to fetch|networkerror|network ?request ?failed/i.test(msg)) {
      return new NetworkError(undefined, { cause: error });
    }
    if (code === '42501' || /row[- ]level security|permission denied|forbidden/i.test(msg)) {
      return new PermissionError(`You don't have permission to ${label || 'do that'}.`, { cause: error });
    }
    if (typeof code === 'number' && code >= 500) {
      return new ServerError(undefined, { code: `server/${code}`, cause: error });
    }
    return new AppError(`Could not ${label || 'complete request'}.`, {
      code: code ? `supabase/${code}` : 'supabase/error',
      cause: error,
      expose: true,
    });
  }

  /* Safe user-facing string. Generic fallback for anything not authored for
     users, so we never leak stack traces or raw DB errors. */
  function userMessage(err) {
    if (err && err.expose && err.message) return String(err.message);
    return 'Something went wrong. Please try again.';
  }

  return {
    AppError,
    ValidationError,
    AuthError,
    PermissionError,
    NetworkError,
    TimeoutError,
    ConflictError,
    ServerError,
    fromSupabase,
    userMessage,
  };
})();
