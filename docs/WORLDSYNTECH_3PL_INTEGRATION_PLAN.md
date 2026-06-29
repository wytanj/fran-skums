# WorldSyntech OFS 3PL Integration Plan

Source API: https://orderfulfillmentdemo3.worldsyntech.com/apidoc/#api-Authorization-GetToken

Read date: 2026-06-24

## Decision

Build this as a 3PL fulfillment integration app, not as a marketplace channel.

The API exposes product setup, inventory, outbound order fulfillment, delivery
methods, addresses, and inbound "ship to warehouse" flows. That makes the
software a warehouse/fulfillment system of record for one logistics partner.
SKUMS should use it as a fulfillment connector that can sit behind many sales
channels, POS surfaces, and marketplace listings.

For LISE's first use case, this is more specific: LISE is a beauty retailer
inbounding goods from Korea and Hong Kong into Loft Logistics, and Loft
Logistics is the 3PL using OFS. LISE does not currently need ecommerce
fulfillment. The initial integration mode should therefore be retail warehouse
replenishment:

```text
Korea/Hong Kong suppliers -> Loft Logistics warehouse -> LISE physical stores
```

In this mode, OFS is used as Loft's warehouse execution system. SKUMS should
coordinate inbound shipment notices, warehouse stock visibility, and store
replenishment requests. Ecommerce order fulfillment should stay as a later
optional mode.

Proposed connector id:

```text
worldsyntech_ofs
```

Proposed integration category:

```text
shipping
```

Proposed product label:

```text
WorldSyntech OFS / 3PL Fulfillment
```

## API Shape

The OFS API is an apidoc-generated REST surface with 30 documented endpoints.
Every documented endpoint is a POST under:

```text
{base_url}/index.php?route=rest_customer/...
```

Authentication is two-step:

1. `Authorization: Basic <token>` plus JSON body `user_name` and `password`.
2. `POST index.php?route=rest_customer/customer_security/api_login&grant_type=client_credentials`
3. Response returns `access_token`, `expires_in`, `token_type`, and customer metadata.
4. Subsequent calls use `Authorization: Bearer <access_token>` and `Content-Type: application/json`.

The response envelope is always business-level:

```json
{
  "success": 1,
  "error": [],
  "data": {}
}
```

Do not trust HTTP 200 alone. Treat `success !== 1` as a failed execution.

## Endpoint Groups

### Authorization

- `Get Token`: `customer_security/api_login&grant_type=client_credentials`
- Inputs: `user_name`, `password`
- Header: provider-issued Basic token
- Output: bearer access token and customer account data

### Product

- `product/create`
- `product/update`
- `product/get_list`
- `product/get`
- `product/get_by_main_product_id`
- `product/create_update_kitting`
- `product/get_by_product_kitting_id`

Core product fields:

- product title and description
- SKU, UPC, supplier SKU, variation
- virtual stock and reserved stock
- price and cost
- length, width, height, weight
- image and gallery image URLs
- kitting/bundle components

### Inventory

- `inventory/get_list`
- `inventory/get`

Inventory details include:

- `available_quantity`
- `ordered_quantity`
- `process_quantity`
- `picked_quantity`
- `stockout_quantity`
- `delivered_quantity`
- `damaged_quantity`
- `stock_alert_quantity`

This should be read from OFS into SKUMS. Do not push SKUMS stock into OFS until
the 3PL confirms ownership rules.

### Order

- `order/create`
- `order/update_order`
- `order/update_order_item`
- `order/get_list`
- `order/get`
- `order/cancel`

Create order accepts:

- `reference_no`
- optional marketplace fields such as `atomic_order_id` and `marketplace_code`
- shipping address
- payment address
- order products by `product_id` and/or `sku`
- `delivery_method_id`
- order comment
- COD total
- tracking number
- airwaybill URL

Order reads return:

- OFS `order_id`
- `reference_no`
- marketplace detail
- shipping/COD/service fee fields
- `order_status`
- order product statuses

For LISE, these order endpoints should be treated as store replenishment or
warehouse outbound requests, not consumer ecommerce orders. `reference_no`
should be a LISE replenishment/transfer reference. Marketplace fields,
customer-facing COD behavior, and ecommerce marketplace identifiers should be
blank, defaulted, or disabled unless Loft confirms they are required by OFS.

### Ship To Warehouse

- `ship_to_warehouse/create`
- `ship_to_warehouse/get_list`
- `ship_to_warehouse/get`
- `ship_to_warehouse/cancel`

This is the inbound ASN or stock-receipt flow. It accepts shipment lines with:

- product id or SKU
- quantity
- product name, price, dimension, weight, description
- tracking number
- estimated arrival date

Details return:

- `stock_incoming_id`
- product id and SKU
- requested quantity
- pending quantity balance
- received/additional/spoil quantities
- status id
- estimated, arrived, and received dates

### Address And Delivery Reference Data

- address list
- country list and detail
- zone list/detail/by country
- delivery method list/detail/by country

Cache these per connection. They are required for validating addresses and
selecting `delivery_method_id`.

## Frequent API Areas For LISE

### Daily Hot Paths

1. `Inventory`

Use `inventory/get_list` and `inventory/get` to monitor stock that Loft has
available for LISE. This is the main visibility loop for store replenishment.

2. `Order`

Use `order/create`, `order/get_list`, and `order/get` if Loft uses OFS orders
for warehouse outbound movement to LISE stores. Each store replenishment should
be modeled as an internal retail replenishment order.

3. `Ship To Warehouse`

Use `ship_to_warehouse/create`, `ship_to_warehouse/get_list`, and
`ship_to_warehouse/get` for inbound goods moving from Korea/Hong Kong suppliers
into Loft. This is frequent around purchasing, import arrivals, and receiving
reconciliation.

### Setup And Change Paths

4. `Product`

Use product endpoints heavily during onboarding, new SKU launches, assortment
changes, and bundle/gift-set setup. Once the catalog is stable, product calls
are less frequent than inventory and replenishment calls.

5. `Address` and `Delivery Method`

Use these to cache Loft-supported destination references, LISE store addresses,
country/zone IDs, and delivery methods. They are not daily high-volume calls
unless stores or route options change.

6. `Authorization`

Use token exchange whenever the OFS bearer token is missing or expired. This is
operationally required but not a business workflow.

## Product Architecture

### Integration Node

Seed a global integration definition in `integration_node_definitions`:

```json
{
  "name": "WorldSyntech OFS",
  "slug": "worldsyntech-ofs",
  "category": "shipping",
  "node_type": "both",
  "actions": [
    {"key": "test_credentials", "label": "Test Credentials"},
    {"key": "pull_products", "label": "Pull OFS Products"},
    {"key": "push_products", "label": "Create or Update OFS Products"},
    {"key": "pull_inventory", "label": "Pull Inventory"},
    {"key": "create_fulfillment_order", "label": "Create Fulfillment Order"},
    {"key": "update_fulfillment_order", "label": "Update Fulfillment Order"},
    {"key": "cancel_fulfillment_order", "label": "Cancel Fulfillment Order"},
    {"key": "poll_fulfillment_orders", "label": "Poll Fulfillment Orders"},
    {"key": "create_inbound_shipment", "label": "Create Ship To Warehouse"},
    {"key": "poll_inbound_shipments", "label": "Poll Ship To Warehouse"}
  ],
  "triggers": [
    {"key": "inventory_changed", "label": "Inventory Changed"},
    {"key": "fulfillment_status_changed", "label": "Fulfillment Status Changed"},
    {"key": "inbound_receipt_changed", "label": "Inbound Receipt Changed"}
  ]
}
```

Credential schema:

```json
{
  "properties": {
    "base_url": {"type": "string", "required": true},
    "basic_token": {"type": "string", "secret": true, "required": true},
    "user_name": {"type": "string", "required": true},
    "password": {"type": "string", "secret": true, "required": true},
    "language_id": {"type": "number", "default": 1},
    "default_country_id": {"type": "number"},
    "default_zone_id": {"type": "number"},
    "default_delivery_method_id": {"type": "number"}
  }
}
```

Store the bearer token and expiry as derived credential metadata, not as a user
editable secret.

### Adapter Boundary

Do not force this into the current `ChannelAdapter` write contract. The existing
contract is product/listing oriented and has no first-class `create_order` or
`create_inbound_shipment` operation.

Add a fulfillment adapter contract beside the channel contract:

```ts
export interface FulfillmentAdapter {
  id: string
  name: string
  auth: FulfillmentAuth
  products: FulfillmentProductOps
  inventory: FulfillmentInventoryOps
  orders: FulfillmentOrderOps
  inboundShipments: FulfillmentInboundShipmentOps
}
```

Then implement WorldSyntech/OFS against that interface. Channel adapters can
route orders into a fulfillment adapter through SKUMS fulfillment policies.

### Suggested Files

```text
integrations/worldsyntech-ofs/
  README.md
  client.ts
  mapping.ts
  adapter.ts
  types.ts
  fixtures/
    token-success.json
    product-list-success.json
    inventory-list-success.json
    order-create-success.json
    order-get-success.json
    ship-to-warehouse-create-success.json

server/api/integrations/worldsyntech-ofs/
  test.post.ts
  sync-reference-data.post.ts
  pull-products.post.ts
  push-products.post.ts
  pull-inventory.post.ts
  create-order.post.ts
  poll-orders.post.ts
  create-inbound-shipment.post.ts
  poll-inbound-shipments.post.ts
```

If the repo standardizes all official integrations under `channels/`, this can
move later. The important boundary is the fulfillment adapter interface, not the
folder name.

## Data Model

Reuse existing tables:

- `integration_credentials` for encrypted OFS account data
- `integration_connections` for active workspace-level OFS connection config
- `integration_executions` for every manual or scheduled action run
- `integration_sync_mappings` for SKUMS product to OFS product mappings
- `domain_events` for material fulfillment/inventory facts
- `product_attention_items` for exceptions and reconciliation work
- `fulfillment_policies` for routing channel/POS orders to this 3PL

Add one generic external mapping table instead of adding OFS-specific columns:

```sql
create table public.integration_entity_mappings (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'product',
    'order',
    'order_line',
    'inbound_shipment',
    'delivery_method',
    'address',
    'country',
    'zone'
  )),
  local_entity_type text,
  local_entity_id uuid,
  external_id text not null,
  external_secondary_id text,
  external_data jsonb not null default '{}',
  remote_hash text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, entity_type, external_id)
);
```

This avoids making `integration_sync_mappings` carry orders, shipments, delivery
methods, and reference data when it is currently product/listing shaped.

Add a fulfillment request table only if SKUMS needs first-class lifecycle UI:

```sql
create table public.fulfillment_requests (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  source_type text not null,
  source_id uuid,
  reference_no text not null,
  external_order_id text,
  status text not null default 'pending',
  requested_payload jsonb not null,
  latest_remote_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, reference_no)
);
```

For a first MVP, `integration_entity_mappings`, `integration_executions`, and
`domain_events` are enough. Add `fulfillment_requests` when the UI needs a
dedicated queue.

## Core Flows

### 1. Connect 3PL Account

1. User enters base URL, Basic token, username, password, default locale, and optional defaults.
2. Server calls Get Token.
3. Save credential if token exchange succeeds.
4. Pull user details and reference data.
5. Create `integration_connection` with status `active`.
6. Emit `worldsyntech_ofs.connected`.

### 2. Product Handshake

1. Pull OFS `product/get_list` with `language_id`, `offset`, `limit`, and `status`.
2. Match by existing mapping, SKU, UPC, then supplier SKU.
3. Create or update SKUMS product identity only if the workspace chooses OFS as a trusted product source.
4. Create product mappings:
   - external `product_id`
   - external `main_product_id`
   - external `product_kitting_id`
5. Create attention items for duplicate SKUs, missing dimensions, missing SKU, or kitting conflicts.

Default policy:

```text
OFS is trusted for fulfillment identifiers and stock, not for canonical product content.
```

### 3. Push Products To OFS

Use `product/create` or `product/update` only after SKUMS has:

- SKU
- product title
- price and cost policy
- length, width, height, weight
- image URL policy
- bundle/kitting rules

Do a dry-run validator first. OFS examples show required fields that are often
optional in product data systems, especially cost, dimensions, image, and
reserved/virtual stock.

### 4. Create Store Replenishment / Fulfillment Order

Trigger sources:

- POS sale that should be shipped
- store replenishment request from LISE operations
- low-stock reorder proposal approved by an operator
- purchase or allocation workflow that needs Loft to move goods to a store
- marketplace order imported through a channel adapter, later when LISE adds ecommerce
- custom API request to SKUMS
- agent-approved fulfillment action

For LISE's current operating model, the primary trigger is store replenishment.
The OFS `order/create` payload is still the likely API mechanism, but SKUMS
should name the local workflow `store_replenishment` or `warehouse_outbound`
instead of `ecommerce_fulfillment`.

Steps:

1. Resolve fulfillment policy for source order.
2. Resolve SKUMS products to OFS `product_id` or SKU mappings.
3. Validate address against cached country/zone records.
4. Resolve delivery method.
5. Build OFS `orders[]` payload.
6. Use `reference_no` as the idempotency key.
7. Call `order/create`.
8. Store returned OFS `order_id` in `integration_entity_mappings`.
9. Emit `fulfillment.order.created`.
10. Create attention item if any product cannot be mapped or OFS returns `success: 0`.

### 5. Poll Fulfillment Orders

No webhooks are documented, so the first production implementation should poll.

Recommended schedule:

- every 15 minutes for open orders
- hourly for completed orders during a short reconciliation window
- manual sync action from the integration page

Poll strategy:

1. Use `order/get_list` with offset and limit to discover changed orders.
2. Use `order/get` for mapped open orders when detail is required.
3. Normalize status into SKUMS:
   - pending
   - processing
   - picked
   - shipped
   - delivered
   - cancelled
   - stockout
   - exception
4. Emit `fulfillment.order.status_changed` when status changes.
5. Create attention items for stockout, damaged goods, rejected orders, or unknown statuses.

### 6. Pull Inventory

Use `inventory/get_list` for scheduled sync and `inventory/get` for direct SKU
reconciliation.

Map inventory facts into SKUMS as external stock signals:

- available stock
- ordered/reserved stock
- process/picked stock
- stockout quantity
- damaged quantity
- delivered quantity
- stock alert threshold

Do not overwrite canonical SKUMS stock blindly. Store OFS inventory as
connection-scoped warehouse availability and let inventory policy decide how it
affects sellable stock per channel.

### 7. Ship To Warehouse

Use this for inbound replenishment to the 3PL:

1. User or upstream procurement flow creates inbound shipment in SKUMS.
2. Resolve each line to OFS product id or SKU.
3. Call `ship_to_warehouse/create`.
4. Store returned `stock_incoming_main_id` and `stock_incoming_id`.
5. Poll `ship_to_warehouse/get_list` and `get`.
6. Emit inbound receipt events as quantities move from pending to received,
   partially received, spoiled, or cancelled.
7. Create attention items for partial receipt, spoil quantity, missing product
   mapping, or late arrival.

## Validation Rules

Before calling OFS:

- require SKU for every product/order line
- require product dimensions and weight before product push or inbound shipment
- require country and zone ids for order addresses
- require delivery method id unless the 3PL confirms automatic selection
- require order reference number to be globally unique per connection
- require product mapping before creating orders, unless OFS accepts SKU-only orders in production
- validate COD amount and currency ownership
- validate airwaybill URLs are HTTPS and user-approved or system-generated

## Error Handling

OFS examples indicate business failures can return HTTP 200 with:

```json
{
  "success": 0,
  "error": "Bad Request",
  "data": []
}
```

The client should normalize errors into:

- `auth_failed`
- `token_expired`
- `bad_request`
- `not_found`
- `duplicate_reference`
- `product_mapping_missing`
- `delivery_method_missing`
- `address_reference_missing`
- `remote_validation_failed`
- `remote_unavailable`
- `unknown_remote_status`

Every failed action should create an `integration_executions` row. High-risk
failures should also create a `product_attention_items` row.

## Sync And Idempotency

The API does not document idempotency headers. SKUMS must enforce idempotency
locally:

- credential test: no idempotency needed
- product push: idempotent by local product id plus external mapping
- order create: idempotent by `connection_id + reference_no`
- order cancel: idempotent by `connection_id + external_order_id + cancel_reason_hash`
- inbound shipment create: idempotent by `connection_id + inbound_shipment_reference`
- polling: idempotent by remote hash and latest seen remote status

Use bounded paging. The docs use `limit: 250` examples for product, inventory,
country, zone, and delivery method list endpoints.

## UI Plan

Add a WorldSyntech/OFS card on the Integrations page:

- connection status
- last token test
- last product sync
- last inventory sync
- last order poll
- last inbound shipment poll
- open exceptions count

Connection setup fields:

- base URL
- Basic token
- username
- password
- language id
- default country
- default zone
- default delivery method

Actions:

- Test credentials
- Sync reference data
- Pull products
- Pull inventory
- Create test order in sandbox
- Poll orders
- Create inbound shipment
- Poll inbound shipments

Do not expose raw Basic token or password after save.

## Implementation Phases

### Phase 0: Discovery And Contract Confirmation

Get from the 3PL:

- production base URL
- sandbox base URL
- Basic token issuance process
- whether username/password are per merchant, per warehouse, or per operator
- token expiry behavior and revocation behavior
- rate limits
- max page size
- complete order status list and status transitions
- complete ship-to-warehouse status list
- required vs optional product fields
- whether order creation accepts SKU-only lines or requires OFS `product_id`
- cancellation rules by order status
- warehouse/multi-location behavior
- delivery method selection rules
- COD handling and settlement ownership
- airwaybill ownership
- webhook availability, if undocumented

### Phase 1: Read-Only MVP

Build:

- client auth and token cache
- credential test endpoint
- reference data sync
- product list/detail pull
- inventory list/detail pull
- mapping creation by SKU/UPC/product id
- execution logging
- fixtures and unit tests

Outcome:

SKUMS can show what the 3PL has and map OFS products/inventory to SKUMS without
changing remote state.

### Phase 2: Store Replenishment Order Push

Build:

- order payload mapper
- local idempotency by reference number
- product/address/delivery validation
- create order endpoint
- cancel order endpoint
- update order/address/item endpoints where safe
- order mapping storage
- domain events and attention items

Outcome:

SKUMS can send LISE store replenishment requests from operations, POS, or a
custom API to Loft through OFS.

### Phase 3: Fulfillment Status Polling

Build:

- scheduled poll worker
- order list/detail polling
- status normalization
- change detection by remote hash
- event emission
- exception handling

Outcome:

SKUMS can keep channel/POS operators updated when the 3PL accepts, processes,
ships, cancels, or fails an order.

### Phase 4: Inbound Shipment Flow

Build:

- inbound shipment payload mapper
- create ship-to-warehouse action
- inbound shipment mapping storage
- status polling
- partial/spoil/late attention items

Outcome:

SKUMS can coordinate replenishment into the 3PL and reconcile what was actually
received.

### Phase 5: Policy And Automation

Build:

- fulfillment policy routing UI
- per-channel fulfillment rules
- agent proposal generation for exceptions
- operator approvals for risky updates
- inventory availability policy combining OFS stock with channel reserves

Outcome:

WorldSyntech/OFS becomes one fulfillment target behind SKUMS, not a hardcoded
one-off integration.

## Test Plan

Unit tests:

- auth header and token exchange
- token cache refresh
- success envelope parsing
- `success: 0` error normalization
- product mapping
- inventory mapping
- order payload mapping
- ship-to-warehouse payload mapping
- status normalization

Integration tests with mocked HTTP:

- pull products paginates until empty
- pull inventory emits stable deltas
- create order stores external order id once
- retry create order does not duplicate remote creation after local success
- cancel order handles already-cancelled responses safely
- inbound shipment create stores all returned stock incoming ids

Database/API tests:

- integration node definition exists
- credentials are workspace-scoped
- mappings are workspace and connection scoped
- RLS prevents cross-workspace access
- executions log both success and failure
- failed fulfillment creates attention item with idempotency key

## Open Risks

- API examples contain malformed JSON in a few places, so implementation should
  follow live responses and tolerate inconsistent types.
- No webhook docs are visible. Polling is required unless the vendor confirms a
  webhook surface.
- No rate limits are documented. Start with conservative polling and one
  connection-scoped request queue.
- No idempotency support is documented. SKUMS must guard duplicate creates.
- Status ids are not fully enumerated. Treat unknown statuses as attention
  items until the 3PL provides a state table.
- Product ownership is ambiguous. The safest default is OFS owns fulfillment
  IDs and inventory, SKUMS owns canonical product content.
