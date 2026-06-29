-- ============================================================
-- SKUMS — Team Invites & Permission Framework
-- Run AFTER schema.sql and fix-rls-recursion.sql
-- ============================================================

-- ============================================================
-- 1. PERMISSION SCHEMAS
--    Defines a named set of granular permissions.
--    Global rows (workspace_id IS NULL) are the platform-provided
--    defaults. Workspaces can create custom schemas later for
--    programmatic permissioning.
-- ============================================================
create table if not exists public.permission_schemas (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid references public.workspaces(id) on delete cascade,

  name            text not null,
  slug            text not null,
  description     text,

  -- The actual permissions definition (JSON)
  -- Each key is a permission area, value is an object of granular flags
  permissions     jsonb not null default '{}',

  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (workspace_id, slug)
);

alter table public.permission_schemas enable row level security;

create policy "Anyone can view global permission schemas"
  on public.permission_schemas for select
  using (workspace_id is null);

create policy "Members can view workspace permission schemas"
  on public.permission_schemas for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage workspace permission schemas"
  on public.permission_schemas for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));


-- ============================================================
-- 2. SEED: Global default permission schemas
--    One standard schema per role. These serve as the baseline
--    for all organizations. Companies can later create custom
--    schemas that override specific permissions.
-- ============================================================
insert into public.permission_schemas (id, workspace_id, name, slug, description, is_default, permissions)
values
  -- Owner: full access
  ('00000000-0000-0000-0001-000000000001', null, 'Owner', 'owner', 'Full access to all workspace features', true,
    '{
      "products":       {"read": true, "write": true, "delete": true, "import": true, "export": true},
      "brands":         {"read": true, "write": true, "delete": true},
      "categories":     {"read": true, "write": true, "delete": true},
      "integrations":   {"read": true, "write": true, "delete": true, "execute": true},
      "credentials":    {"read": true, "write": true, "delete": true},
      "schemas":        {"read": true, "write": true, "delete": true},
      "custom_fields":  {"read": true, "write": true, "delete": true},
      "team":           {"read": true, "invite": true, "remove": true, "change_role": true},
      "workspace":      {"read": true, "write": true, "delete": true},
      "activity":       {"read": true},
      "api":            {"read": true, "write": true}
    }'::jsonb
  ),

  -- Admin: nearly full access, cannot delete workspace
  ('00000000-0000-0000-0001-000000000002', null, 'Admin', 'admin', 'Full access except workspace deletion', true,
    '{
      "products":       {"read": true, "write": true, "delete": true, "import": true, "export": true},
      "brands":         {"read": true, "write": true, "delete": true},
      "categories":     {"read": true, "write": true, "delete": true},
      "integrations":   {"read": true, "write": true, "delete": true, "execute": true},
      "credentials":    {"read": true, "write": true, "delete": true},
      "schemas":        {"read": true, "write": true, "delete": true},
      "custom_fields":  {"read": true, "write": true, "delete": true},
      "team":           {"read": true, "invite": true, "remove": true, "change_role": true},
      "workspace":      {"read": true, "write": true, "delete": false},
      "activity":       {"read": true},
      "api":            {"read": true, "write": true}
    }'::jsonb
  ),

  -- Member: read-write on data, no team/integration management
  ('00000000-0000-0000-0001-000000000003', null, 'Member', 'member', 'Can read and write product data, but cannot manage team or integrations', true,
    '{
      "products":       {"read": true, "write": true, "delete": false, "import": true, "export": true},
      "brands":         {"read": true, "write": true, "delete": false},
      "categories":     {"read": true, "write": true, "delete": false},
      "integrations":   {"read": true, "write": false, "delete": false, "execute": false},
      "credentials":    {"read": false, "write": false, "delete": false},
      "schemas":        {"read": true, "write": false, "delete": false},
      "custom_fields":  {"read": true, "write": false, "delete": false},
      "team":           {"read": true, "invite": false, "remove": false, "change_role": false},
      "workspace":      {"read": true, "write": false, "delete": false},
      "activity":       {"read": true},
      "api":            {"read": true, "write": false}
    }'::jsonb
  ),

  -- Viewer: read-only
  ('00000000-0000-0000-0001-000000000004', null, 'Viewer', 'viewer', 'Read-only access to all data', true,
    '{
      "products":       {"read": true, "write": false, "delete": false, "import": false, "export": true},
      "brands":         {"read": true, "write": false, "delete": false},
      "categories":     {"read": true, "write": false, "delete": false},
      "integrations":   {"read": true, "write": false, "delete": false, "execute": false},
      "credentials":    {"read": false, "write": false, "delete": false},
      "schemas":        {"read": true, "write": false, "delete": false},
      "custom_fields":  {"read": true, "write": false, "delete": false},
      "team":           {"read": true, "invite": false, "remove": false, "change_role": false},
      "workspace":      {"read": true, "write": false, "delete": false},
      "activity":       {"read": true},
      "api":            {"read": false, "write": false}
    }'::jsonb
  )
on conflict (workspace_id, slug) do nothing;


-- ============================================================
-- 3. ADD PERMISSION_SCHEMA_ID TO WORKSPACE_MEMBERS
--    Links each member to a permission schema. Null = use the
--    default for their role. This allows per-user overrides.
-- ============================================================
alter table public.workspace_members
  add column if not exists permission_schema_id uuid references public.permission_schemas(id) on delete set null;


-- ============================================================
-- 4. WORKSPACE INVITES
--    Email-based invitations with expiry and acceptance flow.
-- ============================================================
create table if not exists public.workspace_invites (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  email           text not null,
  role            text not null default 'member'
                    check (role in ('admin', 'member', 'viewer')),

  permission_schema_id uuid references public.permission_schemas(id) on delete set null,

  -- Invite lifecycle
  status          text not null default 'pending'
                    check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),

  -- Unique token for the invite link
  token           text not null unique default encode(gen_random_bytes(32), 'hex'),

  invited_by      uuid references public.profiles(id) on delete set null,
  accepted_by     uuid references public.profiles(id) on delete set null,

  expires_at      timestamptz not null default (now() + interval '7 days'),
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),

  unique (workspace_id, email, status)
);

create index if not exists idx_invites_workspace on public.workspace_invites(workspace_id);
create index if not exists idx_invites_email on public.workspace_invites(email);
create index if not exists idx_invites_token on public.workspace_invites(token);
create index if not exists idx_invites_status on public.workspace_invites(status);

alter table public.workspace_invites enable row level security;

-- Workspace admins/owners can view and manage invites
create policy "Admins can view invites"
  on public.workspace_invites for select
  using (workspace_id in (select public.get_my_admin_workspace_ids()));

create policy "Admins can create invites"
  on public.workspace_invites for insert
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create policy "Admins can update invites"
  on public.workspace_invites for update
  using (workspace_id in (select public.get_my_admin_workspace_ids()));

create policy "Admins can delete invites"
  on public.workspace_invites for delete
  using (workspace_id in (select public.get_my_admin_workspace_ids()));

-- Invited users can see their own pending invites (by email)
create policy "Users can view own invites"
  on public.workspace_invites for select
  using (
    email = (select email from auth.users where id = auth.uid())
    and status = 'pending'
  );


-- ============================================================
-- 5. RPC: Accept an invite by token
--    Atomically: validates the invite, creates the membership,
--    and marks the invite as accepted.
-- ============================================================
create or replace function public.accept_invite(p_token text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite record;
  v_user_email text;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_user_email from auth.users where id = v_uid;

  select * into v_invite
  from public.workspace_invites
  where token = p_token
    and status = 'pending'
    and expires_at > now();

  if not found then
    raise exception 'Invite not found, expired, or already used';
  end if;

  if lower(v_invite.email) <> lower(v_user_email) then
    raise exception 'This invite was sent to a different email address';
  end if;

  -- Check if already a member
  if exists (
    select 1 from public.workspace_members
    where workspace_id = v_invite.workspace_id and user_id = v_uid
  ) then
    -- Mark invite accepted and return
    update public.workspace_invites
    set status = 'accepted', accepted_by = v_uid, accepted_at = now()
    where id = v_invite.id;
    return json_build_object('status', 'already_member', 'workspace_id', v_invite.workspace_id);
  end if;

  -- Create membership
  insert into public.workspace_members (workspace_id, user_id, role, permission_schema_id)
  values (v_invite.workspace_id, v_uid, v_invite.role, v_invite.permission_schema_id);

  -- Mark invite accepted
  update public.workspace_invites
  set status = 'accepted', accepted_by = v_uid, accepted_at = now()
  where id = v_invite.id;

  return json_build_object('status', 'accepted', 'workspace_id', v_invite.workspace_id);
end;
$$;


-- ============================================================
-- 6. RPC: Get resolved permissions for current user in a workspace
--    Resolves: member role -> default schema for role -> override schema
-- ============================================================
create or replace function public.get_my_permissions(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_member record;
  v_perms jsonb;
begin
  select role, permission_schema_id
  into v_member
  from public.workspace_members
  where workspace_id = p_workspace_id and user_id = auth.uid();

  if not found then
    return '{}'::jsonb;
  end if;

  -- If member has a custom permission schema, use it
  if v_member.permission_schema_id is not null then
    select permissions into v_perms
    from public.permission_schemas
    where id = v_member.permission_schema_id;
    if found then return v_perms; end if;
  end if;

  -- Fall back to the global default for their role
  select permissions into v_perms
  from public.permission_schemas
  where workspace_id is null and slug = v_member.role and is_default = true;

  return coalesce(v_perms, '{}'::jsonb);
end;
$$;


-- ============================================================
-- 7. ALLOW MEMBERS TO VIEW OTHER MEMBERS IN THEIR WORKSPACE
--    The original schema only allows users to see their own
--    membership. We need workspace members to see each other
--    for the team management UI.
-- ============================================================
create policy "Members can view workspace colleagues"
  on public.workspace_members for select
  using (
    workspace_id in (select public.get_my_workspace_ids())
  );

-- Also allow viewing colleague profiles
create policy "Members can view colleague profiles"
  on public.profiles for select
  using (
    id in (
      select user_id from public.workspace_members
      where workspace_id in (select public.get_my_workspace_ids())
    )
  );


-- ============================================================
-- 8. updated_at triggers
-- ============================================================
create trigger set_updated_at before update on public.permission_schemas
  for each row execute function public.update_updated_at();
