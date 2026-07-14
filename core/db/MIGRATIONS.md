# SKUMS Core Database Migrations

Run in order. All migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE`, etc.).

## Migration Order

| # | File | Domain | Notes |
|---|------|--------|-------|
| 001 | workspaces.sql | Workspaces, members, products, brands, categories, base RLS | Foundation. Run first. |
| 002 | dynamic_schema.sql | Dynamic product schemas | User-defined product field schemas. Run before brand schema extensions. |
| 003 | add_brand.sql | Brand table extension | Updates the seeded global dynamic schema. |
| 004 | canonical_forks.sql | Canonical/fork product manuals | Channel-specific override mechanism |
| 005 | fix_rls_recursion.sql | RLS helper functions | Fixes recursive RLS issues |
| 006 | fix_categories_rls.sql | Categories RLS fix | |
| 007 | fix_workspace_creation.sql | Workspace creation flow fix | |
| 008 | fix_workspace_select.sql | Workspace SELECT RLS fix | |
| 009 | team_permissions.sql | Permission schemas, area-based ACL | |
| 010 | api_keys.sql | Workspace API keys | |
| 011 | expiry.sql | Batch expiry tracking | |
| 012 | integration_framework.sql | Integration nodes, credentials, connections, executions, webhooks | n8n-style integration registry |
| 013 | image_support.sql | Image renditions, platform requirements | |
| 014 | assistant.sql | AI assistant tables | |
| 015 | organizations.sql | Organizations layer, org > workspace | Run before RLS that uses `get_my_admin_workspace_ids()` |
| 016 | inventory.sql | Inventory locations, levels, ledger, POs, transfers | Depends on workspaces |
| 017 | forecasting.sql | Demand forecasting | Depends on inventory ledger and purchase orders. |
| 018 | localization.sql | Locale/market projections | |
| 019 | product_quality.sql | Marketplace quality scoring v1 | |
| 020 | product_quality_v2.sql | Marketplace quality scoring v2 | |
| 021 | identity_spine.sql | Product identities, trade units, identifiers, scoped SKU assignments | Introduces SKU-as-contextual-label model |
| 022 | identity_spine_backfill.sql | Backfill and insert bridge for identity spine | Keeps existing product writes compatible |
| 023 | identity_graph_views.sql | Read compatibility views for product identity graph | Adds API-safe graph projection |
| 024 | identity_spine_update_bridge.sql | Update bridge from legacy product fields into identity spine | Keeps direct Supabase product edits coherent |
| 025 | sku_assignment_helpers.sql | RPC helpers for scoped SKU assignment and resolution | Centralizes SKU-as-context semantics |
| 026 | listings.sql | Channels, listings, listing identifiers, listing sync state | Makes marketplace/channel listings first-class |
| 027 | integration_listing_bridge.sql | Bridge existing integration sync mappings to listings | Lets old sync data resolve to listing records |
| 028 | import_jobs.sql | Server-side import staging for product graph writes | Prepares CSV/import pipeline for identity spine |
| 029 | audit_events.sql | Append-only audit/provenance events for graph tables | Adds traceability foundation |
| 036 | pos_core.sql | POS locations, registers, sales, scan resolution | First-party POS app primitives over product graph |
| 037 | app_platform.sql | App registry, workspace app enablement, capability sources, domain events, agent proposals | Agentic commerce core for POS, intelligence apps, connectors, and custom apps |
| 038 | auth_identity.sql | Auth profiles | Normalizes OAuth identity metadata for Google SSO |
| 039 | import_review_pipeline.sql | Import review metadata | Keeps changing XLSX formats staged and explicitly approved before graph writes |
| 040 | pos_inventory_events.sql | POS inventory event intake | Store-floor damage, found stock, and transfer receipt events into inventory workflows |
| 041 | product_attention_items.sql | Product attention queue | Turns POS, channel, import, and agent signals into human/agent-resolvable work items |
| 042 | channel_intelligence.sql | Channel intelligence | Channel capabilities, requirements, offers, content variants, promotions, fulfillment, fees, and listing findings |
| 043 | fulfillment_integrations.sql | Fulfillment integrations | Generic 3PL/WMS external entity mappings and WorldSyntech/OFS fulfillment app seed |
| 044 | store_operations.sql | Store operations | POS-originated replenishment requests, SKUMS replenishment orders, receiving sessions, and inventory exceptions |
| 045 | fran_product_metadata.sql | Fran product metadata | Fran product context view and JSON metadata normalizers for POS/CRM decisions |
| 046 | loyalty_pricing_inventory.sql | Fran loyalty pricing and inventory | POS basket quotes, stock reservations, quote-linked inventory holds, and inventory commit linkage |
| 047 | marketplace_intelligence.sql | Marketplace intelligence (BI collect) | Crawl seeds, jobs, shops, listings, snapshots, metrics, digests, alerts — Shopee-first competitive warehouse |
| 048 | study_pipeline.sql | Study sessions and pipeline candidates | Explore → propose → decide → promote into watchlist/catalog/purchase interest |
| 049 | internal_purchase_orders.sql | Internal (decision-layer) POs | Fran buying drafts from study/MCP — separate from inventory purchase_orders |
| 050 | projections.sql | Financial projection runs | Assumptions + engine results + optional Grok commentary |
| 051 | fix_create_workspace_overload.sql | Drop ambiguous 2-arg create_workspace | Keeps only (name, slug, org_id default null) so signup RPC resolves |
| 052 | audit_source_channels.sql | Expand audit_events.source_type | ui / mcp / assistant / cron / worker for M1 attribution |
| 053 | help_articles.sql | Platform Help Center articles | In-app `/help` + assistant `resolve_help`; seed upsert by slug |
| 054 | help_connect_claude.sql | Help: Connect Claude remote MCP | Phase R1 connector docs |
| 055 | loft_permissions_topology.sql | Loft store-ops permission schemas + LOFT-SG topology + app scopes | TODO-LOFT Phase P.0 / A.1; pull_products action; pos_connector app |
| 056 | store_ops_waves_inbox.sql | Waves Mon/Thu, HQ inbox, request decisions, delivery_mode | TODO-LOFT Phase B.0 / B.1 / B.1b |
| 057 | inbound_shipments.sql | KR/HK → Loft ASN lifecycle + lines | TODO-LOFT Phase D |

## Planned Phase C Spine

These will be added in upcoming work:

| # | File | Domain |
|---|------|--------|
| 030 | perspectives.sql | Perspective resolution table, role definitions |
| 031 | verification.sql | Brand verification tiers, GTIN lookup, domain verification |
| 032 | grants.sql | Grant chain: brand to distributor to retailer to channel seller |
| 033 | workspace_apps.sql | Per-workspace app enablement |
| 034 | webhook_subscriptions.sql | Outbound webhook system |
| 035 | channel_feeds.sql | Channel feed metadata and caching |

The POS core migration currently uses `036` to avoid occupying the planned Phase C spine slots.
The app platform migration currently uses `037` and supplies the neutral workspace app enablement layer originally planned for `033`, without making billing or packaging assumptions.

## How to Run

The repo has a local migration runner:

```sh
npm run db:migrate:status
npm run db:migrate -- --dry-run
npm run db:migrate -- --from 021 --to 029
npm run db:migrate -- --only 029
```

Required environment:

```sh
SUPABASE_DB_URL=postgresql://...
```

`DATABASE_URL` and `POSTGRES_URL` are also accepted. The runner uses the Node `postgres` driver, so no local `psql` install is required.

For Supabase projects where the direct database host resolves only to IPv6, use the pooler URI:

```sh
SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres
```

The runner records applied migrations in `public.skums_migrations` with a SHA-256 checksum. If a previously applied file changes, the runner stops with a checksum mismatch instead of silently reapplying changed SQL.

## App Migrations

Apps own their own SQL. After running all core migrations, run the migrations for any enabled apps:

- `apps/skincare/db/` - Skincare Intelligence app

See `apps/skincare/db/MIGRATIONS.md` for the skincare-specific run order.
