# Headless Commerce API

Phase 1 turns SKUMS into a headless, agent-friendly commerce core. POS, channel
connectors, imports, and agents should write durable events or attention items
instead of hiding exceptions inside app-specific workflows.

## Core Flow

1. A commerce app writes facts into SKUMS.
2. SKUMS emits a `domain_events` record for coordination.
3. If the fact needs human or agent review, SKUMS creates a
   `product_attention_items` record.
4. An agent can create an `agent_proposals` record from the attention item.
5. Operators approve, reject, dry-run, or execute the proposal.
6. Execution emits another domain event and resolves the attention item.

## Attention Items

Attention items are the shared work queue for product graph, listing, POS,
inventory, and channel exceptions.

- `GET /api/v1/attention-items`
- `POST /api/v1/attention-items`
- `POST /api/v1/attention-items/:id/resolve`
- `POST /api/v1/attention-items/:id/proposals`

Use `idempotency_key` when creating attention items from external systems. This
lets webhook, POS, and connector retries stay safe.

## Agent Proposals

Proposals are deterministic change plans. They should contain affected objects,
proposed steps, policy results, risk, and rollback metadata.

- `POST /api/v1/agent-proposals/from-attention-item`
- `POST /api/v1/agent-proposals/:id/dry-run`
- `POST /api/v1/agent-proposals/:id/execute`

Execution is approved-only. The execute endpoint emits
`agent_proposal.executed` and resolves the source attention item when the
proposal originated from one.

## POS as a Headless Commerce Source

The POS catalog endpoint now includes a stable `revision` and `updated_at` so
offline registers can decide whether they need to refresh items.

- `GET /api/v1/pos/catalog`
- `POST /api/v1/pos/sales`
- `POST /api/v1/pos/inventory-events`

Sales are idempotent by `idempotency_key` and emit either `pos_sale.completed`
or `pos_return.completed`. Inventory exceptions emit `pos.<event_type>` and
create attention items for pending approval or failed processing.

## Channel Intelligence

The channel intelligence migration adds reusable tables for:

- `channel_capabilities`
- `channel_requirements`
- `channel_offer_rules`
- `listing_content_variants`
- `promotion_events`
- `fulfillment_policies`
- `channel_fee_snapshots`
- `listing_quality_findings`

Use `resolve_channel_capabilities(workspace_id, channel_key, channel_id)` to
retrieve effective global and workspace channel requirements. Listing quality
findings can link back to attention items and proposals, which gives agents a
closed loop from detection to proposal to execution.

## Square Scaffold

`channels/square` defines the first Square POS channel boundary:

- `mapping.ts` maps SKUMS projected SKUs to Square catalog objects.
- `webhook.ts` normalizes Square catalog, inventory, and order webhooks.
- `adapter.ts` validates Square-required fields and exposes the registry
  contract without making live network calls yet.

Live Square OAuth, token storage, catalog upserts, order sync, and webhook
signature verification remain follow-up implementation work.
