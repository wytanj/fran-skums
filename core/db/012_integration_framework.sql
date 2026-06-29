-- ============================================================
-- SKUMS — n8n-Inspired Integration Framework
-- Adopts node/credential/trigger/action/execution patterns
-- Run AFTER schema.sql and fix-rls-recursion.sql
-- ============================================================

-- ============================================================
-- 1. INTEGRATION NODE DEFINITIONS
--    The registry of all available integration types.
--    Global rows (workspace_id IS NULL) are platform-provided.
--    Workspace rows are custom connectors built by users.
-- ============================================================
create table if not exists public.integration_node_definitions (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid references public.workspaces(id) on delete cascade,

  -- Identity
  name            text not null,
  slug            text not null,
  description     text,
  icon            text,
  color           text,
  category        text not null default 'other'
                    check (category in (
                      'ecommerce', 'marketplace', 'automation',
                      'productivity', 'communication', 'database',
                      'analytics', 'shipping', 'payment', 'other'
                    )),

  -- Node capabilities (n8n-style)
  node_type       text not null default 'action'
                    check (node_type in ('trigger', 'action', 'both')),

  -- Version & status
  version         int not null default 1,
  is_available    boolean not null default true,
  is_coming_soon  boolean not null default false,

  -- The actions this node supports (declarative definition)
  -- e.g. [{"key":"push_product","label":"Push Product","description":"...","fields":[...]}, ...]
  actions         jsonb not null default '[]',

  -- The triggers this node can fire
  -- e.g. [{"key":"product_updated","label":"On Product Update","description":"..."}, ...]
  triggers        jsonb not null default '[]',

  -- Credential schema: what auth fields this node requires
  -- JSON Schema defining the credential form
  -- e.g. {"properties":{"api_key":{"type":"string","label":"API Key","secret":true},...}}
  credential_schema jsonb not null default '{}',

  -- Field mapping schema: how SKUMS fields map to the external system
  -- e.g. {"product_title":"title","sku":"sku","price":"variants[0].price"}
  default_field_mapping jsonb not null default '{}',

  -- Webhook config for trigger nodes
  supports_webhooks boolean not null default false,
  webhook_path      text,

  -- Rate limiting
  rate_limit_rpm    int,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (workspace_id, slug)
);

create index if not exists idx_node_defs_workspace on public.integration_node_definitions(workspace_id);
create index if not exists idx_node_defs_category on public.integration_node_definitions(category);

alter table public.integration_node_definitions enable row level security;

create policy "Anyone can view global node definitions"
  on public.integration_node_definitions for select
  using (workspace_id is null);

create policy "Members can view workspace node definitions"
  on public.integration_node_definitions for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage workspace node definitions"
  on public.integration_node_definitions for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));


-- ============================================================
-- 2. CREDENTIALS
--    Encrypted credential storage per workspace.
--    Follows n8n's pattern: credentials are separate from
--    connections, so one credential can be shared across
--    multiple connections/workflows.
-- ============================================================
create table if not exists public.integration_credentials (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  node_def_id     uuid not null references public.integration_node_definitions(id) on delete cascade,

  name            text not null,
  -- Encrypted at application layer before storage
  credential_data jsonb not null default '{}',

  -- Validation state
  is_valid        boolean,
  last_tested_at  timestamptz,
  test_error      text,

  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_credentials_workspace on public.integration_credentials(workspace_id);
create index if not exists idx_credentials_node_def on public.integration_credentials(node_def_id);

alter table public.integration_credentials enable row level security;

create policy "Members can view credentials"
  on public.integration_credentials for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage credentials"
  on public.integration_credentials for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));


-- ============================================================
-- 3. CONNECTIONS  (an instance of a node + credential)
--    Like n8n "nodes on the canvas" — a configured, activated
--    integration instance within a workspace.
-- ============================================================
create table if not exists public.integration_connections (
  id              uuid primary key default uuid_generate_v4(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  node_def_id     uuid not null references public.integration_node_definitions(id) on delete cascade,
  credential_id   uuid references public.integration_credentials(id) on delete set null,

  name            text not null,
  status          text not null default 'inactive'
                    check (status in ('active', 'inactive', 'error', 'paused')),

  -- Connection-specific configuration
  config          jsonb not null default '{}',

  -- Field mapping overrides (merges with node definition defaults)
  field_mapping   jsonb not null default '{}',

  -- Sync settings
  sync_direction  text not null default 'push'
                    check (sync_direction in ('push', 'pull', 'bidirectional')),
  sync_frequency  text not null default 'manual'
                    check (sync_frequency in ('manual', 'realtime', '5min', '15min', 'hourly', 'daily', 'weekly')),

  -- Stats
  last_synced_at  timestamptz,
  last_error      text,
  total_synced    int not null default 0,
  total_errors    int not null default 0,

  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_connections_workspace on public.integration_connections(workspace_id);
create index if not exists idx_connections_node_def on public.integration_connections(node_def_id);
create index if not exists idx_connections_status on public.integration_connections(status);

alter table public.integration_connections enable row level security;

create policy "Members can view connections"
  on public.integration_connections for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage connections"
  on public.integration_connections for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));


-- ============================================================
-- 4. WEBHOOKS
--    Registered webhook endpoints for trigger-type nodes.
--    Each webhook has a unique path that external services
--    can POST to.
-- ============================================================
create table if not exists public.integration_webhooks (
  id              uuid primary key default uuid_generate_v4(),
  connection_id   uuid not null references public.integration_connections(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  -- Unique webhook path (used in URL: /api/webhooks/{path})
  path            text not null unique,
  secret          text,

  trigger_key     text not null,
  is_active       boolean not null default true,

  last_received_at timestamptz,
  total_received   int not null default 0,

  created_at      timestamptz not null default now()
);

create index if not exists idx_webhooks_connection on public.integration_webhooks(connection_id);
create index if not exists idx_webhooks_path on public.integration_webhooks(path);

alter table public.integration_webhooks enable row level security;

create policy "Members can view webhooks"
  on public.integration_webhooks for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Admins can manage webhooks"
  on public.integration_webhooks for all
  using (workspace_id in (select public.get_my_admin_workspace_ids()))
  with check (workspace_id in (select public.get_my_admin_workspace_ids()));


-- ============================================================
-- 5. EXECUTION LOG
--    Every action or trigger execution is logged here.
--    Follows n8n's execution model: each run has input data,
--    output data, status, timing, and error info.
-- ============================================================
create table if not exists public.integration_executions (
  id              uuid primary key default uuid_generate_v4(),
  connection_id   uuid not null references public.integration_connections(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,

  -- What was executed
  execution_type  text not null check (execution_type in ('action', 'trigger', 'test', 'webhook')),
  action_key      text,
  trigger_key     text,

  -- Status tracking
  status          text not null default 'running'
                    check (status in ('running', 'success', 'error', 'cancelled', 'timeout')),

  -- Data flow (n8n-style input/output)
  input_data      jsonb default '{}',
  output_data     jsonb default '{}',
  error_message   text,
  error_stack     text,

  -- Metrics
  items_processed int not null default 0,
  items_created   int not null default 0,
  items_updated   int not null default 0,
  items_failed    int not null default 0,

  -- Timing
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     int,

  triggered_by    uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_executions_connection on public.integration_executions(connection_id, created_at desc);
create index if not exists idx_executions_workspace on public.integration_executions(workspace_id, created_at desc);
create index if not exists idx_executions_status on public.integration_executions(status);

alter table public.integration_executions enable row level security;

create policy "Members can view executions"
  on public.integration_executions for select
  using (workspace_id in (select public.get_my_workspace_ids()));

create policy "Members can insert executions"
  on public.integration_executions for insert
  with check (workspace_id in (select public.get_my_writable_workspace_ids()));

create policy "Members can update executions"
  on public.integration_executions for update
  using (workspace_id in (select public.get_my_writable_workspace_ids()));


-- ============================================================
-- 6. PRODUCT SYNC MAPPINGS  (enhanced from original)
--    Maps SKUMS products to external system entities per
--    connection (not just per integration).
-- ============================================================
create table if not exists public.integration_sync_mappings (
  id              uuid primary key default uuid_generate_v4(),
  connection_id   uuid not null references public.integration_connections(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,

  external_id     text not null,
  external_url    text,
  external_data   jsonb default '{}',

  sync_status     text not null default 'synced'
                    check (sync_status in ('synced', 'pending_push', 'pending_pull', 'conflict', 'error')),
  last_pushed_at  timestamptz,
  last_pulled_at  timestamptz,
  last_error      text,

  -- Hash of last synced data for conflict detection
  local_hash      text,
  remote_hash     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (connection_id, external_id),
  unique (connection_id, product_id)
);

create index if not exists idx_sync_mappings_connection on public.integration_sync_mappings(connection_id);
create index if not exists idx_sync_mappings_product on public.integration_sync_mappings(product_id);
create index if not exists idx_sync_mappings_status on public.integration_sync_mappings(sync_status);

alter table public.integration_sync_mappings enable row level security;

create policy "Sync mappings follow connection access"
  on public.integration_sync_mappings for select
  using (
    connection_id in (
      select id from public.integration_connections
      where workspace_id in (select public.get_my_workspace_ids())
    )
  );

create policy "Sync mappings follow connection management"
  on public.integration_sync_mappings for all
  using (
    connection_id in (
      select id from public.integration_connections
      where workspace_id in (select public.get_my_admin_workspace_ids())
    )
  )
  with check (
    connection_id in (
      select id from public.integration_connections
      where workspace_id in (select public.get_my_admin_workspace_ids())
    )
  );


-- ============================================================
-- 7. SEED: Global node definitions
--    Platform-provided integration blueprints
-- ============================================================
insert into public.integration_node_definitions
  (workspace_id, name, slug, description, icon, color, category, node_type, is_available, is_coming_soon, actions, triggers, credential_schema, supports_webhooks)
values
  -- ── E-Commerce ──
  (null, 'Shopify', 'shopify', 'Sync products, inventory, and orders with Shopify', 'shopify', 'bg-green-600/10 text-green-400 ring-green-500/20', 'ecommerce', 'both', true, false,
    '[
      {"key":"push_product","label":"Push Product","description":"Create or update a product in Shopify"},
      {"key":"pull_product","label":"Pull Product","description":"Import a product from Shopify"},
      {"key":"sync_inventory","label":"Sync Inventory","description":"Synchronize stock levels"},
      {"key":"pull_orders","label":"Pull Orders","description":"Import orders from Shopify"}
    ]'::jsonb,
    '[
      {"key":"product_created","label":"Product Created","description":"Fires when a new product is created in Shopify"},
      {"key":"product_updated","label":"Product Updated","description":"Fires when a product is updated in Shopify"},
      {"key":"order_created","label":"Order Created","description":"Fires when a new order is placed"},
      {"key":"inventory_updated","label":"Inventory Updated","description":"Fires when stock levels change"}
    ]'::jsonb,
    '{"properties":{"shop_domain":{"type":"string","label":"Shop Domain","description":"yourstore.myshopify.com","required":true},"api_key":{"type":"string","label":"API Key","required":true},"api_secret":{"type":"string","label":"API Secret","secret":true,"required":true},"access_token":{"type":"string","label":"Access Token","secret":true,"required":true}}}'::jsonb,
    true
  ),

  (null, 'WooCommerce', 'woocommerce', 'Connect your WooCommerce store for product and order sync', 'woocommerce', 'bg-purple-600/10 text-purple-400 ring-purple-500/20', 'ecommerce', 'both', true, false,
    '[
      {"key":"push_product","label":"Push Product","description":"Create or update a product in WooCommerce"},
      {"key":"pull_product","label":"Pull Product","description":"Import a product from WooCommerce"},
      {"key":"sync_inventory","label":"Sync Inventory","description":"Synchronize stock levels"}
    ]'::jsonb,
    '[
      {"key":"product_created","label":"Product Created","description":"Fires when a product is created"},
      {"key":"product_updated","label":"Product Updated","description":"Fires when a product is updated"},
      {"key":"order_created","label":"Order Created","description":"Fires when a new order is placed"}
    ]'::jsonb,
    '{"properties":{"site_url":{"type":"string","label":"Site URL","description":"https://yourstore.com","required":true},"consumer_key":{"type":"string","label":"Consumer Key","required":true},"consumer_secret":{"type":"string","label":"Consumer Secret","secret":true,"required":true}}}'::jsonb,
    true
  ),

  -- ── Marketplaces ──
  (null, 'Amazon', 'amazon', 'Sync with Amazon Seller Central', 'amazon', 'bg-orange-600/10 text-orange-400 ring-orange-500/20', 'marketplace', 'both', false, true,
    '[
      {"key":"push_listing","label":"Push Listing","description":"Create or update an Amazon listing"},
      {"key":"pull_listing","label":"Pull Listing","description":"Import a listing from Amazon"},
      {"key":"sync_inventory","label":"Sync Inventory","description":"Synchronize FBA/FBM stock levels"}
    ]'::jsonb,
    '[
      {"key":"order_created","label":"Order Created","description":"Fires when a new order is placed"},
      {"key":"listing_updated","label":"Listing Updated","description":"Fires when a listing changes"}
    ]'::jsonb,
    '{"properties":{"seller_id":{"type":"string","label":"Seller ID","required":true},"marketplace_id":{"type":"string","label":"Marketplace ID","required":true},"refresh_token":{"type":"string","label":"Refresh Token","secret":true,"required":true}}}'::jsonb,
    false
  ),

  (null, 'eBay', 'ebay', 'Connect your eBay store for listing management', 'ebay', 'bg-blue-600/10 text-blue-400 ring-blue-500/20', 'marketplace', 'both', false, true,
    '[
      {"key":"push_listing","label":"Push Listing","description":"Create or update an eBay listing"},
      {"key":"pull_listing","label":"Pull Listing","description":"Import a listing from eBay"}
    ]'::jsonb,
    '[
      {"key":"item_sold","label":"Item Sold","description":"Fires when an item is sold on eBay"}
    ]'::jsonb,
    '{"properties":{"app_id":{"type":"string","label":"App ID","required":true},"cert_id":{"type":"string","label":"Cert ID","secret":true,"required":true},"auth_token":{"type":"string","label":"Auth Token","secret":true,"required":true}}}'::jsonb,
    false
  ),

  -- ── Automation ──
  (null, 'Zapier', 'zapier', 'Automate workflows with 5,000+ apps via Zapier', 'zapier', 'bg-orange-600/10 text-orange-400 ring-orange-500/20', 'automation', 'both', false, true,
    '[
      {"key":"send_data","label":"Send Data","description":"Push product data to a Zapier webhook"}
    ]'::jsonb,
    '[
      {"key":"webhook_received","label":"Webhook Received","description":"Fires when Zapier sends data to SKUMS"}
    ]'::jsonb,
    '{"properties":{"webhook_url":{"type":"string","label":"Zapier Webhook URL","description":"Your Zap webhook endpoint","required":true}}}'::jsonb,
    true
  ),

  (null, 'n8n', 'n8n', 'Self-hosted workflow automation with n8n', 'n8n', 'bg-red-600/10 text-red-400 ring-red-500/20', 'automation', 'both', false, true,
    '[
      {"key":"send_data","label":"Send Data","description":"Push product data to an n8n webhook"},
      {"key":"trigger_workflow","label":"Trigger Workflow","description":"Trigger an n8n workflow by ID"}
    ]'::jsonb,
    '[
      {"key":"webhook_received","label":"Webhook Received","description":"Fires when n8n sends data to SKUMS"}
    ]'::jsonb,
    '{"properties":{"instance_url":{"type":"string","label":"n8n Instance URL","description":"https://your-n8n.example.com","required":true},"api_key":{"type":"string","label":"API Key","secret":true,"required":true},"webhook_url":{"type":"string","label":"Webhook URL","description":"n8n webhook endpoint"}}}'::jsonb,
    true
  ),

  -- ── Productivity ──
  (null, 'Google Sheets', 'google-sheets', 'Sync product data to and from Google Sheets', 'google-sheets', 'bg-green-600/10 text-green-400 ring-green-500/20', 'productivity', 'both', false, true,
    '[
      {"key":"push_to_sheet","label":"Push to Sheet","description":"Export products to a Google Sheet"},
      {"key":"pull_from_sheet","label":"Pull from Sheet","description":"Import products from a Google Sheet"},
      {"key":"append_row","label":"Append Row","description":"Add a product as a new row"}
    ]'::jsonb,
    '[
      {"key":"row_added","label":"Row Added","description":"Fires when a new row is added to the sheet"},
      {"key":"row_updated","label":"Row Updated","description":"Fires when a row is updated"}
    ]'::jsonb,
    '{"properties":{"service_account_json":{"type":"string","label":"Service Account JSON","secret":true,"required":true,"multiline":true},"spreadsheet_id":{"type":"string","label":"Spreadsheet ID","required":true},"sheet_name":{"type":"string","label":"Sheet Name","default":"Sheet1"}}}'::jsonb,
    false
  ),

  (null, 'Notion', 'notion', 'Sync product catalogs with Notion databases', 'notion', 'bg-gray-600/10 text-gray-300 ring-gray-500/20', 'productivity', 'both', false, true,
    '[
      {"key":"push_to_database","label":"Push to Database","description":"Create or update pages in a Notion database"},
      {"key":"pull_from_database","label":"Pull from Database","description":"Import pages from a Notion database"}
    ]'::jsonb,
    '[
      {"key":"page_created","label":"Page Created","description":"Fires when a page is added to the database"},
      {"key":"page_updated","label":"Page Updated","description":"Fires when a page is modified"}
    ]'::jsonb,
    '{"properties":{"api_key":{"type":"string","label":"Integration Token","secret":true,"required":true},"database_id":{"type":"string","label":"Database ID","required":true}}}'::jsonb,
    false
  ),

  (null, 'Airtable', 'airtable', 'Two-way sync with Airtable bases', 'airtable', 'bg-yellow-600/10 text-yellow-400 ring-yellow-500/20', 'productivity', 'both', false, true,
    '[
      {"key":"push_records","label":"Push Records","description":"Create or update records in Airtable"},
      {"key":"pull_records","label":"Pull Records","description":"Import records from Airtable"},
      {"key":"upsert_records","label":"Upsert Records","description":"Create or update records matching a key field"}
    ]'::jsonb,
    '[
      {"key":"record_created","label":"Record Created","description":"Fires when a new record is added"},
      {"key":"record_updated","label":"Record Updated","description":"Fires when a record is modified"}
    ]'::jsonb,
    '{"properties":{"api_key":{"type":"string","label":"Personal Access Token","secret":true,"required":true},"base_id":{"type":"string","label":"Base ID","required":true},"table_name":{"type":"string","label":"Table Name","required":true}}}'::jsonb,
    false
  ),

  -- ── Communication ──
  (null, 'Slack', 'slack', 'Get notifications for product changes, low stock alerts, and sync status', 'slack', 'bg-purple-600/10 text-purple-400 ring-purple-500/20', 'communication', 'action', false, true,
    '[
      {"key":"send_message","label":"Send Message","description":"Send a message to a Slack channel"},
      {"key":"send_alert","label":"Send Alert","description":"Send a formatted alert notification"},
      {"key":"send_product_card","label":"Send Product Card","description":"Send a rich product card to a channel"}
    ]'::jsonb,
    '[]'::jsonb,
    '{"properties":{"webhook_url":{"type":"string","label":"Webhook URL","description":"Slack incoming webhook URL","secret":true,"required":true},"channel":{"type":"string","label":"Default Channel","description":"e.g. #product-updates"}}}'::jsonb,
    false
  ),

  -- ── Custom ──
  (null, 'Custom API', 'custom-api', 'Build your own integration via REST API', 'api', 'bg-gray-600/10 text-gray-400 ring-gray-500/20', 'other', 'both', true, false,
    '[
      {"key":"http_request","label":"HTTP Request","description":"Make a custom HTTP request with product data"},
      {"key":"webhook_push","label":"Webhook Push","description":"Push data to a custom webhook endpoint"}
    ]'::jsonb,
    '[
      {"key":"webhook_received","label":"Webhook Received","description":"Fires when data is received at your SKUMS webhook"}
    ]'::jsonb,
    '{"properties":{"base_url":{"type":"string","label":"Base URL","description":"https://api.example.com","required":true},"auth_type":{"type":"string","label":"Auth Type","enum":["none","api_key","bearer","basic"],"default":"none"},"api_key":{"type":"string","label":"API Key / Token","secret":true},"username":{"type":"string","label":"Username"},"password":{"type":"string","label":"Password","secret":true},"headers":{"type":"string","label":"Custom Headers (JSON)","multiline":true}}}'::jsonb,
    true
  ),

  (null, 'Inventory Management', 'custom-ims', 'Connect a custom inventory management system', 'ims', 'bg-cyan-600/10 text-cyan-400 ring-cyan-500/20', 'other', 'both', true, false,
    '[
      {"key":"push_stock","label":"Push Stock Levels","description":"Send stock quantities to your IMS"},
      {"key":"pull_stock","label":"Pull Stock Levels","description":"Import stock quantities from your IMS"},
      {"key":"sync_products","label":"Sync Products","description":"Full product data sync"}
    ]'::jsonb,
    '[
      {"key":"stock_changed","label":"Stock Changed","description":"Fires when stock levels change in the IMS"},
      {"key":"product_updated","label":"Product Updated","description":"Fires when a product is updated in the IMS"}
    ]'::jsonb,
    '{"properties":{"api_url":{"type":"string","label":"API URL","required":true},"api_key":{"type":"string","label":"API Key","secret":true,"required":true},"warehouse_id":{"type":"string","label":"Warehouse ID"}}}'::jsonb,
    true
  )
on conflict (workspace_id, slug) do nothing;


-- ============================================================
-- 8. updated_at triggers for new tables
-- ============================================================
create trigger set_updated_at before update on public.integration_node_definitions
  for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.integration_credentials
  for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.integration_connections
  for each row execute function public.update_updated_at();

create trigger set_updated_at before update on public.integration_sync_mappings
  for each row execute function public.update_updated_at();
