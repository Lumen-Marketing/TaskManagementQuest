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

## Step 2 — grant access

Visibility is gated by the same company RLS as every other task (migration
028): a user only sees or creates Overall tasks when `profiles.company_ids`
contains `'overall'`.

### Recommended: the People / Approvals UI

The company checkboxes in the People admin (approve/edit a person, and "Add
person") now include **Overall**. Tick **Overall** for anyone who should
create or see Overall tasks, and save. That writes `'overall'` into their
`profiles.company_ids` — no SQL required.

Developers already have all-company access (RLS god-mode bypass), so they can
use Overall without being granted.

### Alternative: SQL

If you'd rather do it directly in the Supabase SQL editor:

```sql
update public.profiles
set company_ids = array_append(company_ids, 'overall')
where id = '<auth-uuid>'
  and not ('overall' = any(company_ids));
```

## Expected behavior

- A **granted** user sees "Overall" in the New Task and Task Detail company
  pickers, the table company chip, and the filter bar; Overall tasks appear
  under every company view and export as `Overall` in CSV.
- A **single-company** user *without* the grant does not see the Overall option
  and cannot see Overall tasks — by design (the "only cross-company members"
  visibility choice). If you want *everyone* to see Overall tasks regardless of
  company, that needs a separate RLS migration adding an `overall` carve-out
  (like `general-shift`); it is intentionally not built here.
