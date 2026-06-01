/* Observability bootstrap.
   - Lazy-loads the Sentry browser SDK from CDN only if App.sentryDsn is set,
     so dev environments without a DSN cost zero bytes.
   - Auto-detects environment from hostname (development / preview / production)
     so the Sentry dashboard separates errors per env.
   - Scrubs known PII (email values, password fields, the user's auth profile)
     in beforeSend so a stack trace can't leak a customer's email.
   - Exposes App.observability.{captureException, captureMessage, throwTestError}.
     The global error handlers in app.js + auth.js call into these. */
window.App = window.App || {};

App.observability = (function () {
  let ready = null;
  let enabled = false;

  function environmentFromHostname() {
    const h = window.location.hostname;
    if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')) return 'development';
    if (h.endsWith('.vercel.app')) return 'preview';
    return 'production';
  }

  /* Remove obvious PII from event payloads before they leave the browser.
     Email is the highest-risk field here — it's both an identifier and the
     primary key for the auth system. Strip it from request strings, breadcrumb
     messages, and form values. */
  function scrubPII(event) {
    try {
      const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

      const walk = (obj, depth = 0) => {
        if (depth > 4 || obj == null) return obj;
        if (typeof obj === 'string') return obj.replace(EMAIL_RE, '[email]');
        if (Array.isArray(obj)) return obj.map((v) => walk(v, depth + 1));
        if (typeof obj === 'object') {
          for (const k of Object.keys(obj)) {
            if (/password|token|secret|api[_-]?key|cookie|authorization/i.test(k)) {
              obj[k] = '[redacted]';
            } else {
              obj[k] = walk(obj[k], depth + 1);
            }
          }
        }
        return obj;
      };

      walk(event);
      // Always overwrite user.email even if the SDK auto-populated it.
      if (event.user && event.user.email) event.user.email = '[email]';
    } catch { /* never let a scrubbing bug drop the event entirely */ }
    return event;
  }

  function injectSentryScript() {
    return new Promise((resolve, reject) => {
      // Pinned bundle version — bumping is intentional. The CDN URL is in CSP
      // so a typo here surfaces as a CSP block in DevTools immediately.
      const script = document.createElement('script');
      script.src = 'https://browser.sentry-cdn.com/8.52.0/bundle.min.js';
      script.integrity = ''; // SRI omitted; Sentry doesn't publish stable hashes per release
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Sentry CDN failed to load'));
      document.head.appendChild(script);
    });
  }

  async function init() {
    if (ready) return ready;
    ready = (async () => {
      if (!App.sentryDsn) {
        // No DSN -> observability is a no-op. Local dev path.
        return;
      }
      try {
        await injectSentryScript();
        if (!window.Sentry || typeof window.Sentry.init !== 'function') return;

        window.Sentry.init({
          dsn: App.sentryDsn,
          environment: environmentFromHostname(),
          release: App.release || undefined,
          // Keep sample rates conservative — free-tier quotas don't last long
          // if you instrument every interaction. Bump in Sentry dashboard once
          // traffic patterns are clear.
          tracesSampleRate: 0.1,
          replaysSessionSampleRate: 0.0,    // session replay off by default
          replaysOnErrorSampleRate: 0.5,    // replay around errors only
          sendDefaultPii: false,
          beforeSend: (event) => scrubPII(event),
          beforeBreadcrumb: (crumb) => {
            // Don't record fetch-body content (could include task titles, etc.)
            if (crumb && crumb.data) delete crumb.data.body;
            return crumb;
          },
          ignoreErrors: [
            // Browser extensions / ad blockers throw these constantly.
            'ResizeObserver loop limit exceeded',
            'Non-Error promise rejection captured',
          ],
        });

        // Tag the session with the role (NOT the email/id) so we can answer
        // "is this bug worker-only?" without identifying anyone.
        const role = (App.currentProfile && App.currentProfile.role) || 'anonymous';
        window.Sentry.setTag('app.role', role);
        window.Sentry.setTag('app.env', environmentFromHostname());

        enabled = true;
      } catch (err) {
        // Don't let observability break the app it's observing.
        // eslint-disable-next-line no-console
        console.warn('[observability] init failed', err);
      }
    })();
    return ready;
  }

  function captureException(err, context) {
    try {
      if (!enabled || !window.Sentry) return;
      window.Sentry.captureException(err, context ? { extra: context } : undefined);
    } catch { /* swallow */ }
  }

  function captureMessage(message, level = 'info', context) {
    try {
      if (!enabled || !window.Sentry) return;
      window.Sentry.captureMessage(message, { level, extra: context });
    } catch { /* swallow */ }
  }

  /* Verification hook. Open DevTools console and run:
       App.observability.throwTestError()
     Then check Sentry's Issues view — you should see a new event tagged
     with environment=development|preview|production within ~30 seconds.
     This is also what the post-deploy smoke test calls. */
  function throwTestError() {
    const tag = `Sentry verification ${new Date().toISOString()}`;
    throw new Error(tag);
  }

  // Kick off init at script load — it's idempotent and the await chain in
  // app.js / auth.js doesn't need to wait for Sentry specifically.
  init();

  return { init, captureException, captureMessage, throwTestError, isEnabled: () => enabled };
})();
