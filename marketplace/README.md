# Marketplace intelligence (Fran BI collect layer)

Competitive observation for public marketplaces (Shopee first).  
**Not** an authorized sales channel adapter (`channels/`).

## Collectors

| `collector_id` | Runtime | Notes |
|----------------|---------|--------|
| `mock` | In-process | Deterministic fixtures (tests / dry-run) |
| `shopee_puppeteer` | Puppeteer via `browser-manager` | **Primary live path (2026-07-17):** local **Windows** Chrome + warm `SHOPEE_SG_SESSION_JSON` |
| `browserbase` | Browserbase cloud browser + Puppeteer | **Not primary** — Developer plan is Linux OS; Shopee captcha common. Revisit only with non-Linux OS plan + persistent context |
| `cloudflare_browser_run` | Cloudflare Browser Rendering REST | Needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` |

## Brand universe (weekly radar)

| Module | Role |
|--------|------|
| `brandKey.mjs` | `brand_key` slug, CSV parse, pilot allowlist, priority |
| `scripts/import-brand-universe.mjs` | Import `sample-brands.csv` → `marketplace_brand_universe` (tier=paused) |
| Design | `docs/WEEKLY_MARKETPLACE_INTELLIGENCE_DESIGN.md` |

```bash
# Dry-run parse only
node scripts/import-brand-universe.mjs --workspace <uuid> --dry-run
# After mig 068 applied:
node scripts/import-brand-universe.mjs --workspace <uuid>
```

### APIs (PR-2)

| Method | Path | Scope |
|--------|------|-------|
| GET | `/api/v1/marketplace/brand-universe` | `intel:read` |
| PATCH | `/api/v1/marketplace/brand-universe/:id` | `intel:write` |
| POST | `/api/v1/marketplace/brand-universe/import` | `intel:write` |
| POST | `/api/v1/marketplace/brand-universe/materialize-seeds` | `intel:write` |

Materialize prefers **`mode=shop`** when `shop_username` is **confirmed** (official Mall storefront); otherwise **`brand_portfolio`** keyword SERP. Shop primary also creates a secondary SERP seed for market context.

```bash
# Confirm official Mall URL before shop scrape (parses beautyofjoseonsg from full URL)
node scripts/set-brand-shop-username.mjs --workspace <uuid> \
  --brand beauty-of-joseon \
  --url "https://shopee.sg/beautyofjoseonsg?categoryId=100630&itemId=28707244664"

# Heuristic shortlist only (never auto-confirmed)
node scripts/set-brand-shop-username.mjs --workspace <uuid> --brand cosrx --suggest

# Materialize pilot (shop primary where confirmed)
node scripts/materialize-brand-seeds.mjs --workspace <uuid> --pilot-allowlist --set-tier pilot
```

**Shop username discovery (before scrape):**

1. **Chrome extension (recommended)** — runs in **your logged-in Chrome** (avoids Puppeteer captcha):
   ```
   extensions/skums-shopee-shop-resolve/   # Load unpacked in chrome://extensions
   ```
   Open Shopee shop or SERP → Scan → Confirm + push → then materialize.
   See `extensions/skums-shopee-shop-resolve/README.md`.
2. **Manual / script** — paste Mall URL:
   ```bash
   node scripts/set-brand-shop-username.mjs --workspace <uuid> --brand beauty-of-joseon \
     --url "https://shopee.sg/beautyofjoseonsg"
   ```
3. **Puppeteer batch** (`discover-mall-shops.mjs`) — demoted; often `session_health=blocked` without warm interactive session.

After confirms:
```bash
node scripts/materialize-brand-seeds.mjs --workspace <uuid> --pilot-allowlist
```

## Phase 0

| Module | Role |
|--------|------|
| `soldLabel.mjs` | Parse sold buckets → lower bound |
| `sellerTaxonomy.mjs` | Mall / Preferred / normal + dropship signals |
| `scheduler.mjs` | Daily/weekly/`cron` next_run + job row builder |
| `collectors/mock` | Deterministic fixture collector |

## Phase 1 (current)

| Module | Role |
|--------|------|
| `shopee/urls.mjs` | Search / listing URLs, id parse |
| `shopee/parseSearch.mjs` | API + DOM → observation cards |
| `shopee/fixtures/` | Sample search JSON for tests |
| `writers/upsertObservations.mjs` | Upsert shops/listings + insert snapshots |
| `collectors/shopee-puppeteer` | Puppeteer SERP scrape + session cookies |
| `collectors/browserbase` | Browserbase session + Puppeteer (proxies, captcha solve) |
| `collectors/cloudflare-browser-run` | CF `/browser-rendering/content` fallback |

### Job APIs

```http
POST /api/internal/marketplace/scheduler-tick
POST /api/internal/marketplace/process-jobs
Authorization: Bearer <MARKETPLACE_CRON_SECRET or QUEUE_PROCESSOR_KEY>

GET  /api/v1/marketplace/seeds
POST /api/v1/marketplace/seeds
POST /api/v1/marketplace/seeds/:id/run
GET  /api/v1/marketplace/jobs
GET  /api/v1/marketplace/snapshots
```

### Session (required for reliable live Shopee)

Cold browsers (especially Linux cloud) get captcha. Prefer a **warm human session** from Windows Chrome:

```env
# Full cookie jar for .shopee.sg (export from logged-in Chrome after captcha)
SHOPEE_SG_SESSION_JSON=[{"name":"SPC_ST","value":"...","domain":".shopee.sg","path":"/"}, ...]
# Or: sample-cookie.json + SHOPEE_USE_COOKIE_FILE=1 for local smokes
MARKETPLACE_CRON_SECRET=...
# Inter-seed delay (processMarketplaceJobs, shopee_puppeteer only)
# SHOPEE_INTER_SEED_MS=8000
# Browserbase — parked as primary (Linux Developer OS + captcha). Optional experiment only:
# BROWSERBASE_API_KEY=...
# BROWSERBASE_PROXIES=1
# BROWSERBASE_REGION=ap-southeast-1
# BROWSERBASE_CONTEXT_ID=...   # if revisiting: persist after human solve
# Optional CF fallback:
# CLOUDFLARE_ACCOUNT_ID=...
# CLOUDFLARE_API_TOKEN=...
```

### G1 — Windows local primary smoke

1. Export cookies from logged-in Chrome → `sample-cookie.json` or `SHOPEE_SG_SESSION_JSON`
2. Local SERP smoke:
   ```bash
   SHOPEE_USE_COOKIE_FILE=1 node scripts/_smoke_shopee_live.mjs
   # If captcha: SHOPEE_INTERACTIVE=1 SHOPEE_USE_COOKIE_FILE=1 node scripts/_smoke_shopee_live.mjs
   ```
3. Weekly orchestration (control plane HTTP — process-jobs runs where Chrome can reach or worker has browser):
   ```bash
   # Dry-run control flow (stop_batch still calls metrics + digest)
   node scripts/windows-marketplace-weekly.mjs --workspace <uuid> --dry-run
   # Task Scheduler entry:
   # powershell -File scripts/windows-marketplace-weekly.ps1
   ```
4. **stop_batch:** on `login_required` / `blocked`, process-jobs fails that job, cancels remaining pending, returns `stop_batch: true`. Weekly script breaks the collect loop only, **always** runs metrics-tick + weekly-digest, exit code **2**. Refresh cookies → re-run with `--resume`.

### Suggested seed

```json
{
  "target": "anua official",
  "country": "sg",
  "mode": "keyword",
  "schedule_kind": "daily",
  "collector_id": "shopee_puppeteer",
  "max_pages": 2,
  "max_listings": 40
}
```

Use `collector_id: "mock"` to validate the write path without hitting Shopee.

Live smoke (local Windows Chrome — primary):

```bash
# After exporting cookies to sample-cookie.json:
SHOPEE_USE_COOKIE_FILE=1 node scripts/_smoke_shopee_live.mjs
# Interactive captcha if needed:
# SHOPEE_INTERACTIVE=1 SHOPEE_USE_COOKIE_FILE=1 node scripts/_smoke_shopee_live.mjs
```

Browserbase smoke (optional only — not primary):

```bash
# Prefer cookies if trying BB at all:
SHOPEE_USE_COOKIE_FILE=1 node scripts/_smoke_shopee_browserbase.mjs
```

## Phase 2 (current)

| Module / route | Role |
|----------------|------|
| `normalize/metrics.mjs` | Seller mix, undercut vs Mall p50, export/CSV builders |
| `POST /api/internal/marketplace/metrics-tick` | Upsert `marketplace_metrics_daily` from snapshots |
| `GET /api/v1/marketplace/metrics` | Read daily metrics |
| `GET /api/v1/marketplace/export` | Sheet-ready JSON or CSV + summary |
| `GET /api/v1/marketplace/listings` | Listing filters (`seller_type`, `q`, …) |
| `GET /api/v1/marketplace/snapshots` | Richer filters (price, overseas, since/until) |
| `PATCH /api/v1/marketplace/seeds/:id` | Cadence / collector updates |

### Export example

```http
GET /api/v1/marketplace/export?search_query=anua%20official&format=json&include_summary=true
Authorization: Bearer <api_key>
```

CSV body only: `?format=csv&raw=1`

## Phase 3 — Study + pipeline

See `intelligence/README.md`.

```http
POST /api/v1/study/sessions
POST /api/v1/study/sessions/:id/brief
POST /api/v1/study/sessions/:id/match
POST /api/v1/study/sessions/:id/propose
POST /api/v1/pipeline/candidates/:id/decide
POST /api/v1/pipeline/candidates/:id/execute
```

Scopes: `study:write`, `pipeline:propose`, `pipeline:decide`, `pipeline:execute`  
(Empty API key scopes = full access.)

## Phase 4 — MCP

```bash
# set FRAN_MCP_WORKSPACE_ID in .env
npm run mcp
```

See `mcp/README.md` for Cursor/Claude config and full tool list.

See root `Major Update.md`.
