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
// harfbuzz (inside subset-font) wants an uncompressed sfnt as input — feed it
// the TTF source; the OUTPUT is woff2.
const FULL_TTF = 'vendor/tabler-icons/fonts/tabler-icons.ttf';
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
//    composed class names — `'ti-…' + var` concatenation or `ti-…${expr}`
//    template interpolation — which this scan cannot see. The lookbehind stops
//    substring matches inside words like "multi-assignee".
const used = new Set();
const dynamic = [];
for (const f of files) {
  const src = await readFile(f, 'utf8');
  for (const m of src.matchAll(/(?<![a-zA-Z0-9])ti-[a-z0-9-]+/g)) {
    if (m[0] !== 'ti-tabler') used.add(m[0]);
  }
  for (const m of src.matchAll(/(?<![a-zA-Z0-9])ti-[a-z0-9-]*(?:\$\{|['"]\s*\+)/g)) {
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

// 4. Subset the TTF to exactly the used glyphs; emit woff2.
//    Tabler 3.5.0's webfont ships malformed GSUB/GPOS layout tables that make
//    harfbuzz (and opentype.js) abort. The app addresses glyphs purely by
//    codepoint (CSS content:"\eaxx"), so layout tables are dead weight — strip
//    the sfnt down to the tables an icon font actually needs before subsetting.
function stripSfnt(buf, keep) {
  const num = buf.readUInt16BE(4);
  const recs = [];
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    recs.push({ tag: buf.toString('ascii', o, o + 4), checksum: buf.readUInt32BE(o + 4), off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) });
  }
  const kept = recs.filter((r) => keep.includes(r.tag)).sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = kept.length;
  const e = Math.floor(Math.log2(n));
  const sr = 2 ** e * 16;
  const head = Buffer.alloc(12);
  buf.copy(head, 0, 0, 4);
  head.writeUInt16BE(n, 4); head.writeUInt16BE(sr, 6); head.writeUInt16BE(e, 8); head.writeUInt16BE(n * 16 - sr, 10);
  let off = 12 + n * 16;
  const dir = Buffer.alloc(n * 16);
  const chunks = [];
  kept.forEach((r, i) => {
    const pad = (4 - (r.len % 4)) % 4;
    const data = Buffer.concat([buf.subarray(r.off, r.off + r.len), Buffer.alloc(pad)]);
    dir.write(r.tag, i * 16, 'ascii');
    dir.writeUInt32BE(r.checksum, i * 16 + 4);
    dir.writeUInt32BE(off, i * 16 + 8);
    dir.writeUInt32BE(r.len, i * 16 + 12);
    chunks.push(data);
    off += data.length;
  });
  return Buffer.concat([head, dir, ...chunks]);
}
const KEEP_TABLES = ['cmap', 'glyf', 'loca', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post'];
const chars = glyphs.map((n) => String.fromCodePoint(map.get(n))).join('');
const full = stripSfnt(await readFile(FULL_TTF), KEEP_TABLES);
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
