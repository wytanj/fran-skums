-- Organizations layer: Organization > Workspace hierarchy
-- Run AFTER team-permissions.sql
-- =====================================================

-- ── 1. Organizations table ──

create table public.organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  logo_url    text,
  billing_email text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.organizations enable row level security;

-- ── 2. Organization members ──

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            text not null default 'member'
                    check (role in ('owner', 'admin', 'member', 'billing')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.organization_members enable row level security;

-- ── 3. Organization invites ──

create table public.organization_invites (
  id              uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role            text not null default 'member'
                    check (role in ('admin', 'member', 'billing')),
  status          text not null default 'pending'
                    check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  token           text not null unique default encode(gen_random_bytes(32), 'hex'),
  invited_by      uuid references public.profiles(id),
  accepted_by     uuid references public.profiles(id),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, email, status)
);

alter table public.organization_invites enable row level security;

-- ── 4. Add organization_id to workspaces ──

alter table public.workspaces
  add column organization_id uuid references public.organizations(id) on delete set null;

create index idx_workspaces_org on public.workspaces(organization_id);

-- ── 5. RLS helper functions ──

-- Get org IDs the current user belongs to
create or replace function public.get_my_organization_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select organization_id from public.organization_members
  where user_id = auth.uid();
$$;

-- Get org IDs where user is owner or admin
create or replace function public.get_my_admin_organization_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select organization_id from public.organization_members
  where user_id = auth.uid() and role in ('owner', 'admin');
$$;

-- ── 6. Update workspace RLS helpers to include org-admin passthrough ──

-- Org admins get implicit access to ALL workspaces in their orgs
create or replace function public.get_my_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  -- Direct workspace membership
  select workspace_id from public.workspace_members where user_id = auth.uid()
  union
  -- Org-admin passthrough: org owners/admins see all org workspaces
  select w.id from public.workspaces w
  inner join public.organization_members om
    on om.organization_id = w.organization_id
  where om.user_id = auth.uid()
    and om.role in ('owner', 'admin')
    and w.organization_id is not null;
$$;

create or replace function public.get_my_writable_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  -- Direct membership with write access
  select workspace_id from public.workspace_members
  where user_id = auth.uid() and role in ('owner', 'admin', 'member')
  union
  -- Org-admin passthrough
  select w.id from public.workspaces w
  inner join public.organization_members om
    on om.organization_id = w.organization_id
  where om.user_id = auth.uid()
    and om.role in ('owner', 'admin')
    and w.organization_id is not null;
$$;

create or replace function public.get_my_admin_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  -- Direct admin/owner membership
  select workspace_id from public.workspace_members
  where user_id = auth.uid() and role in ('owner', 'admin')
  union
  -- Org-admin passthrough
  select w.id from public.workspaces w
  inner join public.organization_members om
    on om.organization_id = w.organization_id
  where om.user_id = auth.uid()
    and om.role in ('owner', 'admin')
    and w.organization_id is not null;
$$;

-- ── 7. RLS policies for organizations ──

create policy "members can view their orgs"
  on public.organizations for select
  using (id in (select public.get_my_organization_ids()));

create policy "authenticated users can create orgs"
  on public.organizations for insert
  with check (auth.uid() is not null);

create policy "org admins can update org"
  on public.organizations for update
  using (id in (select public.get_my_admin_organization_ids()));

create policy "org owners can delete org"
  on public.organizations for delete
  using (exists (
    select 1 from public.organization_members
    where organization_id = organizations.id
      and user_id = auth.uid()
      and role = 'owner'
  ));

-- ── 8. RLS policies for organization_members ──

create policy "members can view org members"
  on public.organization_members for select
  using (organization_id in (select public.get_my_organization_ids()));

create policy "org admins can add members"
  on public.organization_members for insert
  with check (organization_id in (select public.get_my_admin_organization_ids()));

create policy "org admins can update members"
  on public.organization_members for update
  using (organization_id in (select public.get_my_admin_organization_ids()));

create policy "org admins can remove members"
  on public.organization_members for delete
  using (organization_id in (select public.get_my_admin_organization_ids()));

-- ── 9. RLS policies for organization_invites ──

create policy "org members can view invites"
  on public.organization_invites for select
  using (organization_id in (select public.get_my_organization_ids()));

create policy "org admins can create invites"
  on public.organization_invites for insert
  with check (organization_id in (select public.get_my_admin_organization_ids()));

create policy "org admins can update invites"
  on public.organization_invites for update
  using (organization_id in (select public.get_my_admin_organization_ids()));

-- ── 10. Atomic org creation (bypasses RLS chicken-and-egg) ──

create or replace function public.create_organization(org_name text, org_slug text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org public.organizations%rowtype;
begin
  insert into public.organizations (name, slug, created_by)
  values (org_name, org_slug, auth.uid())
  returning * into new_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org.id, auth.uid(), 'owner');

  return row_to_json(new_org);
end;
$$;

-- ── 11. Accept org invite (atomic) ──

create or replace function public.accept_org_invite(p_token text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.organization_invites%rowtype;
  v_email text;
begin
  select * into v_invite
  from public.organization_invites
  where token = p_token and status = 'pending' and expires_at > now();

  if not found then
    raise exception 'Invalid or expired invite';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  if lower(v_email) <> lower(v_invite.email) then
    raise exception 'Invite email does not match your account';
  end if;

  -- Upsert membership
  insert into public.organization_members (organization_id, user_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.role)
  on conflict (organization_id, user_id) do nothing;

  -- Mark accepted
  update public.organization_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_invite.id;

  return json_build_object(
    'status', 'accepted',
    'organization_id', v_invite.organization_id
  );
end;
$$;

-- ── 12. Update create_workspace to optionally link to org ──
-- NOTE: CREATE OR REPLACE does not drop the 2-arg overload from 007.
-- Migration 051 drops public.create_workspace(text, text) to resolve ambiguity.

create or replace function public.create_workspace(ws_name text, ws_slug text, ws_org_id uuid default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_ws public.workspaces%rowtype;
begin
  -- If org_id provided, verify user is org admin/owner
  if ws_org_id is not null then
    if not exists (
      select 1 from public.organization_members
      where organization_id = ws_org_id
        and user_id = auth.uid()
        and role in ('owner', 'admin')
    ) then
      raise exception 'Must be org admin to create workspace in organization';
    end if;
  end if;

  insert into public.workspaces (name, slug, owner_id, organization_id)
  values (ws_name, ws_slug, auth.uid(), ws_org_id)
  returning * into new_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_ws.id, auth.uid(), 'owner');

  return row_to_json(new_ws);
end;
$$;

-- ── 13. Move workspace to org (org admin only) ──

create or replace function public.move_workspace_to_org(p_workspace_id uuid, p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Must be workspace owner
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'Must be workspace owner';
  end if;

  -- Must be org admin/owner
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_org_id and user_id = auth.uid() and role in ('owner', 'admin')
  ) then
    raise exception 'Must be org admin';
  end if;

  update public.workspaces set organization_id = p_org_id where id = p_workspace_id;
end;
$$;

-- ── 14. Expand permission areas for newer features ──

-- Update the global default permission schemas to include new areas
-- (inventory, expiry, images, assistant, organization)

update public.permission_schemas
set permissions = permissions
  || '{"inventory": {"read": true, "write": true, "delete": true}}'::jsonb
  || '{"expiry": {"read": true, "write": true, "delete": true}}'::jsonb
  || '{"images": {"read": true, "write": true, "delete": true}}'::jsonb
  || '{"assistant": {"read": true, "write": true}}'::jsonb
  || '{"organization": {"read": true, "write": true, "delete": true, "invite": true, "remove": true}}'::jsonb
where workspace_id is null and slug = 'owner';

update public.permission_schemas
set permissions = permissions
  || '{"inventory": {"read": true, "write": true, "delete": true}}'::jsonb
  || '{"expiry": {"read": true, "write": true, "delete": true}}'::jsonb
  || '{"images": {"read": true, "write": true, "delete": true}}'::jsonb
  || '{"assistant": {"read": true, "write": true}}'::jsonb
  || '{"organization": {"read": true, "write": true, "invite": true}}'::jsonb
where workspace_id is null and slug = 'admin';

update public.permission_schemas
set permissions = permissions
  || '{"inventory": {"read": true, "write": true}}'::jsonb
  || '{"expiry": {"read": true, "write": true}}'::jsonb
  || '{"images": {"read": true, "write": true}}'::jsonb
  || '{"assistant": {"read": true, "write": true}}'::jsonb
  || '{"organization": {"read": true}}'::jsonb
where workspace_id is null and slug = 'member';

update public.permission_schemas
set permissions = permissions
  || '{"inventory": {"read": true}}'::jsonb
  || '{"expiry": {"read": true}}'::jsonb
  || '{"images": {"read": true}}'::jsonb
  || '{"assistant": {"read": true}}'::jsonb
  || '{"organization": {"read": true}}'::jsonb
where workspace_id is null and slug = 'viewer';
