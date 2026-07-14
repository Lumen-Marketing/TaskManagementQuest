# Enabling the "Overall" company

"Overall" is a company that spans every company: a task set to Overall shows
under Roofing, Drafting, Lumen, and its own Overall view, and renders an
`OVERALL` pill everywhere a company is shown.

Enabling Overall takes **two** steps: register the company row (once, per
database), then grant people access to it.

## Step 1 — register the 'overall' company row (REQUIRED, once)

`public.tasks.company_id` has a foreign key to `public.companies`
(`tasks_company_id_fkey`), so `'overall'` must exist as a real row there.
Without it, creating an Overall task fails with:

> insert or update on table "tasks" violates foreign key constraint
> "tasks_company_id_fkey"

Run `supabase/sql/067_overall_company.sql` (idempotent):

```sql
insert into public.companies (id, label, pill)
values ('overall', 'Overall', 'pill-overall')
on conflict (id) do nothing;
```

This is a data row, not a schema change — `companies` already mirrors the
client's `App.COMPANIES` (id / label / pill).

## Step 2 — access is AUTOMATIC (run `068_overall_auto_grant.sql`)

Access is gated by the same company RLS as every other task (migration 028): a
user sees/creates Overall tasks only when `profiles.company_ids` contains
`'overall'`.

**You do not grant this by hand.** Being in **2 or more real companies** is what
makes someone a cross-company member, so Overall follows automatically:

| Real companies | Overall access |
|----------------|----------------|
| 2 or more      | granted (auto) |
| 0 or 1         | not granted    |
| any (developer)| granted (RLS god-mode bypass) |

`supabase/sql/068_overall_auto_grant.sql` installs a `profiles_sync_overall`
trigger that maintains `'overall'` in `company_ids` on every write (adding it at
2+ real companies, removing it below that), and backfills existing profiles. Tick
someone into a second company in People/Approvals and Overall comes with it; drop
them back to one and it goes away.

There is deliberately **no "Overall" checkbox** in People/Approvals — it's derived,
so a manual tick would just be overridden on save.

Migration 068 also lets an Overall task be assigned to **any** approved member
(migration 041 otherwise restricted a worker's assignee to the task's own
company, which makes no sense for a company-wide task).

## Expected behavior

- A **cross-company** user (2+ companies) sees "Overall" in the New Task and Task
  Detail company pickers, the table company chip, and the filter bar; Overall
  tasks appear under every company view and export as `Overall` in CSV.
- A **single-company** user does not see the Overall option and cannot see
  Overall tasks — by design. If you want *everyone* to see Overall tasks
  regardless of company, that needs a separate RLS migration adding an `overall`
  carve-out (like `general-shift`); it is intentionally not built here.
