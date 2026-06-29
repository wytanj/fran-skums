# SKUMS Phase 2: Operational Sync And Adapter Runtime

## Purpose

Phase 2 assumes Phase 1 has established the attention item, proposal, approval, and execution loop.

Phase 2 turns that loop into a real integration runtime. SKUMS should be able to connect to external commerce systems, ingest their changes, compare them against the graph, propose safe actions, and execute approved updates through typed adapters.

Core principle:

```text
SKUMS is not another catalog silo.
SKUMS is the control plane for catalog, listing, inventory, order, and operational sync.
```

## Phase 2 Outcome

By the end of Phase 2, SKUMS should be able to:

1. Run observable sync jobs for POS, Square-style catalogs, Shopify-style storefronts, and marketplace channels.
2. Store external object references without corrupting the canonical graph.
3. Detect drift between SKUMS and external systems.
4. Generate proposals for risky bidirectional changes.
5. Auto-execute explicitly safe low-risk operations.
6. Route inventory and order events through trade-unit-aware movements.
7. Offer a developer-ready webhook and event replay surface.
8. Give operators a sync console, proposal review queue, and connector health view.

## Workstream 1: Sync Runtime

Add generic sync infrastructure that every channel adapter can use.

New migration:

```text
core/db/043_sync_runtime.sql
```

Suggested tables:

```text
sync_jobs
  id
  workspace_id
  channel_id
  app_key
  direction
  sync_type
  status
  cursor
  high_water_mark
  started_at
  finished_at
  idempotency_key
  summary
  metadata

sync_job_steps
  id
  workspace_id
  sync_job_id
  step_type
  status
  input
  output
  error_message
  started_at
  finished_at

sync_conflicts
  id
  workspace_id
  sync_job_id
  channel_id
  conflict_type
  risk_level
  status
  local_object
  external_object
  proposed_resolution
  attention_item_id
  proposal_id
  metadata
  created_at

external_object_links
  id
  workspace_id
  channel_id
  external_system
  external_object_type
  external_object_id
  external_version
  skums_entity_type
  skums_entity_id
  direction
  last_seen_at
  metadata
```

API endpoints:

```text
GET  /api/v1/sync-jobs
POST /api/v1/sync-jobs
GET  /api/v1/sync-jobs/:id
POST /api/v1/sync-jobs/:id/cancel
GET  /api/v1/sync-conflicts
POST /api/v1/sync-conflicts/:id/proposals
```

Acceptance checks:

- Sync jobs are workspace-scoped.
- Sync jobs can be retried safely with idempotency.
- External object links can map Square/Shopify/marketplace IDs to SKUMS entities.
- Conflicts can generate attention items and proposals.

## Workstream 2: Adapter Runner

Move from static channel contracts to a runnable adapter framework.

Scope:

- Load registered `ChannelAdapter` implementations.
- Resolve credentials from workspace capability sources.
- Run pull, push, validate, and webhook steps through `sync_jobs`.
- Capture adapter errors as structured sync step failures.
- Enforce rate limits and retry policy per adapter.
- Emit `domain_events` for every material adapter action.

Suggested server modules:

```text
server/utils/adapters/registry.ts
server/utils/adapters/runner.ts
server/utils/adapters/credentials.ts
server/utils/adapters/sync-policy.ts
server/utils/adapters/conflicts.ts
```

Acceptance checks:

- Adapter execution is testable without network calls.
- Fixture adapters can produce pull deltas.
- Adapter validation errors become listing quality findings or attention items.
- No adapter writes directly to core graph tables without going through approved execution paths.

## Workstream 3: Square-Style Catalog Adapter

Promote the Phase 1 Square skeleton into a sandbox-ready adapter.

Scope:

- Support catalog pull from fixture and sandbox-like payloads.
- Map `ITEM`, `ITEM_VARIATION`, `CATEGORY`, `IMAGE`, `TAX`, `DISCOUNT`, `PRICING_RULE`, and custom attributes into SKUMS projections or external links.
- Treat Square item variations as sellable units, but do not assume they are canonical SKUMS trade units without review.
- Store Square IDs in `external_object_links`.
- Convert Square catalog mutations into `sync.external_update_detected` domain events.
- Create conflicts for price, SKU, variation, deletion, and category changes.

Non-goals:

- Do not process real merchant Square credentials without an explicit setup flow.
- Do not push destructive deletes to Square in Phase 2.
- Do not make Square the master catalog.

Acceptance checks:

- Fixture pull creates or updates staging rows, external links, and attention items.
- Price/channel conflicts become proposals.
- Deleted external objects do not delete SKUMS graph entities automatically.

## Workstream 4: First Storefront Or Marketplace Adapter

Build one additional adapter after Square-style catalog mapping is stable.

Preferred order:

1. Shopify-style owned storefront if the priority is common headless commerce compatibility.
2. Shopee or Lazada if the priority is SEA marketplace proof.

Scope:

- Implement pull-only first.
- Model listing requirements and quality findings.
- Detect drift against SKUMS listing projections.
- Generate proposals for publish/update actions.
- Use adapter fixtures before live credentials.

Acceptance checks:

- One real-world channel shape can produce listing findings.
- A listing finding can generate a proposal.
- A proposal can dry-run the outbound payload.

## Workstream 5: Trade-Unit-Aware Inventory Runtime

Move inventory from product-level adjustments toward graph-aware movement semantics.

New migration:

```text
core/db/044_inventory_movements_v2.sql
```

Suggested table:

```text
inventory_movements_v2
  id
  workspace_id
  product_identity_id
  trade_unit_id
  listing_id
  channel_id
  sku_assignment_id
  identifier_id
  location_id
  batch_id
  movement_type
  quantity
  base_quantity
  conversion_factor
  source_event_id
  source_app_key
  reference_type
  reference_id
  idempotency_key
  status
  metadata
  occurred_at
  created_at
```

Initial movement types:

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
external_sync
```

Acceptance checks:

- POS sale events can create movement proposals.
- Approved damage/found-stock events can create movement rows.
- Movements preserve graph refs and source event lineage.
- Idempotency prevents duplicate stock impact.

## Workstream 6: Approval Policies

Add workspace-level rules for when agents can execute automatically.

New migration:

```text
core/db/045_approval_policies.sql
```

Suggested concepts:

```text
approval_policies
  workspace_id
  policy_key
  applies_to
  risk_threshold
  auto_approve_conditions
  required_role
  enabled

approval_policy_evaluations
  proposal_id
  matched_policy_id
  decision
  reasons
  created_at
```

Initial policies:

- Auto-create attention item for unknown scan.
- Auto-stage import rows, never auto-write uncertain identity merges.
- Auto-accept read-only external sync facts.
- Require approval for price changes, deletes, merges, and channel publish.
- Require approval for stock adjustments over a workspace threshold.

Acceptance checks:

- Every proposal has a policy evaluation.
- Auto-execution is impossible without an enabled policy.
- Policy decisions are visible in proposal details.

## Workstream 7: Webhooks And Event Replay

Expose SKUMS as a headless platform for external apps and agents.

New migration:

```text
core/db/046_webhook_runtime.sql
```

Suggested tables:

```text
webhook_subscriptions
webhook_deliveries
event_replay_cursors
```

API endpoints:

```text
GET  /api/v1/events
POST /api/v1/webhook-subscriptions
GET  /api/v1/webhook-subscriptions
POST /api/v1/webhook-subscriptions/:id/test
POST /api/v1/events/replay
```

Acceptance checks:

- Events can be delivered with signed payloads.
- Failed deliveries retry with backoff.
- External apps can replay events from a cursor.
- Webhook delivery logs are inspectable.

## Workstream 8: Operator Console

Build the SKUMS UI needed to operate Phase 2.

Pages:

```text
app/pages/attention.vue
app/pages/proposals.vue
app/pages/sync.vue
app/pages/channels.vue
app/pages/developer/webhooks.vue
```

Acceptance checks:

- Operators can inspect attention items.
- Operators can review proposal diff, evidence, risk, and policy result.
- Operators can approve, reject, dry-run, and execute.
- Operators can inspect sync jobs and conflicts.
- Operators can test connector health.

## Execution Order

1. Add sync runtime migration and tests.
2. Add external object links and conflict model.
3. Build adapter runner with fixture adapter tests.
4. Promote Square adapter fixtures into sync jobs.
5. Add one storefront or marketplace adapter in pull-only mode.
6. Add inventory movement v2 and POS sale movement proposal path.
7. Add approval policies and policy evaluations.
8. Add webhook delivery and event replay.
9. Build operator console pages.
10. Update OpenAPI and developer docs.
11. Run `npm test`.
12. Run `npm run build`.

## Non-Goals

- Do not build full ERP replacement workflows.
- Do not support every marketplace in Phase 2.
- Do not enable destructive external writes by default.
- Do not auto-merge product identities without approval.
- Do not make payment processing a SKUMS core concern.
- Do not move scraping into the core runtime.

## Done Definition

Phase 2 is done when SKUMS can run this loop:

```text
external catalog or POS event
-> adapter runner
-> sync job
-> external object links
-> drift or finding
-> attention item
-> proposal
-> policy evaluation
-> approved execution
-> webhook/event replay
```

The demo path should show:

```text
Square-style catalog fixture changes price/SKU/category
-> SKUMS detects drift
-> proposal explains risk
-> operator approves
-> SKUMS updates graph or projection
-> POS receives refreshed catalog projection
```
