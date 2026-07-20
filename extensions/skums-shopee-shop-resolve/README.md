# SKUMS Shopee Shop Resolve (Chrome extension)

Resolves **official Shopee Mall shop usernames** into Fran SKUMS `marketplace_brand_universe` using **your logged-in Chrome session**.

**v0.2:** **Side panel** (stays open while you click Shopee) + **cached brand list** (no re-Load every time).

## Why side panel

Chrome **popups close** when you click the page. That killed the brand list.  
The **side panel** stays open; brands are restored from `chrome.storage.local`.

## Install / update

1. `chrome://extensions` → Developer mode  
2. **Load unpacked** → `extensions/skums-shopee-shop-resolve`  
3. After code updates: click **Reload** on the extension card  
4. Click the toolbar icon → panel opens on the **right**

## Configure (once)

1. Expand **Settings** in the panel  
2. **API base:** `https://fran-skums.vercel.app`  
3. **API key:** `intel:read` + `intel:write`, workspace with brand universe  
4. **Save** → **Refresh brands** once  
5. Status: `Loaded N brands…` + workspace id  

Next opens restore the list automatically.

## Workflow

1. Keep the side panel open  
2. On Shopee: open Mall shop or brand search  
3. **Scan active Shopee tab** → pick candidate → **Confirm + push**  
4. Or paste URL → **Push pasted URL**  
5. After several confirms:
   ```bash
   node scripts/materialize-brand-seeds.mjs --workspace <uuid> --pilot-allowlist
   ```

## API

```http
GET  /api/v1/marketplace/brand-universe
POST /api/v1/marketplace/brand-universe/resolve-shop
Authorization: Bearer <api_key>
```

## Notes

- Not a crawl engine — only shop identity.  
- Puppeteer mall discovery is demoted (captcha).  
- Keys stay in `chrome.storage.sync`; brand cache in `chrome.storage.local`.
