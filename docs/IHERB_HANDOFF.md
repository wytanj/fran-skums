# iHerb collect — handoff brief

Task for the next session: **schema + harvest worker**. Parsers are done and
tested; do not rewrite them.

Base commit `main` at or after `ce0c073`. Suite is green at **778 pass / 0 fail** — keep it there.

---

## What already exists

| Path | State |
|---|---|
| `marketplace/iherb/parseCatalogue.mjs` | Done. Parses `/c/<brand>` grid. |
| `marketplace/iherb/parseProduct.mjs` | Done. Parses `/pr/<slug>/<id>` from ld+json. |
| `marketplace/iherb/probeSpec.mjs` | Done. Structure probe + `diffProbes()`. |
| `extensions/skums-iherb-probe/` | Done. Side panel: probe → download fixture. |
| `docs/IHERB_COLLECT_DESIGN.md` | The design. Read it first. |
| `tests/iherb-*.test.mjs` | 54 tests against real fixtures. |

Fixtures (real captures — iHerb 403s every non-browser request, so these are the
only way to test offline):

```
extensions/sample-iherb-anua.html          48 products, 2 pages
extensions/sample-iherb-skin1004.html      41 products, 1 page
extensions/skin1004-product-page.html      one PDP
```

---

## Decisions already made — do not relitigate

**Separate tables, not `marketplace='iherb'` in `marketplace_listings`.**
`marketplace_brand_rollup` (mig 077) reads `v_marketplace_listing_latest` and
filters on **nothing** — no marketplace column in the grouping, the view, or
`brandRollupQuery.mjs`. iHerb rows in those tables would silently change every
existing Shopee number. Verified, not assumed.

**One brand-universe row per brand, with `iherb_interest` flagged.** Never a
second row with `marketplace='iherb'` — brand identity is channel-independent,
and two rows would split history and double every brand-grouped rollup.

**Brand-level comparison first, no SKU join.** A `gtin12` barcode *does* exist on
the PDP, so a non-fuzzy join is possible later — but it costs one navigation per
product and Shopee grid rows carry no GTIN, so it is not the first slice.

**Warm Chrome over CDP `:9222`, same profile as Shopee.** No second browser.

---

## Verified data facts

Measured against the two fixtures. Use these as test expectations.

| | Anua | SKIN1004 |
|---|---|---|
| products | 48 (2 pages) | 41 (1 page) |
| with price / rating | 48 / 48 | 41 / 41 |
| with sold | 34 | 30 |
| out of stock | 4 | 2 |
| currency | SGD | SGD |

**The one that matters most:** iHerb publishes `"4,000+ sold in 30 days"` — a
**rate**, `period: 'month'`. Shopee's `sold_count_lower_bound` is a **cumulative
lifetime bucket**. Never compare them as one number, never compute a ratio. Carry
a caveat the way `SOLD_FIELD_CAVEAT` does in `marketplace/metrics/definitions.mjs`.

**Sold coverage is ~70%, and that is real.** Absence means below iHerb's display
floor, not zero sales. Store the coverage count so a reader cannot mistake a
partial signal for a complete one.

Per-product fields available from the **catalogue** pass (one navigation/brand):

```
product_id part_number name brand_name brand_id url
price list_price discount_pct currency
rating review_count
sold_label sold_lower_bound sold_is_bucket sold_period
in_stock is_discontinued is_sponsored position
```

Extra from the **PDP** pass (one navigation/product — top-N only, same economics
as Shopee MH-4):

```
gtin (gtin12 barcode)   breadcrumb (Beauty > Cleansers > Face Washes)
weight_value/unit       description  category_name/id  brand_url
```

`part_number` (`AUU-73442`, `SIO-26111`) is the natural key. It is stable and
present on every row.

---

## Task 1 — migration `086_iherb_catalogue.sql`

Next free number is **086** (085 is latest applied).

Two tables, mirroring the listing/snapshot split that works on the Shopee side:

- `iherb_products` — stable identity: `workspace_id`, `country`, `part_number`
  (unique together), `product_id`, `gtin`, `name`, `brand_key` (FK-ish to
  `marketplace_brand_universe.brand_key`, not enforced), `brand_name`,
  `brand_id`, `url`, `category_path_text`, `category_leaf`, `weight_value`,
  `weight_unit`, `first_seen_at`, `last_seen_at`, `metadata jsonb`.
- `iherb_product_snapshots` — time series: `product_row_id`, `captured_at`,
  `price`, `list_price`, `discount_pct`, `currency`, `rating`, `review_count`,
  `sold_label`, `sold_lower_bound`, `sold_is_bucket`, `sold_period`, `in_stock`,
  `is_sponsored`, `position`, `signals jsonb`.

RLS **on**, workspace-scoped policies matching the pattern in
`047_marketplace_intelligence.sql`. Index `(workspace_id, brand_key)` and
`(product_row_id, captured_at desc)`.

Apply with `node scripts/migrate.mjs --only 086`. `SUPABASE_DB_URL` is in `.env`.

## Task 2 — writer

`marketplace/iherb/upsertCatalogue.mjs`: takes `parseIherbCatalogue()` output +
`{ workspace_id, brand_key }`, upserts products on `(workspace_id, country,
part_number)`, inserts one snapshot per product per run.

Store the run's coverage (`products`, `with_sold`, `with_price`, `currencies`,
`currency_consistent`) so a truncated or wrong-currency run is visible rather
than averaged in. This is the MH-12 lesson: a partial harvest that looks
complete becomes a fake decline downstream.

**Refuse the write if `currency_consistent` is false.** A page that flipped
locale mid-scroll must not land in an SGD column.

## Task 3 — harvest worker

`marketplace/iherb/harvestWorker.mjs`, CDP-attached like the Shopee one.

Reuse, do not rewrite:
- `waitForRecovery()` from `marketplace/computerHarvest.mjs`
- `createHarvestNotifier` from `marketplace/harvestNotify.mjs`
- per-brand isolation / cooldown / exit code 2 from `scripts/mall-brand-cycle.mjs`

Differences from Shopee, already established:
- **No login needed** — public catalogue.
- Binding constraint is **403 / rate limit**, not captcha. Recovery is
  exponential backoff, usually with no human.
- **Only notify on sustained 403** after backoff exhausts. Firing on the first
  one pages the operator for something that clears in ninety seconds.
- Health detection must return `'unknown'` for an unrecognised page, never
  `'ok'` — a false `ok` writes an empty harvest that reads as "brand delisted
  everything". Same rule as MH-8.
- Use the `sg.` subdomain, and **assert the rendered currency on page one of
  every run**.

Follow pagination via `pagination.next_url` until `is_last_page`.

## Task 4 — MCP tool `market_brand_compare`

Brand-level only:

```
{ brand_key } →
  shopee: { listings, sold_sum, price_band }      // lifetime bucket
  iherb:  { products, price_band, avg_rating,
            review_sum, sold_30d_sum, coverage }  // 30-day rate
  caveat: "…"                                     // required, non-empty
```

Two hard rules: no ratio between the two sold measures, and `coverage` must state
how many iHerb rows carried a sold figure.

---

## Repo gotchas that will bite

- **CRLF.** This repo checks out CRLF. Never write `/--.*$/` in a test — `\r` is
  a JS line terminator, `.` won't cross it, and the pattern silently matches
  nothing on a clean clone. Use `[^\r\n]*`. This has bitten twice (`b685d6d`,
  `1d3aca8`).
- **Tests:** `node --test tests/*.test.mjs`. Fixtures must be checked in for
  determinism; **do not commit `extensions/*_files/`** asset directories.
- `marketplace_crawl_seeds` has `CHECK (marketplace IN ('shopee','lazada',
  'tiktok','other'))` — only touch it if collection becomes seed-driven.
- There are uncommitted in-flight edits in `marketplace/attributeBrandFromTitle.mjs`
  and `marketplace/mallHarvestWorker.mjs` that are **not yours** — leave them.
- Build check: `npx nuxt build`. Vercel deploys from `main` on push.

## Done means

- `node --test tests/*.test.mjs` → 778 + your new tests, 0 fail
- `npx nuxt build` clean
- Migration 086 applied and verified against the live DB
- One real harvest of `sg.iherb.com/c/anua` writing 48 products + 48 snapshots,
  with coverage recorded and currency asserted
