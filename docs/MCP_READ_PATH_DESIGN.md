# MCP read path — agent analytics without a BI stack (Track RP)

**Date:** 2026-07-28
**Goal:** make the MCP read path trustworthy and cheap enough that marketers ask questions in natural language instead of learning PivotTables / Power BI / SQL.
**Depends on:** BR harvest (MH-*) producing data · Track K report registry (Rpt-0–6, shipped)

---

## Why this track exists

The strategy is right: for a team this size, a BI practice is the wrong shape of cost, and Track K already encodes the better pattern (*subscribe, don't spawn*). But the enabling condition is not met yet.

Measured on live data (6,827 snapshots, 2026-07-28):

| Symptom | Measurement |
|---|---|
| **Silent truncation** | `market_brand_listings { min_sold: 1000 }` returns **176** rows. DB truth: **910** distinct listings. At max `fetch_limit` it still only reaches 242. **668 invisible**, reported as complete. |
| **Token cost** | 100 rows = **22,220 tok**. 500 rows = **107,585 tok** — over half a 200k context in one call. |
| **Token waste** | `listing_url` alone = **26%** of payload. `listing_id` UUIDs = 6%. Columnar + 6 useful fields = **84% smaller** for identical data. |
| **Fetch waste** | 800 snapshots pulled to return 100. The window is 12% of the table today and shrinks weekly. |
| **Latency** | 60–230ms. **Not the problem.** |

Two conclusions that shape the whole plan:

1. **The database is not slow; the payload is.** For an LLM client, payload *is* latency — 107k tokens costs far more wall-clock in prefill than the 104ms query. Optimising SQL time would be optimising noise.
2. **A confident wrong answer is worse than the tool it replaces.** A marketer in a PivotTable sees a row count and sets their own filter. An LLM handed a silently truncated sample produces fluent, plausible, wrong output with no tell. Two of those incidents kills trust in the whole approach.

**Architectural correction:** the reflex "expose rows via MCP so the LLM can slice them" is wrong. LLMs are poor aggregators — non-reproducible, and wrong often enough to matter. Same principle `claude-forecast.md` reaches for forecasting: **the LLM is the context and orchestration layer, not the compute.** The pivot belongs in SQL; the model chooses which one and narrates it.

---

## Slices

### RP-1 — Push filters into SQL + honest truncation

**Why first:** correctness gate. Every number an agent currently reports through a `min_sold` / multi-brand / shelf / leaf filter is drawn from a recency-biased sample. Nothing downstream is worth building on top of a wrong answer, and no amount of speed work fixes it. Loud truncation is also the cheapest possible trust mechanism — an agent that *knows* it has a subset can say so.

Today only `brand_key`, `seller_type`, `since`, `until` reach SQL ([brandListingsQuery.mjs:310-359](../marketplace/brandListingsQuery.mjs#L310-L359)). Everything else is applied in JS *after* the window.

- Push to SQL: `min_sold`, `brand_keys[]`, `shop_username`, `shop_collection_name`, `platform_category_leaf`, `q`.
- Return `complete: boolean`, `total_matching: number`, `next_cursor`.
- Retire `fetch_limit` as a public knob — it exists only because filtering happens too late. Keep an internal safety cap.
- Keep `filterBrandListingRows` for the CSV/local-script path, but it must no longer be the primary filter.

**Files:** `marketplace/brandListingsQuery.mjs` · `server/api/v1/marketplace/brand-listings.get.ts` · `mcp/src/tools.mjs`
**Verify:** the 910-vs-176 case returns 910 (or a cursored page with `complete: false` and `total_matching: 910`).

### RP-2 — Denormalise hot filter fields + index them

**Why:** RP-1's filters cannot be fast, and `min_sold` cannot be range-scanned at all, while they live inside `signals` jsonb with **no GIN index**. Today `contains('signals', {brand_key})` walks the `(workspace_id, crawled_at)` index doing a heap check per row.

Real columns beat a GIN index here for three reasons: `min_sold` is a numeric range filter (jsonb containment can't do ranges); `brand_key`/shelf/leaf are equality (btree composite is cheaper than GIN); and only a real column lets Postgres satisfy `ORDER BY sold DESC LIMIT n` from the index instead of sorting.

- Migration **076**: add `brand_key`, `shop_username`, `shop_collection_name`, `platform_category_leaf` to `marketplace_listing_snapshots`; composite indexes on `(workspace_id, brand_key, sold_count_lower_bound desc)` and `(workspace_id, platform_category_leaf)`.
- Populate on write in `writers/upsertObservations.mjs` — keep `signals` as the source of truth, these are derived.
- Backfill script for existing rows.

**Files:** `core/db/076_*.sql` · `marketplace/writers/upsertObservations.mjs` · `scripts/backfill-snapshot-dimensions.mjs`
**Verify:** `explain analyze` shows an index scan, not a seq scan, on a `brand_key` + `min_sold` query.

### RP-3 — `latest per listing` view (delivers BR-A3)

**Why:** every consumer wants one row per listing, and today that dedupe happens in JS *after* transferring up to 2,000 rows ([dedupeSnapshotsByListing](../marketplace/brandListingsQuery.mjs#L76)). That JS dedupe is the entire reason the fetch window exists. Push it into SQL and the window problem disappears structurally rather than being tuned.

Second payoff: this view is the substrate for the velocity/decay work — you cannot difference a series without a reliable "current observation per listing" to compare against the previous one.

- `distinct on (listing_id) ... order by listing_id, sold_count_lower_bound desc, crawled_at desc`.
- Start as a **plain view**. Data is small; a materialized view adds refresh scheduling for no measured gain. Revisit only if latency shows up.

**Files:** `core/db/076_*.sql` (same migration) · `marketplace/brandListingsQuery.mjs`
**Verify:** row counts match the current JS dedupe on the same inputs.

### RP-4 — Aggregation-first tool (`market_brand_rollup`)

**Why:** this is the slice that actually replaces Power BI. Marketers' questions are overwhelmingly aggregate ("which shelf is moving", "top sellers by band", "what's new"). Serving those as rows forces the LLM to do arithmetic it is bad at, costs 22k+ tokens, and is non-reproducible run to run. Served as SQL aggregates it is correct, deterministic, and roughly constant-size regardless of how much data you have — which is the property that lets this scale to 84 brands and a year of weekly snapshots.

- `market_brand_rollup { group_by: shelf | platform_leaf | brand | sold_band | shop, metrics: [...] , filters }`.
- Computed with `group by` in SQL. No row transfer.
- Returns the grouped table plus `total_matching` so the agent can state coverage.

**Files:** new `marketplace/brandRollupQuery.mjs` · `mcp/src/tools.mjs` · `mcp/src/toolScopes.mjs` (scope `intel:read`, mirroring the GUI read scope) · `server/api/v1/marketplace/brand-rollup.get.ts`
**Verify:** rollup totals reconcile against a full row export for the same filter.

### RP-5 — Payload shaping (columnar + projections)

**Why:** measured 84% reduction on identical data, and for an LLM client that is the single largest latency and cost lever. Object-per-row repeats all 20 keys on every row; `listing_url` is a quarter of the payload and `listing_id` UUIDs are 6% the model never uses.

- Columnar: `{ columns: [...], rows: [[...], [...]] }`.
- Hoist fields that are constant for the result set (brand_key, shop_username, harvest date on a single-brand query) into a header instead of repeating per row.
- `fields` projection param; default projection excludes `listing_url`, `listing_id`, `crawled_at`.
- Return `url_template` once — Shopee URLs are reconstructible from `shop_id`/`item_id`.
- Omit nulls.

**Files:** `marketplace/brandListingsQuery.mjs` · `mcp/src/tools.mjs`
**Verify:** re-run the payload measurement; assert default 100-row response is under ~5k tokens.

### RP-6 — Metric definitions (the semantic layer)

**Why:** the gap nobody is assigned. Dropping BI does not remove the need to define metrics once — it just moves it. If "top seller" isn't encoded, the LLM picks a different definition per conversation (cumulative sold? velocity? per shelf?) and marketers will never notice the inconsistency. This is also what makes chat, Track K packs, and CSV export agree on the same number.

This is the actual replacement for "train marketers on Power BI": one person encodes definitions once, in code the tools read.

- Single module of named metric definitions (`top_seller`, `shelf_share`, `sold_band`, `wow_delta`), each with the SQL expression and a one-line human description.
- Consumed by RP-4's rollup, the **`marketplace.*` sections only** in Track K, and surfaced in `agentInstructions.mjs` so agents cite the definition they used.
- Explicitly record that `sold_count_lower_bound` is a **cumulative lifetime bucket**, not a rate — the single most misread field in this dataset.

**Scope guard:** `core/reports/sections.mjs` hosts both buckets. Touch only the `marketplace.*` handlers. Do **not** wire `inventory.*` / `finance.*` / `sales.*` sections into this module — those read our own ATS and belong to the other bucket.

**Files:** new `marketplace/metrics/definitions.mjs` · `core/reports/sections.mjs` (marketplace handlers only) · `mcp/src/agentInstructions.mjs`
**Verify:** the same metric name returns the same number via MCP, report pack, and CSV.

### RP-7 — Tool tiering + agent instructions

**Why:** the natural first call an agent makes today — `market_brand_listings` with no filter — is the 22k-token one. Tool defaults *are* the interface for an LLM; if the cheap path isn't the obvious one, it won't be taken.

- Default entry point becomes `market_brand_summary` / `market_brand_rollup`.
- Row-level fetch requires explicit narrowing (a brand, a shelf, or a cursor).
- Routing table in `agentInstructions.mjs`: aggregate question → rollup; "give me the sheet" → CSV export; single SKU → listings.
- Every response states coverage so agents stop implying completeness they don't have.

**Files:** `mcp/src/agentInstructions.mjs` · tool descriptions in `mcp/src/tools.mjs`
**Verify:** extend `tests/mcp-instructions.test.mjs`.

### RP-8 — Cache summaries per (workspace, brand, week)

**Why:** harvest data changes weekly at most, so repeated agent reads of the same summary should cost nothing. Deliberately **last** — caching before RP-1/4/5 change the response shapes would just cache wrong answers in the wrong format.

**Files:** `marketplace/brandRollupQuery.mjs` · optional cache table or `bi_digests` reuse
**Verify:** second identical call served from cache; invalidated by a new harvest write.

---

## Order and rationale

```
RP-1  correctness gate — nothing is trustworthy before this
RP-2  makes RP-1's filters actually fast (and min_sold possible)
RP-3  removes the structural cause of the window; substrate for velocity
RP-4  the Power-BI replacement — aggregate in SQL, not in the model
RP-6  pairs with RP-4: definitions must exist for rollups to mean anything
RP-5  the 84% token win — safe to do any time after RP-1
RP-7  makes agents actually use the cheap correct path
RP-8  last; caching shapes that are still changing is waste
```

RP-1 and RP-6 are the two that change whether the strategy works at all. RP-5 is the one that makes it pleasant.

## Explicit non-goals

| Not doing | Why |
|---|---|
| Raising row limits / `fetch_limit` | Treats a correctness bug as a capacity problem. More rows means more tokens and still-wrong filters. |
| Letting the LLM aggregate row sets | Non-reproducible and wrong often enough to matter. Aggregation is SQL's job. |
| A BI cube / semantic-layer product | Overkill at this size; RP-6 is a code module, not a platform. |
| Text-to-SQL over the warehouse | Unbounded query risk and no metric consistency. Parameterised rollups give the same reach with guardrails. |
| Caching before RP-1 | Would cache truncated answers. |

## Interaction with the harvest track

Two different truncations must stay distinguishable:

- **MH-12** marks a *harvest* as incomplete (captcha stopped collection).
- **RP-1** marks a *query* as incomplete (result exceeded a page).

Conflating them would let a captcha-truncated week read as a complete query result. Both flags must survive into the response an agent sees.
