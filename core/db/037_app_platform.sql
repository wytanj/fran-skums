-- ============================================================
-- SKUMS App Platform
--
-- Purpose:
--   Make SKUMS the agentic commerce core that other apps can build on.
--   This migration adds neutral app registry, workspace app enablement,
--   capability ownership, domain events, and agent proposal/execution
--   primitives. These are operational primitives, not billing/package
--   assumptions.
--
-- Run AFTER: 036_pos_core.sql
-- ============================================================


-- ============================================================
-- 1. APP DEFINITIONS
--    Registry for core modules, first-party apps, connectors, agents,
--    and workspace/private apps.
-- ============================================================

create table if not exists public.app_definitions (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid references public.workspaces(id) on delete cascade,

  app_key               text not null check (app_key ~ '^[a-z0-9][a-z0-9_:-]*$'),
  name                  text not null,
  app_type              text not null default 'first_party'
    check (app_type in ('core', 'first_party', 'connector', 'agent', 'external', 'custom')),
  status                text not null default 'available'
    check (status in ('available', 'private', 'deprecated', 'disabled')),

  description           text,
  config_schema         jsonb not null default '{}',
  provided_capabilities text[] not null default '{}',
  consumed_capabilities text[] not null default '{}',
  emitted_events        text[] not null default '{}',
  subscribed_events     text[] not null default '{}',
  required_scopes       text[] not null default '{}',
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_app_definitions_unique_key
  on public.app_definitions(
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    app_key
  );

create index if not exists idx_app_definitions_workspace
  on public.app_definitions(workspace_id)
  where workspace_id is not null;

alter table public.app_definitions enable row level security;

create policy "Anyone can view global app definitions"
  on public.app_definitions for select
  using (workspace_id is null and status <> 'disabled');

create policy "Members can view workspace app definitions"
  on public.app_definitions for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage workspace app definitions"
  on public.app_definitions for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create trigger set_updated_at before update on public.app_definitions
  for each row execute function public.update_updated_at();


-- ============================================================
-- 2. WORKSPACE APPS
--    Operational app enablement per workspace. This is not billing.
-- ============================================================

create table if not exists public.workspace_apps (
  id                uuid primary key default uuid_generate_v4(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  app_definition_id uuid references public.app_definitions(id) on delete set null,
  app_key           text not null check (app_key ~ '^[a-z0-9][a-z0-9_:-]*$'),

  status            text not null default 'enabled'
    check (status in ('configuring', 'enabled', 'disabled', 'suspended', 'error')),
  enabled_by        uuid references public.profiles(id) on delete set null,
  enabled_at        timestamptz not null default now(),
  disabled_at       timestamptz,
  config            jsonb not null default '{}',
  capabilities      jsonb not null default '{}',
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (workspace_id, app_key)
);

create index if not exists idx_workspace_apps_workspace
  on public.workspace_apps(workspace_id);

create index if not exists idx_workspace_apps_status
  on public.workspace_apps(workspace_id, status);

alter table public.workspace_apps enable row level security;

create policy "Members can view workspace apps"
  on public.workspace_apps for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage workspace apps"
  on public.workspace_apps for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create trigger set_updated_at before update on public.workspace_apps
  for each row execute function public.update_updated_at();


-- ============================================================
-- 3. CAPABILITY SOURCES
--    Declares which app/connector/system is authoritative for a
--    commerce capability in a workspace. This lets a company use:
--      SKUMS only, POS only, SKUMS+POS, SKUMS+external apps, or
--      external app stacks with SKUMS as observer/coordinator.
-- ============================================================

create table if not exists public.workspace_capability_sources (
  id                        uuid primary key default uuid_generate_v4(),
  workspace_id              uuid not null references public.workspaces(id) on delete cascade,

  capability_key            text not null check (capability_key ~ '^[a-z0-9][a-z0-9_:-]*$'),
  owner_type                text not null default 'workspace_app'
    check (owner_type in ('skums_core', 'workspace_app', 'integration_connection', 'external_system', 'manual')),
  app_key                   text,
  app_definition_id         uuid references public.app_definitions(id) on delete set null,
  workspace_app_id          uuid references public.workspace_apps(id) on delete set null,
  integration_connection_id uuid references public.integration_connections(id) on delete set null,

  mode                      text not null default 'source_of_truth'
    check (mode in ('source_of_truth', 'read_only', 'write_through', 'event_sink', 'disabled')),
  conflict_policy           text not null default 'manual_review'
    check (conflict_policy in ('prefer_source', 'prefer_latest', 'manual_review', 'block')),

  config                    jsonb not null default '{}',
  metadata                  jsonb not null default '{}',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (workspace_id, capability_key)
);

create index if not exists idx_capability_sources_workspace
  on public.workspace_capability_sources(workspace_id);

create index if not exists idx_capability_sources_capability
  on public.workspace_capability_sources(workspace_id, capability_key);

create unique index if not exists idx_capability_sources_one_truth
  on public.workspace_capability_sources(workspace_id, capability_key)
  where mode = 'source_of_truth';

alter table public.workspace_capability_sources enable row level security;

create policy "Members can view capability sources"
  on public.workspace_capability_sources for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage capability sources"
  on public.workspace_capability_sources for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

create trigger set_updated_at before update on public.workspace_capability_sources
  for each row execute function public.update_updated_at();


-- ============================================================
-- 4. DOMAIN EVENTS
--    Append-only event ledger for app and agent coordination.
-- ============================================================

create table if not exists public.domain_events (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  event_type      text not null check (event_type ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  event_version   integer not null default 1 check (event_version > 0),
  source_type     text not null default 'system'
    check (source_type in ('app', 'connector', 'agent', 'api', 'import', 'sync', 'system')),
  source_app_key  text,
  source_id       uuid,

  aggregate_type  text,
  aggregate_id    uuid,
  correlation_id  uuid,
  causation_id    uuid references public.domain_events(id) on delete set null,
  idempotency_key text,

  payload         jsonb not null default '{}',
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists idx_domain_events_workspace
  on public.domain_events(workspace_id, created_at desc);

create index if not exists idx_domain_events_type
  on public.domain_events(workspace_id, event_type, created_at desc);

create index if not exists idx_domain_events_aggregate
  on public.domain_events(workspace_id, aggregate_type, aggregate_id)
  where aggregate_type is not null and aggregate_id is not null;

create unique index if not exists idx_domain_events_idempotency
  on public.domain_events(workspace_id, idempotency_key)
  where idempotency_key is not null;

alter table public.domain_events enable row level security;

create policy "Members can view domain events"
  on public.domain_events for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can insert domain events"
  on public.domain_events for insert
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

-- No UPDATE or DELETE policies. domain_events is append-only.

create or replace function public.emit_domain_event(
  p_workspace_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_source_type text default 'system',
  p_source_app_key text default null,
  p_aggregate_type text default null,
  p_aggregate_id uuid default null,
  p_correlation_id uuid default null,
  p_causation_id uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.domain_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.domain_events%rowtype;
begin
  insert into public.domain_events (
    workspace_id,
    event_type,
    payload,
    source_type,
    source_app_key,
    aggregate_type,
    aggregate_id,
    correlation_id,
    causation_id,
    idempotency_key,
    metadata
  )
  values (
    p_workspace_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    p_source_type,
    p_source_app_key,
    p_aggregate_type,
    p_aggregate_id,
    p_correlation_id,
    p_causation_id,
    p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (workspace_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning * into v_event;

  if v_event.id is null and p_idempotency_key is not null then
    select * into v_event
    from public.domain_events
    where workspace_id = p_workspace_id
      and idempotency_key = p_idempotency_key;
  end if;

  return v_event;
end;
$$;

revoke execute on function public.emit_domain_event(uuid, text, jsonb, text, text, text, uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;


-- ============================================================
-- 5. AGENT PROPOSALS, APPROVALS, EXECUTION LOGS
--    Agentic behavior must propose, be policy-checked, then execute
--    deterministically through tools.
-- ============================================================

create table if not exists public.agent_proposals (
  id                uuid primary key default uuid_generate_v4(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  source_event_id   uuid references public.domain_events(id) on delete set null,

  app_key           text,
  agent_type        text not null,
  intent_summary    text not null,
  affected_objects  jsonb not null default '[]',
  proposed_steps    jsonb not null default '[]',
  data_diff         jsonb not null default '{}',
  risk_level        text not null default 'low'
    check (risk_level in ('low', 'medium', 'high', 'critical')),
  policy_result     jsonb not null default '{}',
  approval_required boolean not null default true,
  status            text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'executing', 'executed', 'failed', 'cancelled')),

  created_by_agent  text,
  requested_by      uuid references public.profiles(id) on delete set null,
  approved_by       uuid references public.profiles(id) on delete set null,
  approved_at       timestamptz,
  executed_at       timestamptz,
  rollback_metadata jsonb not null default '{}',
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_agent_proposals_workspace
  on public.agent_proposals(workspace_id, created_at desc);

create index if not exists idx_agent_proposals_status
  on public.agent_proposals(workspace_id, status, created_at desc);

alter table public.agent_proposals enable row level security;

create policy "Members can view agent proposals"
  on public.agent_proposals for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can insert agent proposals"
  on public.agent_proposals for insert
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create policy "Members can update agent proposals"
  on public.agent_proposals for update
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.agent_proposals
  for each row execute function public.update_updated_at();


create table if not exists public.approval_requests (
  id                uuid primary key default uuid_generate_v4(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  proposal_id       uuid references public.agent_proposals(id) on delete cascade,

  approval_type     text not null default 'agent_proposal',
  status            text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  requested_by      uuid references public.profiles(id) on delete set null,
  assigned_to       uuid references public.profiles(id) on delete set null,
  decided_by        uuid references public.profiles(id) on delete set null,
  decision_notes    text,
  due_at            timestamptz,
  decided_at        timestamptz,
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_approval_requests_workspace
  on public.approval_requests(workspace_id, created_at desc);

create index if not exists idx_approval_requests_status
  on public.approval_requests(workspace_id, status, created_at desc);

alter table public.approval_requests enable row level security;

create policy "Members can view approval requests"
  on public.approval_requests for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can manage approval requests"
  on public.approval_requests for all
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.approval_requests
  for each row execute function public.update_updated_at();


create table if not exists public.agent_execution_logs (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  proposal_id     uuid references public.agent_proposals(id) on delete set null,
  source_event_id uuid references public.domain_events(id) on delete set null,

  app_key         text,
  agent_type      text,
  status          text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'cancelled', 'blocked')),
  input_data      jsonb not null default '{}',
  output_data     jsonb not null default '{}',
  error_message   text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     integer,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists idx_agent_execution_logs_workspace
  on public.agent_execution_logs(workspace_id, created_at desc);

create index if not exists idx_agent_execution_logs_proposal
  on public.agent_execution_logs(proposal_id)
  where proposal_id is not null;

alter table public.agent_execution_logs enable row level security;

create policy "Members can view agent execution logs"
  on public.agent_execution_logs for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can insert agent execution logs"
  on public.agent_execution_logs for insert
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));


-- ============================================================
-- 6. AUDIT TRIGGERS
-- ============================================================

drop trigger if exists audit_app_definitions on public.app_definitions;
create trigger audit_app_definitions
  after insert or update or delete on public.app_definitions
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_workspace_apps on public.workspace_apps;
create trigger audit_workspace_apps
  after insert or update or delete on public.workspace_apps
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_workspace_capability_sources on public.workspace_capability_sources;
create trigger audit_workspace_capability_sources
  after insert or update or delete on public.workspace_capability_sources
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_agent_proposals on public.agent_proposals;
create trigger audit_agent_proposals
  after insert or update or delete on public.agent_proposals
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_approval_requests on public.approval_requests;
create trigger audit_approval_requests
  after insert or update or delete on public.approval_requests
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_agent_execution_logs on public.agent_execution_logs;
create trigger audit_agent_execution_logs
  after insert or update or delete on public.agent_execution_logs
  for each row execute function public.record_graph_audit_event();


-- ============================================================
-- 7. GLOBAL APP SEED
-- ============================================================

insert into public.app_definitions
  (workspace_id, app_key, name, app_type, description, provided_capabilities, consumed_capabilities, emitted_events, subscribed_events, required_scopes, metadata)
select *
from (
  values
    (
      null::uuid,
      'skums_core',
      'SKUMS Core',
      'core',
      'Agentic commerce core: product graph, capabilities, events, proposals, imports, listings, and audit.',
      array['product_identity','trade_units','identifiers','sku_assignments','channels','listings','imports','audit_events','domain_events','agent_proposals','capability_sources'],
      array[]::text[],
      array['product.created','product.updated','trade_unit.created','sku_assignment.created','listing.created','import.completed','agent_proposal.created'],
      array[]::text[],
      array['products:read','products:write','apps:read','events:read','agents:read'],
      '{}'::jsonb
    ),
    (
      null::uuid,
      'pos',
      'SKUMS POS',
      'first_party',
      'Retail execution app that consumes the SKUMS graph and emits sales, returns, samples, tester, and stock events.',
      array['pos_sales','register_sessions','receipt_records','settlement_records'],
      array['product_identity','trade_units','identifiers','sku_assignments','listings','inventory_availability','customers'],
      array['pos_sale.completed','pos_return.completed','sample.issued','tester.opened'],
      array['product.updated','listing.updated','inventory.low_stock','expiry.warning_created'],
      array['pos:read','pos:write','products:read','events:write'],
      '{}'::jsonb
    ),
    (
      null::uuid,
      'skincare_intelligence',
      'Skincare Intelligence',
      'first_party',
      'Category intelligence app for skincare product claims, marketplace quality, scraping, and product attention signals.',
      array['market_intelligence','claim_review','quality_analysis','product_attention'],
      array['product_identity','listings','channels','content','media','audit_events'],
      array['quality.analysis_created','claim.review_required','product_attention.created'],
      array['product.created','product.updated','listing.created','listing.updated'],
      array['products:read','products:write','events:read','events:write','agents:write'],
      '{}'::jsonb
    ),
    (
      null::uuid,
      'shopify',
      'Shopify',
      'connector',
      'Storefront connector for product/listing sync and online order events.',
      array['storefront_listings','online_orders','customer_refs'],
      array['product_identity','trade_units','listings','pricing','inventory_availability'],
      array['external_order.created','listing_sync.completed','listing_sync.failed'],
      array['listing.created','listing.updated','inventory_availability.changed'],
      array['products:read','events:read','events:write'],
      '{}'::jsonb
    ),
    (
      null::uuid,
      'supplier_imports',
      'Supplier Imports',
      'agent',
      'Import and normalization agent for supplier catalogs, price lists, and messy commerce files.',
      array['supplier_catalog_normalization','import_review','duplicate_detection'],
      array['product_identity','trade_units','identifiers','sku_assignments','imports'],
      array['supplier_catalog.imported','import_review.created','duplicate_candidates.detected'],
      array['import.created','import.rows_validated'],
      array['products:read','products:write','events:write','agents:write'],
      '{}'::jsonb
    )
) as seed(
  workspace_id,
  app_key,
  name,
  app_type,
  description,
  provided_capabilities,
  consumed_capabilities,
  emitted_events,
  subscribed_events,
  required_scopes,
  metadata
)
where not exists (
  select 1
  from public.app_definitions ad
  where ad.workspace_id is null
    and ad.app_key = seed.app_key
);
