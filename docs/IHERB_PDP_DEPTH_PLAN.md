# iHerb PDP depth plan — sold, rankings, unit price, ingredients/specs

**Status:** coverage audit done · read-path fixes shipped · **ingredients/specs slice shipped + live-enriched (2026-08-11)** · **ingredient parser layout-bug fixed + re-enriched (2026-08-11)**  
**Warehouse (2026-08-11):** 2,931 SKUs · 182 brands · 100% gtin · 100% pdp_enriched · 100% specs_enriched · 94.3% rank_best · **99.2% ingredients** · **95.9% suggested_use** · 43.6% price/ml  
**Images (checked 2026-08-14):** **100%** `metadata.pdp_image` (Cloudinary). Not yet on MCP. See `TODO.md` Track **IMG** — read-path only, no rescrape.

> Live specs pass 2026-08-11 11:39→12:47: all 182 brands, 2,931 PDPs re-fetched, **0 failed · 0 blocked**. Every SKU carries `specifications` (UPC + dimensions at 100%).
>
> **Post-pass audit found a real parser gap (not content absence):** newer PDPs render the overview as `.ingredient-info` / `#product-supplement-facts` with `<h3><strong>Other ingredients</strong></h3>` — the original `parseProductIngredients` only matched the older `prodOverview*` / bare-`<h3>Ingredients` markup, so ~6% of SKUs silently lost ingredients they actually publish. Fixed `parseProductIngredients` (new-layout fallback, `<strong>`-wrapped headings, `<ol><li>` warnings body) + fixture `sample-iherb-pdp-new-ingredients.html` + test. Re-enriched the 186 missing rows via `scripts/iherb-pdp-reenrich-ingredients.mjs` (177 written, 0 failed/blocked): ingredients **93.7% → 99.2%**, suggested_use **90.6% → 95.9%**.
>
> Remaining gaps are now confirmed genuine content absences (re-navigated live with the fixed parser, no ingredient/rank markup on the page — verified via `scripts/_iherb_verify_remaining_gaps.mjs`): 24 SKUs with no ingredient block (makeup tools / lashes) and the ~6% with no `.best-selling-rank` block. No rescrape recovers those.

---

## 1. Sold “N+ in 30 days” — can we have it for *all*?

### What the data says

| Signal | Latest snap only | Any snap in history |
|--------|------------------|---------------------|
| sold_lower_bound | ~34% (998) | ~35% (1,020) |
| price | ~67% latest | **100%** with history merge |

**Conclusion:** iHerb does **not** publish a 30-day sold label on most K-Beauty SKUs. Catalogue harvest already only saw ~35% overall (top movers show it; long-tail / makeup shades often don’t). Rescraping will **not** get to 100%.

Missing sold means **below iHerb’s display floor**, not zero sales and not a harvest bug.

### What we fixed (no rescrape required for price)

1. **Read path** (`pickMergedLatestSnapshots`): latest PDP row no longer hides older catalogue sold/price when PDP left them null.  
2. **Write path** (`upsertIherbPdp`): carry-forward sold/price from prior snap on next PDP write.  
3. MCP `sold_coverage_note` explains the floor.

### Optional rescrape (only if you want *fresh* rates)

```bash
# Catalogue re-scrape refreshes sold labels where iHerb still shows them
# (deletes progress first only if you want every brand again)
node scripts/iherb-kbeauty-cycle.mjs -w <ws> --connect --from-json .iherb-kbeauty-brands.json --max-brands 200 --fast
```

Do **not** expect sold coverage to jump past ~40–50% on this assortment.

---

## 2. Product rankings — already the main PDP win

| Coverage | ~ |
|----------|---|
| gtin / pdp_enriched_at | ~99.9% |
| rank_best / rankings[] | ~94% |

Parser: `parseProductRankings` → `.best-selling-rank` only (avoids variant table noise).

MCP: `market_iherb_products` returns:

- `rank_best_rank`, `rank_best_category`
- `rankings[]` on **objects** (full tree: #5 K-Beauty Eyeliner → … → #1237 K-Beauty)

### Residual ~6% without ranks

Usually: page had no rank block, wrong/redirected URL, or discontinued. Optional:

```bash
# Re-hit only still-missing ranks (after adding only_missing_rank filter later)
node scripts/iherb-pdp-cycle.mjs -w <ws> --connect --tabs 3 --full --include-enriched
```

Prefer a dedicated `only_missing_rank` candidate filter before a full re-walk.

---

## 3. Price + price/ml — shipped on read path

| Field | Source |
|-------|--------|
| `price` | schema.org offers · coalesced from history if PDP null |
| `volume_ml` | Package quantity (“0.5 ml”) or title `(200 ml)` / fl oz |
| `price_per_ml` | `price / volume_ml` |

Also on product metadata after next PDP write: `package_quantity_ml`, `price_per_ml`.

**Limitations:** powder/g-only packs → `volume_ml` null (no fake ml). Multi-piece “10 sheets” not converted to ml.

---

## 4. Ingredients + specifications — ✅ shipped

**Done (2026-08-11).** Parsers, writer, candidate flag, cycle pass, MCP surface, and a
full live re-enrich all landed. Steps A–F below are complete; kept for reference.

### Markup already present on live PDPs (fixtures)

| Block | Selector / pattern | Fields |
|-------|-------------------|--------|
| **Specifications** | `.product-description-specifications` | Product code, UPC, dimensions, shipping weight, package qty |
| **Dimensions attrs** | `data-dimensions-cm`, `data-dimensions-in`, `data-actual-weight-lb` | cm / in / lb |
| **UPC** | `upcCd:` in page script · gtin12 in ld+json | barcode |
| **Key info** | `.product-at-a-glance__key-info-*` | Package quantity, Best by |
| **Ingredients** | overview / “Ingredients” / “Suggested use” sections · `prodOverviewDetail` | text |
| **Description** | schema.org `description` | marketing copy (already parsed) |

### Proposed storage (no new tables required for v1)

```
iherb_products.metadata.specifications = {
  upc, product_code, package_quantity_label, package_quantity_ml,
  dimensions_cm, dimensions_in, shipping_weight, best_by
}
iherb_products.metadata.ingredients_text = "..."
iherb_products.metadata.suggested_use = "..."
iherb_products.metadata.specs_enriched_at = ISO
```

Optional later: first-class columns if we filter heavily on UPC/dimensions.

### Implementation plan (ordered)

| Step | Work | Effort |
|------|------|--------|
| **A** | `parseProductSpecs(html)` + `parseProductIngredients(html)` pure parsers + fixtures | S |
| **B** | Extend `upsertIherbPdp` / metadata; signals.specs on snap | S |
| **C** | Candidate flag `only_missing_specs` in pdpEnrich | S |
| **D** | Cycle: `--specs-pass` or include in full PDP (same nav — free if we re-parse) | S |
| **E** | MCP columns: `volume_ml`, `price_per_ml` (done) + `has_ingredients` | S |
| **F** | Bulk re-enrich remaining thin rows with `--tabs 3` | M (hours, not days) |

**Important:** ingredients/specs are on the **same PDP HTML** we already fetch. A re-enrich pass with a richer parser backfills **without new page types**.

### Recommended next run (after A–C)

```bash
# Re-parse all PDPs with richer parser (rankings + specs + ingredients + unit price)
# only_missing=false so we refresh; tabs=3 for speed
node scripts/iherb-pdp-cycle.mjs -w <ws> --connect --tabs 3 --fast --full --include-enriched --delay-ms 400
```

Or thinner: only brands/SKUs missing `metadata.specs_enriched_at`.

---

## 5. MCP agent usage (today)

```
market_iherb_products { brand_key: "cosrx", limit: 50 }
```

Use **`objects`** for full `rankings[]`. Columnar has `rank_best_*`, `price`, `volume_ml`, `price_per_ml`, `sold_*`, `gtin`.

---

## 6. Decision summary

| Goal | Status |
|------|--------|
| Sold for **all** SKUs | **Impossible** from iHerb UI; ~35% is real display coverage |
| Sold not wiped by PDP | **Fixed** (merge + carry-forward) |
| Rankings | **~94%** done; parser solid |
| Price | **100%** with history merge |
| price/ml | **Shipped** on query when volume parseable (43.6% — powder/g-only packs have no ml) |
| Ingredients + specs (UPC, dims) | **Shipped + live-enriched** — 100% specs/UPC/dims, 93.7% ingredients across 2,931 SKUs |

No bulk rescrape required for rankings/price. Optional catalogue refresh only for fresher 30-day sold where shown.