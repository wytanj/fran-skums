-- ============================================================
-- SKUMS — Loft / store-ops permissions + inventory topology
-- Phase P.0 + A.1 foundations from TODO-LOFT.md
-- Run AFTER: 054_help_connect_claude.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Expand global permission schemas (area flags for Loft track)
-- ------------------------------------------------------------

-- Owner: full
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'inventory', jsonb_build_object(
    'read', true, 'write', true, 'delete', true, 'po', true, 'override_expiry', true
  ),
  'locations', jsonb_build_object('read', true, 'write', true, 'delete', true),
  'expiry', jsonb_build_object('read', true, 'write', true, 'delete', true),
  'store_ops', jsonb_build_object(
    'read', true, 'write', true, 'approve', true, 'verify', true,
    'execute_3pl', true, 'inbound', true
  ),
  'pos', jsonb_build_object('read', true, 'write', true, 'config', true),
  'forecasting', jsonb_build_object('read', true, 'write', true),
  'actions', jsonb_build_object('read', true, 'write', true, 'submit', true, 'approve', true),
  'intel', jsonb_build_object('read', true, 'write', true),
  'apps', jsonb_build_object('read', true, 'write', true, 'install', true)
),
updated_at = now()
where workspace_id is null and slug = 'owner' and is_default = true;

-- Admin: full ops except workspace delete (already false); include 3pl
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'inventory', jsonb_build_object(
    'read', true, 'write', true, 'delete', true, 'po', true, 'override_expiry', true
  ),
  'locations', jsonb_build_object('read', true, 'write', true, 'delete', false),
  'expiry', jsonb_build_object('read', true, 'write', true, 'delete', true),
  'store_ops', jsonb_build_object(
    'read', true, 'write', true, 'approve', true, 'verify', true,
    'execute_3pl', true, 'inbound', true
  ),
  'pos', jsonb_build_object('read', true, 'write', true, 'config', true),
  'forecasting', jsonb_build_object('read', true, 'write', true),
  'actions', jsonb_build_object('read', true, 'write', true, 'submit', true, 'approve', true),
  'intel', jsonb_build_object('read', true, 'write', true),
  'apps', jsonb_build_object('read', true, 'write', true, 'install', true)
),
updated_at = now()
where workspace_id is null and slug = 'admin' and is_default = true;

-- Member: data write, no credentials/integrations execute; no store_ops approve/verify/3pl
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'inventory', jsonb_build_object(
    'read', true, 'write', true, 'delete', false, 'po', false, 'override_expiry', false
  ),
  'locations', jsonb_build_object('read', true, 'write', false, 'delete', false),
  'expiry', jsonb_build_object('read', true, 'write', true, 'delete', false),
  'store_ops', jsonb_build_object(
    'read', true, 'write', true, 'approve', false, 'verify', false,
    'execute_3pl', false, 'inbound', false
  ),
  'pos', jsonb_build_object('read', true, 'write', true, 'config', false),
  'forecasting', jsonb_build_object('read', true, 'write', false),
  'actions', jsonb_build_object('read', true, 'write', false, 'submit', true, 'approve', false),
  'intel', jsonb_build_object('read', true, 'write', false),
  'apps', jsonb_build_object('read', true, 'write', false, 'install', false)
),
updated_at = now()
where workspace_id is null and slug = 'member' and is_default = true;

-- Viewer: read-only
update public.permission_schemas
set permissions = permissions || jsonb_build_object(
  'inventory', jsonb_build_object(
    'read', true, 'write', false, 'delete', false, 'po', false, 'override_expiry', false
  ),
  'locations', jsonb_build_object('read', true, 'write', false, 'delete', false),
  'expiry', jsonb_build_object('read', true, 'write', false, 'delete', false),
  'store_ops', jsonb_build_object(
    'read', true, 'write', false, 'approve', false, 'verify', false,
    'execute_3pl', false, 'inbound', false
  ),
  'pos', jsonb_build_object('read', true, 'write', false, 'config', false),
  'forecasting', jsonb_build_object('read', true, 'write', false),
  'actions', jsonb_build_object('read', true, 'write', false, 'submit', false, 'approve', false),
  'intel', jsonb_build_object('read', true, 'write', false),
  'apps', jsonb_build_object('read', true, 'write', false, 'install', false)
),
updated_at = now()
where workspace_id is null and slug = 'viewer' and is_default = true;

-- Store associate (POS-aligned HQ schema optional assignment)
insert into public.permission_schemas (id, workspace_id, name, slug, description, is_default, permissions)
select
  '00000000-0000-0000-0001-000000000010',
  null,
  'Store Associate',
  'store_associate',
  'Store-facing access: POS, request replenishment, report receive exceptions. No HQ approve/verify/3PL.',
  true,
  '{
    "products": {"read": true, "write": false, "delete": false, "import": false, "export": false},
    "brands": {"read": true, "write": false, "delete": false},
    "categories": {"read": true, "write": false, "delete": false},
    "integrations": {"read": false, "write": false, "delete": false, "execute": false},
    "credentials": {"read": false, "write": false, "delete": false},
    "schemas": {"read": false, "write": false, "delete": false},
    "custom_fields": {"read": false, "write": false, "delete": false},
    "team": {"read": false, "invite": false, "remove": false, "change_role": false},
    "workspace": {"read": true, "write": false, "delete": false},
    "activity": {"read": true},
    "api": {"read": false, "write": false},
    "inventory": {"read": true, "write": false, "delete": false, "po": false, "override_expiry": false},
    "locations": {"read": true, "write": false, "delete": false},
    "expiry": {"read": true, "write": false, "delete": false},
    "store_ops": {"read": true, "write": true, "approve": false, "verify": false, "execute_3pl": false, "inbound": false},
    "pos": {"read": true, "write": true, "config": false},
    "forecasting": {"read": false, "write": false},
    "actions": {"read": false, "write": false, "submit": false, "approve": false},
    "intel": {"read": false, "write": false},
    "apps": {"read": false, "write": false, "install": false}
  }'::jsonb
where not exists (
  select 1 from public.permission_schemas
  where id = '00000000-0000-0000-0001-000000000010'
     or (workspace_id is null and slug = 'store_associate')
);

update public.permission_schemas
set
  name = 'Store Associate',
  description = 'Store-facing access: POS, request replenishment, report receive exceptions. No HQ approve/verify/3PL.',
  is_default = true,
  permissions = '{
    "products": {"read": true, "write": false, "delete": false, "import": false, "export": false},
    "brands": {"read": true, "write": false, "delete": false},
    "categories": {"read": true, "write": false, "delete": false},
    "integrations": {"read": false, "write": false, "delete": false, "execute": false},
    "credentials": {"read": false, "write": false, "delete": false},
    "schemas": {"read": false, "write": false, "delete": false},
    "custom_fields": {"read": false, "write": false, "delete": false},
    "team": {"read": false, "invite": false, "remove": false, "change_role": false},
    "workspace": {"read": true, "write": false, "delete": false},
    "activity": {"read": true},
    "api": {"read": false, "write": false},
    "inventory": {"read": true, "write": false, "delete": false, "po": false, "override_expiry": false},
    "locations": {"read": true, "write": false, "delete": false},
    "expiry": {"read": true, "write": false, "delete": false},
    "store_ops": {"read": true, "write": true, "approve": false, "verify": false, "execute_3pl": false, "inbound": false},
    "pos": {"read": true, "write": true, "config": false},
    "forecasting": {"read": false, "write": false},
    "actions": {"read": false, "write": false, "submit": false, "approve": false},
    "intel": {"read": false, "write": false},
    "apps": {"read": false, "write": false, "install": false}
  }'::jsonb,
  updated_at = now()
where workspace_id is null and slug = 'store_associate';

-- Inventory ops (HQ decide + verify; no credentials / 3pl send by default)
insert into public.permission_schemas (id, workspace_id, name, slug, description, is_default, permissions)
select
  '00000000-0000-0000-0001-000000000011',
  null,
  'Inventory Ops',
  'inventory_ops',
  'HQ inventory: approve/defer store requests, verify receipt exceptions, manage stock. No OFS credentials or send-to-Loft unless also admin.',
  true,
  '{
    "products": {"read": true, "write": true, "delete": false, "import": true, "export": true},
    "brands": {"read": true, "write": false, "delete": false},
    "categories": {"read": true, "write": false, "delete": false},
    "integrations": {"read": true, "write": false, "delete": false, "execute": false},
    "credentials": {"read": false, "write": false, "delete": false},
    "schemas": {"read": true, "write": false, "delete": false},
    "custom_fields": {"read": true, "write": false, "delete": false},
    "team": {"read": true, "invite": false, "remove": false, "change_role": false},
    "workspace": {"read": true, "write": false, "delete": false},
    "activity": {"read": true},
    "api": {"read": true, "write": false},
    "inventory": {"read": true, "write": true, "delete": false, "po": true, "override_expiry": true},
    "locations": {"read": true, "write": true, "delete": false},
    "expiry": {"read": true, "write": true, "delete": false},
    "store_ops": {"read": true, "write": true, "approve": true, "verify": true, "execute_3pl": false, "inbound": true},
    "pos": {"read": true, "write": true, "config": false},
    "forecasting": {"read": true, "write": true},
    "actions": {"read": true, "write": true, "submit": true, "approve": false},
    "intel": {"read": true, "write": false},
    "apps": {"read": true, "write": false, "install": false}
  }'::jsonb
where not exists (
  select 1 from public.permission_schemas
  where id = '00000000-0000-0000-0001-000000000011'
     or (workspace_id is null and slug = 'inventory_ops')
);

update public.permission_schemas
set
  name = 'Inventory Ops',
  description = 'HQ inventory: approve/defer store requests, verify receipt exceptions, manage stock. No OFS credentials or send-to-Loft unless also admin.',
  is_default = true,
  permissions = '{
    "products": {"read": true, "write": true, "delete": false, "import": true, "export": true},
    "brands": {"read": true, "write": false, "delete": false},
    "categories": {"read": true, "write": false, "delete": false},
    "integrations": {"read": true, "write": false, "delete": false, "execute": false},
    "credentials": {"read": false, "write": false, "delete": false},
    "schemas": {"read": true, "write": false, "delete": false},
    "custom_fields": {"read": true, "write": false, "delete": false},
    "team": {"read": true, "invite": false, "remove": false, "change_role": false},
    "workspace": {"read": true, "write": false, "delete": false},
    "activity": {"read": true},
    "api": {"read": true, "write": false},
    "inventory": {"read": true, "write": true, "delete": false, "po": true, "override_expiry": true},
    "locations": {"read": true, "write": true, "delete": false},
    "expiry": {"read": true, "write": true, "delete": false},
    "store_ops": {"read": true, "write": true, "approve": true, "verify": true, "execute_3pl": false, "inbound": true},
    "pos": {"read": true, "write": true, "config": false},
    "forecasting": {"read": true, "write": true},
    "actions": {"read": true, "write": true, "submit": true, "approve": false},
    "intel": {"read": true, "write": false},
    "apps": {"read": true, "write": false, "install": false}
  }'::jsonb,
  updated_at = now()
where workspace_id is null and slug = 'inventory_ops';

-- ------------------------------------------------------------
-- 2. workspace_apps.granted_scopes (P.4 install grants)
-- ------------------------------------------------------------
alter table public.workspace_apps
  add column if not exists granted_scopes text[] not null default '{}';

comment on column public.workspace_apps.granted_scopes is
  'Scopes granted at app enable time (intersection of app required_scopes and admin approval).';

-- ------------------------------------------------------------
-- 3. App required_scopes: worldsyntech_ofs + pos (+ pos-connector alias seed)
-- ------------------------------------------------------------
update public.app_definitions
set
  required_scopes = array[
    'inventory:read',
    'inventory:write',
    'store_ops:read',
    'store_ops:write',
    'store_ops:execute_3pl',
    'store_ops:inbound',
    'integrations:execute',
    'locations:read',
    'products:read'
  ],
  updated_at = now()
where workspace_id is null
  and app_key = 'worldsyntech_ofs';

update public.app_definitions
set
  required_scopes = array[
    'pos:read',
    'pos:write',
    'store_ops:read',
    'store_ops:write',
    'products:read'
  ],
  updated_at = now()
where workspace_id is null
  and app_key = 'pos';

-- Explicit POS connector app key used by machine keys / install UX
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
  'pos_connector',
  'POS Connector',
  'connector',
  'Machine access for Fran POS: catalog, sales, floor events, replenishment requests, and store receive reports. No HQ approve/verify/3PL.',
  array['pos_sales', 'pos_inventory_events', 'store_replenishment_requests', 'store_receiving_reports'],
  array['product_identity', 'inventory_availability', 'store_operations'],
  array['pos_sale.completed', 'store_replenishment.requested', 'receiving_session.submitted'],
  array['store_replenishment.status_changed', 'inventory.low_stock'],
  array['pos:read', 'pos:write', 'store_ops:read', 'store_ops:write', 'products:read'],
  '{"package":"pos_connector","least_privilege":true}'::jsonb
where not exists (
  select 1 from public.app_definitions ad
  where ad.workspace_id is null and ad.app_key = 'pos_connector'
);

-- ------------------------------------------------------------
-- 4. WorldSyntech node: pull_products action
-- ------------------------------------------------------------
update public.integration_node_definitions
set
  actions = coalesce(actions, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'key', 'pull_products',
      'label', 'Pull OFS Products',
      'description', 'Pull WorldSyntech/OFS product master for SKU mapping.'
    )
  ),
  updated_at = now()
where workspace_id is null
  and slug = 'worldsyntech-ofs'
  and not exists (
    select 1
    from jsonb_array_elements(coalesce(actions, '[]'::jsonb)) elem
    where elem->>'key' = 'pull_products'
  );

-- ------------------------------------------------------------
-- 5. Inventory topology: Loft 3PL + transit (A.1)
-- ------------------------------------------------------------
create or replace function public.seed_workspace_inventory_locations(
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_locations
    (workspace_id, name, code, location_type, is_default, notes)
  values
    (p_workspace_id,
     'Main Warehouse',  'WH-MAIN',     'warehouse',  true,
     'Primary non-3PL storage when used. Prefer LOFT-SG for LISE Loft stock.'),

    (p_workspace_id,
     'Loft Logistics (OFS)', 'LOFT-SG', '3pl', false,
     'Loft warehouse availability for LISE. Trust only after inbound confirm / policy.'),

    (p_workspace_id,
     'Loft → Store In Transit', 'XFER-LOFT-STORE', 'in_transit', false,
     'Goods released from Loft (delivery or self-collect) not yet store-received.'),

    (p_workspace_id,
     'Ready to Ship',   'READY-SHIP',  'virtual',    false,
     'Stock picked and packed awaiting carrier pickup.'),

    (p_workspace_id,
     'In Transit',      'IN-TRANSIT',  'in_transit', false,
     'Generic in-transit bucket (supplier or inter-site).'),

    (p_workspace_id,
     'Damaged Goods',   'DAMAGED',     'damaged',    false,
     'QC fail / damaged. Excluded from ATS.'),

    (p_workspace_id,
     'Returns',         'RETURNS',     'returns',    false,
     'Returns awaiting inspection.')

  on conflict (workspace_id, code) do nothing;
end;
$$;

-- Seed Loft locations onto existing workspaces (idempotent)
do $$
declare
  r record;
begin
  for r in select id from public.workspaces
  loop
    perform public.seed_workspace_inventory_locations(r.id);
  end loop;
end;
$$;

-- Optional helper: ensure a retail store location + optional pos_locations link
create or replace function public.ensure_store_inventory_location(
  p_workspace_id uuid,
  p_code text,
  p_name text default null,
  p_address jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text := upper(trim(p_code));
  v_name text := coalesce(nullif(trim(p_name), ''), v_code);
begin
  if p_workspace_id is null or v_code = '' then
    raise exception 'workspace_id and code are required';
  end if;

  insert into public.inventory_locations
    (workspace_id, name, code, location_type, is_default, address, notes)
  values
    (p_workspace_id, v_name, v_code, 'store', false, coalesce(p_address, '{}'::jsonb),
     'Retail store location for POS and replenishment destination.')
  on conflict (workspace_id, code) do update
    set name = excluded.name,
        location_type = 'store',
        address = case
          when excluded.address = '{}'::jsonb then public.inventory_locations.address
          else excluded.address
        end,
        updated_at = now()
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.inventory_locations
    where workspace_id = p_workspace_id and code = v_code;
  end if;

  return v_id;
end;
$$;

grant execute on function public.ensure_store_inventory_location(uuid, text, text, jsonb)
  to authenticated, service_role;

comment on function public.ensure_store_inventory_location is
  'Idempotently create/update a store-type inventory_locations row for multi-store retail.';
