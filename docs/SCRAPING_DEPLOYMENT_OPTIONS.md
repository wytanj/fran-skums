# Scraping on Vercel Serverless: The Problem & Solutions

## The Problem

We need to fetch product pages from sites like iHerb, Hwahae, and Olive Young to extract pricing, ratings, reviews, ingredients, and sales velocity. These sites employ anti-bot protection that blocks Node.js `fetch()` based on TLS fingerprinting — not just headers.

**What works where:**

| Method | Local Dev | Vercel Serverless |
|--------|:---------:|:-----------------:|
| Node `fetch()` | ✗ (403 from iHerb) | ✗ (403 from iHerb) |
| `curl` subprocess | ✓ (2MB full page) | ✗ (curl not available) |
| Puppeteer (headless Chrome) | ✓ | ✗ (no Chrome binary, 400MB+) |
| Grok "use your knowledge" fallback | Partial (no live data) | Partial (no live data) |

**Current state:** Local dev works perfectly (curl fallback gets full HTML with JSON-LD, ratings, reviews, ingredients, sales data). Vercel gets blocked and falls back to asking Grok to guess from training knowledge — which returns stale/approximate data or zeros.

---

## The Two Distinct Use Cases

### 1. URL Analyser (on-demand, single product)
User pastes a URL → we fetch the page → extract data → score it. Needs to work in real-time (~5-10s response).

### 2. Catalog Crawler (batch, scheduled)
Crawl hundreds of products from Hwahae/Olive Young categories. Runs overnight, stores results in Supabase. Does NOT need to run on Vercel — can run anywhere.

---

## Solutions Evaluated

### Option A: `@sparticuz/chromium` + `puppeteer-core` on Vercel (URL Analyser)
**How:** Swap full `puppeteer` for `puppeteer-core` + `@sparticuz/chromium` (a Lambda-compatible Chromium binary, ~50MB compressed). Handles on-demand, single-page URL analysis on Vercel.

| Pros | Cons |
|------|------|
| Everything stays in one Vercel project | Vercel function timeout: 10s (Hobby) / 60s (Pro) / 300s (Pro with config) |
| Battle-tested pattern (Vercel docs reference it) | Cold start adds 3-5s for Chromium launch |
| Works for URL Analyser (single page) | NOT viable for batch crawling (too many pages, timeout) |
| ~$0 incremental cost | Adds ~50MB to function bundle |
| Bypasses TLS fingerprint blocks (real Chromium) | |

**Verdict:** Solves the URL Analyser on Vercel. Pair with Option A.1 for batch crawling.

---

### Option A.1: Dedicated Crawl Server (Batch / Overnight)
**How:** A separate Node.js service (its own repo or monorepo package) deployed to a long-running host (Fly.io, Railway, Render, or a VPS). Runs full Puppeteer with no timeout constraints. SKUMS Vercel app triggers crawl jobs via API; the crawl server writes results directly to Supabase.

**Architecture:**
```
VERCEL (skums main app)                    CRAWL SERVER (Fly.io / Railway / VPS)
├── UI + API                               ├── Full Puppeteer + curl
├── URL Analyser (Option A)                ├── Hwahae / OliveYoung / iHerb scrapers
├── POST /api/crawl/trigger ──────────────►├── POST /crawl (accepts job config)
│   (sends job config: source,             │   ├── Runs async, no timeout
│    categories, workspace_id)             │   ├── Writes to Supabase directly
│                                          │   └── POST callback → Vercel when done
├── Reads from Supabase ◄─────────────────►├── Writes to Supabase
└── Scoring engine (IPS, etc.)             └── Cron: nightly scheduled crawls
```

**Crawl server responsibilities:**
- Accepts crawl job requests (source, categories, workspace_id, concurrency)
- Runs Puppeteer with full browser automation (stealth, page reuse, retry)
- Manages browser lifecycle (launch, reuse, kill on idle)
- Writes crawled products to `external_products` in Supabase
- Runs skincare scoring after each product (or delegates back to Vercel)
- Exposes a simple API: `POST /crawl`, `GET /jobs`, `GET /jobs/:id/status`
- Cron-scheduled overnight crawls (configurable per source/category)
- Health check endpoint for uptime monitoring

**Deployment options for the crawl server:**

| Host | Cost | Why |
|------|------|-----|
| **Fly.io** | Free tier (3 shared VMs) or $5/mo | Docker-based, easy deploy, auto-sleep when idle, wake on request |
| **Railway** | Usage-based (~$5/mo) | Git-push deploy, good DX, built-in cron |
| **Render** | Free (spins down) or $7/mo (always on) | Simple, background workers supported |
| **VPS (Hetzner/DigitalOcean)** | $4-6/mo | Full control, always on, cheapest for 24/7 |
| **Docker on your own machine** | $0 | For dev/testing; not reliable for production |

| Pros | Cons |
|------|------|
| No timeout limits — crawl for hours | Separate service to deploy and maintain |
| Full Puppeteer + curl + any binary | Costs $0-7/mo depending on host |
| Perfect for overnight batch crawls | Need to secure the API (shared secret / API key) |
| Can run cron schedules independently | Monitoring / alerting needed for reliability |
| Writes directly to Supabase — Vercel reads from DB | Two codebases (or monorepo with shared types) |
| Scales independently from the main app | |

**Security:** Crawl server API protected by a shared secret (`CRAWL_API_KEY` env var). Vercel sends it as Bearer token. Crawl server validates before accepting jobs.

**Verdict:** The natural complement to Option A. Option A handles real-time URL analysis on Vercel. Option A.1 handles batch/overnight crawling without any Vercel limitations. Together they cover both use cases completely.

---

### Option A.2: Claude Code Headless as Overnight Crawl Runner
**How:** Use Claude Code's headless mode (`claude -p`) or the Claude Agent SDK to orchestrate overnight crawls. Claude acts as the crawl operator — it runs the existing Puppeteer scrapers, handles errors, retries failures, and writes results to Supabase. Triggered by cron (local, GitHub Actions, or cloud scheduler).

**How it works:**
```bash
# Cron entry (2 AM daily) — runs on any machine with Claude Code installed
0 2 * * * claude -p "Run the overnight skincare crawl: \
  1. Launch Puppeteer and crawl Hwahae serums, toners, moisturizers \
  2. Then crawl Olive Young same categories \
  3. For each product, extract ingredients and compute IPS score \
  4. Write all results to Supabase external_products table \
  5. Report summary: total crawled, failures, new products found" \
  --allowedTools Bash,Read \
  --permissionMode acceptEdits \
  >> /var/log/skums-crawl.log 2>&1
```

**Or with the Agent SDK (programmatic):**
```typescript
import { Agent } from '@anthropic-ai/claude-agent-sdk'

const agent = new Agent({
  model: 'claude-sonnet-4-6',
  tools: ['bash', 'read', 'write'],
})

const result = await agent.run(
  `Run the SKUMS overnight crawl:
   - cd /path/to/skums
   - Execute: node -e "import('./server/utils/scrapers/hwahae.ts')"
   - Crawl categories: serums, toners, moisturizers, suncare
   - Write results to Supabase
   - If any category fails, retry once, then skip and continue
   - At the end, summarize: products crawled, failures, IPS scores computed`,
  { maxSteps: 200 }
)
```

| Pros | Cons |
|------|------|
| $0 infrastructure cost (runs on your machine or any box with Claude Code) | Requires a machine that's on at crawl time |
| Claude handles error recovery, retries, edge cases intelligently | Claude API costs per invocation (~$0.50-2 per crawl session) |
| No new server to deploy or maintain | Session-scoped — each run is stateless |
| Can reason about failures ("this page changed layout, adapt selector") | Not truly "set and forget" without external cron |
| Uses your existing scrapers as-is — no code changes needed | Long crawls may hit context limits |
| Built-in logging and summary generation | /loop skill expires after 3 days |
| Can also monitor results: "check if any products have IPS < 30" | |

**Key constraints:**
- Headless mode is stateless — each `-p` invocation is a fresh session
- No built-in scheduling — need external cron (local crontab, GitHub Actions, or cloud scheduler)
- `/loop` skill works within an active session but expires after 3 days
- Session limit: 50 scheduled tasks max
- Standard Claude API pricing applies; Batch API offers 50% discount for async work

**Best for:** Teams already using Claude Code who want intelligent crawl orchestration without deploying infrastructure. Claude's ability to adapt to page layout changes, handle unexpected errors, and generate crawl reports makes it more than just a cron job.

**Verdict:** The zero-infrastructure option. No servers to deploy — Claude runs the crawl scripts on any machine via headless mode or the Agent SDK. Trade-off: you pay Claude API costs instead of server costs ($0.50-2/crawl vs $5-7/mo for a VPS). Best when crawl frequency is low (nightly) and you value intelligent error handling over raw throughput.

---

### Option A + A.1 Combined: The Recommended Architecture

```
┌─────────────────────────────────────────────────────────┐
│  VERCEL (skums main app)                                │
│                                                         │
│  UI: Integrations → Skincare Intelligence               │
│  ├── Product Catalog (reads from Supabase)              │
│  ├── URL Analyser (Option A: @sparticuz/chromium)       │
│  ├── Methodology tab                                    │
│  ├── Scoring engine (IPS, skin type, conflicts)         │
│  └── Crawl trigger UI → calls crawl server API          │
│                                                         │
│  On-demand scraping: ✓ (single page, <60s)              │
│  Batch crawling: ✗ (delegates to crawl server)          │
└────────────────────────┬────────────────────────────────┘
                         │ POST /crawl (job config)
                         │ Bearer CRAWL_API_KEY
                         ▼
┌─────────────────────────────────────────────────────────┐
│  CRAWL SERVER (Fly.io / Railway)                        │
│                                                         │
│  POST /crawl     — start a crawl job                    │
│  GET  /jobs      — list jobs                            │
│  GET  /jobs/:id  — job status + progress                │
│  POST /stop/:id  — cancel a running job                 │
│                                                         │
│  Puppeteer + curl + stealth + browser recycling         │
│  Scrapers: Hwahae, Olive Young, iHerb (extensible)     │
│  Cron: configurable overnight schedules                 │
│                                                         │
│  Writes directly to Supabase:                           │
│  ├── external_products (product data + ingredients)     │
│  ├── skincare_crawl_jobs (job status/progress)          │
│  └── product scoring (IPS, concerns, conflicts)         │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  SUPABASE                                               │
│                                                         │
│  external_products, ingredient_safety,                  │
│  skincare_concerns, conflict_families,                  │
│  skincare_crawl_jobs, product scoring data              │
└─────────────────────────────────────────────────────────┘
```

### Option B: Browserless.io (Cloud Browser API)
**How:** Connect `puppeteer-core` to `wss://chrome.browserless.io?token=XXX`. Browser runs on their infra, our serverless function just sends commands.

| Pros | Cons |
|------|------|
| No binary in our bundle | External dependency |
| Works for both URL Analyser and batch | ~$0.01-0.02 per browser session |
| Built-in stealth mode + proxy rotation | Requires API key |
| Scales to hundreds of concurrent sessions | Free tier = 6 hours/month |
| No timeout issues (their browser stays open) | Paid from $50/mo for serious usage |

**Verdict:** Best overall if willing to pay. Solves both use cases.

### Option C: Cloudflare Browser Rendering REST API
**How:** POST a URL to `https://api.cloudflare.com/client/v4/accounts/<id>/browser-rendering/crawl`. Cloudflare spins up a headless browser, renders the page (executes JS), and returns HTML/Markdown/JSON. Async — POST starts the job, GET polls for results.

| Pros | Cons |
|------|------|
| Serverless-compatible (just an HTTP call from Vercel) | Fixed User-Agent (`CloudflareBrowserRenderingCrawler/1.0`) — cannot customize |
| Full JS rendering (headless browser on their infra) | Cannot bypass CAPTCHAs or advanced bot protection |
| Returns HTML, Markdown, or AI-extracted JSON | Async model — need polling logic (~5-15s for single page) |
| Free tier available | Free tier has undisclosed "additional restrictions" |
| Can follow links (depth + limit params, up to 100k pages) | Respects `robots.txt` — may be rate-limited by target sites |
| Bearer token auth, easy setup | Billed per browser-millisecond when `render: true` |
| 14-day result retention, 7-day max crawl runtime | Crawl-delay directives honored (slows batch crawls) |

**Key details:**
- `render: true` (default) = JS execution = real headless browser. This is what we need for SPAs.
- `render: false` = static fetch on Workers infra (cheaper but no JS, same as our fetch problem).
- Response includes rendered HTML — we can extract JSON-LD, ingredients, ratings from it.
- `formats: ["html", "markdown"]` — markdown is useful for feeding to Grok.
- Authentication: Bearer token with "Browser Rendering - Edit" permission.
- `X-Browser-Ms-Used` header reports actual browser time for billing.

**Risk:** iHerb/Olive Young may block the `CloudflareBrowserRenderingCrawler` UA. If they do, same problem as fetch(). Would need to test.

**Verdict:** Strong contender for URL Analyser (single page, async OK). For batch crawling, the crawl endpoint with `limit` + `depth` is purpose-built. The unknown is whether target sites block the Cloudflare UA. Worth testing on free tier before committing.

---

### Option D: Third-Party Scraping API (ScraperAPI, Bright Data, Oxylabs)
<!-- formerly Option C -->
**How:** Send URL → get back rendered HTML or JSON. They handle proxies, anti-bot, JS rendering.

| Pros | Cons |
|------|------|
| Simplest integration (just an HTTP call) | Pay per request ($0.001-0.01 per request) |
| Works everywhere (Vercel, local, anywhere) | Another vendor dependency |
| Built-in proxy rotation and anti-detection | Rate limits on free tiers |
| No Puppeteer/Chromium needed at all | Some sites still block even these services |

**Verdict:** Easiest to implement. Good for URL Analyser. Batch crawling costs scale linearly.

### Option E: Separate Worker Service (VPS / Railway / Fly.io)
**How:** Run the crawl worker on a cheap VPS ($5-10/mo). Vercel calls it via API. Worker has full Puppeteer + curl + no timeouts.

| Pros | Cons |
|------|------|
| Full control — no timeout or binary limits | Another service to manage |
| Perfect for batch crawling (run for hours) | Need to set up deployment pipeline |
| Puppeteer works natively | Costs $5-10/mo for a basic VPS |
| Can also serve URL Analyser via API | Network latency between Vercel ↔ worker |

**Verdict:** Best for batch crawling. Overkill for just URL Analyser.

### Option F: Hybrid — Vercel for UI + Supabase Edge Function for Scraping
**How:** Keep UI/API on Vercel. Move scrape logic to a Supabase Edge Function (Deno-based, 150s wall time) or Supabase Background Task.

| Pros | Cons |
|------|------|
| Stays within existing Supabase billing | Deno Puppeteer is less mature |
| No new vendor | 150s timeout still tight for batch |
| Supabase already in our stack | Edge Functions have limited runtime APIs |

**Verdict:** Viable for URL Analyser. Batch crawling would need Supabase Background Tasks (newer feature, less documented).

### Option G: Pre-Crawl Locally, Query from Vercel
**How:** Run batch crawls from local dev machine (or a cron-scheduled script on any machine). Store all product data in Supabase. Vercel reads from DB only — never scrapes.

| Pros | Cons |
|------|------|
| Vercel stays simple (no scraping at all) | Requires a machine to run crawls |
| All data in Supabase = fast queries | Data freshness depends on crawl frequency |
| URL Analyser can check DB first, scrape only if missing | Manual or semi-automated process |
| $0 cost | Single point of failure (your machine) |

**Verdict:** The pragmatic choice for now. Already works today — just need to formalize it.

---

## Recommended Path

### Phase 1: Now (local dev)
**Option G** — Continue running crawls locally on `dev/skincare-intelligence` branch. Store results in Supabase. Vercel serves UI and reads from DB. URL Analyser on Vercel uses Grok knowledge fallback.

### Phase 2: Production URL Analyser
**Option A** — Add `@sparticuz/chromium` + `puppeteer-core` to the Vercel app. Single-page URL analysis works within 60s Pro timeout. Real Chromium bypasses TLS fingerprint blocks. This is the standard Vercel pattern.

### Phase 3: Automated Batch Crawling (choose one)

**Option A.1 (Dedicated server)** — Deploy a crawl server to Fly.io/Railway ($0-7/mo). Best for high-frequency crawls, full control, and production reliability.

**Option A.2 (Claude Code headless)** — Use `claude -p` via cron on any machine. Zero infrastructure, intelligent error handling, uses existing scrapers as-is. Best for low-frequency crawls (nightly) when you want simplicity over throughput. Trade-off: ~$0.50-2 per crawl in API costs vs $5-7/mo flat for a server.

**Option C (Cloudflare Browser Rendering)** — Managed headless browsers, no server needed. Risk: fixed UA may be blocked by target sites. Test on free tier first.

---

## Current Architecture (Phase 1)

```
LOCAL DEV (your machine)
├── Puppeteer crawlers (Hwahae, Olive Young)
├── curl fallback for anti-bot sites (iHerb)
├── Batch crawl → stores in Supabase `external_products`
└── URL Analyser with full HTML extraction + JSON-LD parsing

VERCEL (production)
├── UI: Product Catalog, Methodology tab, Score Cards
├── URL Analyser: fetch() → if blocked → Grok knowledge fallback
├── Scoring engine: IPS, skin type fit, conflict detection (works without scraping)
└── Reads from Supabase (crawled data from local runs)

SUPABASE
├── external_products (crawled product data)
├── ingredient_safety (scoring reference)
├── skincare_concerns, conflict_families (methodology data)
└── All scoring/analysis data persisted here
```

## Target Architecture (Phase 2 + 3: Option A + A.1)

```
VERCEL (skums main app)
├── UI: Integrations → Skincare Intelligence
├── URL Analyser: @sparticuz/chromium (real Chromium, <60s) ← Phase 2
├── Scoring engine: IPS, skin type, conflicts
├── Crawl trigger UI → POST to crawl server ← Phase 3
└── Reads from Supabase

CRAWL SERVER (Fly.io / Railway, $0-7/mo) ← Phase 3
├── Full Puppeteer + curl + stealth
├── Scrapers: Hwahae, Olive Young, iHerb (extensible)
├── API: POST /crawl, GET /jobs, GET /jobs/:id
├── Cron: nightly scheduled crawls
└── Writes directly to Supabase

SUPABASE
├── external_products, skincare_crawl_jobs
├── ingredient_safety, skincare_concerns
├── conflict_families, pairwise_conflicts
└── All scoring/analysis data
```
