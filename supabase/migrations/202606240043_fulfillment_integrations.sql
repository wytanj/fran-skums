-- ============================================================
-- SKUMS - Fulfillment integrations
-- Generic 3PL/WMS external entity mappings plus WorldSyntech/OFS seeds.
-- Run AFTER: 042_channel_intelligence.sql
-- ============================================================

create table if not exists public.integration_entity_mappings (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  connection_id         uuid not null references public.integration_connections(id) on delete cascade,

  entity_type           text not null check (entity_type in (
    'product',
    'order',
    'order_line',
    'inbound_shipment',
    'inventory_snapshot',
    'delivery_method',
    'address',
    'country',
    'zone'
  )),
  local_entity_type     text,
  local_entity_id       uuid,

  external_id           text not null,
  external_secondary_id text,
  external_data         jsonb not null default '{}',
  remote_hash           text,
  last_synced_at        timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (connection_id, entity_type, external_id)
);

create index if not exists idx_integration_entity_mappings_workspace
  on public.integration_entity_mappings(workspace_id, entity_type, updated_at desc);

create index if not exists idx_integration_entity_mappings_connection
  on public.integration_entity_mappings(connection_id, entity_type);

create index if not exists idx_integration_entity_mappings_external_secondary
  on public.integration_entity_mappings(connection_id, entity_type, external_secondary_id)
  where external_secondary_id is not null;

create index if not exists idx_integration_entity_mappings_local
  on public.integration_entity_mappings(workspace_id, local_entity_type, local_entity_id)
  where local_entity_id is not null;

alter table public.integration_entity_mappings enable row level security;

drop policy if exists "Members can view integration entity mappings"
  on public.integration_entity_mappings;
create policy "Members can view integration entity mappings"
  on public.integration_entity_mappings for select
  to authenticated
  using (workspace_id in (select public.get_my_workspace_ids()));

drop policy if exists "Admins can manage integration entity mappings"
  on public.integration_entity_mappings;
create policy "Admins can manage integration entity mappings"
  on public.integration_entity_mappings for all
  to authenticated
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));

grant select, insert, update, delete on table public.integration_entity_mappings
  to authenticated, service_role;

drop trigger if exists set_updated_at on public.integration_entity_mappings;
create trigger set_updated_at before update on public.integration_entity_mappings
  for each row execute function public.update_updated_at();


insert into public.integration_node_definitions
  (
    workspace_id,
    name,
    slug,
    description,
    icon,
    color,
    category,
    node_type,
    is_available,
    is_coming_soon,
    actions,
    triggers,
    credential_schema,
    default_field_mapping,
    supports_webhooks,
    rate_limit_rpm
  )
select
  null::uuid,
  'WorldSyntech OFS',
  'worldsyntech-ofs',
  'Connect Loft Logistics or another WorldSyntech OFS-powered 3PL for inbound warehouse stock, inventory visibility, and store replenishment.',
  'warehouse',
  'bg-cyan-600/10 text-cyan-300 ring-cyan-500/20',
  'shipping',
  'both',
  true,
  false,
  '[
    {"key":"test_credentials","label":"Test Credentials","description":"Exchange OFS credentials for a bearer token and verify the account."},
    {"key":"sync_reference_data","label":"Sync Reference Data","description":"Cache OFS addresses, countries, zones, and delivery methods."},
    {"key":"pull_inventory","label":"Pull Inventory","description":"Read Loft warehouse stock visibility from OFS."},
    {"key":"create_store_replenishment","label":"Create Store Replenishment","description":"Send a LISE store replenishment request to Loft via OFS orders."},
    {"key":"create_inbound_shipment","label":"Create Inbound Shipment","description":"Create a ship-to-warehouse notice for goods inbound from Korea or Hong Kong."},
    {"key":"poll_inbound_shipments","label":"Poll Inbound Shipments","description":"Check receiving, partial receipt, and spoilage status."}
  ]'::jsonb,
  '[
    {"key":"inventory_changed","label":"Inventory Changed","description":"Fires when OFS warehouse availability changes."},
    {"key":"store_replenishment_status_changed","label":"Store Replenishment Status Changed","description":"Fires when a store replenishment request changes status."},
    {"key":"inbound_receipt_changed","label":"Inbound Receipt Changed","description":"Fires when inbound warehouse receiving status changes."}
  ]'::jsonb,
  '{
    "properties": {
      "base_url": {"type":"string","label":"OFS Base URL","description":"https://orderfulfillment.example.com","required":true},
      "basic_token": {"type":"string","label":"Basic Token","secret":true,"required":true},
      "user_name": {"type":"string","label":"Username","required":true},
      "password": {"type":"string","label":"Password","secret":true,"required":true},
      "language_id": {"type":"number","label":"Language ID","default":1},
      "default_country_id": {"type":"number","label":"Default Country ID"},
      "default_zone_id": {"type":"number","label":"Default Zone ID"},
      "default_delivery_method_id": {"type":"number","label":"Default Delivery Method ID"}
    }
  }'::jsonb,
  '{}'::jsonb,
  false,
  60
where not exists (
  select 1
  from public.integration_node_definitions ind
  where ind.workspace_id is null
    and ind.slug = 'worldsyntech-ofs'
);


insert into public.app_definitions
  (
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
select
  null::uuid,
  'worldsyntech_ofs',
  'WorldSyntech OFS',
  'connector',
  '3PL fulfillment app for OFS-powered logistics partners such as Loft Logistics: inbound warehouse stock, inventory visibility, and LISE store replenishment.',
  array['inbound_shipments','warehouse_inventory','store_replenishment','fulfillment_reference_data'],
  array['product_identity','trade_units','sku_assignments','inventory_availability','fulfillment_policies'],
  array['worldsyntech_ofs.connected','warehouse_inventory.synced','store_replenishment.created','inbound_shipment.created','inbound_receipt.changed'],
  array['inventory.low_stock','store_replenishment.requested','purchase_order.inbound_ready'],
  array['products:read','integrations:read','integrations:write','events:read','events:write'],
  '{"adapter_id":"worldsyntech_ofs","integration_node_slug":"worldsyntech-ofs","default_mode":"retail_replenishment"}'::jsonb
where not exists (
  select 1
  from public.app_definitions ad
  where ad.workspace_id is null
    and ad.app_key = 'worldsyntech_ofs'
);
