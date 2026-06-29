-- ============================================================
-- SKUMS Product Attention Items
--
-- Purpose:
--   Convert product graph, POS, channel, and agent signals into a
--   durable work queue that humans and agents can resolve together.
--
-- Run AFTER: 040_pos_inventory_events.sql
-- ============================================================

create table if not exists public.product_attention_items (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  attention_type        text not null check (attention_type ~ '^[a-z0-9][a-z0-9_.:-]*$'),
  risk_level            text not null default 'medium'
    check (risk_level in ('low', 'medium', 'high', 'critical')),
  status                text not null default 'open'
    check (status in ('open', 'in_review', 'proposed', 'resolved', 'dismissed', 'cancelled')),

  source_type           text not null default 'system'
    check (source_type in ('app', 'connector', 'agent', 'api', 'import', 'sync', 'system', 'pos')),
  source_app_key        text,
  source_event_id       uuid references public.domain_events(id) on delete set null,
  proposal_id           uuid references public.agent_proposals(id) on delete set null,

  product_identity_id   uuid references public.product_identities(id) on delete set null,
  trade_unit_id         uuid references public.trade_units(id) on delete set null,
  listing_id            uuid references public.listings(id) on delete set null,
  channel_id            uuid references public.channels(id) on delete set null,
  sku_assignment_id     uuid references public.sku_assignments(id) on delete set null,
  identifier_id         uuid references public.identity_identifiers(id) on delete set null,
  product_id            uuid references public.products(id) on delete set null,
  variant_id            uuid references public.product_variants(id) on delete set null,

  title                 text not null,
  summary               text,
  recommended_action    text,
  evidence              jsonb not null default '{}',
  metadata              jsonb not null default '{}',

  assigned_to           uuid references public.profiles(id) on delete set null,
  resolved_by           uuid references public.profiles(id) on delete set null,
  resolved_at           timestamptz,
  idempotency_key       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_product_attention_items_workspace
  on public.product_attention_items(workspace_id, created_at desc);

create index if not exists idx_product_attention_items_status
  on public.product_attention_items(workspace_id, status, risk_level, created_at desc);

create index if not exists idx_product_attention_items_type
  on public.product_attention_items(workspace_id, attention_type, created_at desc);

create index if not exists idx_product_attention_items_source_event
  on public.product_attention_items(source_event_id)
  where source_event_id is not null;

create index if not exists idx_product_attention_items_proposal
  on public.product_attention_items(proposal_id)
  where proposal_id is not null;

create index if not exists idx_product_attention_items_identity
  on public.product_attention_items(product_identity_id)
  where product_identity_id is not null;

create index if not exists idx_product_attention_items_listing
  on public.product_attention_items(listing_id)
  where listing_id is not null;

create unique index if not exists idx_product_attention_items_idempotency
  on public.product_attention_items(workspace_id, idempotency_key)
  where idempotency_key is not null;

alter table public.product_attention_items enable row level security;

create policy "Members can view product attention items"
  on public.product_attention_items for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can insert product attention items"
  on public.product_attention_items for insert
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create policy "Members can update product attention items"
  on public.product_attention_items for update
  using (workspace_id in (select public.get_my_writable_workspace_ids()))
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create trigger set_updated_at before update on public.product_attention_items
  for each row execute function public.update_updated_at();

create or replace function public.create_product_attention_item(
  p_workspace_id uuid,
  p_attention_type text,
  p_title text,
  p_summary text default null,
  p_recommended_action text default null,
  p_risk_level text default 'medium',
  p_source_type text default 'system',
  p_source_app_key text default null,
  p_source_event_id uuid default null,
  p_product_identity_id uuid default null,
  p_trade_unit_id uuid default null,
  p_listing_id uuid default null,
  p_channel_id uuid default null,
  p_sku_assignment_id uuid default null,
  p_identifier_id uuid default null,
  p_product_id uuid default null,
  p_variant_id uuid default null,
  p_evidence jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns public.product_attention_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.product_attention_items%rowtype;
begin
  insert into public.product_attention_items (
    workspace_id,
    attention_type,
    title,
    summary,
    recommended_action,
    risk_level,
    source_type,
    source_app_key,
    source_event_id,
    product_identity_id,
    trade_unit_id,
    listing_id,
    channel_id,
    sku_assignment_id,
    identifier_id,
    product_id,
    variant_id,
    evidence,
    metadata,
    idempotency_key
  )
  values (
    p_workspace_id,
    p_attention_type,
    p_title,
    p_summary,
    p_recommended_action,
    coalesce(p_risk_level, 'medium'),
    coalesce(p_source_type, 'system'),
    p_source_app_key,
    p_source_event_id,
    p_product_identity_id,
    p_trade_unit_id,
    p_listing_id,
    p_channel_id,
    p_sku_assignment_id,
    p_identifier_id,
    p_product_id,
    p_variant_id,
    coalesce(p_evidence, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    p_idempotency_key
  )
  on conflict (workspace_id, idempotency_key)
    where idempotency_key is not null
  do update set
    updated_at = now()
  returning * into v_item;

  return v_item;
end;
$$;

revoke execute on function public.create_product_attention_item(
  uuid, text, text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text
) from public, anon, authenticated;

drop trigger if exists audit_product_attention_items on public.product_attention_items;
create trigger audit_product_attention_items
  after insert or update or delete on public.product_attention_items
  for each row execute function public.record_graph_audit_event();
