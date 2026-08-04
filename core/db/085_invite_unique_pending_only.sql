-- 085 — One PENDING invite per email, not one invite per status.
--
-- Symptom: revoking an invite fails with
--   duplicate key value violates unique constraint
--   "workspace_invites_workspace_id_email_status_key"
--
-- Cause: migration 009 declared `unique (workspace_id, email, status)`. That
-- reads as "one invite per email per state", which silently caps the history at
-- a single revoked row and a single accepted row per address. The moment a
-- second invite to the same person is revoked, the UPDATE tries to create a
-- second (workspace, email, 'revoked') and the constraint rejects it.
--
-- Real-world sequence that hits it — and it is the ordinary one:
--   invite → revoke        (revoked row now exists)
--   invite again → accept  (accepted row now exists)
--   invite again → revoke  ✗ collides with the first revoked row
--
-- The invariant actually worth enforcing is narrower: a workspace should not
-- have two *live* invitations outstanding for the same address, because there
-- would be no way to say which one a token belongs to. Revoked and accepted rows
-- are history and should be free to accumulate — they are the audit trail of who
-- was invited, by whom, and when.
--
-- So: a partial unique index on the pending state only.
--
-- Safe to apply as-is. Duplicate pending rows cannot already exist, since the
-- constraint being dropped forbade them; the DELETE below is belt-and-braces for
-- any environment where the constraint was dropped manually first.

-- Keep the newest pending invite per (workspace, email) if any duplicates exist.
delete from public.workspace_invites w
using public.workspace_invites keep
where w.status = 'pending'
  and keep.status = 'pending'
  and w.workspace_id = keep.workspace_id
  and lower(w.email) = lower(keep.email)
  and (w.created_at, w.id) < (keep.created_at, keep.id);

alter table public.workspace_invites
  drop constraint if exists workspace_invites_workspace_id_email_status_key;

-- Lowercased so a differently-cased re-invite cannot slip a second live one
-- through. sendInvite() already lowercases on write; accept_invite() and the RLS
-- self-view policy (084) both compare case-insensitively, so this matches.
create unique index if not exists workspace_invites_one_pending_per_email
  on public.workspace_invites (workspace_id, lower(email))
  where status = 'pending';

comment on index public.workspace_invites_one_pending_per_email is
  'At most one outstanding invitation per address per workspace. Revoked and accepted rows are history and intentionally unconstrained — see migration 085.';
