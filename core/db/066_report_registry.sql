-- ============================================================
-- 066 — Agentic report registry (track K / Rpt-0 + Rpt-1 + Rpt-2)
--
-- Sectionized report packs with per-workspace subscription toggle.
-- Scopes: reports:read|run|write|admin, automations:webhook|inbound
-- Suggest ≠ execute: runs produce digests only; no auto approve/Loft/FOB.
--
-- Run AFTER: 064_notification_bus.sql, 065_inventory_manager_schema.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Permission schemas — reports + automations areas
-- ------------------------------------------------------------

-- Owner: full reports + automations
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'reports', jsonb_build_object(
    'read', true, 'run', true, 'write', true, 'admin', true
  ),
  'automations', jsonb_build_object(
    'webhook', true, 'inbound', true
  )
),
updated_at = now()
where workspace_id is null and slug = 'owner' and is_default = true;

-- Admin: write + run; automations webhook (not inbound admin unless needed)
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'reports', jsonb_build_object(
    'read', true, 'run', true, 'write', true, 'admin', true
  ),
  'automations', jsonb_build_object(
    'webhook', true, 'inbound', false
  )
),
updated_at = now()
where workspace_id is null and slug = 'admin' and is_default = true;

-- Inventory Manager / inventory_ops: read + run + write (ops digests)
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'reports', jsonb_build_object(
    'read', true, 'run', true, 'write', true, 'admin', false
  ),
  'automations', jsonb_build_object(
    'webhook', false, 'inbound', false
  )
),
updated_at = now()
where workspace_id is null
  and slug in ('inventory_ops', 'inventory_manager')
  and is_default = true;

-- Member: read + run (subscribe/receive), no write/admin
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'reports', jsonb_build_object(
    'read', true, 'run', true, 'write', false, 'admin', false
  ),
  'automations', jsonb_build_object(
    'webhook', false, 'inbound', false
  )
),
updated_at = now()
where workspace_id is null and slug = 'member' and is_default = true;

-- Viewer: read only
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'reports', jsonb_build_object(
    'read', true, 'run', false, 'write', false, 'admin', false
  ),
  'automations', jsonb_build_object(
    'webhook', false, 'inbound', false
  )
),
updated_at = now()
where workspace_id is null and slug = 'viewer' and is_default = true;

-- Store associate: no reports (POS floor, not HQ digests)
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'reports', jsonb_build_object(
    'read', false, 'run', false, 'write', false, 'admin', false
  ),
  'automations', jsonb_build_object(
    'webhook', false, 'inbound', false
  )
),
updated_at = now()
where workspace_id is null and slug = 'store_associate' and is_default = true;

-- ------------------------------------------------------------
-- 2. report_templates (platform seeds + later workspace custom)
-- ------------------------------------------------------------
create table if not exists public.report_templates (
  id                    uuid primary key default uuid_generate_v4(),
  -- null workspace_id = platform seed
  workspace_id          uuid references public.workspaces(id) on delete cascade,
  slug                  text not null
    check (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  title                 text not null,
  description           text,
  audience_hint         text not null default 'hq'
    check (audience_hint in (
      'marketing', 'warehouse', 'ops', 'finance', 'hq', 'buyer', 'all'
    )),
  default_sections      text[] not null default '{}',
  default_schedule      text not null default 'weekly'
    check (default_schedule in ('hourly', 'daily', 'weekly', 'monthly', 'manual')),
  default_timezone      text not null default 'Asia/Singapore',
  default_channels      text[] not null default '{in_app}',
  is_active             boolean not null default true,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_report_templates_platform_slug
  on public.report_templates(slug)
  where workspace_id is null;

create unique index if not exists idx_report_templates_workspace_slug
  on public.report_templates(workspace_id, slug)
  where workspace_id is not null;

create index if not exists idx_report_templates_active
  on public.report_templates(is_active)
  where is_active = true;

alter table public.report_templates enable row level security;

drop policy if exists "Members can view report templates"
  on public.report_templates;
create policy "Members can view report templates"
  on public.report_templates for select
  to authenticated
  using (
    workspace_id is null
    or workspace_id in (select public.get_my_workspace_ids())
  );

drop policy if exists "Admins can manage workspace report templates"
  on public.report_templates;
create policy "Admins can manage workspace report templates"
  on public.report_templates for all
  to authenticated
  using (
    workspace_id is not null
    and workspace_id in (select public.get_my_admin_workspace_ids())
  )
  with check (
    workspace_id is not null
    and workspace_id in (select public.get_my_admin_workspace_ids())
  );

grant select, insert, update, delete on table public.report_templates
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.report_templates;
create trigger set_updated_at before update on public.report_templates
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- 3. report_subscriptions (per workspace, toggle)
-- ------------------------------------------------------------
create table if not exists public.report_subscriptions (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  template_id           uuid not null references public.report_templates(id) on delete cascade,
  enabled               boolean not null default false,
  schedule              text not null default 'weekly'
    check (schedule in ('hourly', 'daily', 'weekly', 'monthly', 'manual')),
  timezone              text not null default 'Asia/Singapore',
  channels              text[] not null default '{in_app}',
  audience              text,
  sections_override     text[],
  metadata              jsonb not null default '{}',
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (workspace_id, template_id)
);

create index if not exists idx_report_subscriptions_workspace
  on public.report_subscriptions(workspace_id);

create index if not exists idx_report_subscriptions_enabled
  on public.report_subscriptions(workspace_id)
  where enabled = true;

alter table public.report_subscriptions enable row level security;

drop policy if exists "Members can view report subscriptions"
  on public.report_subscriptions;
create policy "Members can view report subscriptions"
  on public.report_subscriptions for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Admins can manage report subscriptions"
  on public.report_subscriptions;
create policy "Admins can manage report subscriptions"
  on public.report_subscriptions for all
  to authenticated
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

grant select, insert, update, delete on table public.report_subscriptions
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.report_subscriptions;
create trigger set_updated_at before update on public.report_subscriptions
  for each row execute function public.update_updated_at();

-- ------------------------------------------------------------
-- 4. report_runs
-- ------------------------------------------------------------
create table if not exists public.report_runs (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  subscription_id       uuid not null references public.report_subscriptions(id) on delete cascade,
  status                text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  trigger_source        text not null default 'manual'
    check (trigger_source in ('manual', 'cron', 'mcp', 'webhook', 'api')),
  started_at            timestamptz,
  finished_at           timestamptz,
  payload_json          jsonb not null default '{}',
  markdown_summary      text,
  error                 text,
  created_by            uuid references auth.users(id) on delete set null,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now()
);

create index if not exists idx_report_runs_subscription
  on public.report_runs(subscription_id, created_at desc);

create index if not exists idx_report_runs_workspace
  on public.report_runs(workspace_id, created_at desc);

create index if not exists idx_report_runs_status
  on public.report_runs(workspace_id, status)
  where status in ('pending', 'running');

alter table public.report_runs enable row level security;

drop policy if exists "Members can view report runs"
  on public.report_runs;
create policy "Members can view report runs"
  on public.report_runs for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Admins can insert report runs"
  on public.report_runs;
create policy "Admins can insert report runs"
  on public.report_runs for insert
  to authenticated
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

grant select, insert, update, delete on table public.report_runs
  to authenticated, service_role;

-- ------------------------------------------------------------
-- 5. Platform seed templates (Rpt-2 — stub sections OK)
-- ------------------------------------------------------------
insert into public.report_templates (
  id, workspace_id, slug, title, description, audience_hint,
  default_sections, default_schedule, default_timezone, default_channels, is_active, metadata
)
values
  (
    '00000000-0000-0000-0002-000000000001',
    null,
    'marketing-weekly',
    'Marketing weekly',
    'Category sales rollup and top movers. Suggest-only — no stock mutations.',
    'marketing',
    array['sales.category_rollup', 'sales.top_movers', 'data_quality.gaps'],
    'weekly',
    'Asia/Singapore',
    array['in_app'],
    true,
    '{"v":1,"seed":true}'::jsonb
  ),
  (
    '00000000-0000-0000-0002-000000000002',
    null,
    'warehouse-weekly-baseline',
    'Warehouse weekly baseline',
    'Loft ATS, wave baseline, open store requests, cover days. Suggest-only.',
    'warehouse',
    array['inventory.ats_by_location', 'ops.wave_baseline', 'ops.open_queues', 'inventory.cover_days'],
    'weekly',
    'Asia/Singapore',
    array['in_app'],
    true,
    '{"v":1,"seed":true}'::jsonb
  ),
  (
    '00000000-0000-0000-0002-000000000003',
    null,
    'finance-stock-rewards',
    'Finance stock & rewards',
    'Stock position and rewards liability stubs. Suggest-only.',
    'finance',
    array['finance.stock_position', 'loyalty.rewards_liability', 'data_quality.gaps'],
    'weekly',
    'Asia/Singapore',
    array['in_app'],
    true,
    '{"v":1,"seed":true}'::jsonb
  )
on conflict do nothing;

-- Idempotent re-seed if unique index path used slug without conflict target
insert into public.report_templates (
  workspace_id, slug, title, description, audience_hint,
  default_sections, default_schedule, default_timezone, default_channels, is_active, metadata
)
select
  null,
  v.slug,
  v.title,
  v.description,
  v.audience_hint,
  v.default_sections,
  v.default_schedule,
  'Asia/Singapore',
  array['in_app'],
  true,
  '{"v":1,"seed":true}'::jsonb
from (
  values
    (
      'marketing-weekly',
      'Marketing weekly',
      'Category sales rollup and top movers. Suggest-only — no stock mutations.',
      'marketing',
      array['sales.category_rollup', 'sales.top_movers', 'data_quality.gaps']::text[],
      'weekly'
    ),
    (
      'warehouse-weekly-baseline',
      'Warehouse weekly baseline',
      'Loft ATS, wave baseline, open store requests, cover days. Suggest-only.',
      'warehouse',
      array['inventory.ats_by_location', 'ops.wave_baseline', 'ops.open_queues', 'inventory.cover_days']::text[],
      'weekly'
    ),
    (
      'finance-stock-rewards',
      'Finance stock & rewards',
      'Stock position and rewards liability stubs. Suggest-only.',
      'finance',
      array['finance.stock_position', 'loyalty.rewards_liability', 'data_quality.gaps']::text[],
      'weekly'
    )
) as v(slug, title, description, audience_hint, default_sections, default_schedule)
where not exists (
  select 1 from public.report_templates t
  where t.workspace_id is null and t.slug = v.slug
);

comment on table public.report_templates is
  'Agentic report pack definitions (platform seeds + workspace custom). Track K.';
comment on table public.report_subscriptions is
  'Per-workspace pack toggle + schedule. Disabled = cron/n8n/MCP skip.';
comment on table public.report_runs is
  'Report execution ledger. Suggest-only payloads; never auto-approve/Loft/FOB.';
