-- ============================================================
-- SKUMS Audit Events
--
-- Purpose:
--   Add append-only provenance for the product identity graph.
--   This is separate from the older UI-oriented activity_log.
--
-- Run AFTER: 028_import_jobs.sql
-- ============================================================

create table if not exists public.audit_events (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  entity_type     text not null,
  entity_id       uuid not null,
  event_type      text not null,
  operation       text not null check (operation in ('INSERT', 'UPDATE', 'DELETE', 'IMPORT', 'SYNC', 'VERIFY', 'ATTEST')),

  actor_user_id   uuid references public.profiles(id) on delete set null,
  source_type     text not null default 'system'
    check (source_type in ('db_trigger', 'api', 'import', 'sync', 'app', 'system')),
  source_id       uuid,
  idempotency_key text,

  before_data     jsonb,
  after_data      jsonb,
  diff            jsonb,
  metadata        jsonb not null default '{}',

  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_events_workspace
  on public.audit_events(workspace_id, created_at desc);

create index if not exists idx_audit_events_entity
  on public.audit_events(entity_type, entity_id, created_at desc);

create unique index if not exists idx_audit_events_idempotency
  on public.audit_events(workspace_id, idempotency_key)
  where idempotency_key is not null;

alter table public.audit_events enable row level security;

create policy "Members can view audit events"
  on public.audit_events for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can insert audit events"
  on public.audit_events for insert
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

-- No UPDATE or DELETE policies. audit_events is append-only.


-- ============================================================
-- 1. Generic trigger for graph-table audit events
-- ============================================================

create or replace function public.record_graph_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_record jsonb;
  v_workspace_id uuid;
  v_entity_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_before := to_jsonb(old);
    v_after := null;
    v_record := v_before;
  elsif TG_OP = 'INSERT' then
    v_before := null;
    v_after := to_jsonb(new);
    v_record := v_after;
  else
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_record := v_after;
  end if;

  v_workspace_id := (v_record->>'workspace_id')::uuid;
  v_entity_id := (v_record->>'id')::uuid;

  if v_workspace_id is null then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  insert into public.audit_events (
    workspace_id,
    entity_type,
    entity_id,
    event_type,
    operation,
    actor_user_id,
    source_type,
    before_data,
    after_data,
    metadata
  )
  values (
    v_workspace_id,
    TG_TABLE_NAME,
    v_entity_id,
    lower(TG_OP),
    TG_OP,
    auth.uid(),
    'db_trigger',
    v_before,
    v_after,
    jsonb_build_object('schema', TG_TABLE_SCHEMA, 'table', TG_TABLE_NAME)
  );

  if TG_OP = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke execute on function public.record_graph_audit_event() from public, anon, authenticated;


-- ============================================================
-- 2. Attach audit triggers to graph tables
-- ============================================================

drop trigger if exists audit_product_identities on public.product_identities;
create trigger audit_product_identities
  after insert or update or delete on public.product_identities
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_trade_units on public.trade_units;
create trigger audit_trade_units
  after insert or update or delete on public.trade_units
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_identity_identifiers on public.identity_identifiers;
create trigger audit_identity_identifiers
  after insert or update or delete on public.identity_identifiers
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_sku_assignments on public.sku_assignments;
create trigger audit_sku_assignments
  after insert or update or delete on public.sku_assignments
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_channels on public.channels;
create trigger audit_channels
  after insert or update or delete on public.channels
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_listings on public.listings;
create trigger audit_listings
  after insert or update or delete on public.listings
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_listing_identifiers on public.listing_identifiers;
create trigger audit_listing_identifiers
  after insert or update or delete on public.listing_identifiers
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_listing_sync_states on public.listing_sync_states;
create trigger audit_listing_sync_states
  after insert or update or delete on public.listing_sync_states
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_import_jobs on public.import_jobs;
create trigger audit_import_jobs
  after insert or update or delete on public.import_jobs
  for each row execute function public.record_graph_audit_event();

drop trigger if exists audit_import_job_rows on public.import_job_rows;
create trigger audit_import_job_rows
  after insert or update or delete on public.import_job_rows
  for each row execute function public.record_graph_audit_event();
