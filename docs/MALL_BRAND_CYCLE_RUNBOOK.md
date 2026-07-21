# Mall brand cycle runbook (operator)

Procedural cycle for mapping **official Shopee Mall shops** into Fran SKUMS: identity → list/shelves → platform PDP path.

**Workspace (pilot):** `c21c057f-ea01-4e19-bc79-fafcf2626b19`  
**Prod API:** `https://fran-skums.vercel.app`  
**Extension:** `extensions/skums-shopee-shop-resolve` (side panel, v0.5+)

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

1. API key on the pilot workspace: scopes `intel:read` + `intel:write`.
2. Chrome extension: `chrome://extensions` → Load/Reload **SKUMS Shopee Shop Resolve**.
3. Side panel → Settings → API base `https://fran-skums.vercel.app` + key → Save → **Refresh brands**.
4. Warm Chrome profile for automation:
   - Dir: project `.shopee-chrome-profile`
   - Prefer **remote debugging** (less captcha than Puppeteer-only launch).

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
| `--pause-load` | Enter after **every** page (babysit; optional) |

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

## Captcha tips

Default automation is **captcha-only pause** (not every page). When blocked you hear a **bell** and the terminal waits for **Enter**.

| Symptom | What to do |
|---------|------------|
| Bell / “Solve captcha” | Fix in Chrome → **Enter** in terminal |
| Page paints then captcha | Wait for auto detect, or use `--pause-load` once |
| `detached Frame` | Solve captcha; Enter; script soft-reloads |
| Launch always blocked | Use **`--connect`** + logged-in debug Chrome |
| Still hopeless | Extension **Harvest** on the open tab |

**One Chrome for all brands** — do not restart debug Chrome per brand.

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

---

## Code map

| Step | Module / script |
|------|-----------------|
| Link / discover / single-page harvest | `extensions/skums-shopee-shop-resolve/` |
| Full cycle (list + MH-4) | `scripts/mall-brand-cycle.mjs` · state `.mall-cycle-state.json` |
| MH-2/3 list harvest | `scripts/mall-all-products-harvest.mjs` · `marketplace/mallHarvestWorker.mjs` · `computerHarvest.mjs` |
| MH-4 PDP path | `scripts/mall-pdp-breadcrumb-enrich.mjs` · `marketplace/parseBreadcrumb.mjs` · `pdpEnrich.mjs` |
| Data check | `scripts/_check_recent_harvest.mjs` |
