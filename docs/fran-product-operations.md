# Fran Product Operations

Fran product operations should use generic SKUMS catalogue, inventory, fulfillment, and store-ops primitives. Fran-only meaning belongs in Fran metadata, Fran route wrappers, and Fran docs.

**How to operate day-to-day (HQ + POS):** see [`docs/SKUMS_OPERATOR_RUNBOOK.md`](./SKUMS_OPERATOR_RUNBOOK.md) and in-app Help (`/help` — store ops, receive, floor adjustments).

## Product Metadata

Fran metadata is stored in `products.product_data` and normalized by `core/fran/productMetadata.ts`.

| Key | Purpose |
|---|---|
| `fran_category` | Fran-facing category label when it differs from the generic category tree. |
| `fran_brand` | Fran-facing brand label when it differs from the generic brand table. |
| `fran_collection` | Merchandising collection or campaign grouping. |
| `fran_reward_eligible` | Product-level reward eligibility fact. |
| `fran_reward_exclusion_reason` | Product-level reason a reward cannot apply. |
| `fran_sample_eligible` | Whether the product can be issued as a sample. |
| `fran_skin_concern_tags` | Product recommendation tags such as acne, dryness, sensitivity, or barrier support. |
| `fran_sensitivity_flags` | Operational warning flags such as fragrance, essential oil, active acid, retinoid, or allergen. |
| `fran_return_policy_group` | Return policy grouping such as `standard`, `final_sale`, `exchange_only`, or `restricted`. |
| `fran_store_pickup_eligible` | Whether the product can be picked up in store. |
| `fran_3pl_fulfillment_profile` | Fulfillment profile for connector routing. |
| `restricted_product_flags` | Compliance or sales restrictions that POS/CRM should see. |

Product rows can say what a product is. Fran CRM decides who is eligible for points, rewards, advice, or customer-specific offers.

## Database Projection

Migration `045_fran_product_metadata.sql` adds:

- `public.fran_jsonb_bool(jsonb, text, boolean)`
- `public.fran_jsonb_text_array(jsonb, text)`
- `public.v_fran_product_context`

The view uses `security_invoker = true`, so product RLS still applies for authenticated clients. Server-side Fran routes can also compute the same context directly from `product_data`.

## Store-Ops Request Types

Fran-specific store-ops types are kept in request metadata and mapped onto the generic `store_replenishment_requests.request_type` enum:

| Fran type | Generic request type | Example |
|---|---|---|
| `warehouse_replenishment` | `manual` | Request warehouse replenishment for store stock. |
| `3pl_store_shipment` | `manual` | Request a 3PL shipment to a store. |
| `damaged_tester_sample` | `cycle_count` | Mark damaged tester or sample inventory for review. |
| `pos_inventory_reconciliation` | `pos_requested` | Reconcile POS sale, stock count, or availability mismatch. |
| `reward_stock_mismatch` | `manual` | Investigate reward product stock mismatch. |

The manager UI and generic store-ops tables remain reusable for other retailers and connectors.

## Operational Rules

- POS writes must be idempotent.
- POS sales and returns can preserve `crm_customer_id`, `crm_customer_ref`, `loyalty_member_ref`, `reward_ref`, `reward_commitment_ref`, and `return_ref` in metadata.
- Fran CRM product context is read-only product metadata; it is not a customer policy endpoint.
- 3PL credentials must never be exposed in browser payloads or manager UI.
- Fulfillment remains connector-based: Fran sales channels -> SKUMS order/inventory core -> fulfillment connector -> 3PL.
