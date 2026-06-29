# ChatGPT Prompt: SKUMS POS App And Business Outcomes

Use this document as context for a future ChatGPT discussion about whether SKUMS should support a POS app, how that POS should fit into the product architecture, and what business outcomes it could create.

## SKUMS Context

SKUMS is intended to become the programmable product graph, sync engine, and verification layer for commerce.

The goal is not just to build another PIM or SKU table. The long-term goal is to become product identity infrastructure:

- canonical product identity
- product / variant / trade-unit graph
- contextual SKU assignments
- marketplace and channel listings
- external mappings
- sync jobs
- audit and provenance
- app ecosystem
- verification and attestations
- supplier and retailer collaboration

The first user profile is a skincare retailer, but SKUMS is being designed for more than skincare:

- skincare and cosmetics
- food and supplements
- electronics
- apparel
- keyboard switches and other loose-item categories
- regulated goods
- supplier catalogs
- marketplace sellers
- retailers and distributors

## Important Modeling Decision

SKU is not canonical identity.

SKU is a context-scoped operational or commercial label.

Example:

```text
ProductIdentity:
  Gateron Oil King Linear Switch

TradeUnits:
  each: 1 switch
  pack: 10 switches
  jar: 90 switches
  carton: 1,000 switches

SkuAssignments:
  workspace SKU: SWITCH-OILKING
  warehouse SKU: BIN-A17-OILKING
  Shopify seller SKU: OIL-KING-10PK
  Shopee seller SKU: GT-OILKING-X90
```

This matters for POS because a POS may sell:

- one loose unit
- a weighed/bulk unit
- a bundle
- a pack
- a sample
- a service
- a channel-specific listing
- a store-specific barcode/SKU

So POS should not force one product equals one SKU.

## What Codex Has Implemented

Codex added a migration runner and the first product-graph refactor slice.

### Migration Runner

Added:

- `scripts/migrate.mjs`
- `npm run db:migrate`
- `npm run db:migrate:status`

The runner:

- reads migrations from `core/db`
- supports `--dry-run`, `--status`, `--from`, `--to`, and `--only`
- uses the Node `postgres` driver
- does not require local `psql`
- records applied migrations in `public.skums_migrations`
- stores SHA-256 checksums
- stops on checksum mismatch

### Identity-Spine Migrations

Added migrations:

- `021_identity_spine.sql`
- `022_identity_spine_backfill.sql`
- `023_identity_graph_views.sql`
- `024_identity_spine_update_bridge.sql`
- `025_sku_assignment_helpers.sql`
- `026_listings.sql`
- `027_integration_listing_bridge.sql`
- `028_import_jobs.sql`
- `029_audit_events.sql`

### New Core Tables

Added:

- `product_identities`
- `trade_units`
- `identity_identifiers`
- `sku_assignments`
- `channels`
- `listings`
- `listing_identifiers`
- `listing_sync_states`
- `import_jobs`
- `import_job_rows`
- `audit_events`

### Compatibility Bridges

Existing product-table behavior is preserved:

- old `products` rows can be backfilled into the identity spine
- new product inserts create identity/trade-unit/SKU/identifier records
- legacy product updates sync identity fields and workspace SKU assignment
- old integration sync mappings can be bridged into first-class listings

### New API Surface

Added:

- `GET /api/v1/products/:id/identity`
- `GET /api/v1/products/:id/listings`
- `GET /api/v1/products/:id/sku-assignments`
- `POST /api/v1/trade-units/:id/sku-assignments`
- `GET /api/v1/listings`
- `GET /api/v1/imports`
- `POST /api/v1/imports`
- `GET /api/v1/imports/:id`

### Types And Docs

Added frontend/server vocabulary for:

- product identities
- trade units
- scoped SKU assignments
- identifiers
- channels
- listings
- import jobs

Added:

- `docs/IDENTITY_SPINE.md`

## POS App Question

I want to ask whether SKUMS should have a POS app and what the business outcomes would be.

Important constraint:

The POS should probably be an app or module on top of the SKUMS identity graph, not a bloated part of core.

Core should own:

- product identity
- trade units
- scoped SKU assignments
- listings/channels
- inventory primitives
- audit/provenance
- permissions
- sync primitives

POS app may own:

- registers
- store locations
- cashiers
- carts
- receipts
- payments
- returns/exchanges
- discounts
- loyalty
- offline mode
- barcode scanning
- customer profiles
- store-specific assortment
- store inventory views
- POS-specific UX

## Questions For ChatGPT

Please analyze:

1. Should SKUMS build a POS app as a first-party app, third-party app, or not at all?
2. If POS is built, what should be core infrastructure versus POS-app-specific functionality?
3. What business outcomes could POS unlock for SKUMS?
4. Would POS strengthen or distract from the product identity graph thesis?
5. What is the best MVP POS scope for a skincare retailer?
6. How would POS support loose items, bundles, samples, packs, and contextual SKUs?
7. How should POS interact with inventory ledger, trade units, and listings?
8. How should POS data flow back into SKUMS for demand forecasting, product quality, AI enrichment, and supplier ordering?
9. What monetization models make sense?
10. What risks should SKUMS avoid?

## Desired Answer Style

Be direct and strategic.

Separate:

- technical architecture
- product scope
- business outcomes
- monetization
- risks
- recommended MVP
- longer-term roadmap

Do not assume POS should be built just because it is possible.

Evaluate whether POS improves SKUMS' defensibility as commerce product identity infrastructure.
