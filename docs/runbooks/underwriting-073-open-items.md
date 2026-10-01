# Underwriting / multitenant — open items found in the readiness pass

Everything here was reproduced or validated on a throwaway local **PostgreSQL 15.19**.
Nothing was applied to any hosted project. **073 is a numbered migration, so the two
database fixes below are proposals only — they are NOT in `073_underwriting.sql`** until
Alexia decides.

## 1. Concurrent `create_underwriting_for_task` race (reproduced)

Two sessions create the underwriting for the *same* Bid task at the same time (double-click in two
tabs, or two people). Both see "no link yet"; the second then hits the link's primary key and the
caller sees a raw `duplicate key value violates unique constraint "task_underwriting_links_pkey"`
**even though an underwriting now exists**. No data is corrupted (the loser's transaction rolls
back; zero orphans) — it is a spurious error.

Client mitigation **is already in the working tree** (`UnderwritingModel.createFor` shares one
in-flight request; unit-tested). The cross-session case needs the database fix. **Validated patch**
(second caller waits, then returns the same id; one link, zero orphans):

```sql
create or replace function public.create_underwriting_for_task(p_task_id text)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare t record; existing uuid; new_id uuid; me text := public.current_member_id();
begin
  select id, type, company_id, project_id into t from public.tasks where id = p_task_id;
  if not found then raise exception 'task not found'; end if;
  if t.type is distinct from 'bid' then raise exception 'underwriting can only be created for a Bid task'; end if;

  perform pg_advisory_xact_lock(hashtextextended('underwriting:' || p_task_id, 0));   -- <- new

  select underwriting_id into existing from public.task_underwriting_links where task_id = p_task_id;
  if existing is not null then return existing; end if;
  insert into public.underwritings (company_id, project_id, created_by) values (t.company_id, t.project_id, me)
    returning id into new_id;
  insert into public.task_underwriting_links (task_id, underwriting_id, created_by) values (p_task_id, new_id, me);
  return new_id;
end; $$;
```

## 2. Underwriting can reference another tenant's project (reproduced; low severity)

A foreign-key check ignores RLS. Through the REST API (not the UI, which never sends `project_id`),
a user can `insert into underwritings (company_id, project_id)` with **another tenant's project id**:
the insert is accepted, and accepted-vs-`violates foreign key` reveals whether that id exists. The
RPC path is safe (it copies `project_id` from the caller-visible task). No data is *read* across
tenants by this. **Validated patch** (rejects the foreign project; own-company, project-filed and
unfiled creates still work):

```sql
create or replace function public.guard_underwriting_project() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.company_id = new.company_id
  ) then raise exception 'project is not available for this company'; end if;
  return new;
end; $$;
drop trigger if exists underwritings_project_guard on public.underwritings;
create trigger underwritings_project_guard before insert on public.underwritings
  for each row execute function public.guard_underwriting_project();
```

If adopted, add both to `073_underwriting.sql` (still unapplied anywhere) and extend
`verify/073_underwriting_check.sql` with: a concurrent-create assertion is awkward in one
transaction, so test (1) by calling the function twice and asserting one link, and (2) with an
`expect_error` insert of a foreign `project_id`.

## 3. `task_label_sops` — 072 may need it to be optional

Evidence (no migration 069 exists in any local ref; `git log --all -- 'supabase/sql/069*'` is empty):
the client was shipped *before* the table (`8232b2d`, "ships in the client before it exists on every
database") and reads it through `_optionalSelect`, i.e. the application **tolerates the table being
absent**. `createSopStep/updateSopStep/deleteSopStep` exist but have no callers in this branch, and
`App.taxonomy.activeSop` / `App.SOP_CHECKLISTS` / `App.utils.mergeSopSteps` are not defined here. So
the only things the repo establishes are: a table named `task_label_sops` with an `id`, "one row per
step of a label's job-type SOP", plain-deleted (no soft delete). **The column list is unknown.**

`000b` (`id`, `company_id`, `created_at`) is therefore the *minimum* that lets 072's
`alter table … add column tenant_id` work — it is **PROVISIONAL and not production-faithful**.

Consequence if production lacks the table: 072 (both the original and my Task 0) **cannot apply**.
It would fail loudly before changing anything. The fix would be to move `task_label_sops` from the
*required* list to an *optional* (guarded) list — a numbered-migration change, so a decision.
Run `tools/prod-catalog/task_label_sops.sql` in the production SQL editor (read-only) to settle it.

## 4. Smaller observations (not changed)

- **Supervisor + invisible Bid task:** a supervisor can read/edit an existing underwriting but cannot
  *create* one for a Bid task the `tasks` RLS hides from them (not assigned/created/reporting to
  them). Matches the "task-visibility first" design; flag if supervisors should create company-wide.
- **Post-save reload failure:** after a successful save, if the immediate re-read fails (network
  blip), the draft is cleared and the form shows the *previous* saved numbers until the next 30 s
  refresh. The toast ("Estimate saved") is truthful; the panel is briefly stale.
- **Decision note** (`#uwDecisionReason`) lives only in the DOM; a background re-render clears it.
- **`create-user` company allow-list** is hard-coded (`roofing/drafting/lumen`), so it cannot assign
  companies of other tenants.
- **Production drift:** `profiles.onboarded` (migration 015) is absent from production although
  `js/app.js` writes it.
