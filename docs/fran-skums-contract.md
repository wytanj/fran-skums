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
| `POST` | `/fran/pos/basket/quote` | Price a POS basket from SKUMS product facts and inventory levels, returning quote line ids, quote revision, TTL, availability, blocked lines, and Fran product context. |
| `POST` | `/fran/pos/reservations` | Hold quoted stock against existing inventory reservations before payment or reward issue. |
| `POST` | `/fran/pos/reservations/[id]/commit` | Commit held stock after POS payment success or product reward issue. |
| `POST` | `/fran/pos/reservations/[id]/release` | Release held stock when checkout, reward issue, or sample issue is abandoned. |
| `POST` | `/fran/pos/sales` | Ingest idempotent Fran POS sales while preserving CRM, loyalty member, voucher, quote, and reward references (SKUMS does **not** settle points). |
| `POST` | `/fran/pos/returns` | Ingest idempotent Fran POS returns while preserving CRM return/reward references. |
| `POST` | `/fran/pos/inventory-events` | Reuse the generic POS inventory event intake for damage, found stock, and transfer receipts. |
| `POST` | `/fran/pos/products/context` | Bulk product context (ids/skus/barcodes) for POS/CRM loyalty evaluation — category, collection, reward flags only. |
| `POST` | `/fran/store-ops/requests` | Create store-ops requests for replenishment, 3PL, damage, and reconciliation workflows. |

Every POS write should include an `idempotency_key`. Duplicate keys return the already-recorded sale, return, inventory event, or request where the backing table supports it.

## Quote And Reservation Flow

Fran POS should call `POST /fran/pos/basket/quote` before loyalty policy execution. The quote response is the live pricing basis for POS and CRM-side reward decisions: it includes `quote_id`, `quote_revision`, `expires_at`, per-line quote ids, unit/list prices, line totals, `legacy_product_price` provenance, Fran product context, and inventory availability from `inventory_levels`.

Quote availability is SKUMS-owned. Active reservations are reflected through the `reserved` quantity in `inventory_levels`; POS should treat quote lines with `blocked = true` as unavailable for checkout or product reward issue.

When POS needs to hold stock, it should call `POST /fran/pos/reservations` with the quote id and cart/register context. SKUMS writes `pos_reservations`, `pos_reservation_lines`, and linked `inventory_reservations`, then increments the `reserved` inventory bucket through the ledger RPC. On payment success, POS can either call the reservation commit endpoint directly or include `pos_reservation_id` in the sale ingest body; sale ingest will commit the reservation and write the `sale` inventory ledger movement. If checkout is abandoned, POS should release the reservation before the quote/reservation TTL expires.

## Loyalty Sale Contract (Track L / L-skums)

When Fran POS posts a sale after FWB checkout, it should include (in body and/or `metadata.fran_context`):

- `member_ref` / `loyalty_member_ref` — CRM member id
- `policy_version_id`, `assignment_id` — policy bundle used at preview
- `skums_quote_id` / `quote_id` — basket quote id used for pricing
- `points_earned`, `points_redeemed` — **informational only** (CRM ledger is SoR)
- `voucher_ids` / `voucher_codes` — scanned birthday / category / redeem QRs
- `loyalty_commit_id` — CRM `commit_sale` id when available

SKUMS stores these under `metadata.fran_context` for audit and inventory linkage. SKUMS never computes or mutates point balances.

## Fran CRM Product Context

Fran CRM can read narrow product facts for reward eligibility and counter advice through:

```text
GET /fran/crm/product-context
POST /fran/pos/products/context   (bulk by product_ids | skus | barcodes)
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
