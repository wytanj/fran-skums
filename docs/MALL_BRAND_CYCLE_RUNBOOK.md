# Mall brand cycle runbook (operator)

Procedural cycle for mapping **official Shopee Mall shops** into Fran SKUMS: identity → list/shelves → platform PDP path.

**Workspace (pilot):** `c21c057f-ea01-4e19-bc79-fafcf2626b19`  
**Prod API:** `https://fran-skums.vercel.app`  
**Extension:** `extensions/skums-shopee-shop-resolve` (side panel, v0.5+)  
**Harvest host (intent, 2026-08-14):** an **on-prem Linux and/or Windows PC** that stays on — not this laptop, not Browserbase, not Vercel. Same CLI + warm Chrome/CDP. Laptop = link/discover + captcha RDP. See `TODO.md` Track G / BR.

Commands below still work on the current desktop until that box exists. Point them at the on-prem machine once it does. Prefer **Windows** (or a Windows VM) for Shopee headed Chrome. Keep iHerb on a **separate** profile/port (`:9223`) so a Shopee bounce cannot kill it.

---

## Dual taxonomy (remember)

| Layer | What | When |
|-------|------|------|
| **A. Marketing** | Seller shelves (`shopCollection`) e.g. Bundle SET, Serums | MH-1 discover + MH-2/3 list harvest |
| **B. Platform** | Shopee Category path e.g. Beauty → Skincare → Eye Care | **MH-4** PDP BreadcrumbList |

Never force 1:1 between A and B.

## Single-brand vs multi-brand distributor shops (MH-7)

| Shop type | Example | Ops |
|-----------|---------|-----|
| **Single-brand official** | `beautyofjoseonsg`, `biodance.sg` | Normal: Link → Discover → CLI cycle |
| **Multi-brand distributor** | `amorepacific.hair.body.shop` | Extension: tick **Multi-brand distributor shop** → check **2+ brands** → Link. Harvest attributes each SKU by **title** to the allowlist. |

### Extension multi-brand flow

1. Open the distributor Mall tab  
2. Side panel → enable **Multi-brand distributor shop**  
3. Filter + check brands sold in that shop  
4. **Link** → API sets `shop_kind=multi_brand_distributor` + allowlist on each brand  
5. Discover/Harvest as usual — products get `brand_key` from title match (unmatched stay unattributed)

**Found more brands later?** Re-open the shop, multi-brand mode (auto-on if already a distributor), tick the **new** brands (or full set), **Link** again. Allowlist **merges** with what’s already on that shop — you don’t need to re-check everyone. Then re-harvest so new titles get attributed.

Prefer a brand’s **own** mono-brand Mall when it exists; use multi-brand only when the group store is the official channel.

---

## One-time setup

Do this on the **harvest host** (today: this desktop; intended: on-prem PC). The Chrome extension for Link/Discover can stay on the laptop.

1. API key on the pilot workspace: scopes `intel:read` + `intel:write`.
2. Chrome extension: `chrome://extensions` → Load/Reload **SKUMS Shopee Shop Resolve**.
3. Side panel → Settings → API base `https://fran-skums.vercel.app` + key → Save → **Refresh brands**.
4. Warm Chrome profile for automation:
   - Dir: project `.shopee-chrome-profile` **on the harvest host**
   - Prefer **remote debugging** (less captcha than Puppeteer-only launch).
   - Do not share this profile with daily browsing or with iHerb.

### Start Chrome for harvest (PowerShell)

Close other Chrome windows first, then:

```powershell
cd "C:\Users\Jeremy Tan\CodeProjects\fran-skums"
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$PWD\.shopee-chrome-profile"
```

In that window: open shopee.sg, log in, solve any captcha once.

---

## Per-brand cycle (repeat ×5)

### Step A — Link Mall shop → brand (extension)

1. Open official shop, e.g. `https://shopee.sg/biodance.sg`
2. Side panel: brand auto-guess (or **Filter brands** + pick)
3. **Link this Mall page to brand**

### Step B — Marketing shelves MH-1 (extension)

1. On shop home: **Discover collections** → **Push collections**
2. Top nav shelves land on brand metadata (`shop_collections`)
3. Product-line shelves under “More” / “Shop By Product Lines” may need you to open them and Discover again

### Step C+D — Automated list + MH-4 (one command)

Second terminal (same debug Chrome still open). **Default: pause only on captcha** (terminal bell + Enter).

```powershell
cd "C:\Users\Jeremy Tan\CodeProjects\fran-skums"

# Plan
node scripts/mall-brand-cycle.mjs -w c21c057f-ea01-4e19-bc79-fafcf2626b19 --brand biodance --connect --dry-run

# Run list (all+shelves) + MH-4 top 15 PDPs
node scripts/mall-brand-cycle.mjs -w c21c057f-ea01-4e19-bc79-fafcf2626b19 --brand biodance --connect --list-mode both --max-pages 2 --mh4-top 15

# Several linked brands
node scripts/mall-brand-cycle.mjs -w c21c057f-ea01-4e19-bc79-fafcf2626b19 --brand biodance,anua,axis-y --connect --skip-done
```

| Flag | Meaning |
|------|---------|
| `--connect` | Use your debug Chrome (best vs captcha) |
| `--list-mode both` | All Products + marketing shelves |
| `--mh4-top N` | Top sold PDPs for platform path |
| `--skip-done` | Skip brands already ok in `.mall-cycle-state.json` |
| `--skip-list` / `--skip-mh4` | Run only one half |
| `--pause-load` | Enter after **every** page (babysit; ignored with no TTY) |
| `--recovery-minutes N` | How long to poll for a human to clear a captcha (default 15) |
| `--cooldown-hours N` | Skip a blocked brand for N hours on re-run (default 6) |
| `--max-consecutive-blocked N` | Abort after N brands block back-to-back (default 3) |
| `--no-notify` | Silence blocked/recovered pings |

State file: **`.mall-cycle-state.json`** (list/mh4 timestamps per brand). Safe to delete to re-run.

### Manual split commands (if you prefer)

```powershell
# List only
node scripts/mall-all-products-harvest.mjs -w c21c057f-ea01-4e19-bc79-fafcf2626b19 --brand biodance --mode both --computer --connect --max-pages 2

# MH-4 only
node scripts/mall-pdp-breadcrumb-enrich.mjs -w c21c057f-ea01-4e19-bc79-fafcf2626b19 --brand biodance --top 20 --computer --connect
```

### Step E — Verify

```powershell
node scripts/_check_recent_harvest.mjs
```

Expect:

- Listings with sold + titles  
- Snapshots with `harvest_source` `mall_all_products_harvest` / `mall_collection_harvest` / `mall_pdp_mh4`  
- MH-4 rows with platform path text (e.g. `… > Skincare > Eye Care`)

### Step F — Analyze / spreadsheet (MCP or API)

**MCP** (Claude / agent with `intel:read` key):

| Tool | Purpose |
|------|---------|
| `market_brand_summary` | Overview: sold bands, top SKUs, shelf/platform mix (plan the sheet) |
| `market_brand_listings` | JSON table: brand, title, sold, marketing shelf, platform path, URL |
| `market_brand_export_csv` | Same filters → **CSV text** for Google Sheets / Excel |

Example args:

```json
{ "brand_key": "biodance" }
{ "brand_key": "biodance", "min_sold": 1000, "limit": 100 }
{ "brand_key": "biodance", "shop_collection_name": "Bundle", "limit": 50 }
{ "brand_keys": ["biodance", "anua"], "limit": 200 }
```

**Local CLI** (no deploy; uses Supabase service role from `.env`):

```powershell
node scripts/export-brand-listings.mjs -w c21c057f-ea01-4e19-bc79-fafcf2626b19 --brand biodance --summary
node scripts/export-brand-listings.mjs -w c21c057f-ea01-4e19-bc79-fafcf2626b19 --brand biodance --format csv -o biodance.csv
```

**HTTP** (after deploy; same filters as query params):

```http
GET /api/v1/marketplace/brand-listings?brand_key=biodance&format=csv&raw=1
GET /api/v1/marketplace/brand-summary?brand_key=biodance
Authorization: Bearer sk_live_…
```

Columns: `brand_key, shop_username, title, sold_label, sold_count_lower_bound, shop_collection_*, platform_category_*, price, listing_url, …`

---

## Captcha handling (MH-9 — no Enter required)

When a wall appears the run **polls** until it clears. You do **not** have to be at
the terminal, and there is no keypress to miss — this is what makes the cycle
schedulable.

What happens:

1. Bell + `[recover] … blocked — solve it in Chrome` (and a Slack/in-app ping if configured)
2. The run re-probes every 5s for up to `--recovery-minutes` (default **15**)
3. You solve the captcha in Chrome whenever you notice → the run resumes on its own
4. If nobody solves it in time → that brand is **cooled down** (default 6h) and the
   run **continues to the next brand**
5. Only **3 consecutive** blocked brands aborts the run (exit code **2**) — that
   means the session itself died, not one difficult shop

| Symptom | What to do |
|---------|------------|
| Bell / “Solve captcha” | Fix it in Chrome **whenever you see it** — no Enter needed (Enter just re-checks sooner) |
| Page paints then captcha | Nothing — polling detects the clear automatically |
| `detached Frame` | Nothing — the poller soft-reloads the URL itself |
| Brand skipped as “cooled down” | Expected after a timeout. Re-run later, or lower `--cooldown-hours` |
| Run exited with code 2 | Session died — re-login in the debug Chrome, re-run with `--skip-done` |
| Launch always blocked | Use **`--connect`** + logged-in debug Chrome |
| Still hopeless | Extension **Harvest** on the open tab |

**One Chrome for all brands** — do not restart debug Chrome per brand.

### Notifications (optional but recommended)

```powershell
$env:SKUMS_API_BASE = "https://fran-skums.vercel.app"
$env:MARKETPLACE_CRON_SECRET = "<same secret as the cron routes>"
```

Sends `marketplace.harvest.blocked` / `.recovered` through the Phase N bus
(in-app + Slack, migration **075**). Without them the run still works — it just
polls silently. `--no-notify` disables.

---

## Brand keys (examples)

| Brand | `--brand` | Typical shop |
|-------|-----------|--------------|
| Biodance | `biodance` | `biodance.sg` |
| Anua | `anua` | `anua.sg` |
| AXIS-Y | `axis-y` | `axisysg` |
| Beauty of Joseon | `beauty-of-joseon` | `beautyofjoseonsg` |

---

## What not to do

- Don’t open every PDP manually just to “link brand” — brand is shop-level.  
- Don’t treat Mall “Serums” as Shopee “Eye Care”.  
- Don’t run MH-4 before any list harvest (no candidates).  
- Don’t use cold Browserbase as primary for this path.  
- Don’t keep the overnight grind on the personal desktop once the on-prem harvest PC exists.

---

## Code map

| Step | Module / script |
|------|-----------------|
| Link / discover / single-page harvest | `extensions/skums-shopee-shop-resolve/` |
| Full cycle (list + MH-4) | `scripts/mall-brand-cycle.mjs` · state `.mall-cycle-state.json` |
| MH-2/3 list harvest | `scripts/mall-all-products-harvest.mjs` · `marketplace/mallHarvestWorker.mjs` · `computerHarvest.mjs` |
| MH-4 PDP path | `scripts/mall-pdp-breadcrumb-enrich.mjs` · `marketplace/parseBreadcrumb.mjs` · `pdpEnrich.mjs` |
| Data check | `scripts/_check_recent_harvest.mjs` |
