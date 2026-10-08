# Runbook — rebuild the hosted DEV database (`ydrekmghdbpkothhmbut`)

**Status: PREPARED, NOT EXECUTED.** Nothing in this document has been run against either hosted
project. Every destructive step needs Alexia's explicit approval *at the time*.

| | Ref | Role |
|---|---|---|
| Production Quest HQ | `qqvmcsvdxhgjooirznrj` | **never touched by this runbook** |
| Candidate hosted DEV (old `quest-ops-prototype`) | `ydrekmghdbpkothhmbut` | reset + rebuilt here |

No secrets belong in this file. Connection strings and keys live in your shell/password
manager only (`DEV_DB_URL`, `DEV_SERVICE_KEY`, `DEV_ANON_KEY` below are *variable names*).

---

## 0. STOP conditions (do not proceed if any is true)

- Step 1 does not positively identify the target as `ydrekmghdbpkothhmbut`.
- Anything in step 2 still depends on the project and nobody has agreed to break it.
- Step 3's backups are not complete **and** verified readable.
- The donor branch in step 3.3 is still unpushed/unbundled.
- You are unsure which window/terminal holds which `DEV_DB_URL`. Close the production tabs first.

## 1. Prove the target is DEV, not production

```bash
export DEV_DB_URL='postgresql://postgres.ydrekmghdbpkothhmbut:<password>@<pooler-host>:5432/postgres'  # from the DEV dashboard only
case "$DEV_DB_URL" in
  *qqvmcsvdxhgjooirznrj*) echo "ABORT: production ref in DEV_DB_URL"; exit 1;;
  *ydrekmghdbpkothhmbut*) echo "ref ok";;
  *) echo "ABORT: cannot identify project ref"; exit 1;;
esac
```

Also confirm by eye in the Supabase dashboard: project name `quest-ops-prototype`, URL
`https://ydrekmghdbpkothhmbut.supabase.co`. Fingerprint the schema before touching it — it must
look like the *prototype*, not Quest HQ:

```sql
select to_regclass('public.work_items') is not null  as prototype_table_present,   -- expect true
       to_regclass('public.tasks')      is not null  as quest_hq_table_present;     -- expect false
```

If `quest_hq_table_present` is **true**, STOP — you are probably pointed at production.

## 2. Confirm nothing deployed still depends on it

`novum-quest-ops` (the donor) is a Next.js app whose Supabase URL/keys live in its untracked
`.env.local` (not opened by this review) and in any Vercel/GitHub settings. Check, in the dashboards:

- [ ] Vercel: any project built from `alexia-builds/novum-quest-ops` — Settings → Environment Variables → `*SUPABASE_URL*` pointing at this ref. Pause/remove, or accept it will break.
- [ ] GitHub `alexia-builds/novum-quest-ops` → Settings → Secrets: any Supabase secrets.
- [ ] Supabase DEV dashboard → Edge Functions: list anything deployed. Auth → URL Configuration: Site URL / redirect URLs. Database → Webhooks / Cron. Storage buckets.
- [ ] Other machines/people with the donor `.env.local`.

The Quest HQ repo has **no** reference to this ref (`git grep ydrekmghdbpkothhmbut` is empty), and
the donor's tracked files contain none either — the only place it can live is untracked env/settings.

## 3. Backups (all must exist and be test-readable before step 5)

1. **Full logical dump** (schema + data, all schemas you can read):
   ```bash
   pg_dump "$DEV_DB_URL" -Fc -f "quest-ops-prototype-$(date +%F).dump"
   pg_restore -l "quest-ops-prototype-$(date +%F).dump" | head      # must list objects
   ```
2. **Dashboard settings** (not in a dump): screenshot Auth → Providers, URL Configuration, Email
   templates/SMTP; Storage bucket list + policies; Edge Function list; API settings.
3. **Donor code — this is the one that is easy to lose.** At review time
   `novum-quest-ops` was on branch `novum-claude/work-management-v1` with **no upstream and 3 commits
   that exist on no remote**: `dcc3f7a` notifications/calendar, `ea85a5a` **underwriting proposal &
   contract workflow**, `556cb06` **estimate breakdown/history**, plus the migrations
   `20260930140000_underwriting_and_proposals.sql` and `20260930150000_underwriting_estimate_history.sql`.
   The proposal/contract code is the reference for the *next* Quest HQ slice. Preserve it first:
   ```bash
   cd /Users/alexiavalenzuela/pv-taskmanagementq/novum-quest-ops
   git bundle create ../novum-quest-ops-$(date +%F).bundle --all     # local, restorable
   git push -u origin novum-claude/work-management-v1                 # ONLY with Alexia's approval
   ```
4. Nothing in the prototype's *data* is believed worth migrating (it is a donor/reference), but
   `select count(*)` per table (step 4) tells you if that assumption is wrong.

## 4. Inventory (read-only) — know what you are about to destroy

```sql
-- public tables + approximate rows
select relname, n_live_tup from pg_stat_user_tables where schemaname='public' order by 1;
-- auth + storage
select count(*) as auth_users from auth.users;
select id, public from storage.buckets;
select bucket_id, count(*) from storage.objects group by 1;
-- code that lives in the DB
select proname from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by 1;
select tgname, tgrelid::regclass from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'auth.%';
select extname from pg_extension order by 1;
select jobname, schedule from cron.job;                       -- only if pg_cron is installed
select pubname, schemaname, tablename from pg_publication_tables;   -- realtime
```

Expected prototype contents (from the donor migrations): `companies`(uuid), `profiles`, `company_memberships`,
`jobs`, `clients`, `work_items`, `work_item_events`, `work_item_notifications`, `underwritings`,
`underwriting_field_changes`, `proposals`; trigger `on_auth_user_created` on `auth.users`.

## 5. Reset `public` (DESTRUCTIVE — needs explicit approval)

Reset only `public`. Never drop `auth`, `storage`, `extensions`, or `realtime`.

```sql
-- psql "$DEV_DB_URL" -v ON_ERROR_STOP=1
begin;
drop schema public cascade;      -- also drops the prototype's on_auth_user_created trigger (it depends on public.handle_new_user)
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
commit;

-- verify the prototype trigger is gone (it would write into the prototype's profiles)
select tgname from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal;   -- expect 0 rows
delete from auth.users;          -- prototype logins; identities cascade
```

Storage objects: remove through the Storage API/dashboard — direct `delete from storage.objects` is
blocked by Supabase. Optionally clear `supabase_migrations.schema_migrations` of prototype rows.

## 6. Bootstrap order (exactly what `tools/dev-rehearse.sh` proves locally)

Run as the `postgres` role (migration 029 installs a trigger on `auth.users`, which needs ownership),
with `psql -v ON_ERROR_STOP=1 -f <file>`; **stop at the first error**.

| # | File | Note |
|---|---|---|
| 1 | `supabase/sql/bootstrap/000_dev_baseline.sql` | `profiles` — reconciled against the production catalog |
| 2 | `supabase/sql/003` … `068` in name order | **skip 042** (production-only jsonb→text[] repair; nothing to repair on a clean DB). Run 004 *and* 020 as a pair (demo seed then clear) or neither. Both `059_*` run, in name order. |
| 3 | `supabase/sql/bootstrap/000b_dev_baseline_task_label_sops.sql` | **PROVISIONAL** — replace with the real definition first (§ Open items) |
| 4 | `supabase/sql/070_checkin_settings.sql`, `071_checkin_log.sql` | |
| 5 | pre-flight: the 20 tables 072 walls exist | 072's own Task 0 also enforces this |
| 6 | `supabase/sql/072_multitenant_foundation.sql` | |
| 7 | create auth users (§7), then `bootstrap/003_dev_signup_assertions.sql` is **local-only** (it inserts into `auth.users`) — use the matrix (§ test matrix) instead |
| 8 | `supabase/sql/bootstrap/001_dev_seed.sql` | after users exist (§8) |
| 9 | `supabase/sql/verify/072_isolation_check.sql` | wrapped in `begin; … rollback;` |
| 10 | `supabase/sql/073_underwriting.sql` (twice: idempotency) | |
| 11 | `supabase/sql/verify/073_underwriting_check.sql` | placeholders substituted |
| 12 | `supabase/sql/bootstrap/002_dev_underwriting_extras.sql`, `004_dev_postgrest_shape_check.sql` | |

Do **not** run `local_supabase_shim.sql` or `local_seed_auth_users.sql` on a hosted project — they
fake roles/`auth`/`storage` that Supabase already provides.

## 7. Recreate auth users (hosted: through the Auth admin API / dashboard, never SQL)

Six identities (emails on the reserved `.test` TLD; passwords from your password manager, never
committed): admin `abraham`, supervisor `sam`, worker `wanda`, sales `sally`, developer `dana`, and
**tenant-less** `bob`. For the first five set **`app_metadata: { tenant_id: "00000000-0000-0000-0000-000000000000" }`**
(server-only; this is the path the `create-user` function uses). `bob` gets no `app_metadata` (self-signup).
Create with `email_confirm: true`. **Never** put a tenant in `user_metadata` — it is ignored by design.

## 8. Seed fixtures

`001_dev_seed.sql` and the verify scripts use fixed ids `a0000000-0000-0000-0000-00000000000N`. Hosted
Auth assigns its own UUIDs, so substitute them in a copy:

```bash
sed -e 's/a0000000-0000-0000-0000-000000000001/<abraham-uuid>/g' … supabase/sql/bootstrap/001_dev_seed.sql > /tmp/seed.sql
```

## 9–10. 072 then 073

Expected: 072 emits `NOTICE`s only; 073 re-applies cleanly. Then the verify scripts print
`073 verify: ALL CHECKS PASSED` / `073 extras: ALL CHECKS PASSED` / `postgrest-shape: ALL CHECKS PASSED`.
Re-run 072's isolation check **after** 073 (the new tables ride the same wall).

## 11–13. Real-Supabase behaviour

Run the full matrix in `docs/runbooks/hosted-dev-test-matrix.md`: real signups, the `create-user` Edge
Function, PostgREST numeric strings, then the browser pass (set `env.json` to the **DEV** URL and
**anon** key; `node tools/dev-server.mjs`; sign in as each role).

## 14. Rollback / recovery

- **Bootstrap failed midway:** the reset in §5 is idempotent — re-run it and start the sequence
  from the top. No other state to clean.
- **Need the prototype back:** `createdb`-style restore into a *new* project (preferred):
  `pg_restore -d "$NEW_DB_URL" --no-owner quest-ops-prototype-<date>.dump`; restore Auth/Storage
  settings from the §3.2 screenshots; the donor code restores from the git bundle.
- **Production is unaffected by any of this** — no step uses a production connection string.

## Open items before executing

1. Run `tools/prod-catalog/task_label_sops.sql` in the **production** SQL editor (read-only) and replace
   the provisional `000b`. If it reports `table_exists:false`, 072 must treat the table as *optional*
   (see `underwriting-073-open-items.md` §3) — that is a numbered-migration change and needs a decision.
2. Decide whether production's missing `profiles.onboarded` column (migration 015) should be applied
   to production, or dev should diverge by one column.
3. Decide on the two proposed 073 amendments (`underwriting-073-open-items.md` §1–2).
4. Push or bundle the donor branch (§3.3).
