-- ============================================================
-- 073 — Workspace CRM (loyalty) link for POS facade
--
-- SKUMS remains app-agnostic: optional per-workspace link to Fran CRM.
-- POS authenticates with SKUMS API key; SKUMS proxies loyalty to CRM.
--
-- Run AFTER: 072
-- As of: 2026-07-24
-- ============================================================

create table if not exists public.workspace_crm_links (
  workspace_id          uuid primary key references public.workspaces(id) on delete cascade,

  -- Public CRM origin (no trailing slash), e.g. https://fran-crm.example.com
  crm_base_url          text not null,
  -- CRM's workspace UUID when multi-tenant CRM; optional for demo
  crm_workspace_id      uuid,

  status                text not null default 'active'
    check (status in ('active', 'inactive', 'error')),

  -- auth_mode: none (demo POS paths) | bearer (service token in service_token)
  auth_mode             text not null default 'none'
    check (auth_mode in ('none', 'bearer')),
  -- Server-only; never return to browser POS. Nullable for demo CRM.
  service_token         text,

  last_health_at        timestamptz,
  last_health_status    text,
  last_error            text,
  metadata              jsonb not null default '{}',

  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint workspace_crm_links_url_http
    check (crm_base_url ~* '^https?://')
);

create index if not exists idx_workspace_crm_links_status
  on public.workspace_crm_links(status);

alter table public.workspace_crm_links enable row level security;

drop policy if exists "Members can view workspace crm links"
  on public.workspace_crm_links;
create policy "Members can view workspace crm links"
  on public.workspace_crm_links for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Admins can manage workspace crm links"
  on public.workspace_crm_links;
create policy "Admins can manage workspace crm links"
  on public.workspace_crm_links for all
  to authenticated
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

-- service_role for API key facades
grant select, insert, update, delete on table public.workspace_crm_links
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.workspace_crm_links;
create trigger set_updated_at before update on public.workspace_crm_links
  for each row execute function public.update_updated_at();

comment on table public.workspace_crm_links is
  'Optional Fran CRM loyalty link per SKUMS workspace. POS never holds CRM secrets; SKUMS proxies /fran/pos/loyalty/*.';
