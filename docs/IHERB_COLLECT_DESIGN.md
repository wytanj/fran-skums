# iHerb collect — warm Chrome, separate dataset, brand-level comparison

**Status:** design. Nothing built. Supersedes the search-based scraper in
`server/utils/scrapers/iherb.ts`, which stays where it is for product-quality.

## What this is for

One question, asked of the MCP: *"how is Anua doing on Shopee vs iHerb?"*

Deliberately **not** a SKU-level join. The two sources measure different things and
joining them means solving fuzzy title matching at SKU granularity — the same
problem as brand attribution, one level harder. Brand-level comparison needs
almost none of that, and it answers the question actually being asked.

| | Shopee Mall | iHerb |
|---|---|---|
| Price | seller-set, promo-laden, varies by listing | first-party, authoritative |
| Catalogue | what the seller chose to list | the brand's real SKU set |
| Volume signal | `sold_count_lower_bound` — lifetime, bucketed | none; rating + review count only |
| Titles | marketing strings ("Buy1 Get1 Free …") | clean, sized, part-numbered |
| Shop concept | central — shop, collections, distributors | none; one catalogue per brand |

So iHerb answers *which SKUs exist and what they should cost*; Shopee answers
*which ones move*. That contrast is the product.

## Why separate tables, not `marketplace = 'iherb'`

The warehouse would physically accept it — `marketplace_listings.marketplace` is
plain text with no check constraint. It should not.

`marketplace_brand_rollup` (migration 077) reads `v_marketplace_listing_latest`
joined to `marketplace_listings` and **filters on nothing**. There is no
marketplace column in the grouping, the view, or `brandRollupQuery.mjs`. Insert
iHerb rows into those tables and every existing Shopee rollup silently changes
its numbers — no error, no flag, just different answers to questions already
being asked. The RP read path was built when "marketplace" was a constant.

Retrofitting a marketplace dimension through the view, both RPCs, the query
layer, the cache key and the MCP tools is a bigger and riskier change than a
parallel set of tables, and it puts a silent-corruption failure mode on the
critical path of something that currently works.

Separate tables also fit the shape better. iHerb has no shop, so
`marketplace_listings`' unique key `(workspace, marketplace, country, shop_id,
item_id)` needs a sentinel `shop_id`; it has no sold count, so the column that
drives every Shopee metric is always null; and it has a part number and pack
size that have nowhere to live.

**Proposed:** `iherb_products` + `iherb_product_snapshots`, mirroring the
listing/snapshot split that works well on the Shopee side, keyed by
`(workspace_id, country, product_code)`.

## Warm Chrome strategy

Same runtime decision as Shopee, for a different reason.

`https://sg.iherb.com/c/anua` returns **403 Forbidden** to a plain server-side
fetch. iHerb bot-blocks non-browser clients. It is not a captcha wall — it is
fingerprint and reputation filtering, which fails closed and silently.

### Reuse, do not rebuild

Reuse the same **worker primitives** as Shopee (CDP attach, `waitForRecovery`,
notifier, per-brand cooldown). **Do not share Shopee’s Chrome profile or
`:9222`.** A Shopee bounce/`killAllChrome` must not kill an iHerb run.

**Host (2026-08-14):** on-prem Linux/Windows PC. iHerb has no login and almost
no captcha — Linux/headless on that box is fine. Dedicated profile
(`.iherb-chrome-profile`, e.g. `:9223`). Sharing the Shopee laptop Chrome was
the v1 convenience; it is no longer the intended setup.

What carries over unchanged:

- CDP `--connect` attach (`marketplace/computerHarvest.mjs`)
- `waitForRecovery()` — poll for health, TTY Enter as accelerator, never blind-sleep (MH-9)
- `createHarvestNotifier` → Slack/in-app on blocked and recovered (MH-9)
- Per-brand failure isolation, cooldown, `--max-consecutive-blocked`, exit code 2 (MH-8)

### What differs from Shopee

| | Shopee | iHerb |
|---|---|---|
| Binding constraint | captcha, needs a human | 403 / rate limit, needs time |
| Login | required, warm session is the whole point | **not required** — public catalogue |
| Recovery | human solves a puzzle | exponential backoff; usually no human |
| Health signal | captcha keywords + zero product anchors | HTTP 403, "Access Denied", interstitial text, zero tiles on a 200 |
| Pacing ceiling | captcha budget | request rate per session |
| Page shape | shop → collections → paginated grid | one catalogue, paginated |

The consequence worth planning around: **iHerb mostly does not need a human.**
The MH-9 notify path should fire on *sustained* 403 (say, after backoff exhausts),
not on the first one, or it will page the operator for something that clears
itself in ninety seconds.

### Country and currency

The existing scraper sets `iherb.cookie = cn=SG&ln=en-US&cur=SGD` on
`.iherb.com`, then *also* calls `convertToSGD()` — belt and braces that suggests
the cookie was not trusted.

Prefer the **`sg.` subdomain**, which is in the URL and cannot silently revert
mid-session. Keep the cookie as a backstop, and assert the rendered currency
symbol on the first page of every run rather than assuming: a run that silently
collects USD prices into an SGD column is worse than a run that fails.

### Session health

An `detectIherbHealth()` mirroring `detectSessionHealth`, with the same hard-won
rule from MH-8: **return `'unknown'` for an unrecognised page, never `'ok'`.** A
false `ok` writes an empty harvest that looks like a real result — on iHerb that
would read as "this brand delisted everything".

## Phase 0 — probe the structure from the warm profile

There is a genuine chicken-and-egg here and it belongs in the plan rather than
in a footnote: **the page cannot be parsed until it has been seen, and it cannot
be seen without the warm profile.** Every selector written before that point is
a guess, and guesses in an extractor fail silently — an empty grid reads as "this
brand delisted everything", not as "the selector moved".

So the first thing built is not an extractor. It is a **probe** that runs in the
warm browser and reports what is there, extracting nothing:

```
  captured                sg.iherb.com/c/anua
  html                    saved → extensions/sample-iherb-anua.html
  embedded JSON           __NEXT_DATA__ ✗   ld+json ✓ (Product[] × 24)
  candidate tile selector [data-testid="product-card"]  × 24
  pagination              rel=next link  ·  2 pages  ·  no infinite scroll
  currency rendered       SGD ✓
  per-tile fields seen    name, brandName, price, listPrice, rating,
                          reviewCount, partNumber, packSize, inStock
```

This is the MH-10 pattern from the Shopee track, which earned its keep: wire the
observation in log-only mode, look at the evidence, *then* decide the extraction
approach. Zero risk, and it either finds a structured payload — `ld+json` or a
hydration blob — or proves there isn't one. A structured payload is worth far
more than any CSS selector, because it survives redesigns that would silently
break DOM scraping.

The probe is a button in the extension, not a manual save. The operator is
already on the page in the warm profile; asking them to save-as and drop a file
in the repo adds a step and gets the encoding wrong. The extension posts the HTML
plus its observations to an internal endpoint, which writes the fixture.

**The parser is then written and unit-tested against that fixture with no browser
in the loop**, exactly as `parseSearch.mjs` is today. This is also what makes the
work resumable: the fixture is checked in, so a future selector break is
reproducible offline.

Re-probing is cheap and should be routine — run it before each collection cycle
and compare against the last observation. A changed tile count of zero, or a
vanished field, is the early warning that a redesign happened, and it costs one
page load to know.

## Chrome extension — a separate iHerb panel

The Shopee panel exists because shop identity is genuinely ambiguous: which
storefront is official, which brands a distributor actually carries, which
collections are hidden behind "More". **None of that ambiguity exists on iHerb.**
`/c/anua` is Anua, and there is one catalogue.

So the iHerb panel should be much smaller, not a port of the Shopee one:

```
  ┌─ iHerb · sg.iherb.com/c/anua ──────────────────────┐
  │  Detected brand   Anua                             │
  │  Matches          anua  (exact)          [change ▾]│
  │  Currency         SGD ✓                            │
  │  Products         34 · 2 pages                     │
  │                                                    │
  │  [ Probe structure ]                               │
  │  [ Link catalogue to anua ]                        │
  │  [ Harvest 2 pages ]                               │
  └────────────────────────────────────────────────────┘

  …when the brand is not in the universe yet:

  │  Detected brand   Cetaphil                         │
  │  Matches          no brand in universe             │
  │                                                    │
  │  [ Create brand "cetaphil" and link ]   [ pick ▾ ] │
```

Three modes, in the order an operator meets them: **probe → link → harvest.**

- Detect `sg.iherb.com/c/<slug>`, propose a `brand_key` through the existing
  `brandKey.mjs` normaliser
- No collection discovery step — that whole flow is Shopee-specific
- No multi-brand distributor flow — inapplicable
- Surface **pack size and product code** where the Shopee panel surfaces shop and
  collection, because that is what iHerb has and Shopee lacks
- Show the detected currency, so a USD session is caught by the operator rather
  than by a confusing report a week later

### Brand guessing is the point, not a convenience

On Shopee the shop username is arbitrary — `wishtrend.sg` carries Dear Klairs and
I'm From, and no amount of string work derives that. A human has to decide, which
is why that panel is a confirmation UI.

On iHerb the URL **is** the brand: `/c/anua` → `anua`. The guess is close to 1:1,
so the panel can lead with a high-confidence suggestion instead of an
interrogation. That difference is worth exploiting rather than porting the Shopee
flow over.

It matters more than it looks because **this will not stay K-beauty.** The brand
universe was imported from a curated 116-row CSV; once collection spreads past
that list, the binding constraint stops being "can we scrape it" and becomes
"is this brand in the universe at all". A panel that can only link to brands
already present makes every new brand a manual database chore.

So the match step has three outcomes, and the third is the one that earns its
keep:

| Slug matches | Panel offers |
|---|---|
| a universe brand exactly | link, one click |
| a universe brand fuzzily (`cerave` ~ `CeraVe`) | link, with the match shown for confirmation |
| **nothing** | **create the brand and link, in one action** |

Reuse `buildBrandMatchProfile()` from `attributeBrandFromTitle.mjs` for the fuzzy
case so the extension and the harvest agree on what "matches" means. Move the
shared matcher into a module both extensions import rather than copying it — the
Shopee panel already carries a `brandMatch.js`, and two drifting copies of brand
matching is exactly the failure this codebase has seen once already.

### One brand row, channel flags — not one row per marketplace

`marketplace_brand_universe` is keyed
`(workspace_id, marketplace, country, brand_key)` and already carries
`shopee_mall_interest` and `iherb_interest`. A brand discovered on iHerb should
**not** create a second universe row with `marketplace = 'iherb'`.

Brand identity is channel-independent — Anua is one brand whether you found it on
Shopee or iHerb. Two rows would split its history, double every rollup that
groups by brand, and force a merge later. Create one row and set the interest
flag for the channel it was found on.

A useful consequence: creating from iHerb means the check constraint
`marketplace IN ('shopee','lazada','tiktok','other')` is not in the way, because
the row stays `'shopee'` — or `'other'` for a brand with no Shopee presence yet.
Only `marketplace_crawl_seeds` would need `'iherb'` added, and only if collection
is ever seed-driven rather than extension-driven.

Panel and content script live alongside the existing one; `manifest.json` gains a
host match for `sg.iherb.com`. Shared brand-matching code moves to a common module
rather than being copied.

## MCP surface

One new tool, brand-level:

```
market_brand_compare { brand_key }
  → shopee: { listings, sold_sum, price_band, top_by_sold }
    iherb:  { products, price_band, avg_rating, review_sum, in_stock }
    gaps:   { on_iherb_not_shopee, on_shopee_not_iherb }   // by normalised title, advisory
```

Two rules, both learned the hard way on the Shopee side:

1. **Never present the two volume signals as comparable.** Shopee's sold count is
   a lifetime bucket; iHerb has no volume at all, only reviews. The tool must
   carry a caveat string the way `SOLD_FIELD_CAVEAT` does in
   `marketplace/metrics/definitions.mjs`, and must not compute a ratio between
   them.
2. **`gaps` is advisory and must say so.** It is fuzzy title matching, the thing
   this design otherwise avoids. Useful as a prompt for a human to look; not a
   number to report.

## Schema note

`marketplace_brand_universe.iherb_interest` already exists and is populated for
~74 brands, but nothing reads it for collection. It is the natural queue filter,
and — per the one-row rule above — the marker of channel presence rather than a
reason to create a second row.

`marketplace_crawl_seeds` carries
`CHECK (marketplace IN ('shopee','lazada','tiktok','other'))`. That only needs
`'iherb'` if collection becomes seed-driven; the extension-driven path does not
touch it.

## Unknown until the probe runs

Everything about the markup. iHerb 403s every non-browser request, so the tile
selector, whether price and rating live in attributes or text, how pagination is
expressed, where the product code sits, and whether a structured payload exists
are all open. Phase 0 answers all of them in one page load; nothing above depends
on guessing them, which is the point of sequencing it first.

## Sequence

| # | Step | Needs a browser? |
|---|---|---|
| 1 | Probe from the extension → fixture + structure report | **yes** — warm profile |
| 2 | Parser + tests against the fixture | no |
| 3 | `iherb_products` / `iherb_product_snapshots` migration | no |
| 4 | Harvest worker reusing `waitForRecovery` / notifier / cooldown | yes, to verify |
| 5 | Extension panel: probe → guess/create brand → link → harvest | yes |
| 6 | `market_brand_compare` MCP tool | no |

Step 1 is the only one that cannot be done without the operator, and it is a
single page load. Steps 2, 3 and 6 are all offline once the fixture exists —
which is the argument for capturing it early even if collection is weeks away.

A reasonable first slice is **1 + 2 only**: probe Anua, check in the fixture,
write the parser with tests. That proves the extraction approach and the currency
assertion against real markup, and commits nothing to a schema before the shape
of the data is known.
