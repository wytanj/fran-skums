# SKUMS Phase 1: Agentic Headless Commerce Core

## Purpose

Phase 1 turns SKUMS into the operational brain for POS, storefronts, marketplaces, supplier files, and Square-like systems.

The goal is not to clone Square POS or Swell storefront commerce. The goal is to make SKUMS the headless graph, event, proposal, approval, and execution layer that those systems can safely consume.

Core principle:

```text
External systems emit facts.
SKUMS resolves graph meaning.
Agents propose operational changes.
Humans approve risky intent.
Typed tools execute deterministic consequences.
```

## Reference Inputs

- Local SKUMS foundations:
  - `product_identities`, `trade_units`, `identity_identifiers`, `sku_assignments`
  - `channels`, `listings`, `listing_identifiers`, `listing_sync_states`
  - `import_jobs`, `import_job_rows`
  - `audit_events`
  - `domain_events`, `agent_proposals`, `approval_requests`, `agent_execution_logs`
  - POS APIs under `server/api/v1/pos/*`
- Local POS repo foundations:
  - SKUMS graph refs on cart lines and sale payloads
  - SKUMS catalog import and sale write path
  - POS inventory event write path
  - saved baskets, partial returns, provider-neutral receipt email connector
- Square reference model:
  - Catalog item library with items, item variations, modifiers, categories, discounts, taxes, pricing rules, images, custom attributes
  - Catalog batch upserts, pagination, idempotency keys, external reference IDs
  - `catalog.version.updated` webhook and begin-time sync pattern
  - Square warning that bidirectional sync has concurrency, merge, duplicate, deletion, and channel-price risks

## Phase 1 Outcome

By the end of Phase 1, SKUMS should be able to:

1. Serve POS-ready catalog projections without making POS own the product truth.
2. Resolve scans across identifiers, SKU assignments, and listing identifiers.
3. Accept POS sales and store every line against graph references.
4. Accept POS floor events and route risky inventory changes into approval.
5. Create product attention items from imports, sync drift, scan ambiguity, listing gaps, and POS events.
6. Generate first-class agent proposals from those attention items.
7. Execute approved low-risk proposals through typed tools with idempotency and execution logs.
8. Support a Square-style external catalog adapter without treating Square as canonical.

## Workstream 1: Product Attention Queue

Add a first-class queue for operational issues that need human or agent action.

New migration:

```text
core/db/041_product_attention_items.sql
```

Suggested table:

```text
product_attention_items
  id
  workspace_id
  attention_type
  risk_level
  status
  source_type
  source_app_key
  source_event_id
  proposal_id
  product_identity_id
  trade_unit_id
  listing_id
  channel_id
  sku_assignment_id
  identifier_id
  product_id
  variant_id
  title
  summary
  recommended_action
  evidence
  metadata
  assigned_to
  resolved_by
  resolved_at
  created_at
  updated_at
```

Initial `attention_type` values:

```text
scan.ambiguous_identifier
scan.no_match
import.duplicate_identity_candidate
import.missing_trade_unit
listing.required_field_missing
listing.channel_drift_detected
inventory.damage_reported
inventory.found_stock_reported
inventory.transfer_receipt_unmatched
sale.graph_refs_missing
sync.external_update_detected
```

API endpoints:

```text
GET  /api/v1/attention-items
POST /api/v1/attention-items
POST /api/v1/attention-items/:id/resolve
POST /api/v1/attention-items/:id/proposals
```

Acceptance checks:

- Items are workspace-scoped.
- Items can link to graph entities and source events.
- Duplicate events can be deduped with idempotency metadata.
- Attention items can point to an agent proposal.
- Tests cover RLS intent, indexes, and API scope behavior.

## Workstream 2: Agent Proposal Generator

Build deterministic proposal generators before adding any autonomous execution.

Initial generators:

```text
scan_ambiguity_resolution
listing_required_field_repair
inventory_event_review
import_duplicate_identity_review
external_catalog_drift_review
```

Each proposal must include:

```text
intent_summary
affected_objects
proposed_steps
data_diff
risk_level
policy_result
approval_required
rollback_metadata
metadata.evidence
metadata.source_attention_item_id
```

API endpoints:

```text
POST /api/v1/agent-proposals/from-attention-item
POST /api/v1/agent-proposals/:id/dry-run
POST /api/v1/agent-proposals/:id/execute
```

Execution rule:

```text
Only approved proposals execute writes.
Low-risk proposals may be auto-approved only after explicit workspace policy exists.
Every execution writes agent_execution_logs and domain_events.
```

Acceptance checks:

- A proposal can be generated from one attention item.
- A proposal can be dry-run without writes.
- Approved execution is idempotent.
- Failed execution keeps enough error detail to retry safely.

## Workstream 3: Channel Intelligence Primitives

Add the data layer that lets SKUMS understand channel constraints instead of treating every connector as a custom script.

New migration:

```text
core/db/042_channel_intelligence.sql
```

Suggested tables:

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

Initial scope:

- Model requirements and findings for POS and Square-style catalogs first.
- Keep marketplace-specific details data-driven.
- Add a generic channel capability resolver.
- Do not build full Shopee/Lazada/Square sync yet.

Acceptance checks:

- Requirements can be attached to a channel and category-like scope.
- A listing can have quality findings.
- Findings can generate attention items.
- Required-field findings can generate agent proposals.

## Workstream 4: POS API Hardening

Strengthen the existing POS API as the first headless consumer contract.

Existing endpoints to harden:

```text
GET  /api/v1/pos/catalog
POST /api/v1/pos/scan
POST /api/v1/pos/sales
POST /api/v1/pos/inventory-events
```

Changes:

- Keep catalog pagination capped at `limit <= 250`.
- Keep `has_more` and `next_offset`.
- Add stable `revision` or `updated_at` metadata on catalog rows.
- Add idempotency enforcement to sale writes.
- Emit `domain_events` for `pos.sale.completed`, `pos.sale.returned`, and POS inventory events.
- Convert unresolved inventory events into `product_attention_items`.
- Add OpenAPI coverage for every POS route.

Acceptance checks:

- Existing POS tests still pass.
- New tests cover duplicate sale idempotency.
- New tests cover sale domain event emission.
- New tests cover inventory event to attention item routing.

## Workstream 5: Square-Style Adapter Skeleton

Build a Square adapter skeleton as a model for third-party POS/catalog systems, not as the canonical source.

Suggested location:

```text
channels/square/
  README.md
  adapter.ts
  mapping.ts
  webhook.ts
  fixtures/
```

Scope:

- Map Square `CatalogItem` to SKUMS product/listing projection.
- Map Square `CatalogItemVariation` to SKUMS trade unit or listing sellable unit.
- Map Square SKU/custom attributes to contextual `sku_assignments` and external reference IDs.
- Model Square catalog mutations as `domain_events`.
- Create attention items for drift and conflicts.
- Do not perform live Square OAuth or production writes in Phase 1.

Acceptance checks:

- Fixture mapping tests prove Square item/variation data can become a graph proposal.
- Webhook fixture creates `sync.external_update_detected`.
- A drift fixture creates an agent proposal instead of silently overwriting SKUMS.

## Workstream 6: Developer-Facing Headless Contract

Make the API shape usable by POS, custom apps, and external agents.

Deliverables:

- Update `server/api/v1/openapi.get.ts`.
- Update `app/types/index.ts`.
- Add examples for POS catalog, scan, sale, inventory event, attention item, proposal dry-run, and proposal execution.
- Add a short `docs/headless-commerce-api.md`.

Acceptance checks:

- OpenAPI includes the new attention and proposal endpoints.
- POS shared types can be updated without ad hoc shape guessing.
- A developer can understand which APIs are read-only, proposed-write, and direct-write.

## Execution Order

1. Add `product_attention_items` migration and tests.
2. Add attention item API routes.
3. Wire POS inventory unresolved/pending events into attention items.
4. Add proposal generator from attention item.
5. Add proposal dry-run and execute routes.
6. Add channel intelligence migration and required-field finding flow.
7. Add Square adapter skeleton and fixtures.
8. Update OpenAPI and docs.
9. Run `npm test`.
10. Run `npm run build`.

## Non-Goals

- Do not build a full Square clone.
- Do not make Square the source of truth.
- Do not silently run bidirectional sync.
- Do not build full marketplace connectors yet.
- Do not move scraping into the core.
- Do not build a new POS UI in SKUMS.

## Done Definition

Phase 1 is done when a POS or Square-style external event can move through this loop:

```text
external fact
-> domain_event
-> product_attention_item
-> agent_proposal
-> approval
-> deterministic execution
-> agent_execution_log
-> audit/domain event trail
```

The demo path should show:

```text
Unresolved POS inventory damage or Square catalog drift
-> SKUMS attention item
-> proposed fix
-> approval
-> graph/catalog update
-> execution log
```
