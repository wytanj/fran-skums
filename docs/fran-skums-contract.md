# Fran SKUMS Contract

Fran SKUMS is the product, inventory, fulfillment, and store-operations source of truth for Fran. Fran POS captures store reality. Fran CRM owns customer, loyalty, profile, and reward-policy decisions.

## Boundaries

Fran SKUMS owns product identity, catalogue data, SKU/barcode resolution, product metadata, inventory availability, stock movements, fulfillment connector state, 3PL handoff, and store-ops reconciliation.

Fran SKUMS does not own cashier checkout UI, member identity truth, points balances, loyalty policy, reward redemption confirmation, CRM profile fields, or payment execution.

## Fran POS Methods

The Fran-specific route surface is intentionally thin. It wraps generic SKUMS primitives and adds Fran metadata/context where POS needs it.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/fran/pos/scan/resolve` | Resolve a scanned barcode/SKU and return SKUMS graph references with Fran product context. |
| `GET` | `/fran/pos/catalog` | List POS-enabled catalogue items with Fran metadata in `fran` and `metadata.fran`. |
| `GET` | `/fran/pos/products/[id]` | Read a product detail by SKUMS product id with Fran context. |
| `POST` | `/fran/pos/sales` | Ingest idempotent Fran POS sales while preserving CRM and reward references. |
| `POST` | `/fran/pos/returns` | Ingest idempotent Fran POS returns while preserving CRM return/reward references. |
| `POST` | `/fran/pos/inventory-events` | Reuse the generic POS inventory event intake for damage, found stock, and transfer receipts. |
| `POST` | `/fran/store-ops/requests` | Create store-ops requests for replenishment, 3PL, damage, and reconciliation workflows. |

Every POS write should include an `idempotency_key`. Duplicate keys return the already-recorded sale, return, inventory event, or request where the backing table supports it.

## Fran CRM Product Context

Fran CRM can read narrow product facts for reward eligibility and counter advice through:

```text
GET /fran/crm/product-context
```

The response is deliberately product-only:

- `product_id`
- `sku`
- `barcode`
- `brand`
- `category`
- `collection`
- `tags`
- `reward_eligible`
- `reward_exclusion_reason`
- `sample_eligible`
- `return_policy_group`
- `store_pickup_eligible`
- `fulfillment_profile_3pl`
- `skin_concern_tags`
- `sensitivity_flags`
- `restricted_product_flags`

CRM may use these facts to decide reward eligibility, profile recommendations, and counter advice. CRM should not write customer-specific loyalty decisions into SKUMS product rows.

## Event Boundary

Fran SKUMS consumes:

- `pos.sale.completed`
- `pos.return.completed`
- `pos.inventory.adjusted`
- `pos.stock.found`
- `pos.stock.damaged`
- `fran.reward.committed`
- `fran.reward.reversed`

Fran SKUMS produces:

- `skums.product.updated`
- `skums.inventory.updated`
- `skums.fulfillment.requested`
- `skums.fulfillment.completed`
- `skums.store_ops.requested`
- `skums.store_ops.approved`
- `skums.store_ops.failed`
- `skums.reconciliation.exception`

Reward events are inventory context only. They must not mutate points, tiers, member status, or reward policy in SKUMS.

## Secrets

3PL credentials, service-role keys, database passwords, and connector secrets stay server-side. Browser POS and CRM clients should use scoped API keys or authenticated server calls, not direct 3PL credentials.
