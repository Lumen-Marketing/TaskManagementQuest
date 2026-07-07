# Cache-first for versioned static assets in the service worker

sw.js was deliberately network-first for everything ("freshness prioritized over a few ms of load time" — its header comment), which makes every repeat mobile visit revalidate ~60 assets over the radio. We decided: static assets (JS/CSS/fonts) get `?v=BUILD_ID` stamped into app.html by tools/build-env.mjs at deploy and are served cache-first as immutable; HTML stays network-first, so a new deploy is still picked up on the next navigation. Freshness is preserved by the URL changing, not by revalidation.

Status: accepted (2026-07-08). Supersedes the in-code network-first-everything decision — do not "restore" it without re-reading this.

Consequences: dev (no build step) runs unversioned and effectively network-first, which is fine; anyone adding a new static asset to app.html must not hand-write a `?v=` — the stamp is applied at deploy.
