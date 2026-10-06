# Open the PO competitive match

Soobin uses this file to compare a purchase-order barcode with the latest iHerb price and, when iHerb has no exact barcode, a Shopee Mall listing. `review_note` is empty. That column is for her.

The filled sheet is `po-competitive-match.csv` in this folder, after the regenerate command below has been run. `match-stats.json` next to it has the match counts.

## Open the csv

In Excel, choose Data, then From Text or CSV, and pick `po-competitive-match.csv`. Set the delimiter to comma. If a barcode shows in scientific notation, set the barcode column to text before you close the import.

In Google Sheets, choose File, then Import, then Upload. Pick the csv. Set the separator to comma.

## Read a row

The columns are `barcode`, `brand`, `product_name`, `match_source`, `confidence`, `price_sgd`, `currency`, `date_seen`, `listing_url`, and `review_note`.

`match_source` is `iherb`, `shopee`, or `none`.

An `iherb` row is an exact barcode. A 12-digit UPC and the same code written as a 13-digit EAN with a leading 0 count as one barcode. `confidence` is 1. When both channels hit, the row stays on iHerb.

A `shopee` row is not a barcode hit. Shopee Mall listings in this warehouse have no barcode. The script resolves the PO brand through `brandKeyFromDisplayName` and `metadata.aliases` on `marketplace_brand_universe`, then scores the product name against the listing title. `confidence` is that token overlap. A row is included at 0.6 or above. `match-stats.json` also counts the rows at 0.7 or above.

`price_sgd` is filled only when the snapshot currency is SGD. A blank currency is treated as SGD. A USD price leaves `price_sgd` blank and puts USD in `currency`.

`date_seen` is the Singapore calendar day of the snapshot that supplied the price. `listing_url` opens that listing.

`none` means there was no exact iHerb barcode and no Shopee row at the 0.6 overlap. `confidence`, `price_sgd`, `currency`, `date_seen`, and `listing_url` are blank.

## Limits

A size in ml, g, kg, or oz must agree when both titles carry that unit. 200ml does not match 100ml. Different units do not block the row.

Shopee rows with `seller_type` `preferred` or `normal` are dropped. `mall` and a blank seller type stay.

A PO brand that is not in the brand universe does not fuzzy-match, even when a title looks the same. A prior audit named peripera, bbi@, and clio as missing, put Shopee barcode coverage at 0 percent, and put a defendable fuzzy rate around 15 to 20 percent. Treat `shopee` rows as review material, not as identity.

The Mall harvest can be months old. `date_seen` is the snapshot day. A fresh Shopee scrape is a later job and is not required to read this file.

`review_note` is always blank in the generated file. The script does not write `identity_candidates`.

## Regenerate the file

From the repo root, with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `MARKETPLACE_WORKSPACE_ID` set:

```
node scripts/po-competitive-match.mjs --po path\to\po.csv --out exports\po-competitive-match\po-competitive-match.csv
```

The PO file may be csv, json, or xlsx. Recognized headers are UPC, EAN, GTIN, or barcode, plus Brand and Product Name.

To run without the database, pass `--iherb`, `--shopee`, and optional `--brands` json files. That path does not read Supabase.

The command prints `rows`, `iherb`, `shopee`, `none`, and `shopee_overlap_ge_0.7`.

## Build the v2 sheet

The v2 sheet keeps the iHerb price and the Shopee price on the same row. `match_source` is `iherb` when the barcode hits iHerb. It is `shopee` when there is no iHerb hit and the title overlap is at least 0.6. Otherwise it is `none`. `review_note` stays blank.

From the repo root, with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `MARKETPLACE_WORKSPACE_ID` set:

```
powershell -ExecutionPolicy Bypass -File scripts\po-v2-run.ps1 -SkipHarvest
```

That command reads iHerb from Supabase and rebuilds Shopee from the July and August mall workbooks. It does not open Chrome.

To refresh Shopee Mall listings, log into Shopee in the Chrome window the script opens, then run:

```
powershell -ExecutionPolicy Bypass -File scripts\po-v2-run.ps1
```

`scripts\po-v2-run.ps1` stops every chrome.exe before it starts the debug Chrome. Close work you still need in Chrome before that command.

To refresh only the Shopee rows whose price is blank, run:

```
powershell -ExecutionPolicy Bypass -File scripts\po-v2-run.ps1 -PriceRefreshOnly
```

`-Brands joocyee,tirtir` limits the Mall crawl to those pack keys. A brand in `marketplace/poBrandAliasPack.mjs` is crawled only when `shop_verified` is true. A null `shop_username` is a TODO. The script does not invent a shop id.

The v2 file is `exports/po-competitive-match/po-competitive-match-v2.csv`. Counts are in `po-competitive-match-v2-stats.json` in the same folder. The committed csv copies iHerb prices from the PR1 sheet. Shopee prices in that file come from the July and August mall workbooks. Run the command above when you want iHerb read again from Supabase.

The v2 columns are `barcode`, `brand`, `product_name`, `iherb_price_sgd`, `iherb_url`, `iherb_seen_at`, `iherb_confidence`, `shopee_price_sgd`, `shopee_url`, `shopee_title`, `shopee_seen_at`, `shopee_confidence`, `match_source`, `confidence`, `price_sgd`, `seen_at`, and `review_note`.
