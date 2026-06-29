# Shopee Crawler Next Steps

## Decision

Build Shopee competitive intelligence as an external crawler/worker, not as a Vercel serverless feature and not as the official Shopee channel adapter.

Vercel should remain the control plane: create crawl jobs, show job status, read stored results, and run lightweight analysis. Long-running browser work should run in a local/gstack prototype first, then in a dedicated worker if the crawler becomes production-critical.

The official Shopee Open API is still useful for our own authorized seller listings and category/attribute validation. It is not the source for public competitor monitoring.

## Current Repo Fit

Existing pieces we should reuse:

- `docs/SCRAPING_DEPLOYMENT_OPTIONS.md` already splits on-demand URL analysis from scheduled catalog crawling and recommends a non-Vercel batch crawler.
- `docs/SCRAPE_WITH_GSTACK.md` gives a practical low-infra path for persistent-browser overnight crawls.
- `server/api/quality/process-queue.post.ts` already models an overnight queue processor for product-level scans.
- `server/api/skincare/crawl.post.ts` already models batch crawl jobs, progress, logs, product upserts, and per-category processing.
- `app/pages/integrations.vue` already has a crawl UI pattern with source/category selection, job polling, and log viewing.
- `server/utils/scrapers/shopee.ts` already has a minimal Shopee search scraper, but it only searches `shopee.sg`, extracts the first result, and stores a product-level snapshot.

Current pieces that are not sufficient for Shopee category/brand intelligence:

- `product_quality_snapshots` is product-centric and lacks country, shop ID, item ID, variant, rank, page position, seller type, raw payload, and match confidence.
- `external_products` is currently constrained to `hwahae` and `oliveyoung` and is skincare-formulation focused, not marketplace-listing focused.
- `scrape_queue` is good for "crawl this SKUMS product overnight", but not for "crawl Shopee PH dark spot serums top 200 across keywords/categories".
- Current scoring aggregates platforms too early. Shopee country and category differences need to stay first-class.

## Recommended Data Model

Add a marketplace intelligence layer instead of forcing Shopee into the existing product-quality or skincare crawler tables.

Suggested tables:

```text
marketplace_crawl_jobs
  id
  workspace_id
  marketplace              -- shopee
  country                  -- sg, ph, my, id, th, vn, tw
  crawl_type               -- keyword, category, brand, shop, listing_detail
  target                   -- query/category/shop/listing URL
  status                   -- pending, running, completed, failed, cancelled
  priority
  scheduled_for
  claimed_at
  claimed_by
  started_at
  completed_at
  total_targets
  processed_targets
  failed_targets
  summary
  error
  metadata
```

```text
marketplace_listings
  id
  workspace_id
  marketplace
  country
  shop_id
  item_id
  listing_url
  title
  shop_name
  seller_type              -- official, mall, preferred, reseller, unknown
  brand_name_raw
  category_path
  image_url
  first_seen_at
  last_seen_at
  status
  raw_identity
  unique(workspace_id, marketplace, country, shop_id, item_id)
```

```text
marketplace_listing_snapshots
  id
  workspace_id
  listing_id
  crawl_job_id
  crawled_at
  price
  original_price
  currency
  price_sgd
  rating
  review_count
  sold_label
  sold_count_lower_bound
  favourite_count
  available_quantity
  availability
  rank_position
  search_query
  category_id
  voucher_labels
  shipping_labels
  preorder_days
  raw_observation
```

```text
marketplace_listing_variants
  id
  workspace_id
  listing_id
  external_model_id
  variant_label
  normalized_size_value
  normalized_size_unit
  pack_count
  price
  currency
  available_quantity
  raw_variant
```

```text
marketplace_identity_candidates
  id
  workspace_id
  listing_id
  product_id
  product_identity_id
  match_type               -- exact_barcode, brand_title_size, title_similarity, manual
  confidence
  evidence
  status                   -- candidate, accepted, rejected
```

This keeps raw observations, listing identity, variant identity, and SKUMS product matching separate.

## Crawler Runtime

Use this runtime sequence:

1. Phase 1: Local/gstack proof
   - Crawl Shopee SG and PH only.
   - Use a fixed seed list: 5 to 10 skincare keywords and 2 to 3 brand/shop URLs.
   - Crawl top 40 to 100 listing cards per target, then detail pages for top-ranked and high-sold listings.
   - Write directly to Supabase with service credentials.

2. Phase 2: Pooled overnight worker
   - Add `marketplace_crawl_jobs`.
   - Vercel creates jobs and reads status.
   - Worker polls or claims pending jobs from Supabase.
   - Worker runs browser sessions with low concurrency, country-aware delays, checkpointing after each page/listing.
   - Store logs in DB, not only in memory.

3. Phase 3: Dedicated crawl service if usage grows
   - Fly/Railway/VPS worker with a persistent browser or gstack-like profile.
   - Cron creates nightly jobs by country/category.
   - Keep Vercel out of browser execution.

For the "overnight jobs pooled" preference, Phase 2 is the right target. It avoids serverless timeouts while preserving a simple UI-triggered workflow.

## Shopee-Specific Crawl Strategy

Start with these countries:

```text
sg: shopee.sg
ph: shopee.ph
my: shopee.com.my
id: shopee.co.id
th: shopee.co.th
vn: shopee.vn
tw: shopee.tw
```

Do not compare raw country counts directly. For each country, crawl enough local category context to build baselines.

Initial crawl modes:

1. Keyword/category discovery
   - Example queries: niacinamide serum, dark spot serum, sunscreen, toner pad, cleanser.
   - Capture rank position, seller badges, price, sold label, rating, review count, title, shop, URL.

2. Brand intelligence
   - Seed known brand names and official shops.
   - Track official listing vs reseller/listing clones.
   - Group by normalized brand and product family.

3. Product detail snapshots
   - Open detail pages for selected listings.
   - Extract variants, size labels, vouchers, stock, shipping/preorder state, favorites, and image/title quality.

4. Variant normalization
   - Parse `10ml`, `30ml`, `2x30ml`, `150ml`, `70 pads`, gift bundles.
   - Compute price per ml/g/pad where possible.
   - Flag mixed-variant listings where one Shopee item contains unrelated products.

## Analysis Rules

The intelligence layer should analyze in this order:

1. Normalize within country/category first.
2. Convert raw counts into local percentiles.
3. Apply Bayesian smoothing only after normalization.
4. Compare countries using normalized residuals, not raw sold/review counts.

Recommended measures:

- `local_sales_percentile`
- `local_review_percentile`
- `bayesian_rating_score`
- `price_per_unit_percentile`
- `official_store_share`
- `reseller_pressure_score`
- `variant_confidence`
- `identity_match_confidence`

Keep both label and parsed numeric lower bound for Shopee sold values. `4k+ sold` is not the same quality of observation as an exact count.

## UI/API Next Steps

1. Add a dedicated Marketplace Intelligence view or a Shopee tab under Product Quality.
2. Add country selector, crawl type selector, keyword/category inputs, and job status.
3. Add listing table columns: country, rank, title, shop, seller type, price, rating, reviews, sold label, variant, last seen, match confidence.
4. Add filters for official store, reseller, country, brand, category, price-per-unit, and suspected lookalikes.
5. Add product-family/brand summary cards only after the raw listing table is trustworthy.

## Implementation Order

1. Add migration for marketplace crawl jobs, listings, listing snapshots, variants, and identity candidates.
2. Add TypeScript types for those tables.
3. Extract common crawl job/log primitives from the skincare crawler so Shopee does not duplicate job UI behavior.
4. Build a local Shopee crawler module for SG and PH:
   - search/category result extraction
   - listing detail extraction
   - variant parser
   - Supabase upsert writer
5. Run a small crawl: 2 countries, 3 keywords, top 20 listings each.
6. Inspect data quality manually and adjust extraction before scaling.
7. Add the Marketplace Intelligence UI read path.
8. Add pooled overnight worker claim/poll flow.
9. Add country-local normalization and smoothing.
10. Only then add more countries and larger category crawls.

## Non-Goals

- Do not use the Shopee Open API for competitor monitoring.
- Do not put batch browser crawling inside Vercel serverless.
- Do not average Shopee SG and PH raw counts directly.
- Do not rely on an LLM as the source of truth for price, sold count, review count, or variants.
- Do not merge public listing facts into canonical SKUMS product identity without a candidate/review layer.
- Do not confuse the crawler with the future authorized Shopee channel adapter.
