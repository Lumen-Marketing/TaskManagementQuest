-- 024: Let role managers delete profiles (remove a user's access).
--
-- profiles has SELECT (007/012/014) and UPDATE (007/016/017/021) policies
-- but no DELETE policy, so the Approvals "Delete" button needs one. Mirror
-- the team_members manager-delete policy from 007: gate to can_manage_roles()
-- (admin / construction_supervisor). The "id <> auth.uid()" guard stops a
-- manager from deleting their own profile and locking themselves out — the
-- UI hides its own Delete button too, but RLS is the real wall.
--
-- We intentionally delete only the profile, not the team_members row: that
-- row is referenced by NOT NULL FKs on tasks.creator_id / assignee_id (003)
-- with no cascade, so removing it would orphan those tasks. Dropping just
-- the profile revokes app access (no profile => not approved => gated by
-- AuthModel.isApproved) and removes the person from the Approvals list,
-- while their name still renders on any historical tasks. Idempotent.

drop policy if exists "managers can delete profiles" on public.profiles;
create policy "managers can delete profiles" on public.profiles
for delete to authenticated
using (public.can_manage_roles() and id <> auth.uid());
