-- ============================================================
-- SKUMS — API Key Infrastructure
-- Workspace-scoped API keys for external access (n8n, CLI, agents)
-- Run AFTER schema.sql and fix-rls-recursion.sql
-- ============================================================

create table if not exists public.api_keys (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  name            text not null,
  description     text,

  -- The key prefix (first 8 chars) stored in plain text for identification
  -- e.g. "sk_live_Ab3x..." → prefix = "sk_live_A"
  key_prefix      text not null,

  -- SHA-256 hash of the full key (the raw key is shown once at creation)
  key_hash        text not null unique,

  -- Scoping
  -- Which permission areas this key can access (null = all based on role)
  scopes          text[] not null default '{}',

  -- Rate limiting
  rate_limit_rpm  int not null default 60,

  -- Status
  is_active       boolean not null default true,
  last_used_at    timestamptz,
  total_requests  bigint not null default 0,

  -- Metadata
  created_by      uuid references public.profiles(id) on delete set null,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_api_keys_workspace on public.api_keys(workspace_id);
create index if not exists idx_api_keys_hash on public.api_keys(key_hash);
create index if not exists idx_api_keys_prefix on public.api_keys(key_prefix);

alter table public.api_keys enable row level security;

create policy "Admins can view api keys"
  on public.api_keys for select
  using (workspace_id in (select public.get_my_admin_workspace_ids()));

create policy "Admins can manage api keys"
  on public.api_keys for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create trigger set_updated_at before update on public.api_keys
  for each row execute function public.update_updated_at();
