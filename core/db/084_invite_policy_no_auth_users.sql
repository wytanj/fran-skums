-- 084 — Stop the workspace_invites RLS policy from reading auth.users.
--
-- Symptom: inviting a teammate from Settings → Team fails with
-- "permission denied for table users".
--
-- Cause: the "Users can view own invites" SELECT policy (migration 009) does
--
--     email = (select email from auth.users where id = auth.uid())
--
-- An RLS policy is evaluated with the privileges of the querying role, and the
-- `authenticated` role has no SELECT on auth.users — Supabase does not grant it.
-- So the subquery raises before the comparison ever happens.
--
-- Why it surfaces on INSERT rather than SELECT: useTeam.sendInvite() does
-- .insert(...).select().single(). The RETURNING clause is a read, so Postgres
-- evaluates every SELECT policy on the table — including this one — and the
-- whole statement fails even though the INSERT policy
-- (get_my_admin_workspace_ids, a security-definer function) would have allowed
-- it. The invite row is never written.
--
-- Fix: read the email from the request JWT instead of the table. auth.jwt() is
-- a claims accessor, needs no privilege on auth.users, and is the supported
-- Supabase idiom for exactly this.
--
-- Also made case-insensitive to match accept_invite(), which compares with
-- lower() on both sides. Without that an invitee could be unable to SEE an
-- invite they are nonetheless allowed to ACCEPT.
--
-- Not affected, checked: accept_invite() (009) and accept_org_invite() (015)
-- also read auth.users, but both are `security definer`, so they run as the
-- function owner and are fine. This policy was the only RLS expression in
-- core/db reaching into auth.users.

drop policy if exists "Users can view own invites" on public.workspace_invites;

create policy "Users can view own invites"
  on public.workspace_invites for select
  using (
    lower(email) = lower(auth.jwt() ->> 'email')
    and status = 'pending'
  );

comment on table public.workspace_invites is
  'Pending workspace invitations. The self-view policy reads the email claim from auth.jwt(); never query auth.users from an RLS policy — the authenticated role has no privilege on it (see migration 084).';
