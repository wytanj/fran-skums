# Fran SKUMS Genesis

## Source Fork

Start this repo by copying or forking:

```text
C:\Users\Jeremy Tan\CodeProjects\skums
```

Fran SKUMS is the product, inventory, fulfillment, and store-ops backend for Fran. It should stay focused on product and operational truth, while Fran POS owns store reality capture and Fran CRM owns customer and loyalty decisions.

## Product Role

Fran SKUMS owns:

- product catalogue
- barcode and SKU identity
- variant and bundle structure
- inventory availability
- stock movements
- sale and return inventory effects
- fulfillment connectors
- 3PL handoff
- store-ops queue, approval, execution, reconciliation, and exceptions
- product metadata needed by POS and CRM decisions

It does not own:

- cashier checkout UI
- customer graph
- member identity truth
- points balance
- loyalty policy
- reward redemption confirmation
- CRM profile fields
- payment execution

## Upstream Anchors

Keep and extend these SKUMS primitives:

- product/catalog APIs
- POS scan resolution
- POS sale ingest
- inventory event ingest
- store-ops workflow
- fulfillment connector model
- 3PL fulfillment adapter boundary
- manager approval and reconciliation surfaces

Important existing boundary:

```text
POS captures store reality.
SKUMS owns approval, reconciliation, 3PL execution, and exceptions.
```

## Fran-Specific Code Placement

Put Fran-only code in clear surfaces:

```text
core/fran/
server/fran/
app/pages/fran/
docs/fran-skums-contract.md
docs/fran-product-operations.md
```

Use generic product and inventory primitives whenever possible. Keep Fran naming in Fran-specific modules.

## Contract With Fran POS

Fran POS should call Fran SKUMS for:

```text
scan resolution
catalog search
product detail
inventory availability
sale ingest
return ingest
stock adjustment
transfer receipt
store-ops request creation
```

Suggested POS-facing methods:

```text
POST /fran/pos/scan/resolve
GET  /fran/pos/catalog
GET  /fran/pos/products/[id]
POST /fran/pos/sales
POST /fran/pos/returns
POST /fran/pos/inventory-events
POST /fran/store-ops/requests
```

Every POS write should be idempotent.

## Contract With Fran CRM

Fran CRM may need product metadata for reward and profile decisions, but it should not become the product source of truth.

Expose narrow product context:

```text
product id
sku
barcode
brand
category
collection
tags
reward eligibility flags
sample eligibility flags
return policy group
skin concern tags, if product recommendations use them
restricted product flags
```

Fran CRM can use these facts for reward eligibility and counter advice, but SKUMS remains the owner.

## Fran Product Metadata

Add metadata only where it supports POS, CRM, rewards, or fulfillment decisions.

Suggested fields:

```text
fran_category
fran_brand
fran_collection
fran_reward_eligible
fran_reward_exclusion_reason
fran_sample_eligible
fran_skin_concern_tags
fran_sensitivity_flags
fran_return_policy_group
fran_store_pickup_eligible
fran_3pl_fulfillment_profile
```

Do not encode customer-specific loyalty rules in product rows. Product rows can say what a product is; Fran CRM decides who is eligible for what.

## Store-Ops Workflow

Keep the existing store-ops shape:

```text
queue -> approval -> execution -> reconciliation -> exception handling
```

Fran-specific examples:

- request warehouse replenishment
- request 3PL shipment to store
- mark damaged tester/sample inventory
- reconcile POS sale versus inventory availability
- resolve failed 3PL order push
- investigate reward-product stock mismatch

Manager UI should not expose 3PL credentials in-page.

## Fulfillment And 3PL

The correct shape is connector-based:

```text
Fran sales channels -> SKUMS order/inventory core -> fulfillment connector -> 3PL
```

A 3PL connector should not be a marketplace adapter. It should sit behind the product/order/inventory model and operate as a fulfillment target.

## Event Rules

Consume:

```text
pos.sale.completed
pos.return.completed
pos.inventory.adjusted
pos.stock.found
pos.stock.damaged
fran.reward.committed
fran.reward.reversed
```

Produce:

```text
skums.product.updated
skums.inventory.updated
skums.fulfillment.requested
skums.fulfillment.completed
skums.store_ops.requested
skums.store_ops.approved
skums.store_ops.failed
skums.reconciliation.exception
```

Reward events are inventory context only. They should not mutate customer points in SKUMS.

## Non-Goals

- Do not calculate loyalty points.
- Do not own member tiers.
- Do not render POS cashier reward flows.
- Do not store CRM profile fields as product fields.
- Do not expose 3PL secrets to browser clients.
- Do not let POS directly call 3PL credentials.

## Build Order

1. Copy upstream SKUMS into this folder and verify tests/build.
2. Rename product labels to Fran SKUMS where user-facing.
3. Add `docs/fran-skums-contract.md` and `docs/fran-product-operations.md`.
4. Add Fran product metadata schema or config.
5. Add POS scan/catalog responses with Fran metadata.
6. Ensure POS sale ingest preserves Fran customer and CRM refs without owning them.
7. Ensure POS return ingest preserves CRM return/reward refs without owning them.
8. Add product eligibility exports for Fran CRM reward decisions.
9. Add store-ops request types for Fran replenishment, damage, 3PL, and reconciliation.
10. Add fulfillment connector hardening for idempotency, polling, and local retry.
11. Add tests for product metadata, scan resolution, sale ingest, return ingest, and store-ops lifecycle.

## Acceptance Checks

- Fran POS can resolve product scans through SKUMS.
- Fran POS can complete sale sync idempotently.
- Fran CRM can read narrow product eligibility metadata without owning catalogue truth.
- Reward product eligibility is represented as product metadata, not customer policy.
- Store-ops requests follow queue, approval, execution, reconciliation, and exception states.
- 3PL secrets stay server-side.
- Inventory changes from sales, returns, damage, and transfers are replay-safe.
