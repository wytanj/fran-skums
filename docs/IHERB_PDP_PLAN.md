# iHerb PDP enrich plan

**Status:** implemented (parse + writer + CLI + MCP surface).  
**Analogy:** Shopee MH-4 (platform breadcrumb) — same economics, richer payload.

---

## Why it matters

Catalogue harvest answers *what SKUs exist and list price / 30-day sold label*.  
PDP harvest answers questions catalogue **cannot**:

| Signal | Source | Why we care |
|---|---|---|
| **Product rankings** | DOM `.best-selling-rank` | Category share of voice — "#5 in K-Beauty Eyeliner" is demand shape, not just absolute sold |
| **GTIN (gtin12)** | schema.org Product | Only non-fuzzy join key to our identity spine / other channels |
| **Platform breadcrumb** | BreadcrumbList ld+json | Real taxonomy (`Beauty > Cleansers > Face Washes`), not brand nav |
| **Weight** | schema.org weight | Pack-size price normalisation |
| **Sold / price / rating refresh** | text + offers | Same fields as list, but confirmed on the detail page |

Rankings are **time-varying** (like sold). GTIN / breadcrumb / weight are mostly
stable identity. Both are written on each PDP pass.

---

## What is *not* on the catalogue page

- No rankings
- No GTIN
- Breadcrumb is brand navigation (`Brands A–Z > Anua`), not platform category
- Weight absent

Do **not** invent ranks from sold_lower_bound. If `rank_best_*` is null, the SKU
has not been PDP-enriched (or the page had no rank block).

---

## Markup contract (rankings)

```html
<section class="product-description-ranking">
  <div class="best-selling-rank">
    <h2>Product rankings:</h2>
    <div>
      <strong class="rank">#5 in</strong>
      <a class="crumbs" href="/c/k-beauty-eyeliner?sr=2"
         data-ga-event-name="product_ranking"
         data-ga-event-label="5"
         data-ga-event-action="107537">K-Beauty Eyeliner</a>
    </div>
    …
  </div>
</section>
```

**Pitfall:** colour-variant comparison tables (`.attribute-row.rank`) repeat
ranks for *other* SKUs. Parser scopes to `.best-selling-rank` first.

Parsed shape:

```js
{
  rank: 5,
  category: 'K-Beauty Eyeliner',
  category_slug: 'k-beauty-eyeliner',
  category_url: 'https://sg.iherb.com/c/k-beauty-eyeliner?sr=2',
  category_id: '107537', // data-ga-event-action
}
```

`rank_best` = first row (tightest / most specific category iHerb lists first).

---

## Storage (no new migration)

Existing tables from `086_iherb_catalogue.sql`:

### `iherb_products` (identity)

| Column / path | PDP field |
|---|---|
| `gtin` | gtin12 |
| `category_path_text` / `category_leaf` | breadcrumb.path_text / leaf |
| `weight_value` / `weight_unit` | shipping weight |
| `url`, `name`, `brand_*` | refresh |
| `metadata.pdp_enriched_at` | ISO timestamp |
| `metadata.last_rankings` | full rankings array (last known) |
| `metadata.rank_best` | last known best rank |

### `iherb_product_snapshots` (time series)

New row per enrich with:

```js
signals: {
  harvest_source: 'iherb_pdp_enrich',
  rankings: [ /* full list */ ],
  rank_best: { rank, category, category_slug, … },
  rank_best_rank: 5,
  rank_best_category: 'K-Beauty Eyeliner',
  rank_best_category_slug: 'k-beauty-eyeliner',
  breadcrumb: { path, path_text, leaf, scope: 'platform_category' },
  gtin, weight_value, weight_unit,
  sold_field_note: 'iHerb 30-day sold rate — …',
  brand_key, part_number, product_id,
}
```

Price / rating / sold_* columns on the snapshot are filled from the PDP parse so
history is continuous.

Optional later (only if query load demands it): denormalized
`rank_best_rank integer` columns + GIN on `signals->rankings`. Not required for v1.

---

## Pipeline

```
1. Catalogue harvest (brand cycle or kbeauty bids=)
       → iherb_products + snapshots (list economics)

2. PDP enrich (top-N by sold_lower_bound, only_missing default)
       → update identity + insert pdp snapshot

3. MCP / query
       → market_iherb_products includes rank_best_*, rankings, gtin, pdp_enriched_at
```

### CLI

```bash
# After catalogue harvest — single brand
node scripts/iherb-pdp-enrich.mjs -w <ws> --brand anua --top 15 --dry-run
node scripts/iherb-pdp-enrich.mjs -w <ws> --brand anua --top 15 --connect

# Overnight: all K-Beauty brands (slow, resume, top 10 movers each)
node scripts/iherb-pdp-cycle.mjs -w <ws> --dry-run          # estimate hours
node scripts/iherb-pdp-cycle.mjs -w <ws> --connect --overnight

# Resume after interrupt — same command (skips .iherb-pdp-progress.json done brands)
node scripts/iherb-pdp-cycle.mjs -w <ws> --connect --overnight

# Re-fetch ranks (include already enriched)
node scripts/iherb-pdp-enrich.mjs -w <ws> --brand cosrx --top 30 --include-enriched --connect
```

**Overnight defaults (`--overnight`):** full catalog (`--top 500`), ~3s between PDPs,
~8–12s between brands, slow nav, resume via `.iherb-pdp-progress.json`.

**Bot walls:** no login. Classic captcha is rare; long PDP runs have shown a
**press-and-hold** interstitial. Operator solves it in the CDP Chrome tab; the
worker classifies that as `blocked` and waits for recovery. If the queue exits 2
after consecutive blocks, re-run the same command (resume-safe).

### Candidate selection

1. Products for brand_key with `/pr/` URL  
2. Drop those with `metadata.pdp_enriched_at` or `gtin` (unless `--include-enriched`)  
3. Sort by latest snapshot `sold_lower_bound` desc  
4. Take top N  

Same MH-8 rule: blocked health stops after consecutive failures; unknown ≠ ok.

---

## Ops cadence (suggested)

| Pass | When | Top N |
|---|---|---|
| Catalogue (kbeauty / mono) | weekly or after assortment change | all pages |
| PDP top movers | after catalogue, same session | 10–20 / brand |
| PDP re-rank refresh | monthly for tracked brands | 30–50 / brand with `--include-enriched` |

Pacing: public pages, default ~0.9s gap in fast mode. No login. Sustained 403 →
notify + exit 2 (same as catalogue worker).

---

## Modules

| Module | Role |
|---|---|
| `parseProduct.mjs` | `parseIherbProduct`, `parseProductRankings` |
| `upsertPdp.mjs` | product update + snapshot insert |
| `pdpEnrich.mjs` | candidates, open/parse, batch loop |
| `query.mjs` | expose ranks on read path |
| `scripts/iherb-pdp-enrich.mjs` | operator CLI |
| `scripts/_iherb_probe_pdp_rankings.mjs` | fixture capture |

---

## Tests

```
node --test tests/iherb-parse-product.test.mjs
node --test tests/iherb-upsert-pdp.test.mjs
node --test tests/iherb-pdp-enrich.test.mjs
```

Fixtures: `skin1004-product-page.html`, `sample-iherb-pdp-rankings.html`.

---

## Non-goals (for now)

- Full-catalogue PDP (every SKU) — cost too high; top-N is the product  
- SKU join Shopee↔iHerb via GTIN at scale (possible later; Shopee grid has no GTIN)  
- Inventing ranks when block missing  
- Mixing rank into Shopee rollups  

---

## Done means

- [x] Parser extracts rankings without variant-table contamination  
- [x] Writer stamps gtin/breadcrumb/weight + signals.rankings  
- [x] CLI load candidates + live CDP enrich  
- [x] MCP/query returns rank_best_* when present  
- [x] Unit tests on fixtures  
- [x] Live smoke (2026-08-08): Anua top-5 written — all 5 ok, 0 blocked  
  - AUU-73442 #1 K-Beauty Cleansers · gtin 8809640734427  
  - AUU-73452 #7 K-Beauty Treatments & Serums · gtin 8809640734526  
  - AUU-73282 #5 K-Beauty Cleansers · gtin 8809640732829  
  - AUU-73666 #2 K-Beauty Hydrating Serums · gtin 8809640736667  
  - AUU-73055 #1 K-Beauty Face Wipes & Towelettes · gtin 8809640730559  
  - `queryIherbProducts` returns rank_best_* + gtin + pdp_enriched_at for all 5
