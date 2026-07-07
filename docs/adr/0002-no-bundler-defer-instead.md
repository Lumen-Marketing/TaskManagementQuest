# No bundler — `defer` on 56 script tags instead of concatenation

The mobile load path needed the 56 blocking script tags fixed. We considered concatenating them into 2–3 bundles via tools/build-env.mjs at deploy and rejected it: dev (56 files) and prod (3 files) would diverge, eroding the zero-build property that keeps this repo simple to work on. Instead every script except theme-boot.js gets `defer` — execution order is preserved, HTML parses and paints immediately, and dev equals prod.

Status: accepted (2026-07-08).

If someone proposes bundling again: the objection was never request count (HTTP/2 multiplexes; the SW caches) — it was dev/prod divergence.
