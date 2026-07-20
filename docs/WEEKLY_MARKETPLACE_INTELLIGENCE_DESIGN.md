# Design: Weekly Marketplace Intelligence Tool (Brand Radar)

**Product:** Fran SKUMS — Mode A (ongoing BI engine)  
**Track labels:** Unpark **brand radar** from `TODO.md`; extend Track **G** (collect) + Track **K** (reports)  
**Status:** Design for implementation (~2–4 weeks incremental PRs; pilot gate stricter — see PR Plan)  
**Date:** 2026-07-20 (rev 3 — re-review fixes)  
**Primary marketplace:** Shopee SG (`country=sg`)  
**Brand universe source:** `sample-brands.csv` (126 data rows; **125 unique** brands; House of Hur dual-category only)

---

## 1. Problem & goals

### Problem

Fran needs an **always-on marketplace competitive radar** for a known brand universe (K-beauty / C-beauty portfolio), not open-web crawl of everything. Mode B (study/pipeline) is partially built; Mode A digests and brand portfolio collect are not productized. Brand radar is currently **parked** in `TODO.md` while scrape reliability was fixed around **Windows Chrome + warm cookies**.

Operators and leadership need a **Monday morning weekly pack**: price/sold proxies, Mall vs reseller pressure, new listings, catalog gaps, and grounded narrative — without auto-purchasing or inventing numbers.

### Goals

1. Import `sample-brands.csv` as the initial **brand universe** and generate crawl seeds.
2. Run a **weekly** collect batch realistic for human-maintained Shopee sessions on a Windows worker.
3. Normalize facts into existing warehouse tables (`marketplace_*`, `marketplace_metrics_daily`).
4. Produce a **weekly digest** via the **report registry** (track K), not a third parallel digests product.
5. Ground Grok judgment on warehouse metrics/snapshots only.
6. Allow “interesting brand/listing → study or watchlist seed” via existing pipeline (suggest ≠ execute).
7. Scale pilot (10–15) → mid (50) → full CSV (~125) → multi-country later.

### Non-goals (v1)

| Non-goal | Why |
|----------|-----|
| Daily collect for all ~125 brands | Session ops cost; captcha risk; weekly is the product cadence |
| iHerb live scrape | CSV `iHerb` is catalog-of-interest only in v1 |
| PH/MY/ID multi-country SERP | Shopee SG first; design for extension only |
| Shopee Open API competitor monitoring | Forbidden / wrong product surface |
| Auto catalog create, PO, Loft, approve | Facts ≠ judgment ≠ action |
| LLM as source of truth for price/sold | Explicitly forbidden |
| Cloud Linux browser as primary (Browserbase Developer, CF primary) | Failed / demoted; see §11 |
| Vercel serverless browser batch | No Chrome binary; timeouts; control plane only |
| Chrome extension as crawl engine | Cookie export later only (G3) |
| Hwahae/OliveYoung / skincare crawl revival | Separate domain; weekly v1 does not depend on it |
| Replacing Marketing/Warehouse/Finance packs | New pack sits beside them |
| New permission scope `marketplace:write` | Use existing **`intel:write`** (seed APIs already do) |

---

## 2. Personas & weekly workflow

| Persona | Needs from weekly pack | Primary surface |
|---------|------------------------|-----------------|
| **HQ buyer / inventory manager** | Undercuts, sold proxies, catalog gaps, promote-to-study | `/reports`, MCP `reports_*` / `bi_*` |
| **Marketer** | Brand visibility, Mall share, new hero SKUs | Report pack + export CSV |
| **Ops owner (session keeper)** | Collect health, captcha/login_required, cookie refresh | Marketplace jobs UI + Windows worker console |
| **Leadership** | 1-page narrative + top 5 moves | Markdown summary / Phase N inbox |

### Canonical week (Asia/Singapore)

**User decision (2026-07-20):** collect is a **“week of”** window — brands do **not** all need to run on a single Sunday night. Batching may spread across the week for session health and ops convenience. The **report period** still keys off a week identity (Sunday `metric_date` / most recent week boundary), aggregating whatever snapshots exist for that week.

```text
Mon–Sun (week of)  Ops may run process-jobs / weekly script in slices (pilot brands first,
                   or resume after captcha). Prefer completing the brand set before Monday pack.
                   Cookies: refresh whenever login_required/blocked appears (not only Thu–Sat).
Optional Sun evening  Full catch-up pass: scheduler-tick → process-jobs → metrics-tick → weekly-digest
Mon 08:00 SGT         Report cron / manual: run pack marketplace-brand-weekly
                      (uses most recent Sunday metric_date ≤ today SGT; partial weeks OK with gates)
Mon AM                Buyer + marketing read pack; promote candidates via study/pipeline (list only)
Mon–Wed               Deep dives (study sessions) on promoted brands/listings only — human-opened
```

**Who runs collect (locked):** Windows worker calling **production internal APIs** (`MARKETPLACE_CRON_SECRET`). Script: `scripts/windows-marketplace-weekly.ps1` (or `.mjs` wrapper) may run multiple times per week; metrics/digest are idempotent per `week_key`. See KD-13.  
**Who “owns” Monday read:** HQ buyer (primary), marketing (share/newness), owner (session ops).

---

## 3. Architecture (reuse map)

Lock Major Update principles:

1. **Facts ≠ judgment ≠ action**
2. **Warehouse first** — MCP/BI/reports share tables; live scrape is async
3. **Explicit promotion** — no auto catalog/PO from scrape
4. **Vercel = control plane only**
5. **Shopee Open API ≠ competitor monitoring**

```text
 sample-brands.csv
        │
        ▼ import (one-shot + re-import)
 marketplace_brand_universe  ──links──► marketplace_crawl_seeds
        │   (flags, category, tier)        mode=brand_portfolio
        │                                  schedule_kind=weekly
        ▼
 ┌──────────────────────────────────────────────────────────┐
 │ Windows worker (Track G primary)                         │
 │  scripts/windows-marketplace-weekly.ps1                  │
 │  scheduler-tick → process-jobs (stop_batch) → metrics    │
 │  cookies: SHOPEE_SG_SESSION_JSON / cookie file           │
 └────────────────────────┬─────────────────────────────────┘
                          ▼ facts (signals.brand_key stamped)
 marketplace_shops / marketplace_listings / marketplace_listing_snapshots
                          ▼
 marketplace_metrics_daily  (dimension_type: query | brand)
                          ▼ judgment
 bi_digests (digest_kind=weekly, period-keyed, idempotent)
                          ▼ delivery
 report_templates slug=marketplace-brand-weekly
 report_subscriptions (toggle, disabled-by-default) → report_runs
   runReportSections(marketplace.* real | else stub)
   Phase N in_app · MCP reports_* · n8n webhook
                          ▼ action (human only)
 study session (opened by human) → pipeline propose → decide → execute
```

### Existing building blocks (do not redesign)

| Layer | Path / API | Role |
|-------|------------|------|
| Collect | `marketplace/collectors/shopee-puppeteer` | Primary live SERP |
| Collect registry | `marketplace/collectors/registry.mjs` | mock / BB / CF |
| Scheduler | `marketplace/scheduler.mjs` | daily/weekly/cron next_run; **preferred_hour = UTC** today |
| Writers | `marketplace/writers/upsertObservations.mjs` | shops/listings/snapshots |
| Metrics pure | `marketplace/normalize/metrics.mjs` | seller mix, undercut, export |
| Metrics job | `POST /api/internal/marketplace/metrics-tick` | upsert `marketplace_metrics_daily` |
| Job runner | `POST /api/internal/marketplace/process-jobs` → `processMarketplaceJobs` | claim + collect (must gain stop_batch) |
| Seed APIs | `/api/v1/marketplace/seeds*` | CRUD + run; scope **`intel:write`** |
| Types | `packages/@skums-types/marketplace-intelligence.ts` | modes include `brand_portfolio` |
| Study | `intelligence/*`, `/api/v1/study/*`, `/api/v1/pipeline/*` | Mode B |
| Reports | `core/reports/*`, `server/utils/reportRegistry.ts`, mig **066** | Track K; today always `runStubSections` |
| BI digests table | `bi_digests` (047) | Judgment artifact (no period unique today) |
| MCP | `bi_*` (`intel:read`/`intel:write`), `reports_*` (`reports:*`) | Agent surface |

### Integration path decision (locked)

**Primary delivery = report registry pack** `marketplace-brand-weekly` with real section handlers over the warehouse.

**Secondary artifact = `bi_digests`** one row per workspace×Sunday-metric_date×marketplace×country (grounded Grok brief + evidence_refs). `week_key` = collect **Sunday metric_date** (`YYYY-MM-DD`), not ISO week. Section `marketplace.grok_brief` selects by **most recent Sunday ≤ today SGT**, never inserts digests itself. Do **not** invent a third digests product. `/reports` remains the operator toggle surface.

Rationale: Track K Rpt-0–5 already shipped scopes, UI, cron, MCP, n8n. `bi_digests` exists in mig 047; MCP `bi_latest_digest` reads it but currently has no `digest_kind` filter — extend in PR-6.

**Scopes (locked):** Brand-universe write APIs and seed materialize use **`intel:write`** (same as `seeds.post.ts` / `seeds/[id].patch.ts` / `run.post.ts`). Read paths use **`intel:read`**. Report pack uses existing **`reports:read|run|write`**. MCP brand metrics = existing `bi_list_metrics` with `dimension_type=brand` — **no new scopes**.

---

## 4. Brand universe model

### 4.1 CSV shape & parse rules (`sample-brands.csv`)

**File quirks:** Leading empty column on every line; first data-ish header row may be `,,,,,,,,`; skip lines with empty Brand.

| Column | Use in v1 |
|--------|-----------|
| No. | Import order / display sort (ignore numbering anomaly e.g. Dr. Reju-All = 50) |
| Brand | Canonical display name + seed `target` base |
| Category | Split on `/` then trim → `categories[]` (e.g. `Skincare/ Cosmetics` → `['Skincare','Cosmetics']`) |
| Country | Origin (Korea/China/Indonesia) — **not** marketplace country |
| Official | `Yes`→true, `No`→false, **blank→null (unknown)** — not the same as No |
| ShopeeMall | Yes/No/blank same tristate → bool or false if blank for interest priority only |
| iHerb | Catalog-of-interest only — **no scrape** |
| Followers Count | Sparse metadata (**only COSRX filled** in CSV today) — soft hint only |

**Stats:** Skincare 67 · Cosmetics 38 · Hair/Body 20 · dual-category row 1 (Glad2Glow) · Korea 116 · China 9 · Indonesia 1. Official Yes ~83 · ShopeeMall Yes ~85 · iHerb Yes ~74. **House of Hur** two rows (skincare + cosmetics) → one brand_key. **Innisfree is not in CSV.**

#### Boolean / tristate parse

| CSV cell | Stored |
|----------|--------|
| `Yes` / `yes` | `true` |
| `No` / `no` | `false` |
| blank / whitespace | `null` for Official → **unknown** (single SERP query; do not invent official variant). ShopeeMall/iHerb blank → `false` for interest flags |

#### Category parse (locked)

Naive `split('/')` is **wrong** for CSV value `Hair / Body` (20 rows) — that is a **single** category label with spaces around `/`, not two categories.

```js
function parseCategories(raw) {
  const s = String(raw || '').trim()
  if (!s) return []
  // Dual only: Glad2Glow-style "Skincare/ Cosmetics" (slash merge of two categories).
  // "Hair / Body" is a single multi-word label — never free-split on '/'.
  if (/^skincare\s*\/\s*cosmetics$/i.test(s)) {
    return ['Skincare', 'Cosmetics']
  }
  return [s] // includes "Hair / Body", "Skincare", "Cosmetics", etc.
}
```

**Golden tests (PR-1):**

| CSV Category | categories[] |
|--------------|--------------|
| `Skincare` | `['Skincare']` |
| `Cosmetics` | `['Cosmetics']` |
| `Hair / Body` | `['Hair / Body']` (one element) |
| `Skincare/ Cosmetics` | `['Skincare','Cosmetics']` |
| `Skincare/Cosmetics` | `['Skincare','Cosmetics']` |

**Rule of thumb:** default = single-element array of trimmed full string. Split **only** for known dual patterns (`Skincare` + `Cosmetics` with slash). Never free-split on every `/`.

### 4.2 `brand_key` slug function (locked)

```js
/**
 * Deterministic brand_key for universe unique constraint + metrics dimension_key.
 * Shared by import script, materialize, tests.
 */
function brandKeyFromDisplayName(name) {
  return String(name)
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    // strip apostrophes / right-single-quote (d'Alba, I'm from)
    .replace(/[''\u2019]/g, '')
    // strip stylized colons (Su:m37 → sum37)
    .replace(/:/g, '')
    // non-alphanumeric → hyphen (periods, spaces, slashes, ampersands)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
```

**Golden examples (unit tests required):**

| display_name | brand_key |
|--------------|-----------|
| Anua | `anua` |
| House of Hur | `house-of-hur` |
| d'Alba | `dalba` |
| I'm from | `im-from` |
| Su:m37 | `sum37` |
| Dr. Reju-All | `dr-reju-all` |
| Cell Fusion C | `cell-fusion-c` |
| COSRX | `cosrx` |
| Glad2Glow | `glad2glow` |
| Beauty of Joseon | `beauty-of-joseon` |

Re-import must produce the same keys forever.

### 4.3 New table: `marketplace_brand_universe`

Catalog `public.brands` (mig 001) is **Fran product brand** for SKU organization — do not overload it for competitive radar flags.

```sql
-- core/db/068_marketplace_brand_universe.sql  (067 is latest; 068 free)
create table if not exists public.marketplace_brand_universe (
  id                    uuid primary key default uuid_generate_v4(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,

  brand_key             text not null,  -- brandKeyFromDisplayName(display_name)
  display_name          text not null,
  categories            text[] not null default '{}',
  origin_country        text,
  official_interest     boolean,        -- null = unknown (blank CSV)
  shopee_mall_interest  boolean not null default false,
  iherb_interest        boolean not null default false,
  followers_note        text,

  marketplace           text not null default 'shopee',
  country               text not null default 'sg',
  pilot_tier            text not null default 'paused'
    check (pilot_tier in ('pilot', 'mid', 'full', 'paused')),
  enabled               boolean not null default true,
  priority              integer not null default 100,

  primary_seed_id       uuid references public.marketplace_crawl_seeds(id) on delete set null,
  metadata              jsonb not null default '{}',
  source                text not null default 'sample-brands.csv',
  imported_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (workspace_id, marketplace, country, brand_key)
);
```

RLS: same pattern as other `marketplace_*` (members read; writable workspaces manage).

**Default `pilot_tier=paused`:** import never auto-activates crawl. Pilot allowlist sets `pilot` explicitly.

### 4.4 Seed generation rules

For each enabled brand with `pilot_tier` in the requested materialize set (`pilot` | `mid` | `full`):

| Field | Value |
|-------|--------|
| `marketplace` | `shopee` |
| `country` | `sg` |
| `mode` | `brand_portfolio` |
| `target` | Primary SERP string = `display_name` exactly (e.g. `Anua`, `d'Alba`) |
| `schedule_kind` | `weekly` |
| `weekly_day` | `0` (Sunday UTC dow) default |
| `preferred_hour` | **`10` = 10:00 UTC** (≈ 18:00 SGT). **v1 scheduler treats preferred_hour as UTC** (`atPreferredHourUtcApprox` in `marketplace/scheduler.mjs`); seed `timezone` column is **not applied** by computeNextRunAt today. Document in materialize + runbook. Do **not** set hour as if local SGT. Optional: store `metadata.preferred_hour_note: "UTC"` |
| `timezone` | `Asia/Singapore` (display/docs only until scheduler is IANA-aware — **out of v1**) |
| `max_pages` | pilot `2` · mid/full `2` |
| `max_listings` | pilot `30` · mid/full `40` |
| `detail_top_n` | **`0`** — collectors **must skip detail phase entirely** when `detail_top_n <= 0` (see §5.2) |
| `collector_id` | `shopee_puppeteer` prod Windows; `mock` in CI |
| `priority` | See priority rule below |
| `metadata` | See below |

```json
{
  "brand_key": "anua",
  "display_name": "Anua",
  "categories": ["Skincare"],
  "origin_country": "Korea",
  "official_interest": true,
  "shopee_mall_interest": true,
  "iherb_interest": true,
  "query_variants": ["Anua"],
  "universe_id": "<uuid>",
  "source": "sample-brands.csv",
  "preferred_hour_note": "UTC"
}
```

**Query strategy (locked for pilot / v1):**

1. **Exactly one SERP** per brand: `target` = `display_name`. No second `"Brand official"` query in pilot/mid by default.
2. `metadata.query_variants` = `[display_name]` only. Mid+ may add adaptive official variant later (open product choice; not default).
3. Stamp **durable brand identity on every card** (see §5.2) — never depend on parsing `search_query` alone for brand rollup.

**Dedup House of Hur:** one `brand_key=house-of-hur`, merge categories on re-import (`array_union`).

**Seed priority rule (locked):**

```js
// Raise priority if either Official interest or ShopeeMall interest is true.
// Official=null (unknown) + ShopeeMall=true → 120 (e.g. Skintific, Glad2Glow when Mall Yes).
// Official=false + ShopeeMall=false → 80.
// Official=true + ShopeeMall=false → 120.
priority =
  official_interest === true || shopee_mall_interest === true ? 120 : 80
```

**Official unknown (null):** Skintific, AHC, Su:m37, Sulwhasoo, Glad2Glow — single SERP query only (no official variant). Priority still follows the rule above (Mall Yes → 120).

### 4.5 Materialize transaction steps (PR-2)

```text
for each universe row in filter:
  1. upsert marketplace_crawl_seeds on
       (workspace_id, marketplace, country, mode, target)
     with mode=brand_portfolio, target=display_name, metadata.brand_key + universe_id
  2. update marketplace_brand_universe.primary_seed_id = seed.id
  3. never delete seeds on re-import; never clear snapshots
```

Orphan risk if step 2 skipped — implement as sequential awaits in one API handler; tests assert both directions: `seed.metadata.universe_id` and `universe.primary_seed_id`.

### 4.6 Import API / script

| Surface | Contract |
|---------|----------|
| Script | `scripts/import-brand-universe.mjs` — service role |
| API | `POST /api/v1/marketplace/brand-universe/import` scope **`intel:write`** |
| Body | multipart CSV or `{ rows: [...] }`; `dry_run` flag |
| Behavior | upsert by `(workspace_id, marketplace, country, brand_key)`; does **not** auto materialize seeds |
| Idempotent | Re-import refreshes flags/categories; does not delete snapshots or seeds |

Do **not** auto-enable all 125 seeds on first import. Materialize is gated by `pilot_tier` + explicit activate.

**v1 multi-workspace:** Import/materialize against the **single primary Fran workspace** ops uses in production; schema remains workspace-scoped for multi-tenant correctness, but runbook assumes one workspace for pilot.

---

## 5. Collect strategy (weekly cadence)

### 5.1 Runtime (locked — Track G)

| Role | Choice |
|------|--------|
| Primary | Local **Windows Chrome** + `shopee_puppeteer` + warm `SHOPEE_SG_SESSION_JSON` / `SHOPEE_USE_COOKIE_FILE=1` |
| Control plane | Vercel: seeds, jobs queue, metrics-tick, reports, UI |
| Worker topology | **Task Scheduler → production internal HTTP APIs** with `MARKETPLACE_CRON_SECRET` (not local Nuxt dual DB) |
| Orchestration script | `scripts/windows-marketplace-weekly.ps1` (required deliverable; PR-3 ships stop_batch + smoke; PR-7 hardens runbook) |
| Not primary | Browserbase Linux, CF Browser Rendering as primary, Vercel browser, bare fetch |

**Supersedes older Major Update phrasing** that described paid cloud browsers as the default collect layer for Shopee SERP. Track G (2026-07-17) is the lock: Windows warm session primary; cloud browsers experimental/fallback only.

### 5.2 brand_portfolio mode + card stamping

Today collectors treat targets as **keyword SERP**. Schema already allows `mode=brand_portfolio`.

**v1 behavior:**

```text
if mode in (keyword, brand_portfolio):
  brand_key = seed.metadata.brand_key || brandKeyFromDisplayName(seed.target)
  universe_id = seed.metadata.universe_id || null
  query = seed.target   # single query in pilot
  SERP scrape → for each card:
    card.search_query = seed.target          # human-readable SERP string
    card.signals.brand_key = brand_key       # durable join key (required)
    card.signals.universe_id = universe_id
    card.raw.brand_key = brand_key           # belt-and-suspenders for writers
  if detail_top_n <= 0: skip all detail navigations (no product page loads)
return CollectResult + session_health
```

**Writer contract:** `upsertObservationCards` persists `signals` onto `marketplace_listing_snapshots.signals` (already jsonb). Metrics brand rollup groups by `signals.brand_key` (primary), fallback `job.seed_id → seed.metadata.brand_key` if signals missing on legacy rows.

**Never** group brand metrics by string-equality of `search_query` to `display_name` alone (breaks `Anua official` variants, case, punctuation).

**detail_top_n:** Contract: `detail_top_n <= 0` ⇒ **zero detail navigations**. Mock + puppeteer unit/integration tests assert no detail phase. Default materialize uses `0`.

### 5.3 Batch stop contract (critical — changes processMarketplaceJobs)

**Today:** `server/utils/marketplaceCollect.ts` on `session_health != ok` fails the job, updates seed `last_error`, then **`continue`s** to the next pending job — which burns the queue after captcha.

**Required behavior (PR-3):**

1. On `session_health ∈ {login_required, blocked}` for a job:
   - Fail that job (`status=failed`, error `session_health=…`).
   - Update seed `last_error`, bump `consecutive_failures`.
   - Set process result flags: `stop_batch: true`, `stop_reason: session_health`.
   - **`break` out of the claim loop** — do not claim/process further jobs in this invocation.
2. Additionally cancel remaining **pending** jobs for the same `workspace_id` that are `brand_portfolio` (or all marketplace pending for that workspace in the weekly window) with `status=cancelled`, `error=batch_stopped:session_health=…` so Task Scheduler loops that re-call process-jobs do not drain them.
3. Response shape:

```json
{
  "ok": true,
  "claimed": 1,
  "completed": 0,
  "failed": 1,
  "stop_batch": true,
  "stop_reason": "session_health=blocked",
  "results": [{ "job_id": "…", "status": "failed", "session_health": "blocked" }]
}
```

4. Windows script: after each process-jobs call, if `stop_batch === true`, **break the process-jobs loop only** (do **not** exit the process). Log “refresh cookies; re-run with -Resume”. Then **always** continue to metrics-tick and weekly-digest (see §13 script control flow). Exit code reflects stop at the **end** of the script.
5. Resume after cookie refresh: ops re-enables cancelled jobs or runs materialize/enqueue for brands without `last_success_at` on this `metric_date` (see §5.5 resume).
6. Tests: enqueue N=5 mock jobs; first returns blocked → only 1 failed, 4 cancelled or unclaimed, `stop_batch` true; **integration/script test:** after stop_batch, metrics-tick and weekly-digest still invoked.

Non-session failures (parse error, write error) still `continue` (or fail single job) so one bad seed does not halt the week.

**Partial week invariant:** `stop_batch` stops **further collect**, never aggregation or digest. Snapshots already written must still roll into `marketplace_metrics_daily` and a partial `bi_digests` / Monday pack (`collect_health` red, WoW gated).

### 5.4 Volume budget & wall-time breakdown

| Phase | Brands | Pages/brand | Listings/brand | Est. SERP loads | Wall time |
|-------|--------|-------------|----------------|-----------------|-----------|
| Pilot | 12–15 | 2 | 30 | ~24–30 | **30–60 min** measured goal from smoke |
| Mid | ~50 | 2 | 40 | ~100 | 2–4 h |
| Full | ~125 | 2 | 40 | ~250 | split **Sat + Sun** required for P3 |

**Wall-time composition (full ~125, no captcha):**

| Component | Estimate |
|-----------|----------|
| Inter-seed delay `SHOPEE_INTER_SEED_MS` default 8000 × 125 | ~17 min pure wait |
| Per-page navigation + parse + humanDelay (~2–5 s × 2 pages) | ~10–20 min |
| Browser cold start / session attach | ~1–5 min |
| Captcha / manual unblock contingency | **dominates** if hit — can add hours or stop_batch |
| **Pilot measured target** | 30–60 min with warm cookies, no captcha |

Full 5–8 h is a **contingency band** (slow network + occasional interactive waits), not pure delay math. Ops should not raise `SHOPEE_INTER_SEED_MS` to “make time match 5–8h”.

**Rate hygiene:**

- Inter-seed delay env `SHOPEE_INTER_SEED_MS` default `8000`.
- **Owner (locked):** sleep **inside `processMarketplaceJobs`** between jobs when `collector_id === 'shopee_puppeteer'` (after each completed **or** failed attempt, before claiming the next). Not mock. Script-level sleep alone is insufficient when `limit > 1`.
  ```js
  // pseudo inside processMarketplaceJobs claim loop, after handling a job:
  if (collectorId === 'shopee_puppeteer' && !stop_batch) {
    await sleep(Number(process.env.SHOPEE_INTER_SEED_MS || 8000))
  }
  ```
  Test: spy/clock that delay is invoked between two puppeteer jobs in one invocation with `limit: 2`.
- process-jobs `limit` per call: 3–5; script loops until pending=0 **or** `stop_batch` (then still runs metrics + digest).
- `consecutive_failures >= 3` on a seed → leave enabled but surface in collect_health (optional auto-pause via metadata later).

### 5.5 Metrics after collect + capacity + resume

Sunday pipeline after jobs complete (or partial stop):

```http
POST /api/internal/marketplace/metrics-tick
Authorization: Bearer <MARKETPLACE_CRON_SECRET>
{
  "workspace_id": "...",
  "marketplace": "shopee",
  "country": "sg",
  "limit_queries": 200
}
```

**Today’s caps (ground truth):** snapshot load `.limit(5000)`; `limit_queries` max **200**; groups by `search_query` only.

**Required enhancements (PR-4):**

| dimension_type | dimension_key | Group key |
|----------------|---------------|-----------|
| `query` | search_query string | existing |
| `brand` | `brand_key` | `signals.brand_key` or seed metadata via crawl_job_id |

1. **Brand rollup:** group snapshot rows by durable `brand_key`; upsert `dimension_type=brand`. Process **all** brand keys present in the day’s snapshots, not only first N queries — if query limit remains, brand path is separate and unbounded by `limit_queries` (or raise limit_queries default for brand weeks).
2. **Capacity for full universe:** paginate snapshot reads (keyset on `crawled_at,id`) until exhausted, **or** raise day load ceiling (e.g. 20_000) with tests at fixture volume ≥ full pilot×40. Document that silent truncation is a bug.
3. **Resume / re-run same Sunday:**
   - Script flag `-Resume`: scheduler-tick only for seeds where no completed job with `session_health=ok` exists for current UTC date.
   - Or: re-enqueue only seeds with `last_error` set / cancelled jobs from stop_batch.
   - Brands with successful collect this metric_date are **skipped**.
4. **Full phase opt-in:** materialize `pilot_tier=full` only after mid exit; default import leaves `paused`.

**WoW (week-over-week):** pure function in `marketplace/normalize/wow.mjs`. Compare brand metrics this Sunday vs previous Sunday with success.

**WoW emit gates (locked):**

Emit a brand row in `marketplace.wow_price_moves` only if **all** hold:

- both weeks have a brand metrics row
- both have `listing_count >= 10` (same as catalog_gap floor)
- both have `metrics.collect.session_health === 'ok'` **or** portfolio coverage that week ≥ 50% brands with ok collect
- otherwise section status `partial` and that brand suppressed (no false movers)

---

## 6. Metrics & digest sections

### 6.1 Per-brand metrics JSON

Stored in `marketplace_metrics_daily.metrics` for `dimension_type=brand`, `dimension_key=brand_key`:

```json
{
  "brand_key": "anua",
  "display_name": "Anua",
  "listing_count": 30,
  "seller_mix": { "…existing computeSellerMixMetrics…" },
  "price": { "min": 0, "max": 0, "p50": 0, "mall_p50": 0 },
  "sold": { "sum_lower_bound": 0, "p50_lower_bound": 0, "max_lower_bound": 0 },
  "reseller_pressure": { "undercut_count": 0, "undercut_share_pct": 0, "top_undercutters": [] },
  "signals": { "overseas_share_pct": 0, "preorder_share_pct": 0 },
  "new_listing_count_7d": 0,
  "catalog_match_count": 0,
  "catalog_gap_hint": true,
  "collect": { "job_id": "…", "session_health": "ok", "cards": 30 }
}
```

`new_listing_count_7d`: listings with `first_seen_at` in window whose latest snapshot `signals.brand_key` matches.

**`catalog_gap_hint` (v1 lock):**

- `true` when `listing_count >= catalog_gap_min_listings` (default 10) **and**
- **zero** case-insensitive **exact** matches on `public.brands.name` for `display_name` **and** zero products whose brand text field equals `display_name` (case-insensitive).
- **No** fuzzy / token-overlap matching in v1 (P2 later).
- Open Q5 resolved as exact-only.

### 6.2 Report template

| Field | Value |
|-------|--------|
| slug | `marketplace-brand-weekly` |
| title | Marketplace brand weekly |
| audience_hint | `buyer` (valid in 066 check: marketing/warehouse/ops/finance/hq/buyer/all) |
| default_schedule | `weekly` |
| default_timezone | `Asia/Singapore` |
| default_channels | `{in_app}` |
| default_sections | table below |
| migration | **`069_report_marketplace_brand_weekly.sql`** (068 = universe only) |

### 6.3 Section runner dispatch (PR-5)

Today `runSubscriptionNow` **only** calls `runStubSections` for every pack. PR-5 must replace that call with a hybrid dispatcher without blocking full Rpt-6.

```js
// core/reports/sections.mjs
/**
 * @returns {{ sections: SectionResult[], markdown: string }}
 * SectionResult: { id, status: 'ok'|'empty'|'partial'|'error'|'stub', summary, data? }
 */
export async function runReportSections(sectionIds, ctx) {
  // ctx: { client, workspaceId, periodStart, periodEnd, subscription, template }
  const out = []
  for (const id of sectionIds) {
    try {
      const handler = MARKETPLACE_HANDLERS[id] // only marketplace.* registered in this PR
      if (!handler) {
        out.push({ id, status: 'stub', summary: `…not yet implemented…`, data: { stub: true } })
        continue
      }
      out.push(await handler(ctx))
    } catch (e) {
      out.push({ id, status: 'error', summary: String(e.message||e).slice(0, 400) })
      // do not throw — isolate failures
    }
  }
  return { sections: out, markdown: assembleMarkdown(out) }
}
```

- Marketing / warehouse / finance packs keep **stub** status for unknown ids (no regression).
- Marketplace pack does **not** depend on `sales.category_rollup` (Appendix B).
- Tests: marketing-weekly still stub; marketplace sections return empty/partial/ok fixtures.

| Section id | Audience | Content | Data source |
|------------|----------|---------|-------------|
| `marketplace.collect_health` | Ops / all | Jobs completed/failed/cancelled, session_health histogram, brands missing, stop_batch events | jobs, seeds |
| `marketplace.brand_scoreboard` | Buyer / HQ | brand, listing_n, mall_share, price_p50, sold_sum_lb, undercut_share, tier | metrics brand rows |
| `marketplace.wow_price_moves` | Buyer / mkt | Δ p50 / mall_p50 ≥ threshold **after WoW gates** | metrics WoW |
| `marketplace.mall_share` | Marketing | leaders/laggards; official_interest low mall | metrics + universe |
| `marketplace.undercut_pressure` | Buyer | top undercutters | metrics |
| `marketplace.new_listings` | Marketing | first_seen in window | listings + snapshots |
| `marketplace.top_sold_proxy` | Buyer | top sold_lb | snapshots |
| `marketplace.catalog_gaps` | Buyer | exact brand name gaps | metrics + `brands` |
| `marketplace.grok_brief` | Leadership | narrative + claims | `bi_digests` for most recent Sunday week_key **or offline template from metrics** if missing (**read-only**; never insert) |
| `marketplace.promote_candidates` | Buyer | **List-only** suggestion rows (brand_key, listing ids, suggested pipeline kinds); **never** open study sessions or execute | heuristics |

**Threshold defaults:**

| Param | Default |
|-------|---------|
| wow_price_pct | 8 |
| wow_min_listing_count | 10 |
| undercut_highlight_pct | 10 |
| catalog_gap_min_listings | 10 |
| scoreboard_limit | 50 |
| new_listings_limit | 40 |

**Suggest ≠ execute:** sections never call pipeline execute, store_ops approve, or Loft. **promote_candidates does not auto-create study sessions** (list only).

### 6.4 Export

Reuse `GET /api/v1/marketplace/export` and MCP `bi_export_table`. Brand metrics: `bi_list_metrics` / `GET metrics` with `dimension_type=brand` — scopes `intel:read` / existing report scopes for packs.

---

## 7. Judgment layer (Grok weekly brief)

### 7.1 Grounding rules (lock)

- Numbers only from DB metrics/snapshots in the prompt.
- `normalizeGroundedGrokResult` — `numbers_from_model_only: false`.
- Without `XAI_API_KEY`: offline brief from metrics tables.

### 7.2 Generation job + period identity + idempotency

**Period / week_key scheme (locked — not ISO week):**

ISO weeks start **Monday**. Sunday collect + Monday pack would misalign if `week_key = isoWeekKey(now)`:

- Sunday collect stamps W29; Monday pack looks up W30 → permanent miss → offline grok_brief every week.

**Use collect metric_date instead:**

| Field | Rule |
|-------|------|
| `week_key` | **UTC calendar date of the Sunday collect run** as `YYYY-MM-DD` (same as `metric_date` for that batch’s metrics-tick). Example: collect Sunday 2026-07-19 → `week_key = "2026-07-19"`. |
| `period_start` | That Sunday `00:00:00.000Z` |
| `period_end` | Next Sunday `00:00:00.000Z` (half-open `[start, end)`) — window of evidence for the pack |
| Monday report lookup | Resolve `target_metric_date` = **most recent Sunday (UTC date) ≤ “today” in Asia/Singapore**. Load metrics + digest where `metric_date` / `metadata.week_key` = that date. |
| Title | `Brand radar week 2026-07-19` (date, not ISO Www) |

**Worked example:**

| Event | Local (SGT) | UTC date used | week_key / metric_date |
|-------|-------------|---------------|------------------------|
| Collect + metrics + digest | Sun 2026-07-19 18:00 SGT | 2026-07-19 | `2026-07-19` |
| Report pack due | Mon 2026-07-20 08:00 SGT | most recent Sunday ≤ today SGT | looks up `2026-07-19` |
| Next collect | Sun 2026-07-26 | 2026-07-26 | `2026-07-26` |

PR-6 test: “digest written with week_key=Sunday metric_date is found by Monday report ctx that computes most recent Sunday.”

| Item | Spec |
|------|------|
| Trigger | **Script-only writer** after metrics-tick in weekly script (see writer ownership below) |
| Writer | `intelligence/grok/weeklyBrandBrief.mjs` via `POST /api/internal/marketplace/weekly-digest` |
| Period key | `metadata.week_key = metric_date` (`YYYY-MM-DD` Sunday) + period_start/end as above |
| Idempotency (app) | Select existing row where workspace + digest_kind=weekly + `metadata.week_key` (+ marketplace/country); **update** body/grounded, or delete+insert same key. |
| Idempotency (DB, recommended in PR-6 if easy) | Unique index on `(workspace_id, digest_kind, (metadata->>'week_key'))` where digest_kind=weekly — optional; if deferred, still OK under single-writer rule |
| Output | `bi_digests`: digest_kind=weekly, title `Brand radar week {week_key}`, body_markdown, grounded, evidence_refs, model_id, metadata `{ week_key, metric_date, marketplace, country, source: 'weekly_script' }` |
| MCP | Filter `digest_kind=weekly`; prefer filter/list by `week_key` or latest weekly for workspace |
| Report section | Select by Monday’s **most recent Sunday metric_date** / matching `metadata.week_key` — **not** ISO week, **not** bare `order created_at limit 1` |

**Writer ownership (locked — removes dual-trigger race):**

- **Only** the weekly Windows script (step 4 after metrics-tick) **inserts/updates** weekly brand radar digests.
- Report run **`marketplace.grok_brief` never inserts** `bi_digests`. If no row for target week_key: build **offline template from brand metrics** (same as no XAI). No lazy write path in v1.
- Concurrent race between cron report and script is therefore read-only on digests from the report side. P2 may add unique index + allow re-run of weekly-digest only.

**Monday race (digest job failed on Sunday):** offline metrics template; ops may re-run `weekly-digest` alone after fix (idempotent on week_key).

### 7.3 Promote path (Mode B bridge)

1. Human reads list in `marketplace.promote_candidates` or MCP.
2. **Human** opens study session (UI/MCP) — pack never auto-opens.
3. `pipeline_propose` → decide → execute on approval only.
4. New watchlist seeds: default `schedule_kind=weekly`.

---

## 8. Delivery

| Channel | How |
|---------|-----|
| **In-app** | `/reports` — pack card toggle, Run now, last run markdown |
| **Phase N** | `deliverReportRun` on complete |
| **MCP** | `reports_*`; `bi_list_metrics` (dimension_type=brand); `bi_export_table`; `bi_latest_digest` (kind=weekly) |
| **n8n** | webhook + `automations:webhook` |
| **Slack** | Not v1 primary |

**Cron:** Vercel daily tick evaluates weekly due. Subscription weekly Monday SGT; collect Sunday so Monday has data.

**ensureDefaultSubscriptions:** add `marketplace-brand-weekly` to `SEED_SLUGS` — **disabled-by-default**.

---

## 9. Failure modes

| Failure | Detection | Digest behavior | Ops recovery |
|---------|-----------|-----------------|--------------|
| Captcha / blocked | session_health=blocked | collect_health red; stop_batch; **metrics+digest still run** | Interactive unblock; refresh cookies; `-Resume` script |
| login_required | session_health | Same | Re-login; update SHOPEE_SG_SESSION_JSON; manual re-run |
| Partial week | success ratio / cancelled jobs | Banner partial; WoW gated; scoreboard from available brands | Resume failed brands only |
| Empty evidence | no brand metrics | sections `empty`; offline grok “no data” | Check worker; mock dry-run CI |
| Metrics truncation | row count vs seed success | collect_health warns | Paginated metrics-tick |
| Duplicate weekly digests | week_key upsert | Single row | PR-6 idempotent write |
| Seed unique conflict | unique key | Upsert | One mode per target |
| Stale cookies mid-batch | stop_batch after N ok | Partial OK | Resume |

Never invent prices/sold.

---

## 10. Phased rollout

| Phase | Brands | Exit criteria |
|-------|--------|---------------|
| **P0 — Foundation** | 0 live | Universe import + mock seeds + hybrid section runner + stop_batch tests green |
| **P1 — Pilot** | **Explicit allowlist** §Appendix A (12 brands) | PR-1..5 + PR-7 merged; G1 smoke path green; **one dry-run Sunday**; then 2 consecutive Sundays collect success ≥80%; Monday pack readable |
| **P2 — Mid** | ~50 Official+Mall skincare + top cosmetics | WoW stable under gates; ≥1 human promote→study |
| **P3 — Full CSV** | ~125 | **Sat/Sun split** documented + run; metrics-tick capacity test ≥ full fixture volume; catalog_gaps useful |
| **P4 — Expand** | +PH/MY, shop mode, iHerb research | After stable SG / G5 |

**Pilot selection (locked default — deterministic):**

- Source of truth = **Appendix A brand_key allowlist** (not followers sort).
- Followers_note is soft metadata only (COSRX alone has data).
- Buyer may swap list (open Q); materialize must accept explicit `brand_keys[]` and produce stable order (array order).

---

## 11. Alternatives considered (rejected / demoted)

| Approach | Outcome | Design consequence |
|----------|---------|-------------------|
| Node fetch / bare HTTP | 403 / TLS fingerprint fail | Never primary |
| Vercel serverless browser | No Chrome; timeouts | Control plane only |
| Local Puppeteer cold browser | Permanent captcha | Require warm cookies |
| Browserbase as primary | Linux Developer OS; captcha | Parked (G5 only) |
| Cloudflare Browser Rendering primary | Fixed UA; no captcha solve | Optional fallback only (not weekly primary) |
| LLM as price/sold source | Stale/wrong | Forbidden |
| gstack overnight crawl | Research option, not proven here | Not locked architecture |
| Chrome extension crawl engine | Unattended multi-seed unfit | Cookie export only later |
| Shopee Open API for competitors | Not allowed | Own listings only |
| Skincare Vercel crawlers | Not deployable | Out of weekly v1 |
| Daily all-brand collect | Session cost | Weekly portfolio |
| Third digests product vs report registry | UX split | **Registry primary** |
| Overload `public.brands` for radar flags | Wrong domain (catalog) | New `marketplace_brand_universe` |
| **Seeds-only metadata bag (no brand_universe table)** | Loses first-class iHerb/category/pilot_tier filters + re-import UX | **Rejected** — use universe table (KD-4) |
| brand_portfolio = full multi-marketplace | Scope | SG keyword SERP first |

---

## 12. Open questions

Resolved into Key Decisions / body where noted. Remaining:

1. ~~Worker topology~~ → **KD-13** Task Scheduler + production internal APIs.
2. **Exact pilot brand list:** buyer confirm Appendix A (defaults locked for code until changed).
3. **weekly_day:** Sunday collect + Monday report vs Saturday? Default Sunday remains until ops prefers Sat start for full split.
4. ~~Second query `"Brand official"`~~ → **KD-12** pilot/mid single query only.
5. ~~Catalog gap join~~ → **KD-14** exact `brands.name` / product brand field only.
6. ~~promote auto-open study~~ → **KD-15** list only.
7. **Budget:** XAI tokens / max brands in Grok context (propose 40–50) — tune after first live brief.
8. ~~Multi-workspace~~ → **KD-16** schema multi-tenant; ops pilot = single primary workspace.
9. ~~Migration numbers~~ → **068** universe, **069** report template (067 latest).
10. **UI home:** Only `/reports` for pilot; optional brand-radar page = PR-9 after feedback.

---

## 13. APIs, env, MCP (concrete contracts)

### Env (Windows worker)

| Var | Required | Notes |
|-----|----------|-------|
| `SHOPEE_SG_SESSION_JSON` or cookie file + `SHOPEE_USE_COOKIE_FILE=1` | Yes live | Warm session |
| `MARKETPLACE_CRON_SECRET` / `QUEUE_PROCESSOR_KEY` | Yes | Internal APIs |
| `SKUMS_API_BASE` | Yes script | e.g. `https://fran-skums.vercel.app` |
| `MARKETPLACE_WORKSPACE_ID` | Yes script | Primary workspace |
| `XAI_API_KEY` | Optional | Live Grok brief |
| `SHOPEE_INTER_SEED_MS` | Optional | Default **8000** (~17 min overhead at 125 brands; not the bulk of wall time) |
| `SHOPEE_INTERACTIVE` / `SHOPEE_CAPTCHA_WAIT_MS` | Ops | Manual unblock |

### Orchestration script (required)

`scripts/windows-marketplace-weekly.ps1` (PR-3 minimum viable; PR-7 docs):

```text
# Control flow (locked) — stop_batch never skips aggregation
stop = false
1. POST /api/internal/marketplace/scheduler-tick  { workspace_id }
2. loop:
     POST /api/internal/marketplace/process-jobs { workspace_id, limit: 3 }
     if response.stop_batch → stop=true; break   # break loop only; do NOT exit process
     if claimed==0 → break
3. POST /api/internal/marketplace/metrics-tick {
     workspace_id,
     metric_date: <Sunday UTC YYYY-MM-DD>,   # week_key identity
     limit_queries: 200
   }
   # ALWAYS runs — even when stop=true (partial week)
4. POST /api/internal/marketplace/weekly-digest {
     workspace_id,
     week_key / metric_date: <same Sunday UTC YYYY-MM-DD>
   }
   # ALWAYS runs — script-only writer; idempotent
5. exit code:
     2 if stop   # ops alert: captcha/login; cookies + -Resume
     0 otherwise
# exit code ≠ “skip metrics”. Document in runbook.
# Optional -Resume: only enqueue brands without success for this metric_date
```

### New / extended HTTP

| Method | Path | Scope / auth | Purpose |
|--------|------|--------------|---------|
| POST | `/api/v1/marketplace/brand-universe/import` | **`intel:write`** | CSV/JSON import |
| GET | `/api/v1/marketplace/brand-universe` | **`intel:read`** | List filters |
| PATCH | `/api/v1/marketplace/brand-universe/:id` | **`intel:write`** | tier, enabled, priority |
| POST | `/api/v1/marketplace/brand-universe/materialize-seeds` | **`intel:write`** | Create weekly seeds for tier / brand_keys[] |
| POST | `/api/internal/marketplace/weekly-digest` | cron secret | Idempotent bi_digests write |
| POST | `/api/internal/marketplace/process-jobs` | cron secret | Returns `stop_batch` (extended) |

### MCP

| Tool | Action | Scope |
|------|--------|-------|
| `bi_list_metrics` | Filter `dimension_type=brand` | intel:read |
| `bi_export_table` | SERP dumps | intel:read |
| `bi_latest_digest` | Prefer digest_kind=weekly | intel:read |
| `reports_run` | template_slug=marketplace-brand-weekly | reports:run |
| `bi_upsert_seed` | Existing; prefer materialize API for portfolio | intel:write |

No new MCP scopes. No `marketplace:write`.

---

## 14. UI / ops runbook (v1)

### UI slices

1. **Reports pack card** — Monday read.
2. **Marketplace seeds/jobs** — surface `login_required` / `blocked` / cancelled batch (G2).
3. **Optional Brand radar page** (PR-9) after pilot.

### Ops runbook checklist

```text
[ ] Cookies exported this week if last_error login_required
[ ] preferred_hour is UTC 10 (= 18:00 SGT) — do not "fix" to local hour without scheduler change
[ ] Task Scheduler "skums-marketplace-weekly" enabled
[ ] Sun: script completes; if stop_batch, exit code 2 but metrics+digest still ran
[ ] Sun: metrics-tick + weekly-digest for Sunday metric_date week_key (script-only writer)
[ ] Mon: pack resolves most recent Sunday metric_date (not ISO week)
[ ] Mon: report run completed (or Run now)
[ ] Review collect_health first; trust WoW only if not partial
[ ] Promote ≤5 — open study yourself; no bulk execute
[ ] Resume: re-run script -Resume after cookie refresh (skip successes)
```

---

## 15. Data model deltas summary

| Object | Change |
|--------|--------|
| `marketplace_brand_universe` | **New** mig **068** |
| `report_templates` seed | mig **069** `marketplace-brand-weekly` |
| `marketplace_crawl_seeds` | brand_portfolio weekly rows; metadata brand_key |
| `marketplace_listing_snapshots.signals` | brand_key / universe_id stamped |
| `marketplace_metrics_daily` | populate dimension_type=brand |
| `bi_digests` | weekly write path; week_key = Sunday metric_date `YYYY-MM-DD`; script-only writer; optional unique on (workspace, kind, week_key) |
| `processMarketplaceJobs` | stop_batch + cancel remaining pending; **inter-seed sleep** for shopee_puppeteer |
| `runReportSections` | hybrid marketplace real / else stub |
| Types | BrandUniverse + brandKey helper |

No channels/ adapters. No iHerb tables.

---

## 16. Test plan (engineer)

| Test | Assert | PR |
|------|--------|-----|
| brand_key golden | d'Alba→dalba, I'm from→im-from, Su:m37→sum37, House of Hur merge | PR-1 |
| CSV parse | leading comma; blank Official→null; `Hair / Body`→one tag; Glad2Glow→two; skip empty header | PR-1 |
| House of Hur dedup | one brand_key two categories | PR-1 |
| Materialize links | seed.metadata.universe_id ↔ universe.primary_seed_id | PR-2 |
| preferred_hour UTC | Sunday next_run at hour 10 UTC | PR-2 |
| detail_top_n=0 | zero detail navigations mock+puppeteer | PR-3 |
| stop_batch | N jobs, first blocked → halt + cancel remaining; response flag | PR-3 |
| stop_batch then aggregate | after stop, metrics-tick + weekly-digest still called; exit code 2 at end | PR-3 |
| INTER_SEED sleep | processMarketplaceJobs delays between puppeteer jobs when limit≥2 | PR-3 |
| Card stamp | signals.brand_key on snapshots | PR-3 |
| Brand rollup | variants/punctuated names → one brand metrics row | PR-4 |
| Metrics capacity | fixture ≥ full volume no silent drop | PR-4 |
| WoW gates | partial week suppresses movers | PR-4 |
| Hybrid runner | marketplace ok/empty; marketing-weekly still stub | PR-5 |
| Catalog gap | exact name only | PR-5 |
| Digest idempotency | two weekly-digest calls → one row/week_key (metric_date) | PR-6 |
| Digest Monday lookup | digest written Sunday week_key found by Monday most-recent-Sunday ctx | PR-6 |
| No report insert | report grok_brief does not insert bi_digests when missing | PR-6 |
| bi_latest_digest kind | weekly filter | PR-6 |
| Grounding | Grok cannot invent numbers | PR-6 |
| Script dry-run | env checklist documented; stop_batch exit code | PR-7 |

---

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Weekly** brand portfolio collect (not daily×125); **spread across week of** is OK | Session ops; captcha burn; user: not all brands on one wall-clock night |
| 2 | **Report registry** pack `marketplace-brand-weekly` primary delivery | Reuses K Rpt-0–5 |
| 3 | **`bi_digests`** period-keyed weekly narrative only | Artifact for grok_brief; not parallel UX |
| 4 | **New `marketplace_brand_universe`** (not seeds-only, not catalog brands) | First-class flags, tier, re-import |
| 5 | **Shopee SG only**; iHerb = interest not scrape | Failed iHerb HTTP; scope |
| 6 | **`brand_portfolio` = single SERP** + stamp brand_key on cards | Collectors SERP-based; durable metrics join |
| 7 | **Windows `shopee_puppeteer` + warm cookies** primary | Track G; supersedes Major Update cloud-primary wording for Shopee |
| 8 | **Pilot allowlist → mid → full** via pilot_tier (default paused) | Deterministic; safe scale |
| 9 | **stop_batch end-to-end** on login_required/blocked | Current runner continues — must change |
| 10 | **Suggest ≠ execute**; promote = **list only** | No auto study/PO/Loft |
| 11 | **Grok numbers only from warehouse** | contracts.mjs |
| 12 | **Single query per brand in pilot/mid** | Session budget |
| 13 | **Worker = Task Scheduler + production internal APIs** + `windows-marketplace-weekly` script | One topology for P1 |
| 14 | **Catalog match = case-insensitive exact** brand name | No fuzzy v1 |
| 15 | **Scopes = `intel:read`/`intel:write` + `reports:*`** | Matches seeds.post.ts; no marketplace:write |
| 16 | **Ops pilot = single primary workspace** (schema still multi-tenant) | Avoid multi-ws thrash |
| 17 | **preferred_hour is UTC** in v1 (scheduler limitation) | Avoid 8h schedule skew |
| 18 | **detail_top_n≤0 skips detail entirely** | Avoid accidental captcha pages |
| 19 | **WoW only if both weeks listing_count≥10 + coverage** | No false movers |
| 20 | **Mig 068 universe / 069 report template** | Clear PR ownership |
| 21 | **Script always runs metrics-tick + weekly-digest after stop_batch**; exit code 2 only at end | Partial week packs must not be empty of aggregation |
| 22 | **week_key = Sunday metric_date `YYYY-MM-DD`** (not ISO week); Monday pack = most recent Sunday ≤ today SGT | Avoid Sun/Mon ISO week skew |
| 23 | **Script-only bi_digests writer**; report never inserts | Remove dual-trigger race without requiring unique index in v1 |
| 24 | **INTER_SEED sleep inside processMarketplaceJobs** for shopee_puppeteer | Owner clear; limit>1 safe |
| 25 | **priority = 120 if official_interest \|\| shopee_mall_interest else 80** | Official=null + Mall Yes raises priority |

---

## PR Plan

### PR-1 — Brand universe schema + CSV import

- **Title:** `feat(marketplace): brand universe table + sample-brands import`
- **Files:** `core/db/068_marketplace_brand_universe.sql`; `scripts/import-brand-universe.mjs` (+ shared `brandKeyFromDisplayName`); types; `tests/marketplace-brand-universe.test.mjs`
- **Dependencies:** none
- **Description:** Table + RLS; golden brand_key tests; CSV leading comma, blank Official, Glad2Glow category split, House of Hur merge; dry_run; default pilot_tier=paused. No crawl.

### PR-2 — Materialize weekly brand seeds

- **Title:** `feat(marketplace): materialize weekly brand_portfolio seeds from universe`
- **Files:** `server/api/v1/marketplace/brand-universe/*` (**intel:write** / **intel:read**); materialize upsert seed → set primary_seed_id
- **Dependencies:** PR-1
- **Description:** List/patch; materialize by tier or `brand_keys[]` (Appendix A); preferred_hour=10 UTC documented; detail_top_n=0; metadata brand_key+universe_id; pilot defaults paused until activate.

### PR-3 — Collect brand_portfolio + stop_batch + G1 smoke + script MVP

- **Title:** `feat(marketplace): brand_portfolio collect, brand_key stamp, stop_batch, weekly script`
- **Files:** collectors (puppeteer+mock); `marketplaceCollect.ts` stop_batch+cancel pending; `upsertObservations` signals; `scripts/windows-marketplace-weekly.ps1` (or .mjs); G1 smoke notes in marketplace/README
- **Dependencies:** PR-2 (mock path can land earlier)
- **Description:** SERP brand_portfolio; stamp signals.brand_key; detail_top_n≤0; stop_batch + cancel pending; **INTER_SEED sleep inside processMarketplaceJobs** for shopee_puppeteer; weekly script **always** runs metrics-tick + weekly-digest after loop (exit code 2 if stop, never skip aggregation); G1 Windows smoke in this PR.

### PR-4 — Brand metrics rollup + capacity + WoW gates

- **Title:** `feat(marketplace): brand dimension metrics_daily + WoW helpers`
- **Files:** `server/utils/marketplaceMetrics.ts`; `marketplace/normalize/wow.mjs`; paginated snapshot load
- **Dependencies:** PR-3 stamps (tests with mock)
- **Description:** dimension_type=brand via signals.brand_key; no silent 5k truncation at full fixture; WoW gates; resume helper notes.

### PR-5 — Report template 069 + hybrid section runner

- **Title:** `feat(reports): marketplace-brand-weekly pack + marketplace section handlers`
- **Files:** `core/db/069_report_marketplace_brand_weekly.sql`; `core/reports/sections.mjs` `runReportSections`; `reportRegistry.ts` SEED_SLUGS + call hybrid runner; tests non-regression marketing stubs
- **Dependencies:** PR-4 for rich data; empty-tolerant without it
- **Description:** Real marketplace.* handlers; grok_brief reads digest by most recent Sunday week_key or offline-from-metrics (never inserts); promote list-only; catalog exact match; **does not implement sales.category_rollup**.

### PR-6 — Weekly Grok brief idempotent bi_digests

- **Title:** `feat(intelligence): grounded weekly brand radar brief`
- **Files:** `intelligence/grok/weeklyBrandBrief.mjs`; `weekly-digest.post.ts`; MCP bi_latest_digest filter; grok_brief section period select
- **Dependencies:** PR-4, PR-5
- **Description:** week_key = Sunday metric_date `YYYY-MM-DD` (not ISO); Monday most-recent-Sunday lookup test; **script-only writer** (report never inserts); app upsert + optional unique index; offline template if missing; grounding tests.

### PR-7 — Ops runbook + G2 UI health surfaces

- **Title:** `docs+ui(marketplace): weekly worker runbook + session health`
- **Files:** runbook, README, jobs/seeds UI badges for session_health/stop_batch; harden script comments
- **Dependencies:** PR-3
- **Description:** Sunday pipeline ops; stop_batch exit code 2 but metrics+digest always ran; UTC hour note; Monday Sunday-metric_date lookup; resume instructions; unpark brand radar in TODO when pilot ready.

### PR-8 — Pilot activation + promote bridge polish

- **Title:** `feat(marketplace): activate pilot allowlist + promote list deep links`
- **Files:** activate endpoint/UI; promote section payloads; agentInstructions note
- **Dependencies:** PR-2, PR-5
- **Description:** One-click set Appendix A → pilot_tier=pilot + materialize; list-only promote; no auto study.

### PR-9 (optional) — Brand radar UI page

- **Title:** `feat(ui): brand radar scoreboard page`
- **Dependencies:** PR-1, PR-4
- **Description:** Defer until pilot feedback if `/reports` suffices.

### Pilot gate (P1 not claimed until)

```text
PR-1 + PR-2 + PR-3 + PR-4 + PR-5 (empty-tolerant) + PR-7
+ G1 Windows smoke green
+ one dry-run Sunday (script end-to-end, mock or live pilot)
THEN two consecutive live Sundays ≥80% success
```

### Suggested merge order

```text
PR-1 → PR-2 → PR-3 → PR-4 → PR-5 → PR-6
              ↘ PR-7 (required for P1 gate, after PR-3)
PR-5 → PR-8
PR-9 optional
```

Timeline note: ~2–4 weeks for code slices is plausible; **live pilot two Sundays may extend calendar** if G1 smoke is still cold — treat G1 as first task in PR-3, not afterthought.

---

## Appendix A — Pilot brand allowlist (deterministic default)

**Source of truth for materialize** (buyer may edit later). All present in `sample-brands.csv`. **Innisfree excluded** (not in CSV). No other brands auto-included at materialize.

| brand_key | display_name |
|-----------|--------------|
| `anua` | Anua |
| `cosrx` | COSRX |
| `beauty-of-joseon` | Beauty of Joseon |
| `numbuzin` | numbuzin |
| `medicube` | Medicube |
| `celimax` | Celimax |
| `axis-y` | Axis-Y |
| `biodance` | Biodance |
| `mixsoon` | mixsoon |
| `dr-althea` | Dr. Althea |
| `haruharu-wonder` | Haruharu Wonder |
| `mediheal` | Mediheal |

Optional expansion only via explicit buyer edit of allowlist / `brand_keys[]` (e.g. `dalba`, `centellian24`, `isntree` if Official or Mall interest after import).

---

## Appendix B — Relation to Rpt-6

Track K **Rpt-6** = real handlers for marketing/warehouse/finance stubs. This design adds **`marketplace.*`** section ids via hybrid `runReportSections`. **Does not block on** `sales.category_rollup`. Marketplace pack is self-contained on marketplace warehouse tables. PR-5 tests must prove marketing-weekly still stubs.

---

## Appendix C — File index (existing)

- `Major Update.md` — Mode A/B (cloud-browser wording superseded for Shopee by Track G)
- `TODO.md` — brand radar parked; Track G/K
- `marketplace/README.md` — collectors + APIs
- `marketplace/scheduler.mjs` — preferred_hour UTC
- `server/utils/marketplaceCollect.ts` — processMarketplaceJobs (needs stop_batch)
- `server/utils/marketplaceMetrics.ts` — 5000 snap / 200 query caps today
- `server/api/v1/marketplace/seeds*.ts` — **intel:write**
- `core/db/047_marketplace_intelligence.sql` — warehouse + bi_digests
- `core/db/066_report_registry.sql` — templates/subscriptions/runs
- `core/db/067_report_delivery_policy.sql` — latest before 068
- `core/reports/sections.mjs` — stub only today
- `server/utils/reportRegistry.ts` — runStubSections always
- `intelligence/README.md` — study/pipeline
- `sample-brands.csv` — universe source
