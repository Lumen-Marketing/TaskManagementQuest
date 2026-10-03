#!/usr/bin/env node
/* PHASE 2 — create the six dev logins through the Supabase Auth ADMIN API (never SQL).
   Needs, in your shell: DEV_SUPABASE_URL (must be https://ydrekmghdbpkothhmbut.supabase.co),
   DEV_SUPABASE_SERVICE_ROLE_KEY. Passwords are generated here and written ONLY to
   ~/.questhq-dev-users.json (mode 600). Nothing secret is printed.
   Five Lumen users get app_metadata.tenant_id = tenant 0 (server-only); bob gets none.
   Re-running skips users that already exist. */
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
const DEV_REF = 'ydrekmghdbpkothhmbut', PROD_REF = 'qqvmcsvdxhgjooirznrj';
const url = (process.env.DEV_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY || '';
const die = (m) => { console.error('ABORT: ' + m); process.exit(1); };
if (!url || !key) die('DEV_SUPABASE_URL and DEV_SUPABASE_SERVICE_ROLE_KEY are required');
if (url.includes(PROD_REF)) die('DEV_SUPABASE_URL is the PRODUCTION project');
if (!url.includes(DEV_REF)) die('DEV_SUPABASE_URL does not contain ' + DEV_REF);
const TENANT0 = '00000000-0000-0000-0000-000000000000';
const USERS = [
  ['abraham', 'Abraham Dev', true], ['sam', 'Sam Supervisor', true], ['wanda', 'Wanda Worker', true],
  ['sally', 'Sally Sales', true], ['dana', 'Dana Developer', true], ['bob', 'Bob Beta', false],
].map(([n, full, tenant]) => ({ email: n + '@quest.test', full, tenant }));
const file = homedir() + '/.questhq-dev-users.json';
const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
for (const u of USERS) {
  const password = saved[u.email] || randomBytes(18).toString('base64url');
  const res = await fetch(url + '/auth/v1/admin/users', {
    method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: u.email, password, email_confirm: true,
      user_metadata: { full_name: u.full }, app_metadata: u.tenant ? { tenant_id: TENANT0 } : {} }),
  });
  if (res.ok) { saved[u.email] = password; console.log('created  ' + u.email); }
  else if (res.status === 422 || res.status === 409) console.log('exists   ' + u.email);
  else die('HTTP ' + res.status + ' creating ' + u.email + ': ' + (await res.text()).slice(0, 200));
  writeFileSync(file, JSON.stringify(saved, null, 2)); chmodSync(file, 0o600);
}
console.log('passwords saved to ' + file + ' (mode 600). Next: tools/hosted-dev-verify.sh');
