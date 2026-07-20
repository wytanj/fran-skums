# SKUMS Shopee Shop Resolve (Chrome extension)

Resolves **official Shopee Mall shop usernames** into Fran SKUMS `marketplace_brand_universe` using **your logged-in Chrome session** — no Puppeteer, no cold-browser captcha loop.

This is the practical path after Puppeteer discovery hit `session_health=blocked`.

## What it is / isn’t

| Is | Isn’t |
|----|--------|
| Session-backed **shop identity** tool | Full crawl engine |
| Human-in-the-loop (you open Shopee, click scan) | Unattended overnight scraper |
| Writes `shop_username` + `confirmed` | Collects listings (weekly worker still does that) |

After shops are confirmed, re-run materialize so seeds become `mode=shop`.

## Install (Chrome or Edge)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. **Load unpacked** → select this folder:
   ```
   fran-skums/extensions/skums-shopee-shop-resolve
   ```
4. Pin the extension

## Configure

1. Click the extension icon  
2. **API base:**  
   - **Until brand-radar is deployed:** `http://127.0.0.1:3000` with `npm run dev`  
   - **After deploy:** `https://fran-skums.vercel.app`  
   If Load brands returns HTML / Fran SKUMS page title, the API route is not on that host.
3. **API key:** SKUMS key with **`intel:read` + `intel:write`**, for the **same workspace** that has brand universe rows  
4. **Save settings** → **Load brands**  
5. Status line should show e.g. `Loaded 125 brands (124 need shop)` and a `workspace: <uuid>`

### “— all confirmed —” or empty brands

Usually **not** “everything is done” — it was a bad empty-state label (fixed in popup). Real causes:

| Symptom | Cause |
|---------|--------|
| `0 brands` / no brands in key’s workspace | API key is for a **different workspace** than import (`c21c057f-…`) |
| HTTP 401/403 | Key missing `intel:read` or invalid |
| HTTP 500 / relation does not exist | Prod DB missing mig **068/069** |

**Fix:** Settings → create/use an API key on the Fran workspace where you ran import, with scopes including `intel:read` and `intel:write`. Reload extension after updating popup files (`chrome://extensions` → Reload).

## Daily workflow (pilot)

1. In Chrome, log into [shopee.sg](https://shopee.sg) normally (solve captcha once as a human).  
2. Search a brand (e.g. `Anua`) **or** open the official Mall storefront.  
3. Open the extension → select the matching brand → **Scan this tab**.  
4. Pick the Mall/`@username` candidate → **Confirm + push**.  
5. Or paste a known URL:  
   `https://shopee.sg/beautyofjoseonsg?…`  
6. When several brands are confirmed:
   ```bash
   node scripts/materialize-brand-seeds.mjs --workspace <uuid> --pilot-allowlist
   ```

## Suggested order for pilot brands

Open search or shop for each, scan + confirm:

- Anua, COSRX, Axis-Y, Biodance, Celimax, Dr. Althea, Haruharu Wonder, Medicube, Mediheal, mixsoon, numbuzin  
- Beauty of Joseon already confirmed as `beautyofjoseonsg` if you ran the earlier manual set

## API used

```http
GET  /api/v1/marketplace/brand-universe
POST /api/v1/marketplace/brand-universe/resolve-shop
Authorization: Bearer <api_key>
```

```json
{
  "brand_key": "anua",
  "shop_url": "https://shopee.sg/anua.sg",
  "status": "confirmed",
  "source": "serp"
}
```

## Privacy / security

- API key stored in `chrome.storage.sync` (your browser profile).  
- Only talks to the API base you set + reads the active Shopee tab.  
- Does not upload cookies to SKUMS (unlike Puppeteer cookie export).

## Why not Puppeteer for this step

Cold automation browsers get Shopee captcha. Your real Chrome already has a warm session. Extension = **session factory for identity**, weekly `shopee_puppeteer` remains the batch collect worker once shop targets are known.
