# Major Update — Fran Market Intelligence, Study MCP & Ops MCP

**Status:** Approved — **Phase 0–5 landed**  
**Date:** 2026-07-10  
**Company context:** Fran (formerly LISE)  
**Related docs:**

- `docs/SHOPEE_CRAWLER_NEXT_STEPS.md`
- `docs/SCRAPING_DEPLOYMENT_OPTIONS.md`
- `docs/SCRAPE_WITH_GSTACK.md`
- `docs/WORLDSYNTECH_3PL_INTEGRATION_PLAN.md`
- `docs/POS_SKUMS_3PL_STORE_OPS_HANDOFF.md`
- `docs/fran-skums-contract.md`
- `docs/LOFT_SOW_KIV.md`

---

## 1. Purpose

Fran will run one platform with two continuous modes of use:

| Mode | Intent | Cadence |
|------|--------|---------|
| **A. Ongoing BI engine** | Always-on market radar (Shopee and later other marketplaces) | Daily / weekly seeds, digests, alerts |
| **B. Fran MCP** | Interactive agent/human surface to **study**, **decide**, and **act** | On demand |

MCP is not only for competitive research. It is also how Fran staff and agents will:

1. Study new products and decide whether to pipeline into catalog / purchasing / models  
2. Create **internal purchase orders** (draft → approve → execute)  
3. Generate **reconciliation reports** (POS vs warehouse vs 3PL vs channel signals)  
4. Produce **financial projections** (margin, sell-through proxies, scenario ranges)

**Grok API** is the judgment layer (briefs, matching, narratives, projection commentary).  
**Paid cloud browser / scrape services** (Cloudflare Browser Run, Browserbase, etc.) are the collect layer.  
**Supabase** remains the system of record for facts, jobs, and approvals.  
**SKUMS action APIs** remain the system of action (products, inventory, store-ops, LOFT/3PL).

---

## 2. Goals and non-goals

### Goals

- Continuous marketplace observation without a public competitor API  
- Seller-tier visibility (Mall / Preferred / Preferred+ / normal + dropship **signals**)  
- Daily and weekly **product pull** cadence per seed (keyword, shop, listing)  
- Study workflow: explore → evidence → propose → approve → pipeline  
- Ops workflow via MCP: internal POs, reconciliation packs, financial projections  
- Pluggable collect runtime (Cloudflare / Browserbase / other) behind one adapter  
- Grok grounded on stored evidence (no invented sold counts or prices)  
- Workspace-scoped auth, audit trail, promote-to-production gates  

### Non-goals (this major update)

- Using Shopee Open API for competitor monitoring (seller channel adapter stays separate)  
- Running full browser crawls inside Vercel request handlers  
- Letting Grok or MCP silently write to purchasing without approval states  
- Merging raw marketplace listings into canonical product identity without review  
- Replacing LOFT/WorldSyntech operational SOW processes (see `LOFT_SOW_KIV.md`)  
- Building every marketplace on day one (start **Shopee SG**, design multi-market)  

---

## 3. Architecture overview

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                     Fran Control Plane (SKUMS / Nuxt)                    │
│         UI · REST · auth · workspace · approvals · attention items       │
└─────────────┬───────────────────────────┬───────────────────┬────────────┘
              │                           │                   │
              ▼                           ▼                   ▼
┌─────────────────────┐     ┌─────────────────────────┐   ┌────────────────┐
│ Scheduler           │     │ Fran MCP Server         │   │ Action APIs    │
│ daily/weekly seeds  │     │ study · bi · purchase · │   │ products, PO,  │
│ digests · recon jobs│     │ recon · projections     │   │ store-ops, 3PL │
└─────────┬───────────┘     └────────────┬────────────┘   └───────▲────────┘
          │ enqueue                      │ read / propose         │ execute
          ▼                              ▼                        │
┌──────────────────────────────────────────────────┐              │
│              Job bus (Supabase jobs)             │              │
└──────────────────────┬───────────────────────────┘              │
                       ▼                                          │
┌──────────────────────────────────────────────────┐              │
│ Collectors (pluggable)                           │              │
│ Cloudflare Browser Run / Browserbase / …         │              │
│ Deterministic SERP + detail extractors           │              │
└──────────────────────┬───────────────────────────┘              │
                       ▼                                          │
┌──────────────────────────────────────────────────┐              │
│ Observation plane (facts)                        │              │
│ listings · snapshots · shops · study artifacts   │              │
└──────────────────────┬───────────────────────────┘              │
                       ▼                                          │
┌──────────────────────────────────────────────────┐              │
│ Grok intelligence plane                          │              │
│ enrich · match · brief · digest · project        │──────────────┤
└──────────────────────┬───────────────────────────┘   proposals  │
                       ▼                                          │
┌──────────────────────────────────────────────────┐              │
│ Decision plane                                   │──────────────┘
│ pipeline_candidates · purchase_orders (internal) │
│ recon_reports · projection_runs · audit          │
└──────────────────────────────────────────────────┘
```

### Three principles

1. **Facts ≠ judgment ≠ action**  
   Collect writes facts. Grok writes interpretations and drafts. Approvals write actions.

2. **Warehouse first**  
   MCP and BI share the same tables. Live scrape is async and exceptional.

3. **Explicit promotion**  
   Studying a Shopee listing never auto-creates a PO or catalog SKU without a candidate state machine.

---

## 4. Product surfaces

### 4.1 Ongoing BI engine (always on)

| Loop | Cadence | Output |
|------|---------|--------|
| Collect | Per-seed daily / weekly / cron | Snapshots |
| Normalize | On write | seller_type, price, sold bounds, rank |
| Enrich (Grok) | Post-collect / nightly | Clusters, narratives, seed suggestions |
| Score | Daily | Official share, undercut, local percentiles |
| Alert | Continuous | Attention items / Slack |
| Digest | Daily / weekly | Leadership brief with evidence refs |

**Seed types:** keyword SERP, official shop, listing detail watchlist, brand portfolio.

**Seller taxonomy:**

```text
mall | preferred_plus | preferred | official_brand | normal | unknown
```

**Dropship is signals, not a hard badge:** overseas ship, preorder, title clone of official, undercut %, thin shop history.

### 4.2 Fran MCP (interactive)

MCP tools fall into five capability packs:

| Pack | Purpose |
|------|---------|
| **Study** | Explore new products/brands; evidence; match catalog; pipeline propose |
| **BI** | Query snapshots, seller mix, history, export sheet tables |
| **Purchase** | Draft / revise / submit **internal** purchase orders |
| **Reconciliation** | Generate recon packs (POS ↔ inventory ↔ 3PL ↔ market signals) |
| **Projections** | Scenario financial projections (margin, sell-through proxy, cash) |

Agents (Grok/Claude/Cursor) and humans use the same tools; all writes are audited.

---

## 5. Capability detail

### 5.1 Study → pipeline

```text
study_start → market_search / live_refresh → study_brief (Grok)
  → study_match_catalog → pipeline_propose → pipeline_decide → pipeline_execute
```

**Pipeline kinds:**

| kind | Effect when executed |
|------|----------------------|
| `watchlist_seed` | Adds ongoing BI seed (daily/weekly collect) |
| `catalog_product` | Creates product draft + identity candidate |
| `purchase_interest` | Links to internal PO draft or buyer attention item |
| `price_model` | Registers price-watch / pricing model input |
| `forecast_input` | Registers external demand signal for forecasting |
| `supplier_research` | Stores sourcing notes (KR/HK → LOFT inbound later) |

### 5.2 Internal purchase orders

MCP creates **internal POs** owned by SKUMS (Fran buying workflow), not marketplace checkout.

```text
States: draft → pending_approval → approved → ordered
                 ↘ rejected          ↘ cancelled
                 ↘ sent_to_supplier (optional later)
```

Lines reference:

- Fran `product_id` when known  
- Or marketplace `listing_id` / study session when still pre-catalog  
- Qty, unit cost (buyer input or estimate), currency, needed_by, supplier note  

Grok may **suggest** qty/cost bands from market price + sell-through proxy; buyer confirms costs.

Execute path after approve:

- Attention item for purchasing  
- Optional link to LOFT inbound ASN when goods route KR/HK → Loft  
- Optional inventory expected-receipt record (phase 2)

### 5.3 Reconciliation reports

Generate structured packs, not one-off spreadsheets only:

| Report type | Compares |
|-------------|----------|
| `pos_vs_inventory` | POS sales/events vs `inventory_levels` / ledger |
| `warehouse_vs_3pl` | SKUMS warehouse availability vs WorldSyntech/Loft stock |
| `store_receive_vs_outbound` | Store receive vs Loft outbound (scenario 1 courier) |
| `market_vs_retail` | Shopee price/sold signals vs Fran retail/cost |
| `inbound_discrepancy` | ASN declared vs received (when LOFT data flows) |

Flow:

```text
recon_generate(type, period, locations…)
  → pull facts from DB
  → compute variances in code
  → Grok narrative + likely causes (grounded)
  → store recon_reports + line rows
  → MCP returns table + summary + export
```

### 5.4 Financial projections

Scenario engine with **code-first math** and **Grok commentary**:

| Input | Source |
|-------|--------|
| Unit cost | PO / buyer |
| Retail price | Catalog / study |
| Market price band | Snapshots |
| Sell-through proxy | Sold labels (bounded, uncertain) |
| Fees / shipping / returns % | Workspace assumptions table |
| Horizon | 4 / 12 / 26 weeks |

Outputs: revenue range, gross margin range, units, cash tied in stock, confidence, unknowns.

```text
projection_run
  assumptions jsonb
  results jsonb          -- computed in TypeScript
  grok_commentary jsonb  -- narrative only
  evidence_refs[]
```

---

## 6. Grok API role

| Use | Mode | Model guidance |
|-----|------|----------------|
| Study brief | Online (MCP) | Stronger |
| Catalog match candidates | Online / batch | Stronger |
| BI daily digest | Batch | Cheaper ok |
| Alert explanation | Batch | Cheaper ok |
| Recon narrative | Online / batch | Stronger |
| Projection commentary | Online | Stronger |
| Selector/layout discovery when scrape breaks | Ops only | Stronger — not ETL |

### Grounding contract (all Grok outputs)

```json
{
  "claims": [{ "text": "…", "evidence_ref": "snapshot:uuid|metric:…|recon_line:…" }],
  "unknowns": ["…"],
  "recommendation": { "action": "string", "confidence": 0.0 },
  "numbers_from_model_only": false
}
```

**Hard rule:** prices, ranks, sold labels, inventory qty, PO line costs come from DB/tools. Grok must not invent them. If missing → `unknowns`.

---

## 7. Collect runtime (cloud, paid)

| Concern | Choice |
|---------|--------|
| Browser host | Cloudflare Browser Run **or** Browserbase (adapter) |
| Session | Stored Shopee cookies in secrets; health check; re-auth runbook |
| Schedule | `daily` / `weekly` / `cron` / `manual` per seed |
| Concurrency | Serialize per country session |
| Vercel | Control plane + enqueue only |
| Worker | Long-running or CF Worker job consumer for browser |

`/crawl` “well-behaved site crawler” is **not** the Shopee SERP strategy. Use **scripted browser sessions** + network JSON intercept preferred over brittle CSS.

---

## 8. Data model (new tables)

Migration sketch (names finalizable in implementation):

```text
-- Collect / BI
marketplace_crawl_seeds
marketplace_crawl_jobs
marketplace_shops
marketplace_listings
marketplace_listing_snapshots
marketplace_metrics_daily
bi_alerts
bi_digests

-- Study
study_sessions
study_artifacts

-- Decision
pipeline_candidates

-- Ops MCP
internal_purchase_orders
internal_purchase_order_lines
recon_reports
recon_report_lines
projection_runs
projection_assumptions_defaults   -- workspace fee/return/shipping defaults

-- Shared
intelligence_audit_events         -- or reuse domain audit_events
```

### Key columns (summary)

**marketplace_crawl_seeds**

- `marketplace`, `country`, `mode` (`keyword|shop|listing|brand_portfolio`)
- `target`, `enabled`
- `schedule_kind` (`daily|weekly|cron|manual_only`), `schedule_cron`, `timezone`
- `max_pages`, `max_listings`, `detail_top_n`
- `next_run_at`, `last_success_at`, `priority`

**marketplace_listings**

- unique `(workspace_id, marketplace, country, shop_id, item_id)`
- `seller_type`, `shop_name`, `title`, `listing_url`, `first_seen_at`, `last_seen_at`

**marketplace_listing_snapshots**

- `price`, `original_price`, `currency`, `rating`, `review_count`
- `sold_label`, `sold_count_lower_bound`, `rank_position`, `search_query`
- `raw_observation` jsonb, `crawled_at`, `crawl_job_id`

**internal_purchase_orders**

- `status`, `supplier_name`, `currency`, `needed_by`
- `study_session_id?`, `notes`, `created_by`, `approved_by`
- `idempotency_key`

**recon_reports**

- `report_type`, `period_start`, `period_end`, `status`
- `summary_metrics` jsonb, `grok_narrative` jsonb, `evidence_refs`

**projection_runs**

- `horizon_weeks`, `assumptions` jsonb, `results` jsonb
- `grok_commentary` jsonb, `linked_po_id?`, `linked_study_id?`

---

## 9. MCP tool surface (consolidated)

### 9.1 Study

| Tool | Write? | Description |
|------|--------|-------------|
| `study_start` | yes | Open session with hypothesis |
| `study_get` | no | Session + artifacts |
| `market_search` | no* | Warehouse SERP; optional enqueue if stale |
| `market_listing_history` | no | Time series for listing |
| `market_seller_mix` | no | Badge mix for query/period |
| `study_live_refresh` | yes | Force collect job |
| `study_brief` | yes | Grok brief → artifact |
| `study_match_catalog` | yes | Match candidates → artifact |
| `pipeline_propose` | yes | Create pipeline candidate |
| `pipeline_list` | no | Filter candidates |
| `pipeline_decide` | yes | accept / reject / defer |
| `pipeline_execute` | yes | Run accepted candidate adapters |

\*may enqueue job (side effect) when refresh policy requires it.

### 9.2 BI / export

| Tool | Write? | Description |
|------|--------|-------------|
| `bi_list_seeds` | no | List crawl seeds |
| `bi_upsert_seed` | yes | Create/update seed + cadence |
| `bi_set_cadence` | yes | daily / weekly / cron |
| `bi_run_seed_now` | yes | Enqueue immediate job |
| `bi_job_status` | no | Job state |
| `bi_query_snapshots` | no | Filtered listing snapshots |
| `bi_export_table` | no | Sheet-ready rows (CSV/JSON) |
| `bi_latest_digest` | no | Latest Grok digest |

### 9.3 Internal purchase orders

| Tool | Write? | Description |
|------|--------|-------------|
| `po_create_draft` | yes | Header + lines |
| `po_update_draft` | yes | Edit while draft |
| `po_add_lines` | yes | From catalog and/or study listings |
| `po_suggest_qty` | no | Grok+rules suggestion (non-binding) |
| `po_submit` | yes | draft → pending_approval |
| `po_decide` | yes | approve / reject (role-gated) |
| `po_get` | no | PO detail |
| `po_list` | no | Filter by status/date |
| `po_export` | no | Sheet/PDF-oriented payload |

### 9.4 Reconciliation

| Tool | Write? | Description |
|------|--------|-------------|
| `recon_generate` | yes | Build report for type + period |
| `recon_get` | no | Report + lines |
| `recon_list` | no | History |
| `recon_explain` | yes | Grok narrative refresh on existing facts |
| `recon_export` | no | Sheet-ready variance table |

### 9.5 Projections

| Tool | Write? | Description |
|------|--------|-------------|
| `projection_create` | yes | Run code engine + optional Grok commentary |
| `projection_from_po` | yes | Project from internal PO |
| `projection_from_study` | yes | Project from study brief + cost inputs |
| `projection_get` | no | Results |
| `projection_list` | no | History |
| `projection_export` | no | Sheet-ready scenarios |

### 9.6 Auth scopes (suggested)

```text
intel:read
intel:write          -- seeds, live refresh
study:write
pipeline:propose
pipeline:decide
pipeline:execute
po:draft
po:submit
po:decide
recon:generate
projection:run
```

---

## 10. Code that will be written

Layout below is the **intended tree**. Implementation should follow this structure so collectors, Grok, and MCP stay swappable.

### 10.1 Repository layout

```text
fran-skums/
├── Major Update.md                          # this document
├── docs/
│   └── FRAN_MARKET_INTELLIGENCE_ARCHITECTURE.md   # optional slim pointer to this file
│
├── core/db/
│   ├── 047_marketplace_intelligence.sql     # seeds, jobs, shops, listings, snapshots
│   ├── 048_study_pipeline.sql               # study_sessions, artifacts, pipeline_candidates
│   ├── 049_internal_purchase_orders.sql
│   ├── 050_recon_and_projections.sql
│   └── MIGRATIONS.md                        # register order
│
├── packages/
│   └── @skums-types/
│       ├── marketplace-intelligence.ts      # DTOs: seed, listing, snapshot, seller_type
│       ├── study-pipeline.ts
│       ├── internal-po.ts
│       ├── recon.ts
│       ├── projection.ts
│       └── index.ts                         # re-exports
│
├── marketplace/                             # NEW domain package (not a sales channel)
│   ├── _types.ts
│   ├── _registry.ts                         # CollectAdapter registry
│   ├── sellerTaxonomy.ts                    # mall/preferred/normal + signals
│   ├── soldLabel.ts                         # "4.5k+" → lower bound
│   ├── identityMatch.ts                     # rule-based pre-Grok match helpers
│   │
│   ├── collectors/
│   │   ├── types.ts                         # CollectAdapter interface
│   │   ├── cloudflare-browser-run/
│   │   │   ├── client.ts
│   │   │   ├── session.ts                 # cookie inject / health
│   │   │   └── adapter.ts
│   │   ├── browserbase/                     # optional second adapter
│   │   │   └── adapter.ts
│   │   └── mock/
│   │       └── adapter.ts                   # fixtures for tests
│   │
│   ├── shopee/
│   │   ├── urls.ts
│   │   ├── parseSearch.ts                   # network JSON / DOM fallback
│   │   ├── parseListingDetail.ts
│   │   ├── parseShop.ts
│   │   └── fixtures/                        # recorded payloads
│   │
│   ├── normalize/
│   │   ├── snapshot.ts
│   │   └── metrics.ts                       # official share, undercut, percentiles
│   │
│   └── writers/
│       ├── upsertListings.ts
│       └── insertSnapshots.ts
│
├── intelligence/                            # NEW — Grok + decision helpers
│   ├── grok/
│   │   ├── client.ts                        # Grok API wrapper
│   │   ├── contracts.ts                     # Zod schemas for grounded outputs
│   │   ├── studyBrief.ts
│   │   ├── catalogMatch.ts
│   │   ├── biDigest.ts
│   │   ├── reconNarrative.ts
│   │   └── projectionCommentary.ts
│   ├── pipeline/
│   │   ├── propose.ts
│   │   ├── decide.ts
│   │   └── execute/
│   │       ├── watchlistSeed.ts
│   │       ├── catalogProduct.ts
│   │       ├── purchaseInterest.ts
│   │       ├── priceModel.ts
│   │       └── forecastInput.ts
│   ├── po/
│   │   ├── createDraft.ts
│   │   ├── submit.ts
│   │   ├── decide.ts
│   │   └── suggestQty.ts
│   ├── recon/
│   │   ├── engines/
│   │   │   ├── posVsInventory.ts
│   │   │   ├── warehouseVs3pl.ts
│   │   │   ├── storeReceiveVsOutbound.ts
│   │   │   └── marketVsRetail.ts
│   │   └── generate.ts
│   └── projection/
│       ├── engine.ts                        # pure TS math
│       └── run.ts
│
├── mcp/                                     # NEW — Fran MCP server
│   ├── package.json
│   ├── README.md
│   ├── src/
│   │   ├── index.ts                         # stdio or HTTP transport
│   │   ├── auth.ts                          # API key → workspace + scopes
│   │   ├── server.ts                        # tool registration
│   │   ├── tools/
│   │   │   ├── study.ts
│   │   │   ├── bi.ts
│   │   │   ├── purchaseOrders.ts
│   │   │   ├── recon.ts
│   │   │   └── projections.ts
│   │   └── format/
│   │       └── tables.ts                    # sheet-ready row builders
│   └── wrangler.toml                        # optional if hosted on CF
│
├── workers/                                 # NEW — cloud job consumers
│   └── marketplace-worker/
│       ├── package.json
│       ├── src/
│       │   ├── index.ts                     # claim loop / queue consumer
│       │   ├── schedulerTick.ts             # due seeds → jobs
│       │   ├── runCollectJob.ts
│       │   ├── runEnrichJob.ts              # Grok batch digests
│       │   └── healthSession.ts
│       ├── Dockerfile                       # if Fly/Railway/Cloud Run
│       └── README.md
│
├── server/
│   ├── api/
│   │   ├── v1/
│   │   │   ├── marketplace/
│   │   │   │   ├── seeds.get.ts
│   │   │   │   ├── seeds.post.ts
│   │   │   │   ├── seeds/[id].patch.ts
│   │   │   │   ├── seeds/[id]/run.post.ts
│   │   │   │   ├── jobs.get.ts
│   │   │   │   ├── listings.get.ts
│   │   │   │   ├── snapshots.get.ts
│   │   │   │   └── digests.get.ts
│   │   │   ├── study/
│   │   │   │   ├── sessions.post.ts
│   │   │   │   ├── sessions/[id].get.ts
│   │   │   │   └── sessions/[id]/brief.post.ts
│   │   │   ├── pipeline/
│   │   │   │   ├── candidates.get.ts
│   │   │   │   ├── candidates.post.ts
│   │   │   │   └── candidates/[id]/decide.post.ts
│   │   │   ├── purchase-orders/
│   │   │   │   ├── index.get.ts
│   │   │   │   ├── index.post.ts
│   │   │   │   ├── [id].get.ts
│   │   │   │   ├── [id].patch.ts
│   │   │   │   ├── [id]/submit.post.ts
│   │   │   │   └── [id]/decide.post.ts
│   │   │   ├── recon/
│   │   │   │   ├── index.get.ts
│   │   │   │   ├── generate.post.ts
│   │   │   │   └── [id].get.ts
│   │   │   └── projections/
│   │   │       ├── index.get.ts
│   │   │       ├── index.post.ts
│   │   │       └── [id].get.ts
│   │   └── internal/
│   │       └── marketplace/
│   │           ├── scheduler-tick.post.ts   # cron secret
│   │           └── worker-heartbeat.post.ts
│   └── utils/
│       ├── grok.ts                          # shared server Grok client if needed
│       └── marketplaceAccess.ts
│
├── app/
│   └── pages/
│       └── intelligence/                    # optional UI phase
│           ├── index.vue                    # BI overview
│           ├── seeds.vue
│           ├── study.vue
│           ├── purchase-orders.vue
│           ├── recon.vue
│           └── projections.vue
│
└── tests/
    ├── marketplace-seller-taxonomy.test.mjs
    ├── marketplace-sold-label.test.mjs
    ├── marketplace-parse-shopee.test.mjs
    ├── marketplace-metrics.test.mjs
    ├── study-pipeline.test.mjs
    ├── internal-po.test.mjs
    ├── recon-pos-vs-inventory.test.mjs
    ├── projection-engine.test.mjs
    └── mcp-tool-auth.test.mjs
```

### 10.2 Core interfaces (illustrative code)

These are **design sketches** for the implementation PR — not applied yet.

```ts
// marketplace/collectors/types.ts
export type SellerType =
  | 'mall'
  | 'preferred_plus'
  | 'preferred'
  | 'official_brand'
  | 'normal'
  | 'unknown'

export interface CollectSeed {
  id: string
  workspace_id: string
  marketplace: 'shopee'
  country: string
  mode: 'keyword' | 'shop' | 'listing' | 'brand_portfolio'
  target: string
  max_pages: number
  max_listings: number
  detail_top_n: number
}

export interface ObservedListingCard {
  shop_id: string
  item_id: string
  title: string
  listing_url: string
  shop_name?: string
  seller_type: SellerType
  price?: number
  original_price?: number
  currency: string
  rating?: number
  review_count?: number
  sold_label?: string
  sold_count_lower_bound?: number
  rank_position: number
  search_query?: string
  signals?: Record<string, boolean | number | string>
  raw: Record<string, unknown>
}

export interface CollectAdapter {
  id: string
  scrapeSeed(seed: CollectSeed, jobId: string): Promise<{
    cards: ObservedListingCard[]
    details?: Record<string, unknown>[]
    session_health: 'ok' | 'login_required' | 'blocked' | 'unknown'
  }>
}
```

```ts
// intelligence/grok/contracts.ts
export interface GroundedGrokResult {
  claims: Array<{ text: string; evidence_ref: string }>
  unknowns: string[]
  recommendation: { action: string; confidence: number }
  /** Must be false — numbers must come from tools/DB */
  numbers_from_model_only: false
}
```

```ts
// intelligence/projection/engine.ts (pure — no I/O)
export interface ProjectionInput {
  unit_cost: number
  retail_price: number
  market_price_p50?: number
  units_per_week_low: number
  units_per_week_high: number
  horizon_weeks: number
  payment_fees_pct: number
  shipping_per_unit: number
  returns_pct: number
  currency: string
}

export interface ProjectionResult {
  revenue_low: number
  revenue_high: number
  cogs: number
  contribution_low: number
  contribution_high: number
  margin_pct_low: number
  margin_pct_high: number
  cash_tied_units: number
  currency: string
}
```

```ts
// mcp/src/server.ts (tool registration concept)
// registerTool('study_brief', studyBriefHandler)
// registerTool('po_create_draft', poCreateDraftHandler)
// registerTool('recon_generate', reconGenerateHandler)
// registerTool('projection_create', projectionCreateHandler)
// registerTool('bi_export_table', biExportTableHandler)
```

### 10.3 Worker loop (illustrative)

```ts
// workers/marketplace-worker/src/index.ts
async function main() {
  // 1) Optional: run schedulerTick() if this process owns cron
  // 2) Claim next marketplace_crawl_jobs row (pending)
  // 3) adapter = getCollectAdapter(job.collector_id)
  // 4) result = await adapter.scrapeSeed(seed, job.id)
  // 5) if session_health !== 'ok' → fail job, alert, stop
  // 6) upsert listings + insert snapshots
  // 7) enqueue enrich job (Grok digest if seed.priority high / nightly batch)
  // 8) mark complete, set seed.last_success_at / next_run_at already set by scheduler
}
```

### 10.4 MCP → action flow (PO example)

```text
po_create_draft
  → intelligence/po/createDraft.ts
  → insert internal_purchase_orders (status=draft)

po_submit
  → status=pending_approval

po_decide(approve)
  → status=approved
  → optional attention item for buyer ops
  → does NOT auto-call Loft until explicit inbound workflow

projection_from_po
  → load PO lines + market snapshots if linked
  → intelligence/projection/engine.ts
  → optional Grok commentary
  → store projection_runs
```

### 10.5 What we deliberately do **not** rewrite

| Existing | Relationship |
|----------|----------------|
| `server/utils/scrapers/shopee.ts` | Keep for product-quality “first hit” until replaced; **do not** grow into BI |
| `server/api/skincare/crawl.post.ts` | Pattern donor for jobs/logs; separate domain |
| `fulfillment/worldsyntech-ofs` | Downstream of approved buy + inbound; not scrape |
| `channels/*` | Authorized seller push/pull; not competitor BI |
| `server/api/quality/*` | Product quality scoring; may later **read** marketplace metrics |

---

## 11. API surface (HTTP, for UI and non-MCP clients)

Mirror MCP capabilities for the Fran web app:

```text
# Marketplace BI
GET/POST    /api/v1/marketplace/seeds
PATCH       /api/v1/marketplace/seeds/:id
POST        /api/v1/marketplace/seeds/:id/run
GET         /api/v1/marketplace/jobs
GET         /api/v1/marketplace/listings
GET         /api/v1/marketplace/snapshots
GET         /api/v1/marketplace/digests

# Study / pipeline
POST        /api/v1/study/sessions
GET         /api/v1/study/sessions/:id
POST        /api/v1/study/sessions/:id/brief
GET/POST    /api/v1/pipeline/candidates
POST        /api/v1/pipeline/candidates/:id/decide
POST        /api/v1/pipeline/candidates/:id/execute

# Internal POs
GET/POST    /api/v1/purchase-orders
GET/PATCH   /api/v1/purchase-orders/:id
POST        /api/v1/purchase-orders/:id/submit
POST        /api/v1/purchase-orders/:id/decide

# Recon / projections
POST        /api/v1/recon/generate
GET         /api/v1/recon
GET         /api/v1/recon/:id
POST        /api/v1/projections
GET         /api/v1/projections/:id

# Internal cron
POST        /api/internal/marketplace/scheduler-tick
```

---

## 12. Phased delivery (recommended)

### Phase 0 — Foundations (1 PR)

- Migrations 047–048 (marketplace + study/pipeline skeleton)  
- Types package  
- Mock collector + unit tests for sold label + seller taxonomy  
- Scheduler tick that only enqueues  

### Phase 1 — Shopee collect MVP

- Cloudflare or Browserbase adapter  
- Session secret + health  
- Keyword SERP parse for `shopee.sg`  
- Upsert listings/snapshots  
- One seed: e.g. `anua official` daily  

### Phase 2 — BI read path + export

- Snapshots query API  
- Metrics daily job  
- `bi_export_table`  
- Optional simple UI table  

### Phase 3 — Grok study + pipeline

- `study_*` + `pipeline_*`  
- Grok brief + match contracts  
- Execute: watchlist seed + catalog draft only  

### Phase 4 — MCP server v1

- Auth scopes  
- Study + BI tools  
- Document connection for Grok/Cursor agents  

### Phase 5 — Internal POs + projections

- PO state machine + APIs + MCP tools  
- Projection engine + `projection_from_po` / `from_study`  

### Phase 6 — Reconciliation packs

- `pos_vs_inventory` first  
- `warehouse_vs_3pl` when Loft pull is reliable  
- Grok narratives + export  

### Phase 7 — Hardening

- Weekly deep vs daily shallow policies  
- Alerts, budgets, multi-keyword brand packs  
- Second country (e.g. PH) only after SG stable  

---

## 13. Environment & secrets

```text
GROK_API_KEY
GROK_API_BASE_URL                 # if non-default
MARKETPLACE_COLLECTOR=cloudflare|browserbase|mock
CLOUDFLARE_ACCOUNT_ID             # if CF Browser Run
CLOUDFLARE_API_TOKEN              # Browser Run permission
BROWSERBASE_API_KEY               # if Browserbase
SHOPEE_SG_SESSION_JSON            # cookies / storage state
MARKETPLACE_CRON_SECRET
MCP_API_KEYS                      # or per-workspace keys in DB
QUEUE_PROCESSOR_KEY               # reuse pattern from quality queue
SUPABASE_SERVICE_ROLE_KEY         # worker writes
```

---

## 14. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Shopee blocks datacenter browsers | Pluggable adapter + residential proxy vendor if needed |
| Session expiry | Health check, pause seeds, alert, re-auth runbook |
| Grok invents market stats | Grounding contract + schema validation + unit tests |
| MCP over-permissioned | Fine-grained scopes; decide ≠ execute |
| PO treated as supplier order | Naming: **internal** PO; status stops at approved until ops integration |
| Cost runaway (browser + tokens) | Per-workspace budgets; daily shallow / weekly deep |
| Legal / ToS | Internal BI only; rate limits; no resale of scraped data |
| Confusion with seller channel | Separate `marketplace/` vs `channels/shopee` |

---

## 15. Success criteria

1. **Ongoing engine:** scheduled seed completes without laptop; snapshots visible next morning.  
2. **Seller mix:** Mall / Preferred / normal visible for a keyword SERP export.  
3. **Study MCP:** agent produces brief with evidence_refs; user accepts watchlist seed.  
4. **Internal PO:** draft → approve via MCP; appears in API/UI; audited.  
5. **Recon:** one `pos_vs_inventory` report for a date range with variance lines.  
6. **Projection:** from PO or study, numeric engine results + optional Grok commentary, exportable.  
7. **No silent action:** no catalog/PO/3PL mutation without candidate or PO state transition.

---

## 16. Decision log

| Decision | Options | Choice | Date |
|----------|---------|--------|------|
| Where to start | Phase 0 … 7 | **Phase 0 foundations** | 2026-07-10 |
| Collect vendor v1 | Cloudflare Browser Run / Browserbase / other | **mock first**; real vendor in Phase 1 | 2026-07-10 |
| MCP transport | stdio local / hosted HTTP / both | Deferred to Phase 4 | |
| First country | SG only / SG+PH | **SG first** (schema multi-country) | 2026-07-10 |
| PO approval roles | which workspace roles | Deferred to Phase 5 | |
| UI in phase 1 | API+MCP only / include Vue pages | **API + worker first**; UI later | 2026-07-10 |
| Grok model IDs | brief vs digest | Deferred to Phase 3 | |

---

## 17. Approval / progress

| Role | Name | Approve? | Date |
|------|------|----------|------|
| Product / Fran | User | Yes — proceed | 2026-07-10 |
| Engineering | Agent start Phase 0 | Yes | 2026-07-10 |

### Phase 0 delivered

- Migrations `047_marketplace_intelligence.sql`, `048_study_pipeline.sql` (+ Supabase mirrors)
- `@skums/types` marketplace + study-pipeline contracts
- `marketplace/` pure modules: soldLabel, sellerTaxonomy, scheduler, mock collector
- Scheduler tick: `POST /api/internal/marketplace/scheduler-tick`
- Seeds/jobs API: `GET/POST /api/v1/marketplace/seeds`, `POST .../seeds/:id/run`, `GET .../jobs`
- Tests: `tests/marketplace-intelligence-phase0.test.mjs`

### Phase 1 delivered

- Shopee SERP parse (`marketplace/shopee/*`) + fixtures
- Writers: `upsertObservationCards` → shops / listings / snapshots
- Collectors: `shopee_puppeteer` (Puppeteer + optional `SHOPEE_SG_SESSION_JSON`), `cloudflare_browser_run` (CF Browser Rendering)
- Job runner: `POST /api/internal/marketplace/process-jobs`
- Read path: `GET /api/v1/marketplace/snapshots`
- Tests: `tests/marketplace-intelligence-phase1.test.mjs`
- Migrations **047–048 applied** to configured database

### Phase 2 delivered

- `marketplace/normalize/metrics.mjs` — seller mix, official share, undercut vs Mall, CSV/table builders
- `POST /api/internal/marketplace/metrics-tick` → `marketplace_metrics_daily`
- `GET /api/v1/marketplace/metrics`
- `GET /api/v1/marketplace/export` (JSON + CSV + summary)
- Richer filters: listings, snapshots (price, seller_type, overseas, date range)
- `PATCH /api/v1/marketplace/seeds/:id` for cadence changes
- Tests: `tests/marketplace-intelligence-phase2.test.mjs`

### Phase 3 delivered

- `intelligence/grok/*` — grounded contracts, offline brief, xAI client (brief + match rerank)
- `intelligence/match/catalogMatch.mjs` — rule-based catalog candidates
- `intelligence/pipeline/execute.mjs` — watchlist + catalog payload builders, status guards
- Study APIs: sessions CRUD-ish, brief, match, propose-from-brief
- Pipeline APIs: candidates propose/list/decide/execute
- Execute kinds: **`watchlist_seed`**, **`catalog_product`** (draft product)
- Offline path works without `XAI_API_KEY`; live Grok when key present
- Tests: `tests/marketplace-intelligence-phase3.test.mjs`

### Phase 4 delivered

- `mcp/` stdio MCP server (`@modelcontextprotocol/sdk`)
- Tools: study_* , market_*, pipeline_*, bi_* (22 tools)
- Env: `FRAN_MCP_WORKSPACE_ID`, optional `FRAN_MCP_SCOPES`, uses `XAI_API_KEY` + Supabase service role
- Run: `npm run mcp` / `node mcp/src/index.mjs`
- Docs: `mcp/README.md`
- Tests: `tests/marketplace-intelligence-phase4.test.mjs`

### Phase 5 delivered

- Migrations `049_internal_purchase_orders`, `050_projections` (applied)
- Internal PO lifecycle: draft → pending_approval → approved/rejected
- Projection engine (pure) + Grok commentary optional
- HTTP: `/api/v1/purchase-orders/*`, `/api/v1/projections/*`
- MCP tools: `po_*`, `projection_*`
- Workspace helper: `node scripts/print-workspace-id.mjs`
- Tests: `tests/marketplace-intelligence-phase5.test.mjs`

### Next (Phase 6)

- Reconciliation packs (POS vs inventory, warehouse vs 3PL, etc.)

---

## Changelog

| Date | Note |
|------|------|
| 2026-07-10 | Initial consolidated Major Update: BI engine, Study MCP, Grok, cloud collect, internal POs, recon, projections, full code layout. |
| 2026-07-10 | Approved; Phase 0 foundations implemented (schema, types, mock collector, scheduler enqueue, seed APIs, tests). |
| 2026-07-10 | Phase 1: Shopee parse, writers, puppeteer + CF collectors, process-jobs, snapshots API; DB migrations applied. |
| 2026-07-10 | Phase 2: daily metrics, export table/CSV, richer BI filters, seed patch; service role smoke path. |
| 2026-07-10 | Phase 3: Grok/offline study brief, catalog match, pipeline propose/decide/execute (watchlist + catalog draft). |
| 2026-07-10 | Phase 4: Fran MCP stdio server with BI + study + pipeline tools. |
| 2026-07-10 | Phase 5: internal POs + financial projections (HTTP + MCP); workspace id helper script. |
