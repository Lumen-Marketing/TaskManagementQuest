#!/usr/bin/env node
/* Vercel build step: writes env.json from environment variables.
   Runs via the `buildCommand` field in vercel.json. The variables come from
   the Vercel project's Environment Variables panel (Settings -> Environment
   Variables). The output file (env.json) is gitignored and never committed —
   it only exists on the Vercel build server. */
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const requiredVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = requiredVars.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `[build-env] Missing required env vars: ${missing.join(', ')}.\n` +
    `Set them in Vercel: Settings -> Environment Variables, then redeploy.`
  );
  process.exit(1);
}

const url = String(process.env.SUPABASE_URL).trim();
const key = String(process.env.SUPABASE_ANON_KEY).trim();

if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url)) {
  console.error('[build-env] SUPABASE_URL does not look like a Supabase project URL.');
  process.exit(1);
}
if (/^sb_secret_|service_role/i.test(key) || key.length > 400) {
  console.error('[build-env] SUPABASE_ANON_KEY looks like a server-side key. Use the publishable / anon key, NOT the service_role key.');
  process.exit(1);
}

// Optional fields. Both ship to the browser — Sentry DSN is public by design
// (it's a client-side write-only token), and release is just a commit SHA.
const sentryDsn = String(process.env.SENTRY_DSN || '').trim();
if (sentryDsn && !/^https:\/\/[a-f0-9]+@[a-z0-9.-]+\.ingest(\.us|\.de)?\.sentry\.io\/\d+$/i.test(sentryDsn)) {
  console.error('[build-env] SENTRY_DSN does not look like a Sentry DSN (https://<key>@<host>.ingest.sentry.io/<project>).');
  process.exit(1);
}
// Vercel provides VERCEL_GIT_COMMIT_SHA automatically on builds; fall back to
// a manual RELEASE env var for non-Vercel runs (CI, local).
const release = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.RELEASE || '').trim().slice(0, 40);

// Cloudflare Turnstile site key (public — paired with a secret held by
// Supabase Auth). When set, the login flow renders an invisible captcha
// and forwards the token via options.captchaToken; Supabase Auth must
// have Captcha enabled (Dashboard -> Auth -> Captcha) with the matching
// secret key for the token to be validated server-side.
const turnstileSiteKey = String(process.env.TURNSTILE_SITE_KEY || '').trim();
if (turnstileSiteKey && !/^[A-Za-z0-9_-]{10,80}$/.test(turnstileSiteKey)) {
  console.error('[build-env] TURNSTILE_SITE_KEY does not look like a Turnstile site key.');
  process.exit(1);
}

const payload = JSON.stringify({
  supabaseUrl: url,
  supabaseAnonKey: key,
  sentryDsn,
  release,
  turnstileSiteKey,
}, null, 2) + '\n';
const target = resolve(process.cwd(), 'env.json');
await writeFile(target, payload, 'utf8');
console.log(`[build-env] Wrote ${target} (${payload.length} bytes, sentry=${sentryDsn ? 'on' : 'off'}, captcha=${turnstileSiteKey ? 'on' : 'off'}, release=${release || '<none>'}).`);

// One build id per deploy, shared by the sw.js cache-version stamp and the
// asset-URL version stamp below. Prefer the commit SHA (stable, traceable);
// off-Vercel (no release) fall back to a per-run hash.
const buildId = (
  release ||
  createHash('sha256').update(String(Date.now())).digest('hex')
).slice(0, 12);

// Stamp the build id into sw.js so the service-worker CACHE_VERSION changes on
// every deploy and the activate-purge actually drops the previous deploy's
// caches. We rewrite the __BUILD_ID__ placeholder in place — if it's already
// been stamped (or sw.js is missing) we no-op so re-running the build stays
// idempotent and safe.
try {
  const swPath = resolve(process.cwd(), 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  if (sw.includes("'__BUILD_ID__'")) {
    const stamped = sw.replace("'__BUILD_ID__'", `'${buildId}'`);
    await writeFile(swPath, stamped, 'utf8');
    console.log(`[build-env] Stamped sw.js BUILD_ID=${buildId}.`);
  } else {
    console.log('[build-env] sw.js has no __BUILD_ID__ placeholder; skipping stamp.');
  }
} catch (err) {
  // A missing sw.js or write failure must not fail the whole build.
  console.warn(`[build-env] Could not stamp sw.js: ${err && err.message ? err.message : err}`);
}

// Stamp ?v=BUILD_ID onto same-origin static asset URLs so the service worker
// can serve them cache-first as immutable (ADR-0001,
// docs/adr/0001-cache-first-versioned-static-assets.md). Idempotent: the
// [^"?] in the pattern skips URLs that already carry a query. Only local
// css/js/woff2 are stamped — CDN URLs, env.json, and the manifest are left
// alone. Dev never runs this file, so local URLs stay unversioned.
for (const name of ['app.html', 'index.html']) {
  try {
    const p = resolve(process.cwd(), name);
    let html = await readFile(p, 'utf8');
    const before = html;
    html = html.replace(
      /((?:href|src)=")((?!https?:\/\/|\/\/)[^"?]+\.(?:css|js|woff2))(")/g,
      (_, pre, url, post) => `${pre}${url}?v=${buildId}${post}`
    );
    if (html !== before) {
      await writeFile(p, html, 'utf8');
      console.log(`[build-env] Stamped asset versions in ${name} (v=${buildId}).`);
    }
  } catch (err) {
    console.warn(`[build-env] Could not stamp ${name}: ${err && err.message ? err.message : err}`);
  }
}
