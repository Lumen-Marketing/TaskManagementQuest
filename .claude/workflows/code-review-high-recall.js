export const meta = {
  name: 'code-review-high-recall',
  description: 'High-effort recall-biased code review: 7 finder angles + 1-vote verify over the working-tree diff',
  phases: [
    { title: 'Find', detail: '7 independent finder angles, up to 6 candidates each' },
    { title: 'Verify', detail: 'one recall-biased verifier per deduped candidate' },
  ],
}

const DIFF = `WORKING-TREE DIFF UNDER REVIEW (git diff HEAD). Repo: a vanilla-JS task app + Supabase. HEAD == upstream, so scope = these uncommitted changes.

--- js/views/ClockDashboardView.js ---
@@ liveRows fallback unchanged: const p = App.PEOPLE[timer.userId] || { name, full, color }  (NOTE: no id)
@@ NEW (lines ~61-85): builds roster union:
  const week0ms = week0.getTime();
  const activityIds = new Set();
  this.timeModel.allActive().forEach(t => activityIds.add(t.userId));        // line 69 — 2nd allActive() call; 'active' already holds it from line 35
  this.timeModel.entries.forEach(e => { if (e.start >= week0ms) activityIds.add(e.userId); });
  const roster = App.utils.activePeople([...activityIds]);
  const rosterIds = new Set(roster.map(p => p.id));
  const orphans = [...activityIds].filter(id => !rosterIds.has(id)).map(id => App.PEOPLE[id] || { id, name: id, full: id, color: '#E8A03A' });
  const everyone = [...roster, ...orphans].map(p => { todayMs/weekMs via totalForUser; isLive }).sort(...);
  // rows render App.utils.escapeHtml(p.full) — escaped.
  // team totals: everyone.reduce sum of todayMs / weekMs.

--- js/views/TimeView.js (renderResource) ---
@@ liveRows fallback CHANGED: const p = App.PEOPLE[timer.userId] || { id: timer.userId, name: timer.userId, full: timer.userId, color: '#E8A03A' };  // line 127
@@ liveRows template line 134 renders: \${App.utils.avatarHtml(p)}\${p.name}     // p.name NOT escaped (unchanged line)
@@ NEW (lines ~145-158): same roster-union block as ClockDashboard but reuses 'active' var:
  active.forEach(t => activityIds.add(t.userId));
  ...
  const peopleRows = [...roster, ...orphans].map(p => { ... });
@@ peopleRows template line 166 renders: \${App.utils.avatarHtml(p)}\${p.name}   // p.name NOT escaped (unchanged line)

--- js/views/LoginView.js (~line 256) ---
- avatarEl.innerHTML = \`<img src="\${meta.avatar_url}" alt="" />\`;
+ const img = document.createElement('img'); img.src = meta.avatar_url; img.alt=''; avatarEl.replaceChildren(img);
  // XSS fix: meta.avatar_url is account-owner-controlled auth metadata.

--- supabase/functions/notify-email/index.ts (~line 122) ---
  const ALLOWED_CALLER_ROLES = new Set([
-   "admin", "construction_supervisor", "developer", "supervisor", "sales",
+   "admin", "developer", "supervisor", "worker",
  ]);
  // removed construction_supervisor + sales; added worker. Comment claims no profile holds retired roles after migration 032.

--- supabase/sql/032_retire_member_sales_construction_supervisor.sql ---
  Renamed from 026_retire_... (comment: original 026 was a DUPLICATE 026 filename and was SKIPPED on the live DB).
  Reassigns member/sales->worker, construction_supervisor->supervisor. Recreates handle_new_user() to stamp 'worker'. Idempotent.

--- supabase/sql/031_sync_team_member_names_from_profiles.sql ---
  Only working-tree change: a comment line now reads "handle_new_user() (migrations 032/029/033)".
  (file body: backfill team_members.name/full_name/avatar_url from profiles; AFTER trigger sync_team_member_from_profile; SECURITY DEFINER.)

--- supabase/sql/033_harden_member_id_and_role_integrity.sql (committed, depends on 032) ---
  collision-proof handle_new_user member_id; unique index on profiles.member_id only if no dupes; tighten profiles_role_check to live 4 roles.

KEY HELPERS:
- App.utils.activePeople(includeIds): returns Object.values(App.PEOPLE) filtered to approved profile member_ids PLUS includeIds; if !App.PROFILES.length returns ALL App.PEOPLE and IGNORES includeIds; if filtered list empty returns ALL.
- App.utils.avatarHtml(person): escapes avatar_url, uses initials — safe.
- App.utils.escapeHtml exists.
- TimeModel: entries = [{id,userId,taskId,start(ms),end,durationMs}]; allActive()->[{userId,taskId,startedAt}]; totalForUser(userId,sinceMs) sums durationMs where e.start>=sinceMs plus live; isRunning(userId).
- App.ROLES = {worker, supervisor, admin, developer}.

The reviewer must Read the actual files to confirm line numbers/context. Files are under js/views/, js/utils.js, supabase/functions/notify-email/index.ts, supabase/sql/.`

const CAND_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string' },
        },
        required: ['file', 'line', 'summary', 'failure_scenario'],
      },
    },
  },
  required: ['candidates'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
}

const ANGLES = [
  { key: 'A-line-by-line', instr: 'Angle A — line-by-line diff scan. Read every hunk, then Read the enclosing function. For every line ask what input/state/timing/platform makes it wrong: inverted conditions, off-by-one, null/undefined deref, missing await, falsy-zero, wrong-variable copy-paste, swallowed errors, unescaped interpolation.' },
  { key: 'B-removed-behavior', instr: 'Angle B — removed-behavior auditor. For every DELETED/replaced line, name the invariant it enforced and find where the new code re-establishes it. If missing, that is a candidate: removed guard, dropped error path, narrowed validation. Focus on LoginView innerHTML->DOM, notify-email role removal, and the activePeople()->activePeople([...activityIds]) swap.' },
  { key: 'C-cross-file', instr: 'Angle C — cross-file tracer. For each changed function find callers/callees (Grep). Does notify-email role removal break existing callers? Does the roster-union depend on migration ordering (032/033 applied on live)? Does activePeople([...activityIds]) interact badly with its !PROFILES.length / empty-list fallbacks?' },
  { key: 'Reuse', instr: 'Reuse angle (cleanup). Flag new code that re-implements existing helpers. Note duplication: the SAME roster-union block is copy-pasted into ClockDashboardView and TimeView. Name the shared util it should be extracted to (App.utils). State the maintenance cost.' },
  { key: 'Simplification', instr: 'Simplification angle (cleanup). Flag redundant/derivable state, copy-paste with slight variation, dead code. e.g. ClockDashboardView calls allActive() twice; the orphan {id,name,full,color} literal is repeated 4x with slight variation. Name the simpler form.' },
  { key: 'Efficiency', instr: 'Efficiency angle (cleanup). Flag wasted work: redundant computation/IO, sequential independent ops. e.g. second allActive() call; iterating this.timeModel.entries fully on every render. Name the cheaper alternative; state the cost.' },
  { key: 'Altitude', instr: 'Altitude angle. Is each fix at the right depth or a fragile bandaid? The orphan-synthesis + roster-union is a special-case layered on activePeople — should activePeople itself handle activity-backed ids? Is the notify-email allowlist the right place vs deriving from App.ROLES? State the maintenance cost.' },
]

phase('Find')
const finderResults = await parallel(ANGLES.map(a => () =>
  agent(
    `You are a code reviewer running ONE finder angle for a recall-biased high-effort review. Surface UP TO 6 candidate findings, each with file, line (best estimate), one-line summary, and a concrete failure_scenario (real inputs/state -> wrong output/crash, or for cleanup the concrete duplicated/wasted cost). Pass through every candidate with a nameable failure scenario — do not self-censor half-believed ones. Read the actual files to confirm context.\n\n${a.instr}\n\n=== DIFF / CONTEXT ===\n${DIFF}`,
    { label: `find:${a.key}`, phase: 'Find', schema: CAND_SCHEMA }
  ).then(r => (r?.candidates || []).map(c => ({ ...c, angle: a.key })))
))

const all = finderResults.filter(Boolean).flat()
log(`${all.length} raw candidates from ${ANGLES.length} finders`)

// Dedup near-duplicates: same file + same defect keyword bucket
const seen = new Map()
const deduped = []
for (const c of all) {
  const key = `${(c.file || '').toLowerCase()}::${(c.summary || '').toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 6).join(' ')}`
  if (seen.has(key)) continue
  seen.set(key, true)
  deduped.push(c)
}
log(`${deduped.length} candidates after dedup`)

phase('Verify')
const verified = await parallel(deduped.map(c => () =>
  agent(
    `Recall-biased verifier. Return exactly one verdict for the candidate below.\nPLAUSIBLE by default for realistic state (races, nil on rare-but-reachable path, falsy-zero, off-by-one on a non-excluded boundary, regex/allowlist losing an anchor, deploy/migration ordering).\nREFUTED only if constructible from code: factually wrong (quote the line), provably impossible (cite invariant), already handled in this diff (cite guard), or pure style with no observable effect.\nRead the actual file(s) to decide.\n\nCANDIDATE:\nfile: ${c.file}\nline: ${c.line}\nsummary: ${c.summary}\nfailure_scenario: ${c.failure_scenario}\nangle: ${c.angle}\n\n=== DIFF / CONTEXT ===\n${DIFF}`,
    { label: `verify:${(c.file || '').split('/').pop()}:${c.line}`, phase: 'Verify', schema: VERDICT_SCHEMA }
  ).then(v => ({ ...c, verdict: v?.verdict, reason: v?.reason }))
))

const kept = verified.filter(Boolean).filter(v => v.verdict === 'CONFIRMED' || v.verdict === 'PLAUSIBLE')
log(`${kept.length} kept (CONFIRMED/PLAUSIBLE) of ${verified.length} verified`)

return { kept, dropped: verified.filter(v => v && v.verdict === 'REFUTED') }