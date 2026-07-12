# Marketplace intelligence (Fran BI collect layer)

Competitive observation for public marketplaces (Shopee first).  
**Not** an authorized sales channel adapter (`channels/`).

## Collectors

| `collector_id` | Runtime | Notes |
|----------------|---------|--------|
| `mock` | In-process | Deterministic fixtures (tests / dry-run) |
| `shopee_puppeteer` | Puppeteer via `browser-manager` | Local Chrome; often captcha/traffic-walled |
| `browserbase` | Browserbase cloud browser + Puppeteer | Preferred live path; `BROWSERBASE_API_KEY` |
| `cloudflare_browser_run` | Cloudflare Browser Rendering REST | Needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` |

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

### Session (optional but recommended)

```env
SHOPEE_SG_SESSION_JSON=[{"name":"SPC_ST","value":"...","domain":".shopee.sg","path":"/"}]
MARKETPLACE_CRON_SECRET=...
# Preferred live cloud path:
BROWSERBASE_API_KEY=...
# BROWSERBASE_PROXIES=1
# BROWSERBASE_REGION=ap-southeast-1
# Optional CF fallback:
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

### Suggested seed

```json
{
  "target": "anua official",
  "country": "sg",
  "mode": "keyword",
  "schedule_kind": "daily",
  "collector_id": "browserbase",
  "max_pages": 2,
  "max_listings": 40
}
```

Use `collector_id: "mock"` to validate the write path without hitting Shopee.

Live smoke (Browserbase):

```bash
node scripts/_smoke_shopee_browserbase.mjs
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
