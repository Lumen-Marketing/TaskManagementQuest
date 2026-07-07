# C1 — Collapse the Mobile Load Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Quest HQ's mobile first-paint from ~9–15 s to low seconds by deferring all 56 blocking scripts, pruning 6 dead font families, subsetting the 799 KB icon font to ~25 KB, and flipping the service worker to cache-first for versioned static assets.

**Architecture:** app.html is the app-shell module's interface; this plan shrinks it. Four independent levers, each its own ship-safe commit: fonts (dead-code removal), icons (build-time subset committed to vendor/), scripts (`defer` everywhere except `js/theme-boot.js`, with a CSS-only loader first frame), SW (cache-first keyed on `?v=BUILD_ID` URLs stamped at deploy by tools/build-env.mjs). Spec: `docs/superpowers/specs/2026-07-08-mobile-perf-architecture-program-design.md`.

**Tech Stack:** vanilla JS zero-build SPA, Node ≥20 tooling, `subset-font` (devDependency only), Playwright (existing devDependency) for verification, Vercel static deploy.

## Global Constraints

- **No bundler, no framework** (ADR-0002). Dev files == prod files except the deploy-time stamps build-env.mjs applies.
- **CSP has no `script-src 'unsafe-inline'`** (vercel.json) — never add inline `<script>`; inline `<style>` IS allowed (`style-src 'unsafe-inline'`).
- **`js/theme-boot.js` stays render-blocking in `<head>`** — it must run before first paint (theme flash).
- **Zero boss-visible UX change without sign-off:** the loader must look like today's first frame, just sooner. All surfaces verified via the screenshot harness (light + dark + mobile) before merge.
- **Execution order of the 56 scripts must be preserved** — `defer` guarantees document order; never mix in `async`.
- Execute this plan in an isolated worktree (superpowers:using-git-worktrees) branched from latest `main`; verify branch before every commit (a second session sometimes flips branches in the main checkout).
- Windows dev box: run commands in Git Bash syntax; paths in the repo are relative.

**Spec deviation (documented):** the spec says "preload the two kept families." Google Fonts serves UA-specific, hash-named woff2 URLs, so `<link rel="preload">` on font *files* is brittle and can double-download. The existing `preconnect` pair already covers the win. We keep preconnect and skip file preload. If the boss wants zero-network fonts later, self-hosting is the correct follow-up (out of scope).

---

### Task 1: Prune dead font families (8 → 2)

**Files:**
- Modify: `app.html:17`
- Modify: `index.html:17`
- Modify: `taskmanagement.css:6223` (delete dead `--font-serif`)

**Interfaces:**
- Consumes: nothing.
- Produces: both pages request exactly `Hanken Grotesk (400;500;600;700;800)` + `IBM Plex Mono (400;500;600)`. Later tasks assume no other Google families exist.

Evidence (from the audit, re-verifiable): every live `font-family` in loaded CSS resolves to Hanken Grotesk or IBM Plex Mono; Inter / Plus Jakarta Sans / IBM Plex Sans / IBM Plex Sans Condensed / JetBrains Mono / Fraunces appear only in comments and one never-reached `var()` fallback. Bonus fix: index.html today requests *neither* Hanken nor anything `login.css` resolves to — login has been silently rendering system-ui; after this task the login page gets the brand font for the first time.

- [ ] **Step 1: Re-verify the families are dead** (fail-safe before deleting)

Run:
```bash
grep -nE "font-family[^;]*(Inter|Jakarta|Plex Sans|JetBrains|Fraunces)" tokens.css taskmanagement.css login.css css/*.css | grep -v "var(--font-display,"
```
Expected: **no output** (the only hit for these names is the dead fallback inside `var(--font-display, 'Plus Jakarta Sans', …)` at taskmanagement.css:6941, excluded by the grep). If anything else prints, STOP and report — the audit was wrong.

- [ ] **Step 2: Replace the Google Fonts link in `app.html` line 17**

Old line 17 (single line, 8 families). Replace with:
```html
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Replace the Google Fonts link in `index.html` line 17** with the **identical** line from Step 2 (index currently requests IBM Plex Mono/Sans/Sans Condensed — Sans and Condensed are dead, Hanken is missing).

- [ ] **Step 4: Delete the dead serif token** — remove this whole line from taskmanagement.css (currently line 6223):
```css
:root { --font-serif: 'Fraunces', Georgia, 'Times New Roman', serif; }
```

- [ ] **Step 5: Verify nothing references the deleted token**

Run: `grep -rn "font-serif" taskmanagement.css tokens.css css/ login.css js/ app.html index.html`
Expected: no output.

- [ ] **Step 6: Visual verification** — screenshot harness (see `memory: reference_screenshot_harness`; script pattern `shot.js`) against `taskdetail-preview.html` and `newtask-preview.html` in light + dark + mobile-width. Headings must still render Hanken Grotesk (they will — it's still requested); nothing may fall back to serif.

- [ ] **Step 7: Commit**
```bash
git rev-parse --abbrev-ref HEAD   # MUST print the c1 worktree branch
git add app.html index.html taskmanagement.css
git commit -m "perf(fonts): prune 6 dead Google font families (8→2), give login the brand font"
```

---

### Task 2: Icon-subset tool + generated artifacts

**Files:**
- Create: `tools/subset-icons.mjs`
- Create (generated, committed): `vendor/tabler-icons/tabler-icons-subset.css`, `vendor/tabler-icons/fonts/tabler-icons-subset.woff2`
- Modify: `package.json` (devDependency `subset-font`, script `icons:subset`)

**Interfaces:**
- Consumes: `vendor/tabler-icons/tabler-icons.min.css` (full glyph map, stays in repo as the subset SOURCE, no longer shipped) and `vendor/tabler-icons/fonts/tabler-icons.woff2`.
- Produces: `tabler-icons-subset.css` defining `@font-face { font-family:'tabler-icons'; font-display:block }` + the `.ti` base rule + one `.ti-<name>:before` rule per used glyph. Task 3 swaps the `<link>`s to it.

- [ ] **Step 1: Add the devDependency**
```bash
npm install --save-dev subset-font@^2.3.0
```
Expected: package.json gains `"subset-font": "^2.3.0"`; node_modules is already gitignored.

- [ ] **Step 2: Write `tools/subset-icons.mjs`**

```js
#!/usr/bin/env node
/* Regenerates the shipped Tabler icon subset. RUN THIS whenever a new ti-*
   icon is introduced anywhere in js/, app.html, index.html, or the preview
   harnesses — a missing glyph renders as a blank box. Dev-only tool: the
   generated subset css+woff2 are committed; the full font stays in vendor/
   as the source and is NOT linked by any page. Pure Node (no shell tools —
   must run on Windows dev boxes and any CI alike).
   Usage: npm run icons:subset */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import subsetFont from 'subset-font';

const FULL_CSS = 'vendor/tabler-icons/tabler-icons.min.css';
const FULL_WOFF2 = 'vendor/tabler-icons/fonts/tabler-icons.woff2';
const OUT_CSS = 'vendor/tabler-icons/tabler-icons-subset.css';
const OUT_WOFF2 = 'vendor/tabler-icons/fonts/tabler-icons-subset.woff2';

// 1. Collect every source file: js/ (recursive) + the four HTML entry points.
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = [
  ...await walk('js'),
  'app.html', 'index.html', 'taskdetail-preview.html', 'newtask-preview.html',
];

// 2. Every ti-* name referenced literally, plus a guard against dynamically-
//    composed class names ("ti-" + var), which this scan cannot see.
const used = new Set();
const dynamic = [];
for (const f of files) {
  const src = await readFile(f, 'utf8');
  for (const m of src.matchAll(/ti-[a-z0-9-]+/g)) {
    if (m[0] !== 'ti-tabler') used.add(m[0]);
  }
  for (const m of src.matchAll(/['"]ti-['"]\s*\+/g)) {
    dynamic.push(`${f}: ${m[0]}`);
  }
}
if (dynamic.length) {
  console.error('[subset-icons] Dynamic ti-* class construction found — add those icons manually:\n' + dynamic.join('\n'));
  process.exit(1);
}

// 3. Map names -> codepoints from the full CSS.
const usedList = [...used].sort();
const css = await readFile(FULL_CSS, 'utf8');
const map = new Map();
for (const m of css.matchAll(/\.ti-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)"/gi)) {
  map.set('ti-' + m[1], parseInt(m[2], 16));
}
// Names not in the full Tabler map are custom app classes that merely start
// with "ti-" (e.g. ti-assignee) or typos that were ALREADY broken with the
// full font — either way they can't be subset. Warn, don't abort.
const missing = usedList.filter((n) => !map.has(n));
if (missing.length) {
  console.warn('[subset-icons] Skipping non-Tabler ti-* names (custom classes or pre-existing typos): ' + missing.join(', '));
}
const glyphs = usedList.filter((n) => map.has(n));

// 4. Subset the woff2 to exactly the used glyphs.
const chars = glyphs.map((n) => String.fromCodePoint(map.get(n))).join('');
const full = await readFile(FULL_WOFF2);
const subset = await subsetFont(full, chars, { targetFormat: 'woff2' });
await writeFile(OUT_WOFF2, subset);

// 5. Emit the minimal CSS: @font-face (font-display: block — icons must not
//    flash as ligature text), the .ti base rule, and only the used glyphs.
const base = `@font-face{font-family:'tabler-icons';font-style:normal;font-weight:400;font-display:block;src:url('fonts/tabler-icons-subset.woff2') format('woff2')}
.ti{font-family:'tabler-icons'!important;speak:never;font-style:normal;font-weight:normal;font-variant:normal;text-transform:none;line-height:1;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
`;
const rules = glyphs.map((n) => `.${n}:before{content:"\\${map.get(n).toString(16)}"}`).join('\n');
await writeFile(OUT_CSS, base + rules + '\n');

console.log(`[subset-icons] ${glyphs.length} glyphs -> ${OUT_WOFF2} (${subset.length} bytes), ${OUT_CSS}`);
```

- [ ] **Step 3: Add the npm script** — in package.json `"scripts"`, add:
```json
"icons:subset": "node tools/subset-icons.mjs"
```

- [ ] **Step 4: Run it**

Run: `npm run icons:subset`
Expected: `[subset-icons] ~125 glyphs -> vendor/tabler-icons/fonts/tabler-icons-subset.woff2 (<40000 bytes), vendor/tabler-icons/tabler-icons-subset.css`. If it exits 1 listing dynamic constructions or missing names, fix those first (report them in the task summary).

- [ ] **Step 5: Sanity-check the output**
```bash
ls -la vendor/tabler-icons/fonts/tabler-icons-subset.woff2   # expect ~15-40 KB (vs 799 KB full)
grep -c ":before" vendor/tabler-icons/tabler-icons-subset.css # expect ~125
grep "font-display:block" vendor/tabler-icons/tabler-icons-subset.css # expect 1 hit
```

- [ ] **Step 6: Commit**
```bash
git add tools/subset-icons.mjs package.json package-lock.json vendor/tabler-icons/tabler-icons-subset.css vendor/tabler-icons/fonts/tabler-icons-subset.woff2
git commit -m "build(icons): add Tabler subset tool + generated ~25KB subset (125 glyphs, font-display:block)"
```

---

### Task 3: Ship the icon subset (swap the links)

**Files:**
- Modify: `app.html:18`, `index.html:18`, `taskdetail-preview.html:8`, `newtask-preview.html` (its tabler `<link>`)

**Interfaces:**
- Consumes: Task 2's `tabler-icons-subset.css`.
- Produces: no page loads the 221 KB full CSS or 799 KB full woff2.

- [ ] **Step 1: Swap all four links.** In each file replace
```html
<link rel="stylesheet" href="vendor/tabler-icons/tabler-icons.min.css">
```
with
```html
<link rel="stylesheet" href="vendor/tabler-icons/tabler-icons-subset.css">
```
(In the preview harnesses the path may be identical — same replacement.)

- [ ] **Step 2: Verify no page still links the full set**

Run: `grep -rn "tabler-icons.min.css" app.html index.html *.html`
Expected: no output.

- [ ] **Step 3: Visual verification** — screenshot harness on `taskdetail-preview.html` (light + dark + mobile). Check specifically: side-arrow chevrons (`ti-chevron-left/right`), topbar bolt (`ti-bolt`), watch eye, dots menu. Any blank box = a glyph missed by the subset — STOP and re-run Task 2 Step 4.

- [ ] **Step 4: Commit**
```bash
git add app.html index.html taskdetail-preview.html newtask-preview.html
git commit -m "perf(icons): serve the 25KB icon subset everywhere (was 221KB css + 799KB woff2)"
```

---

### Task 4: Static loader first frame (CSS-only shell)

**Files:**
- Modify: `app.html:30` (the `#appLoader` div)
- Modify: `js/views/LoaderView.js:29-33` (`build()` — clear static frame before building the grid)

**Interfaces:**
- Consumes: existing `.ldr-brand/.ldr-logo/.ldr-name/.ldr-dots` CSS (taskmanagement.css:6914-6955 — pure CSS, no JS required).
- Produces: `#appLoader` paints the brand frame as soon as CSS loads, before ANY script runs. Task 5 depends on this (with defer, LoaderView runs late).

- [ ] **Step 1: Put the static first frame inside the loader div.** Replace `<div id="appLoader" aria-hidden="true"></div>` (app.html line 30) with:
```html
<div id="appLoader" aria-hidden="true">
  <!-- Static first frame: identical to LoaderView's brand block so the loader
       is visible from first paint. LoaderView.build() replaces this wholesale
       with the animated grid version once scripts run (deferred). -->
  <section class="ldr-intro">
    <div class="ldr-brand">
      <div class="ldr-logo"><i class="ti ti-bolt"></i></div>
      <div class="ldr-name">Quest HQ</div>
      <div class="ldr-dots"><span></span><span></span><span></span></div>
    </div>
  </section>
</div>
```

- [ ] **Step 2: Make LoaderView replace (not append to) the static frame.** In `js/views/LoaderView.js` `build()`, the current guard is:
```js
    const root = document.getElementById('appLoader');
    if (!root || root.dataset.built) return;
    root.dataset.built = '1';
```
Immediately after those lines, add:
```js
    root.innerHTML = ''; // drop the static first frame; the animated grid replaces it
```
(The animated version re-creates the same `.ldr-brand` block, so there's no visual jump — the grid tiles fade in around it.)

- [ ] **Step 3: Verify the static frame stands alone.** Run the screenshot harness pattern against `app.html` with JS disabled:
```js
// shot-loader.js — same skeleton as shot.js; key lines:
const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
await page.goto('file:///<abs-path>/app.html');
await page.screenshot({ path: 'loader-static.png' });
```
Expected screenshot: dark #050505 full-screen, bolt logo + "Quest HQ" + three dots, centered — matching today's loader brand block. (Icon may show blank with file:// if the font hasn't loaded — verify shape/text, icon verified in Step 4.)

- [ ] **Step 4: Verify the live handoff** — `npm run dev`, open the printed localhost URL for app.html in Playwright WITH JS, screenshot at 300 ms: the brand frame must be there; by ~1.5 s the grid tiles appear behind it (LoaderView). No flash/jump between the two.

- [ ] **Step 5: Commit**
```bash
git add app.html js/views/LoaderView.js
git commit -m "perf(loader): static CSS-only first frame; LoaderView swaps in the animated grid"
```

---

### Task 5: `defer` all scripts except theme-boot

**Files:**
- Modify: `app.html` lines 31-32 (GSAP + LoaderView) and lines 242-306 (the MVC block)

**Interfaces:**
- Consumes: Task 4 (loader no longer needs early JS).
- Produces: exactly ONE non-deferred external script in app.html (`js/theme-boot.js`). All 56 others carry `defer`. Execution order unchanged (defer preserves document order).

- [ ] **Step 1: Add `defer` to the loader pair** (app.html:31-32):
```html
<script defer src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script defer src="js/views/LoaderView.js"></script>
```
Also update the comment above them: the loader div is now painted by the static frame (Task 4); LoaderView animates it post-parse.

- [ ] **Step 2: Add `defer` to every script tag from line 242 (`@supabase/supabase-js@2`) through line 306 (`js/register-sw.js`)** — all 54 tags, e.g.:
```html
<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script defer src="js/EventBus.js"></script>
...
<script defer src="js/app.js"></script>
<script defer src="js/register-sw.js"></script>
```
Do NOT touch line 24 (`js/theme-boot.js` — stays blocking by design; see Global Constraints).

- [ ] **Step 3: Mechanical verification**
```bash
grep -c "<script defer" app.html          # expect 56
grep -n "<script src" app.html            # expect exactly ONE line: js/theme-boot.js
```

- [ ] **Step 4: Boot verification** — with `npm run dev` running, use a Playwright node script (screenshot-harness skeleton) against the local app.html:
  - collect `page.on('console')` errors and `page.on('pageerror')`: expect **none** (an out-of-order execution bug would throw "App.X is undefined" immediately);
  - unauthenticated: expect redirect to `/index.html` (auth-guard) — login page paints;
  - screenshot the login page (light + dark + 390px mobile) — visually identical to before this plan.

- [ ] **Step 5: Boss-flow spot-check via preview harnesses** — screenshot `taskdetail-preview.html` (loads the real TaskDetailView) to confirm views still attach to `App.*` correctly in deferred order.

- [ ] **Step 6: Commit**
```bash
git add app.html
git commit -m "perf(boot): defer all 56 scripts (theme-boot stays blocking) — HTML parses/paints before 837KB of JS"
```

---

### Task 6: Stamp `?v=BUILD_ID` onto static asset URLs at deploy

**Files:**
- Modify: `tools/build-env.mjs` (append a stamping pass for app.html + index.html)

**Interfaces:**
- Consumes: the existing `buildId` computed for sw.js stamping (same value — one deploy, one id).
- Produces: on Vercel builds, every same-origin `href`/`src` for css/js/woff2 in app.html and index.html carries `?v=<buildId>`. Task 7's SW treats any same-origin URL with `?v=` as immutable. Dev is untouched (the tool only runs on Vercel).

- [ ] **Step 1: Restructure the buildId so both stamps share it.** In `tools/build-env.mjs`, the sw.js stamp block (lines 72-89) computes `buildId` inside its `try`. Lift the computation above it:
```js
const buildId = (
  release ||
  createHash('sha256').update(String(Date.now())).digest('hex')
).slice(0, 12);
```
and change the sw.js block to use this shared `buildId` (delete its local computation; keep its placeholder-check + no-op semantics exactly as they are).

Note: the old fallback hashed sw.js's own source "so an unchanged worker keeps a stable id" — that property matters less than asset-URL freshness now; on Vercel `release` (the commit SHA) is always present anyway, so the fallback only fires off-Vercel.

- [ ] **Step 2: Append the HTML stamping pass** at the end of the file:
```js
// Stamp ?v=BUILD_ID onto same-origin static asset URLs so the service worker
// can serve them cache-first as immutable (ADR-0001). Idempotent: skips URLs
// that already carry ?v=. Only local css/js/woff2 are stamped — CDN URLs,
// env.json, and manifest are left alone.
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
```

- [ ] **Step 3: Test the stamp locally on throwaway copies** (never against the working tree — the tool mutates in place):
```bash
mkdir -p /tmp/stamptest && cp app.html index.html sw.js /tmp/stamptest/ && cd /tmp/stamptest
SUPABASE_URL="https://qqvmcsvdxhgjooirznrj.supabase.co" SUPABASE_ANON_KEY="dummy-key-for-stamp-test" RELEASE="abc123def456" node "<abs-repo-path>/tools/build-env.mjs"
grep -c "?v=abc123def456" app.html    # expect ~60 (5 css + subset css + 56 js + theme-boot)
grep -n "cdn.jsdelivr" app.html | grep "?v="   # expect NO output (CDN untouched)
grep -n "env.json?v" app.html          # expect NO output
cd - && rm -rf /tmp/stamptest
```
Also re-run the tool twice on the same copies: second run must print nothing new (idempotent — `[^"?]` stops re-stamping).

- [ ] **Step 4: Commit**
```bash
git add tools/build-env.mjs
git commit -m "build: stamp ?v=BUILD_ID onto local asset URLs at deploy (ADR-0001 groundwork)"
```

---

### Task 7: Service worker — cache-first for versioned assets

**Files:**
- Modify: `sw.js` (header comment lines 1-14 + fetch handler lines 38-81)

**Interfaces:**
- Consumes: Task 6's `?v=` URLs (prod only; dev URLs carry no `?v=` and keep today's behavior exactly).
- Produces: same-origin GETs with a `v` query param are served cache-first; everything else keeps current network-first semantics.

- [ ] **Step 1: Rewrite the header comment** (lines 1-14) to reflect the split strategy — replace the first paragraph with:
```js
/* Quest HQ service worker.
   Strategy (ADR-0001, docs/adr/0001-cache-first-versioned-static-assets.md):
   - VERSIONED static assets (same-origin URLs carrying ?v=BUILD_ID, stamped by
     tools/build-env.mjs at deploy) are immutable → CACHE-FIRST. A new deploy
     changes the URL, so freshness is guaranteed by the version, not revalidation.
   - Everything else same-origin (HTML/navigations, un-versioned dev assets)
     stays NETWORK-FIRST with conditional revalidation — the latest deploy
     always wins when online; cache is the offline fallback.
   Do NOT "restore" network-first-everything without reading the ADR. */
```
(Keep the existing cross-origin/env.json paragraph and BUILD_ID lines 15-17 unchanged.)

- [ ] **Step 2: Insert the cache-first branch** in the fetch handler, after the env.json guard (line 46) and before the `dest` logic:
```js
  // Immutable versioned assets (?v= stamped at deploy): cache-first.
  if (url.searchParams.has('v')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }
```
The existing network-first block below it stays byte-identical.

- [ ] **Step 3: Syntax + behavior check**
```bash
node --check sw.js
```
Expected: silence. Behavioral verification is deploy-time (Step 5) because dev URLs are never versioned.

- [ ] **Step 4: Commit**
```bash
git add sw.js
git commit -m "perf(sw): cache-first for ?v= versioned assets, network-first for the rest (ADR-0001)"
```

- [ ] **Step 5 (post-deploy, after merge): prod verification checklist** — document the results in the PR/summary:
  1. Open the prod URL → DevTools → Application → Service Workers: new SW active, cache name `questhq-<sha>`.
  2. Network tab, reload: css/js rows show `?v=<sha>` and, on second reload, "(ServiceWorker)" as the source with ~0 ms times.
  3. Deploy a trivial change → open a stale tab → navigate: new HTML → new `?v=` URLs fetched → UpdateWatcher reload works as before.

---

### Task 8: Full verification sweep + ship

**Files:** none new — this is the gate.

- [ ] **Step 1:** Screenshot harness: login page + `taskdetail-preview.html` + `newtask-preview.html`, each light + dark + 390px mobile. Compare against `main` versions of the same shots: **zero intended visual differences** (fonts identical, icons identical, loader identical-but-earlier).
- [ ] **Step 2:** Boot check from Task 5 Step 4 rerun: no console errors, login redirect intact.
- [ ] **Step 3:** `npm run icons:subset` again — must be a no-op (idempotent, nothing new to commit).
- [ ] **Step 4:** Measure and record in the final summary: `grep -c "script defer" app.html` (56), subset woff2 bytes vs 799 KB, Google Fonts URL family count (2), and the head's total render-blocking local CSS list (unchanged 6 files — CSS split is out of scope, C1 doesn't touch it).
- [ ] **Step 5:** Merge via superpowers:finishing-a-development-branch (user decides merge/PR). After Vercel deploys, run Task 7 Step 5's prod checklist.
- [ ] **Step 6:** Re-measure the C6 attrition metric (taskdetail-preview stub member count — expected unchanged this candidate: 24) and note it in the summary, per the program spec.

---

## Self-review notes

- **Spec coverage:** fonts ✓ (T1), icons ✓ (T2+T3), defer + CSS shell ✓ (T4+T5), SW + versioning ✓ (T6+T7), ADR refs ✓, out-of-scope respected (no CSS split, no bundling, no precache-all). Preload deviation documented in Global Constraints.
- **Type consistency:** `buildId` name shared across T6 steps; `?v=` param name consistent in T6 regex and T7 `searchParams.has('v')`; subset file names identical across T2/T3.
- **No placeholders:** every code step carries the actual code; every command carries expected output.
