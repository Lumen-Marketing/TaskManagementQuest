#!/usr/bin/env node
/* Minimal dep-free static server used by Playwright + local dev.
   Serves files from the project root. Adds the same response headers Vercel
   adds in production (HSTS, CSP, X-Frame-Options, etc.) so tests catch CSP
   violations locally instead of only in prod. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, join, normalize } from 'node:path';

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

// Match vercel.json so local tests fail on CSP violations rather than passing
// silently and breaking only in prod.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://browser.sentry-cdn.com https://js.sentry-cdn.com 'unsafe-inline'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; worker-src 'self' blob:",
};

function safeJoin(root, urlPath) {
  // Prevent path-traversal: resolve, then assert it's still under root.
  const target = normalize(join(root, decodeURIComponent(urlPath)));
  if (!target.startsWith(root)) return null;
  return target;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = url.pathname;
    if (path.endsWith('/')) path += 'index.html';
    const filePath = safeJoin(ROOT, path);
    if (!filePath) { res.writeHead(403); return res.end('Forbidden'); }

    let info;
    try { info = await stat(filePath); } catch { res.writeHead(404); return res.end('Not found'); }
    if (info.isDirectory()) {
      const idx = safeJoin(filePath, 'index.html');
      if (!idx) { res.writeHead(403); return res.end('Forbidden'); }
      try { info = await stat(idx); }
      catch { res.writeHead(404); return res.end('Not found'); }
      const body = await readFile(idx);
      return respond(res, 200, body, 'text/html; charset=utf-8', idx);
    }
    const body = await readFile(filePath);
    const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    respond(res, 200, body, mime, filePath);
  } catch (err) {
    console.error('[dev-server]', err);
    res.writeHead(500);
    res.end('Internal error');
  }
});

function respond(res, status, body, mime, filePath) {
  const headers = { 'Content-Type': mime, ...SECURITY_HEADERS };
  if (filePath && filePath.endsWith('env.json')) {
    headers['Cache-Control'] = 'no-store, max-age=0';
  } else {
    headers['Cache-Control'] = 'public, max-age=60';
  }
  res.writeHead(status, headers);
  res.end(body);
}

server.listen(PORT, () => {
  console.log(`[dev-server] Serving ${ROOT} at http://localhost:${PORT}`);
});

// Graceful shutdown for Playwright's webServer manager.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => process.exit(0)); });
}
