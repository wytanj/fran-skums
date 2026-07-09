# Fran SKUMS Pricing and Inventory Execution Plan

Fran SKUMS is the product, pricing, availability, reservation, and inventory movement authority for Fran loyalty checkout. It should not mutate points, tiers, member balances, or reward policy. Those belong to Fran CRM. Fran POS executes the loaded loyalty policy, but it must execute against SKUMS-controlled pricing and inventory facts.

## Target Boundary

- Fran SKUMS owns SKU identity, barcode resolution, product metadata, price books, promotions, quote revisions, stock availability, reservations, sale inventory commit, returns inventory movement, and product reward stock.
- Fran POS owns cashier UI, basket sequencing, payment execution, local policy evaluation, receipt rendering, and source-event outbox.
- Fran CRM owns loyalty policy versions, member/account snapshots, ledger settlement, reward audit, and reconciliation.

## Required Build

1. Add basket quote API.
   - `POST /fran/pos/basket/quote`
   - Input: workspace/register/store, idempotency key, cart lines, customer/member context, and requested quote mode.
   - Output: quote id, quote revision, TTL, currency, line prices, discounts, tax basis if applicable, product context, availability, blocked lines, warnings, and price source.
   - Quote response must be the only live pricing basis Fran POS uses for policy execution.

2. Add price book and price revision support.
   - Move checkout pricing beyond `sale_price ?? retail_price`.
   - Record effective windows, channel/register/store scope, promotion references, and revision ids.
   - Include enough provenance for CRM/POS audit to reproduce why a price was used.

3. Use inventory levels for availability.
   - Availability should derive from `inventory_levels` and active reservations, not legacy `products.stock_quantity`.
   - Quote lines should return available-to-sell and reservable quantity by store/location.

4. Add reservation lifecycle.
   - `POST /fran/pos/reservations`
   - `POST /fran/pos/reservations/[id]/commit`
   - `POST /fran/pos/reservations/[id]/release`
   - Reservation rows should reference quote id, POS cart/sale id, store/register, line ids, expiry, source, and idempotency key.

5. Commit inventory on sale ingest.
   - Current sale ingest records POS sales/items/events.
   - Add inventory ledger movements for sold items after payment success.
   - Preserve CRM loyalty references in sale metadata, but do not mutate loyalty state.

6. Support product rewards and samples.
   - Product rewards, gifts, and samples need stock checks and holds.
   - Return product reward availability to POS as product facts; CRM/POS decide eligibility, SKUMS decides whether stock can be held.

7. Add bulk product context.
   - CRM and POS need batch context for policy evaluation.
   - Add a bulk endpoint that returns category, brand, collection, tags, reward eligibility, sample eligibility, return group, sensitivity flags, restricted flags, and revision metadata for many products/SKUs.

8. Update tests and docs.
   - Quote calculation with active price book.
   - Quote TTL/stale rejection.
   - Reservation create/commit/release idempotency.
   - Sale ingest decrements inventory ledger.
   - Product reward stock hold and release.
   - Bulk product context filtering and workspace boundaries.

## First Implementation Slice

1. Add `POST /fran/pos/basket/quote` using existing product metadata and current price fields.
2. Return quote id, TTL, quote line ids, price source, and product context even before full price books exist.
3. Add reservation rows against existing `inventory_reservations`.
4. Wire sale ingest to commit reserved stock into `inventory_ledger`.
5. Replace catalog-only POS pricing in Fran POS with quote-based pricing.
