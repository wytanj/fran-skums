# Scraping with gstack: Browser-First Crawl Architecture

## Context

Our current scraping stack (Puppeteer + Node fetch) has friction:
- **Puppeteer**: Heavy startup (2-3s per browser launch), crashes under load, can't preserve sessions
- **Node fetch**: Gets 403'd by anti-bot systems (iHerb, CloudFlare-protected sites)
- **Vercel**: Can't run headless Chrome at all in serverless

gstack (github.com/garrytan/gstack) provides a **persistent Chromium daemon** with sub-second commands, session reuse, and cookie persistence — designed to work with Claude Code. This doc plans how to use it for SKUMS skincare product crawling.

---

## What gstack's `/browse` gives us

### Architecture

```
┌─────────────┐     HTTP     ┌──────────────┐     CDP      ┌────────────┐
│ Claude Code  │ ──────────→ │ gstack server │ ──────────→ │  Chromium   │
│ (headless)   │  100-200ms  │  (Bun.serve)  │             │  (daemon)   │
└─────────────┘             └──────────────┘             └────────────┘
                                                            │
                                 Persists:                  │
                                 - Cookies                  │
                                 - Login sessions           │
                                 - localStorage             │
                                 - Open tabs                │
                                 - 30-min idle shutdown     │
```

### Key advantages over Puppeteer

| Feature | Puppeteer (current) | gstack /browse |
|---------|-------------------|----------------|
| Browser startup | 2-3s per launch | 100-200ms (persistent) |
| Session persistence | None (fresh each time) | Cookies, login, localStorage preserved |
| Anti-bot detection | High (detectable TLS fingerprint) | Lower (real Chrome with real profile) |
| Memory management | Crashes under load (we saw this) | Single daemon, sequential execution |
| Error recovery | Manual try/catch | Auto-retry, staleness detection |
| Element targeting | CSS selectors (brittle) | Accessibility tree refs (@e1, @e2) — framework-agnostic |
| SPA handling | Manual `waitForSelector` | Auto re-snapshot on DOM mutations |

### Command types

**READ commands** (safe, retryable):
- `snapshot` — accessibility tree of current page (used for element refs)
- `text @ref` — get text content of element
- `html @ref` — get HTML of element
- `cookies` — dump current session cookies

**WRITE commands** (mutate state):
- `goto <url>` — navigate to URL
- `click @ref` — click element by ref
- `fill @ref <value>` — type into input
- `scroll down/up` — scroll page

**META commands:**
- `tabs` — list open tabs
- `chain [cmd1, cmd2, ...]` — execute multiple commands atomically
- `shutdown` — stop the daemon

---

## Crawl Strategy: gstack + Claude Code Headless

### The Concept

Instead of writing Puppeteer scripts that break when page layouts change, we let **Claude drive the browser conversationally**. Claude can:
1. Navigate to a product page
2. Read the accessibility tree (structured, not raw HTML)
3. Extract product name, price, rating, reviews, ingredients
4. Handle unexpected layouts by reasoning about what it sees
5. Write results to Supabase via Bash/Node commands

This is fundamentally more resilient than CSS selectors.

### Workflow: Overnight Hwahae Crawl

```bash
# Cron: 2 AM daily
claude -p "$(cat <<'PROMPT'
You are running the nightly SKUMS skincare crawl.

## Setup
- Working directory: /path/to/skums
- Target workspace: 4fdea5f5-413a-40b8-9b39-9fcad66ebf17
- Supabase connection: use SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env

## Step 1: Crawl Hwahae Rankings
For each category (serums, toners, moisturizers, suncare, cleansers):
1. /browse goto https://www.hwahae.com/en/rankings?english_name=category&theme_id=<id>
2. /browse snapshot — read the product list
3. For each product in the top 20:
   a. /browse click on the product
   b. /browse snapshot — read the product detail page
   c. Extract: name, brand, price, rating, review count, full INCI ingredient list
   d. /browse back — return to listings

## Step 2: Crawl Olive Young Bestsellers
Same pattern for https://global.oliveyoung.com/categories/<category>

## Step 3: Score & Store
For each product:
1. Parse INCI ingredients
2. Run through the IPS scoring engine (use server/utils/skincare-scoring.ts)
3. Compute skin type fit, concern tags, conflict flags
4. Upsert into external_products table in Supabase

## Step 4: Report
Summarize: total products crawled, new vs updated, average IPS, any failures.
PROMPT
)" \
  --allowedTools Bash,Read,Write \
  --permissionMode acceptEdits \
  >> /var/log/skums-crawl.log 2>&1
```

### Workflow: iHerb Product Analysis (On-Demand)

```bash
# User triggers via URL Analyser UI → API calls Claude headless
claude -p "$(cat <<'PROMPT'
Analyze this iHerb product: https://sg.iherb.com/pr/anua-niacinamide-10-txa-4-serum/147912

1. /browse goto <url>
2. /browse snapshot
3. Extract from the page:
   - Product name, brand
   - Price (SGD)
   - Rating and review count
   - "X sold in 30 days" badge
   - UPC code
   - Package quantity
   - Full ingredient list (under Description + Other Ingredients)
4. Return as JSON: { name, brand, price, rating, reviewCount, salesVelocity, upc, packageQty, ingredients[] }
PROMPT
)" --output json
```

---

## Implementation Plan

### Phase 1: Install & Validate (30 min)

```bash
# Install gstack
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack
./setup

# Import browser cookies (for sites that need login)
# /setup-browser-cookies — imports from Chrome/Arc/Edge
```

**Validate with a manual test:**
```
/browse goto https://www.hwahae.com/en/rankings?english_name=category&theme_id=2
/browse snapshot
# → Should see product list with accessibility refs (@e1, @e2, etc.)
/browse click @e5
# → Navigate to product detail
/browse snapshot
# → Should see product details, ingredients, reviews
```

### Phase 2: Crawl Script (1-2 hours)

Create `scripts/crawl-skincare.md` — a Claude Code prompt file that:
1. Defines the crawl targets (Hwahae categories, OY categories)
2. Uses `/browse` to navigate and extract data
3. Uses Bash to run the scoring engine and write to Supabase
4. Handles pagination, errors, and rate limiting

### Phase 3: Scheduling (30 min)

Option A: Local crontab
```bash
0 2 * * * claude -p "$(cat /path/to/skums/scripts/crawl-skincare.md)" --allowedTools Bash,Read >> /var/log/skums-crawl.log 2>&1
```

Option B: GitHub Actions
```yaml
name: Nightly Skincare Crawl
on:
  schedule:
    - cron: '0 18 * * *'  # 2 AM SGT = 6 PM UTC
jobs:
  crawl:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: |
          claude -p "$(cat scripts/crawl-skincare.md)" \
            --allowedTools Bash,Read,Write \
            --permissionMode acceptEdits
```

Option C: Claude `/loop` (within active session)
```
/loop 24h Run the nightly skincare crawl from scripts/crawl-skincare.md
```
Note: Expires after 3 days. Only works while session is active.

---

## Cost Estimate

| Component | Cost |
|-----------|------|
| gstack | Free (open source) |
| Chromium daemon | $0 (runs locally) |
| Claude API per crawl | ~$0.50-2.00 (depends on product count) |
| Supabase writes | Free tier covers it |
| **Daily crawl (30 days)** | **~$15-60/month** |

Compare: Dedicated crawl server (Option A.1) = $5-7/mo flat, but doesn't self-heal or adapt to layout changes.

---

## Advantages Over Current Puppeteer Approach

### 1. Self-Healing Scrapers
When Olive Young redesigns their product page (which broke our selectors last time), Claude reads the new accessibility tree and adapts. No code changes needed.

### 2. No "Connection closed" Crashes
gstack's sequential execution model (one command at a time through a persistent browser) eliminates the memory pressure that crashed our Puppeteer crawl at 11/24 products.

### 3. Anti-Bot Resilience
Real Chrome with real cookies and login sessions. Sites like iHerb that 403 Node `fetch` will serve full pages to gstack's browser.

### 4. Session Reuse for Authenticated Sites
Some marketplace data requires login (Hwahae full ingredient lists, OY pricing tiers). gstack preserves login sessions across commands — log in once, crawl forever.

### 5. Ingredient Extraction Quality
Instead of regex-matching INCI lists from raw HTML (which picked up review text last time), Claude reads the structured accessibility tree and can distinguish "Ingredients:" section from review content by semantic understanding.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Claude API cost scales with product count | $60/mo at daily crawls | Use batch API (50% discount), crawl every 3 days instead of daily |
| gstack Chromium daemon crashes mid-crawl | Lost progress | Auto-restart daemon + checkpoint progress to Supabase after each product |
| Sites detect automated browsing patterns | Rate limits / blocks | Add random delays (2-5s between pages), use `/browse` cookie import for auth |
| Claude hallucinating product data | Bad data in DB | Validate extracted data against JSON-LD structured data when available |
| Context window limits on large crawls | Crawl stops mid-way | Split into per-category invocations (one `claude -p` per category) |

---

## Comparison: All Scraping Options

| | A.1 Dedicated Server | A.2 Claude Headless | A.3 gstack /browse | C. Cloudflare |
|---|---|---|---|---|
| **Infra cost** | $5-7/mo | $0 | $0 | $0-5/mo |
| **API cost** | $0 | $0.50-2/crawl | $0.50-2/crawl | $0 |
| **Self-healing** | No | Partial | Yes | No |
| **Anti-bot** | Weak (Puppeteer detected) | Weak (same) | Strong (real Chrome) | Moderate (CF UA) |
| **Session reuse** | Manual | None | Built-in | None |
| **Setup effort** | High (deploy server) | Low (cron + prompt) | Low (git clone + setup) | Medium (CF config) |
| **Best for** | High-frequency, production | Low-frequency, simple | Authenticated sites, resilient crawling | Simple static pages |

---

## Next Steps

1. Install gstack and validate `/browse` works against Hwahae and Olive Young
2. Write the crawl prompt script (`scripts/crawl-skincare.md`)
3. Test a single category crawl end-to-end (browse → extract → score → Supabase)
4. Set up scheduling (cron or GitHub Actions)
5. Compare data quality vs current Puppeteer output
