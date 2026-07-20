# SKUMS Shopee Mall harvest (Chrome extension)

Harvest **official Mall shop product lists** into Fran SKUMS using your logged-in Chrome session.

## Page this is designed for

```
https://shopee.sg/beautyofjoseonsg?page=0&sortBy=pop&tab=0
```

| Query | Role |
|-------|------|
| `sortBy=pop` | Popularity order (sold signal strongest) |
| `page=0,1,2…` | Paginate through the shop catalog |
| `tab=0` | Collection tab |

Validated against saved HTML in `extensions/sample-beauty-of-joseon/`  
(shop_id `1111230332`, product links `-i.{shop}.{item}`, sold text like `30k+ sold`).

## What we capture

| Field | Source on shop page |
|-------|---------------------|
| **name** | Product card / URL slug |
| **sold** | Card text (`9k+ sold`) → lower bound |
| **category** | Active shop collection tab (default `All Products`) |
| ids / url | `shop_id`, `item_id`, listing URL (for warehouse upsert) |

Not required for your use case (ignored as primary): price history, full INCI, SERP rank vs resellers.

## UX (v0.3)

- **Side panel** stays open while you browse
- **Harvest products on this shop page** → table of name / sold / category
- **Push harvest to SKUMS** → `POST /api/v1/marketplace/shop-harvest`
- **Download JSON** offline backup
- Brand list cached; auto-links `@beautyofjoseonsg` → `beauty-of-joseon` when confirmed

## Workflow

1. `chrome://extensions` → **Reload** this extension  
2. Open side panel; set API base `https://fran-skums.vercel.app` + `sk_live` key (`intel:read` + `intel:write`)  
3. Open Mall shop (popularity sort), optionally click a category chip  
4. **Harvest** → review table → **Push**  
5. Next page: change `page=1` in URL → Harvest again  

## API

```http
POST /api/v1/marketplace/shop-harvest
Authorization: Bearer <key>
```

```json
{
  "shop_username": "beautyofjoseonsg",
  "brand_key": "beauty-of-joseon",
  "active_category": "All Products",
  "page": 0,
  "sort_by": "pop",
  "products": [
    {
      "name": "Beauty Of Joseon Relief Sun …",
      "sold_label": "30k+ sold",
      "sold_count_lower_bound": 30000,
      "category": "All Products",
      "shop_id": "1111230332",
      "item_id": "28707244664",
      "listing_url": "https://shopee.sg/…"
    }
  ]
}
```

Writes mall listings + snapshots (sold, category in `signals`).
