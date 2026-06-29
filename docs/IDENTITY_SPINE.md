# SKUMS Identity Spine

## Purpose

The identity spine is the first step away from a flat product/SKU table.

The core rule:

> SKU is a context-scoped label, not canonical product identity.

This matters because many commerce objects do not have one stable SKU:

- loose keyboard switches sold as singles, packs of 10, jars of 90, or wholesale cartons
- skincare products sold as samples, retail units, bundles, regional listings, or marketplace variants
- supplier catalogs where supplier item codes differ from warehouse SKUs and seller SKUs

## Current Compatibility Mode

The existing `products` table remains in place.

New migrations add an identity spine beside it:

- `product_identities`
- `trade_units`
- `identity_identifiers`
- `sku_assignments`
- `channels`
- `listings`
- `listing_identifiers`
- `listing_sync_states`

Legacy product inserts and updates are bridged into the new tables with triggers.

This lets existing UI and API code continue using `products` while newer code reads and writes the graph model.

## Model

```text
ProductIdentity
  Product / item definition

TradeUnit
  Countable or sellable unit of that identity
  Examples: each, sample, pack, case, pallet, bundle, bulk

IdentityIdentifier
  First-class external or regulated identifier
  Examples: GTIN, UPC, EAN, ASIN, MPN, supplier item code

SkuAssignment
  Context-scoped SKU label
  Examples: workspace SKU, warehouse SKU, channel seller SKU, supplier SKU

Listing
  Channel-facing commercial record
  Examples: Shopify variant, Amazon listing, Shopee listing, retailer portal item
```

## Example: Keyboard Switches

```text
ProductIdentity
  Gateron Oil King Linear Switch

TradeUnits
  each: 1 switch
  pack: 10 switches
  jar: 90 switches
  carton: 1,000 switches

SkuAssignments
  workspace SKU: SWITCH-OILKING
  warehouse SKU: BIN-A17-OILKING
  Shopify seller SKU: OIL-KING-10PK
  Shopee seller SKU: GT-OILKING-X90
```

## Example: Skincare Retail

```text
ProductIdentity
  Beauty of Joseon Relief Sun

TradeUnits
  retail unit: 50ml tube
  sample: 1ml sachet
  bundle: 2-pack

IdentityIdentifiers
  GTIN for retail unit
  supplier item code
  marketplace listing IDs

Listings
  Shopify product variant
  Shopee SG listing
  Lazada listing
```

The skincare intelligence app can enrich the product identity and trade units without owning the core schema.

## Migration Sequence

1. `021_identity_spine.sql`
2. `022_identity_spine_backfill.sql`
3. `023_identity_graph_views.sql`
4. `024_identity_spine_update_bridge.sql`
5. `025_sku_assignment_helpers.sql`
6. `026_listings.sql`
7. `027_integration_listing_bridge.sql`

## API Compatibility

Existing product endpoints continue to work.

New read endpoints:

- `GET /api/v1/products/:id/identity`
- `GET /api/v1/products/:id/listings`
- `GET /api/v1/listings`

Write paths are still conservative. New direct writes should go through the identity-spine tables or helper RPCs, but existing product writes remain bridged.

## Near-Term Rules

- Do not add new canonical identifier columns to `products`.
- Do not make `sku` required for products.
- Do not assume one product equals one SKU.
- Do not assume one GTIN equals one product in every context.
- Put channel-facing records in `listings`.
- Put seller SKUs in `sku_assignments` with `scope_type = 'listing'` or `scope_type = 'channel'`.
