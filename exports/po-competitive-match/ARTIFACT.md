# PO competitive match (PR1) — shareable CSV

Generated: **2026-10-05 14:03 SGT**  
Source PO: `/workspace/po_upcs.json` (1986 rows)  
Audience: JT / Soobin — read-only review artifact (no `identity_candidates` writes).

## Files
- CSV: `/workspace/briefs/po-competitive-match-pr1.csv`
- Stats JSON: `/workspace/briefs/po-competitive-match-pr1-stats.json`

## How to open in Google Sheets
1. Open [Google Sheets](https://sheets.google.com) → **Blank** spreadsheet.
2. **File → Import → Upload** → choose `po-competitive-match-pr1.csv`.
3. Import location: **Replace spreadsheet** (or new sheet). Separator: **Comma**. Convert text to numbers/dates: Yes.
4. Freeze header row; filter on `match_source` (`iherb` / `shopee` / `none`).
5. Share the Sheet as **Viewer** with Soobin (CSV itself is fine as an email attachment too).

Excel: double-click the CSV, or Data → From Text/CSV (UTF-8).

## Match rules
1. **iHerb exact** — barcode digits normalized 12↔13 (UPC-A ↔ EAN-13 leading zero). Source: Supabase `iherb_products.gtin` + latest `iherb_product_snapshots` price. Confidence = `1.0`.
2. **Else Shopee fuzzy** — brandKey aliases + token overlap (same logic as `po_match.py`). Match if score ≥ **0.6**. Confidence = overlap score.
3. Prefer **iHerb over Shopee** when both hit. `review_note` left blank for human review.

## Match-rate stats
| match_source | rows | % |
|---|---:|---:|
| iherb | 267 | 13.44% |
| shopee | 368 | 18.53% |
| none | 1351 | 68.03% |
| **total** | **1986** | **100%** |

iHerb join: **possible** (fran-skums Supabase via desktop `.env`; 2931 products with gtin).  
Rows where iHerb won over an also-eligible Shopee fuzzy hit: 156.  
Empty `price_sgd` among matches: iHerb 11, Shopee 205 (harvest price gaps).

## Known gaps / blockers
- Shopee Mall harvest is ~Jul–Aug 2026 stale; 0% exact UPC on Shopee (shop_id+item_id only).
- Many K-beauty makeup brands (peripera / bbi@ / clio / judydoll / etc.) absent from mall harvest brandKey coverage → `none`.
- iHerb catalogue is K-beauty leaning; not every PO barcode exists there.
- Box `/workspace/.env` Supabase project has no `iherb_products` table — fran-skums desktop credentials were required.

## Top uncovered brands (`match_source=none`)
- peripera: 88 rows
- joocyee: 70 rows
- judydoll: 63 rows
- fwee: 53 rows
- bbi@: 49 rows
- aztk: 40 rows
- clio: 38 rows
- maogeping: 38 rows
- veecci: 30 rows
- vdl: 28 rows
- skintific: 23 rows
- the saem: 23 rows
- t-fit: 22 rows
- unleasia: 22 rows
- tirtir: 21 rows

## Columns
`barcode, brand, product_name, match_source, confidence, price_sgd, currency_or_date_seen, listing_url, review_note`
