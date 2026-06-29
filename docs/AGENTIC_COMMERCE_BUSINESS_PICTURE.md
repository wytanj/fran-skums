# SKUMS Agentic Commerce Business Picture

## Executive Summary

SKUMS is being shaped as an agentic commerce core: a structured operating layer where products, trade units, contextual SKUs, identifiers, listings, imports, events, approvals, agents, and apps share one durable model.

The goal is not to build one more PIM, POS, ERP, website optimizer, or chatbot. The goal is to give commerce teams a system that understands their product operations well enough to propose and execute deterministic work across every surface where commerce happens.

The core principle is:

```text
Humans approve commercial intent.
Agents execute deterministic operational consequences.
```

This matters because modern commerce stacks are increasingly easy to generate, customize, or replace. The moat cannot be generic CRUD screens. The moat must be the product graph, operational memory, provenance, app interoperability, and the deterministic agent layer that compounds over time.

The important market nuance is that many merchants, especially in SEA, LATAM, and other developing markets, do not run commerce primarily from their own website. They operate across marketplaces, superapps, social channels, chat, offline stores, fulfillment partners, and spreadsheets. SKUMS should therefore position itself as the cross-channel commerce intelligence and execution core, not as an "AI store builder" alone.

## Why Agentic Commerce Makes Sense

Commerce teams do not struggle because they lack forms. They struggle because the same product appears differently across suppliers, marketplaces, online stores, POS systems, warehouses, regional feeds, and internal spreadsheets.

Typical mess:

```text
One product has many SKUs.
One SKU means different things in different systems.
Barcodes may point to a pack, an each, a sample, or a listing.
Supplier sheets disagree with Shopify.
Marketplace listings drift.
POS sells loose items or bundles.
Inventory depends on trade-unit conversion.
Claims, media, pricing, expiry, and descriptions move at different speeds.
```

Traditional software makes users manually fix this system by system. Agentic commerce should do something better:

```text
1. Understand the product graph.
2. Detect operational consequences.
3. Propose a safe plan.
4. Require approval when risk is material.
5. Execute through typed tools.
6. Record events and audit history.
```

The agent is not a chatbot with database access. It is a proposal and execution layer over structured commerce primitives.

## Marketplace-Heavy Markets

In markets like Singapore, Malaysia, Indonesia, Thailand, the Philippines, Vietnam, Mexico, Brazil, Colombia, and similar developing commerce environments, the merchant's own website is often only one node in the operating stack.

Common surfaces:

```text
SEA
  Shopee
  Lazada
  TikTok Shop / Tokopedia
  Grab
  LINE
  WhatsApp
  Instagram / Facebook
  Shopify or custom website
  offline retail / POS

LATAM
  Mercado Libre
  Mercado Pago / Mercado Envios
  Amazon Mexico / Brazil
  Magalu
  Americanas
  Falabella
  Liverpool / Coppel
  Rappi
  WhatsApp
  Instagram / Facebook
  Shopify or custom website
  offline retail / POS
```

The operational reality is not "optimize my online store." It is:

```text
Keep my product truth coherent across every selling surface.
Tell me when a channel has drifted.
Adapt product content to each marketplace's rules.
Resolve SKUs, barcodes, listings, packs, bundles, and fulfillment policies.
Execute safe updates through approvals and typed integrations.
```

That makes SKUMS materially different from a self-improving storefront product. A website optimizer can improve conversion on the owned site. SKUMS should coordinate the product graph and operational consequences across owned commerce, marketplaces, social commerce, superapps, POS, inventory, and intelligence apps.

This is especially important because marketplace and superapp channels impose constraints that owned stores do not:

```text
category-specific required attributes
listing title limits
image and media policies
seller SKU formats
campaign and voucher mechanics
warehouse and fulfillment programs
marketplace fees and commissions
content moderation rules
variant limits
regional language expectations
price and inventory sync latency
```

The product architecture should treat these constraints as data and capability rules, not hardcoded connector quirks.

## Defensible Moat

The defensibility is not the UI alone. A capable team can code a product table, POS screen, or Shopify sync. The harder part is the accumulated operational model.

The durable moat is:

```text
Product identity graph
Trade-unit semantics
Contextual SKU assignments
Identifier resolution
Listing/channel projections
Import normalization memory
Domain event history
Audit/provenance
Proposal/approval/execution patterns
Integration capability ownership
Domain-specific apps and playbooks
```

As more apps use SKUMS, the graph becomes more valuable. POS sales, supplier imports, Shopify listings, skincare intelligence, expiry signals, marketplace scraping, and agent proposals all enrich the same core memory.

In marketplace-heavy markets, the moat is stronger because the merchant's pain is cross-channel coherence. A generated stack can recreate a single app. It is much harder to recreate accumulated product identity resolution, channel-specific listing memory, trade-unit semantics, SKU scope rules, import history, marketplace drift findings, approval patterns, and audit history across many surfaces.

## Product Shape

SKUMS should be understood as the core. Apps build on top.

```text
SKUMS Core
  product graph
  trade units
  contextual SKUs
  identifiers
  channels/listings
  channel capabilities
  channel requirements
  channel offer rules
  listing content variants
  promotions and campaigns
  fulfillment policies
  fee snapshots
  imports
  app registry
  capability ownership
  domain events
  audit events
  agent proposals
  approvals
  execution logs

Apps
  POS
  skincare intelligence
  supplier imports
  marketplace intelligence
  Shopify connector
  Shopee connector
  Lazada connector
  TikTok Shop connector
  Mercado Libre connector
  WhatsApp commerce assistant
  ERP/WMS connectors
  forecasting
  expiry/batch workflows
  custom workspace apps
```

This allows several adoption modes:

```text
SKUMS only
POS only
SKUMS + POS
SKUMS + external apps
External stack + SKUMS as observer/coordinator
```

The platform should not presume a business model yet. App enablement is operational, not billing. Monetization can later be layered via plans, entitlements, usage events, or enterprise contracts without changing the core model.

## API Strategy

APIs are the product boundary. Apps, connectors, agents, and external systems should interact with SKUMS through scoped APIs rather than directly mutating arbitrary tables.

Current API principles:

```text
API keys are workspace scoped.
Scopes are explicit.
Read APIs stay read-only.
Write APIs validate workspace ownership.
Agent behavior goes through proposals/events where possible.
Graph writes should be idempotent.
```

Current API surfaces include:

```text
Products
  GET /api/v1/products
  POST /api/v1/products
  GET /api/v1/products/:id
  PUT /api/v1/products/:id
  DELETE /api/v1/products/:id
  GET /api/v1/products/:id/identity
  GET /api/v1/products/:id/listings
  GET /api/v1/products/:id/sku-assignments

Trade Units
  POST /api/v1/trade-units/:id/sku-assignments

Listings
  GET /api/v1/listings

Imports
  GET /api/v1/imports
  POST /api/v1/imports
  GET /api/v1/imports/:id

POS
  POST /api/v1/pos/scan
  POST /api/v1/pos/sales

Apps
  GET /api/v1/apps
  GET /api/v1/workspace-apps
  POST /api/v1/workspace-apps
  GET /api/v1/capability-sources
  POST /api/v1/capability-sources

Events
  GET /api/v1/events
  POST /api/v1/events

Agents
  GET /api/v1/agent-proposals
  POST /api/v1/agent-proposals
  POST /api/v1/agent-proposals/:id/decision
```

Current scope groups:

```text
products:read
products:write
products:delete
apps:read
apps:write
events:read
events:write
agents:read
agents:write
pos:read
pos:write
api:read
api:write
```

API direction:

```text
1. Keep low-level CRUD minimal.
2. Add higher-level intent/proposal endpoints.
3. Make app-specific APIs resolve through the graph.
4. Use domain events for app coordination.
5. Add idempotency keys to write paths.
6. Generate OpenAPI once routes settle.
```

Near-term channel API direction:

```text
GET /api/v1/channels
GET /api/v1/channels/:id/capabilities
GET /api/v1/channels/:id/requirements
GET /api/v1/listings/:id/quality-findings
POST /api/v1/listings/:id/proposals
POST /api/v1/channel-sync-jobs
GET /api/v1/channel-sync-jobs/:id
```

The API should allow apps to ask:

```text
Can this trade unit be sold on this channel?
What fields are missing for this marketplace category?
Which content variant should be published?
What changed since the last channel sync?
What operational risk requires human approval?
```

## Operating Environments And Backups

SKUMS should assume separate production and development databases from the beginning.

```text
Production database
  customer-facing data
  live auth identities
  workspace/org membership
  production API keys
  connector credentials
  durable audit history
  scheduled backups and restore drills

Development database
  internal development and QA
  disposable or sanitized data
  non-production OAuth clients
  test API keys and connector sandboxes
  migration testing before production rollout
```

Production and development should not share Supabase projects, auth providers, API keys, service-role keys, webhook secrets, connector credentials, or OAuth redirect clients. Google SSO in particular should have separate dev and prod OAuth client configuration so callback URLs, consent screens, and test users do not leak across environments.

For customers, SKUMS will likely also operate managed backups. That should be treated as part of the trust and IAM story, not as an afterthought:

```text
backup ownership
backup retention policy
point-in-time recovery expectations
restore approval workflow
customer export rights
operator access logging
service-role key custody
incident recovery runbooks
```

The important distinction:

```text
RLS protects tenant access inside the live app.
IAM governs who can administer users, teams, orgs, keys, and restores.
Backups protect customer continuity and must be operated with auditable access.
```

As SKUMS moves toward teams and orgs, backup/restore actions should eventually become first-class operational events. A restore should not be an invisible database action. It should leave an audit trail that records who requested it, who approved it, which environment was affected, the restore point, and what customer/org/workspace scope was involved.

## What Has Been Built

### Migration Runner

The repo now has a local migration runner:

```sh
npm run db:migrate:status
npm run db:migrate -- --dry-run
npm run db:migrate -- --only 037
```

It uses the Node `postgres` driver, records applied migrations in `public.skums_migrations`, and checks SHA-256 checksums to prevent silent drift.

### Product Identity Spine

Built migrations `021` to `025`:

```text
product_identities
trade_units
identity_identifiers
sku_assignments
identity graph views
legacy product bridge
SKU assignment helper RPCs
```

Key model correction:

```text
SKU is not canonical identity.
SKU is a scoped operational/commercial label.
```

This supports:

```text
loose items
packs
cases
bundles
samples
supplier SKUs
warehouse SKUs
POS SKUs
marketplace seller SKUs
listing-level SKUs
```

### Listings And Channels

Built migrations `026` and `027`:

```text
channels
listings
listing_identifiers
listing_sync_states
integration listing bridge
```

A listing is now a first-class channel projection of a product identity or trade unit. It is not the product, and it is not the SKU.

This now needs a richer second layer for marketplace-heavy commerce:

```text
channel_capabilities
channel_requirements
channel_offer_rules
listing_content_variants
promotion_events
fulfillment_policies
channel_fee_snapshots
listing_quality_findings
```

This is where SKUMS can model the difference between an owned site, Shopee listing, Lazada listing, TikTok Shop offer, Mercado Libre offer, Grab catalog item, WhatsApp sales flow, and POS sale without corrupting the canonical product identity.

### Import Staging

Built migration `028`:

```text
import_jobs
import_job_rows
normalized product graph write plans
```

This prepares SKUMS for messy CSV/supplier/marketplace imports where agents can normalize, detect duplicates, and propose graph writes before execution.

### Audit Events

Built migration `029`:

```text
audit_events
record_graph_audit_event()
graph-table audit triggers
```

Graph mutations now have append-only provenance.

### POS Core

Built migration `036`:

```text
pos_locations
pos_registers
pos_register_sessions
pos_sales
pos_sale_items
pos_sale_payments
resolve_pos_scan()
```

POS sale items reference graph objects:

```text
product_identity_id
trade_unit_id
listing_id
channel_id
sku_assignment_id
identifier_id
batch_id
```

This makes POS a first-party app over the graph, not another product database.

### App Platform

Built migration `037`:

```text
app_definitions
workspace_apps
workspace_capability_sources
domain_events
agent_proposals
approval_requests
agent_execution_logs
```

Seeded apps:

```text
skums_core
pos
skincare_intelligence
shopify
supplier_imports
```

This is the foundation for non-POS apps to build on SKUMS.

### POS Repo

The POS repo now includes:

```text
POS terminal demo
sale flow
returns/exchanges
stock view
transfers
transactions
reports/closing
manager auth
receipt/payment UI
SKUMS graph types
SKUMS sale adapter
SKUMS API client
SKUMS POS catalog client contract
contract tests
```

It can still run standalone with mock data, but its cart/sale objects can carry SKUMS graph references. The next production path is to read sellable catalogue rows from `GET /api/v1/pos/catalog`, resolve scans through `POST /api/v1/pos/scan`, and write completed transactions through `POST /api/v1/pos/sales`.

## What Apps Can Be Built

### Supplier Import Agent

Wedge app for self-serve value.

```text
Upload supplier sheet.
Stage raw rows.
Normalize columns with deterministic mappings first and LLM assistance when the file shape is new.
Detect duplicate products.
Detect ambiguous SKUs.
Suggest trade units.
Map supplier SKUs to contextual assignments.
Generate proposal.
Human approves.
SKUMS writes graph.
```

### Skincare Intelligence

For the first user and similar retailers.

```text
Claim review
Ingredient extraction
Marketplace quality scoring
Listing drift detection
Expiry/batch risk
Product attention queue
Scraping-backed competitive signals
```

### POS App

Retail execution app.

```text
Scan resolution
Cart and checkout
Returns/exchanges
Samples/testers
Register sessions
Receipt records
Sale events
Inventory movement bridge
Customer memory later
```

### Shopify Connector

Storefront projection app.

```text
Draft listings
Sync title/description/media
Detect listing drift
Receive order events
Map Shopify variants to trade units
Queue publish proposals
```

### Marketplace Connectors

Shopee, Lazada, TikTok Shop, Tokopedia, Mercado Libre, Amazon, Magalu, Falabella, Rappi, and other regional channels.

```text
Listing projections
Seller SKU mapping
Marketplace identifiers
Price/content drift
Sync health
Quality/performance signals
Campaign eligibility
Channel fees
Fulfillment constraints
Regional content variants
Channel-specific required fields
```

These should not be simple sync plugins. Each marketplace connector should behave as a capability provider that contributes requirements, findings, sync events, and proposals into the SKUMS core.

### Social And Chat Commerce

In many developing markets, WhatsApp, LINE, Instagram, Facebook, and livestream/social selling flows are operationally important even when they are not the system of record.

```text
catalog share links
manual order capture
chat-assisted product recommendations
payment confirmation
customer-specific availability
informal bundles
follow-up reminders
```

SKUMS should not try to own every chat surface. It should expose enough product, trade-unit, availability, listing, and proposal APIs for chat agents and social-commerce apps to operate without creating another product database.

### Inventory And Expiry App

Operational stock layer.

```text
Trade-unit-aware inventory movements
Batch tracking
Expiry warnings
Write-off proposals
Sample/tester movements
Bundle component deduction
Reorder suggestions
```

### Product Attention Queue

Cross-app operational inbox.

```text
Ambiguous barcode
Missing trade unit
Duplicate identity candidate
Listing sync failed
Claim review required
Batch expiring soon
Low stock
Supplier pack size changed
Marketplace required field missing
Listing content rejected
Campaign price would violate margin rule
Channel fulfillment mode unavailable
```

### Custom Workspace Apps

Teams can later define private apps that consume/provide capabilities and emit/subscribe to events.

## What We Will Do Next

### 1. Product Attention Queue

Create a first-class table/API for operational issues:

```text
product_attention_items
attention_type
risk_level
source_event_id
entity references
status
recommended_action
proposal_id
```

This is the self-serve surface where users see value quickly.

For marketplace-heavy merchants, this queue should be channel-aware from day one:

```text
which channel raised the issue
which listing / trade unit / product identity is affected
whether the issue blocks sales
whether the issue affects margin, availability, compliance, or discoverability
which app can resolve it
```

### 2. Agent Proposal Workflows

Add deterministic proposal generators for:

```text
import normalization
duplicate product merge candidates
missing trade units
ambiguous SKU/barcode resolution
listing drift
expiry risk
```

The UI should show:

```text
what SKUMS understood
what it proposes
why
risk level
affected objects
approval action
```

### 3. Trade-Unit-Aware Inventory Movements

Do not force POS through the old product/variant/integer inventory model.

Next inventory migration should support:

```text
product_identity_id
trade_unit_id
location_id
batch_id
movement_type
quantity
base_quantity
conversion_factor
source_event_id
reference_type
reference_id
idempotency_key
```

Movement types:

```text
sale
return
sample_issued
tester_opened
pack_break
bundle_component_sale
expiry_writeoff
stock_adjustment
transfer
supplier_receipt
```

### 4. Import-To-Proposal E2E

Build the first high-value E2E:

```text
messy import
-> staged rows
-> normalized graph plan
-> agent proposal
-> approval
-> product identity/trade unit/SKU/listing writes
-> audit + domain events
```

Do not assume supplier XLSX formats are stable. Each import should preserve the original file metadata and raw row JSON, then generate a staged, reviewable normalized plan. Known formats can use saved mappings. Unknown or changed formats should route through an LLM-assisted column inference and normalization step, but the LLM output remains a proposal, not an automatic write.

For beauty supplier catalogues such as ABW/LISE-style XLSX files, keep the supplier identifiers and operational flags separate:

```text
ABW catalog number -> supplier_item identifier / supplier-scoped SKU
UPC/EAN/GTIN -> identity or trade-unit identifier when valid
Brand + product name + option -> identity and trade-unit candidate
availability -> supplier availability metadata
box quantity/box price -> pack/case trade-unit candidates
enabled/disabled for POS -> explicit staged field such as pos_enabled or sellable_in_pos
```

The user must be able to see staged rows, warnings, duplicate matches, inferred columns, and enabled/disabled decisions before approving graph writes. Disabled rows should still be stored in SKUMS for search, provenance, later enablement, and supplier-history comparison; POS catalog reads should only return active products where `product_data.pos_enabled` / `product_data.sellable_in_pos` is not false.

This is likely the best no-sales-team wedge.

The demo should include marketplace-shaped input, not only clean Shopify-style catalog data:

```text
seller SKU columns
marketplace listing IDs
channel category names
mixed pack sizes
duplicate supplier rows
localized titles
missing required attributes
channel-specific price fields
```

This better matches SEA and LATAM reality and makes the product's value obvious without a sales process.

### 5. POS Real Wiring

After inventory movements v2:

```text
scan -> resolve_pos_scan
checkout -> pos_sales
sale completed -> domain_event
event -> inventory movement proposal/execution
```

For the near-term demo and first customer wiring, SKUMS should offer a one-click POS connector setup from workspace settings. An owner/admin can create a scoped connector key with only `pos:read` and `pos:write`, then copy the POS environment values:

```text
VITE_SKUMS_API_URL=https://skums.vercel.app
VITE_SKUMS_API_KEY=sk_live_...
```

Google SSO should be treated as required on the SKUMS administration side first, because SKUMS owns organizations, workspaces, team membership, API keys, imports, and connector setup. POS does not need full Google SSO before the demo if it is using a scoped connector key. POS staff IAM can later converge on SKUMS identity through register/device assignment, role-based sessions, or shared SSO once cashier/manager permissions are modeled.

### 6. Connector Sync Jobs

Add sync job infrastructure:

```text
sync_jobs
sync_job_steps
sync_conflicts
webhook_subscriptions
webhook_deliveries
```

This lets Shopify, marketplaces, ERP, and custom apps operate through one observable execution model.

### 7. Channel Intelligence Layer

Add the channel-specific primitives that convert listings from static projections into actionable commerce intelligence:

```text
channel_capabilities
channel_requirements
channel_offer_rules
listing_content_variants
promotion_events
fulfillment_policies
channel_fee_snapshots
listing_quality_findings
```

This layer is the difference between "we sync products" and "we understand what each commerce surface requires, what is currently wrong, and what safe action should happen next."

## Unit Test Strategy

Current tests are static/contract oriented because the project is still migration/API heavy.

Keep testing:

```text
migration registration
table shape
RLS intent
append-only tables
idempotency indexes
workspace scoping
API scopes
read-only route behavior
write route validation
type vocabulary
```

Add next:

```text
proposal generator tests
import normalization tests
SKU resolution edge cases
trade unit conversion tests
inventory movement idempotency
capability ownership resolver tests
domain event reducer/projection tests
```

## E2E Strategy

E2E should run against disposable infrastructure, not the production Supabase project.

Needed:

```text
local Supabase or test Postgres harness
seed workspace
seed API key
run migrations
run deterministic workflows
assert database state
```

First E2E flows:

```text
1. Import CSV -> proposal -> approval -> graph writes.
2. POS scan -> sale -> domain event.
3. Listing drift -> proposal -> approval.
4. Expiry batch -> attention item -> proposal.
5. Capability source config -> app behavior routing.
6. Marketplace import -> channel requirements -> listing findings -> proposal.
7. Marketplace sync event -> drift detection -> approval -> corrected listing projection.
```

## Public And Self-Serve Positioning

The product should explain itself by doing useful work immediately.

Best first public demo:

```text
Upload messy supplier / marketplace commerce file.
SKUMS resolves product identities, trade units, SKUs, identifiers, listings, channel requirements, duplicates, and risks.
It proposes a safe repair plan for every affected surface.
User approves.
The graph updates with audit history.
```

This is stronger than leading with POS or a website optimizer. POS proves the graph can power retail execution, and storefront optimization can be an app on top. The self-serve wedge is messy cross-channel data to agentic product operations.

Public positioning:

```text
Your commerce stack understands itself and improves across every channel.
```

Avoid positioning SKUMS as:

```text
AI Shopify
AI POS
AI PIM
website optimizer
generic commerce chatbot
```

## Current Status

Implemented and pushed:

```text
SKUMS commit: 43dfb15 Build SKUMS agentic commerce core
POS commit: 4d37368 Add SKUMS-compatible POS app
POS commit: 11025d3 Add POS deployment config
```

Applied database migrations:

```text
021-029
036
037
```

Verified:

```text
SKUMS tests passing
SKUMS build passing
POS tests passing
POS build passing
```

SKUMS is now ready for the next phase: product attention queue, deterministic proposal generators, trade-unit-aware inventory movements, and import-to-proposal E2E.
