# Fran WEB — TODO (store-routing site, GEO/SEO, offers)

**Date:** 2026-07-22  
**Relation to core:** `TODO.md` Track BR = marketplace *intelligence* (Shopee harvest).  
**This file:** public/marketing **website** that turns brand search → **retail outlets first**, with Gen‑Z / **yuu** / voucher **nett value** (not static price wars with Sephora/Guardian/brand.com).

**Positioning (draft):**  
Fast multi-store retail · Gen‑Z · yuu loyalty · Grab/Chagee/Luckin-style velocity (drops, points, brand voucher, store voucher) · **web directs visits & till**, not pure e-com first.

---

## Problem (why not “another shop”)

Google SG for a brand like [rom&nd](https://romandbeauty.com/) typically shows:

| Result | Issue for Fran |
|--------|----------------|
| Official brand.com (often US/global) | You won’t win “official brand” authority |
| Guardian / Sephora | Scale + assortment; thin reviews on some online paths |
| Weak thin pages | Easy to out-quality, hard to win pure “buy online cheapest” |

**Win differently:** *“rom&nd in Singapore — yuu + store vouchers + try in person at Fran near you.”*

---

## North star funnel

```text
Google / Ads / TikTok / ChatGPT
        ↓
  fran web brand / product intent page
        ↓
  Offer stack (account · multi-buy · yuu · vouchers)
        ↓
  Primary CTA: get at store (stock near me · reserve · QR · maps)
        ↓
  Till + yuu / voucher redeem → LTV
```

**Phase-1 success metrics:** store locator clicks, voucher/QR redemptions, visit within 7 days, drop-week footfall — not online GMV.

---

## Offer ladder (operator thought — high priority)

**Idea:** On brand/product search landings, don’t only show static `$X`. Show **conditional nett value** that increases LTV and Ads ROAS.

### Example (rom&nd product page / brand hub)

| Tier | Offer | Intent |
|------|--------|--------|
| **A — Browse** | Price `$X` + “in stock at [store]” | Trust + proximity |
| **B — New Fran account** | **~$X − 10%** (or equivalent voucher) with new account / first visit | Capture identity · CRM · yuu link |
| **C — Multi-item / basket** | **~25% effective** if buy **2+ items** (brand or store mission) | Basket size · LTV · trip purpose |
| **D — Loyalty stack** | yuu earn/redeem + brand voucher + store voucher (when member known) | Repeat · ROAS on retargeting |

**Why this helps ROAS:**  
Ads pay for the click; **account + multi-buy** raise contribution per visit and give a cheaper second purchase (email/yuu/retargeting), not one-off price match with Sephora.

**Design rules:**

- Always show **conditions** (new account / 2 items / dates / store-only).  
- Prefer **redeem at till / QR** for phase 1 (web-to-store), not open coupon abuse online.  
- Compute **displayed nett** from offer engine API (not hard-coded in CMS).  
- Track: `ad_click → landing → account_create | multi_buy_intent → store_redeem`.

### Slice backlog (offers)

| ID | Work | Status |
|----|------|--------|
| **W-OFF-1** | Offer model: brand voucher, store voucher, new-account %, multi-buy %/GWP, yuu points estimate | Planned |
| **W-OFF-2** | Landing UI: “Your nett ≈ $Y” with expandable rules + primary “Get at store” | Planned |
| **W-OFF-3** | New-account 10% path: create/link Fran + optional yuu deep link | Planned |
| **W-OFF-4** | Multi-buy 2+ mission: basket rules (same brand vs any Fran) + till redeem code | Planned |
| **W-OFF-5** | Ads landing params: `utm_*` + offer id for ROAS reporting | Planned |
| **W-OFF-6** | Abuse controls: one new-account offer per phone/yuu; store staff verify | Planned |

---

## Site IA (for ranking + GEO)

| Page type | URL sketch | Job |
|-----------|------------|-----|
| Brand hub | `/brands/romand` | “Where to buy in SG” + offers + stores |
| Product/line | `/brands/romand/juicy-lasting-tint` | Only **stocked** SKUs + stock near me |
| Store | `/stores/{slug}` | Local SEO + brands + hours + yuu |
| Mission/drop | `/drops` or `/missions/...` | Velocity content for GEO + ads |

**Dual value story on every brand hub:**

1. Marketing truth (what Fran stocks + offers)  
2. Optional later: intelligence snippets (what’s moving) — data from SKUMS brand radar, not scraped thin pages  

---

## SEO (ranking) focus

| Priority | Work |
|----------|------|
| **W-SEO-1** | Local: Google Business Profile per store, NAP consistency, posts for drops |
| **W-SEO-2** | Schema: `LocalBusiness`, `Brand`, `Product`/`Offer` with `availableAtOrFrom` store, FAQ |
| **W-SEO-3** | Index only real assortment (from SKUMS ATS) — no orphan PDPs |
| **W-SEO-4** | Internal links: brand ↔ store ↔ product auto from catalog |
| **W-SEO-5** | Core Web Vitals / mobile-first brand hubs |
| **W-SEO-6** | Reviews loop: in-store QR → brand/store pages |

**Do not** try to outrank brand.com for generic global “romand”.  
**Do** target: “romand singapore”, “near me”, “yuu”, neighbourhood + store.

---

## GEO (generative engine optimization)

| Priority | Work |
|----------|------|
| **W-GEO-1** | Answer-first blocks: “Where to buy rom&nd in Singapore?” (40–80 words + stores) |
| **W-GEO-2** | Freshness: weekly drops / “updated” offers (AI prefers current local pages) |
| **W-GEO-3** | Unique citable angle: yuu + multi-store + Fran missions (not brand.com INCI clone) |
| **W-GEO-4** | FAQ schema with real SG questions (auth, yuu, shades in store) |
| **W-GEO-5** | Clean sitemap / optional `llms.txt` pointing at brand + store hubs |

---

## Web → store conversion tech

| Priority | Work |
|----------|------|
| **W-CONV-1** | Stock near me (geo/postcode) from SKUMS locations + ATS |
| **W-CONV-2** | Reserve/hold for pickup (soft hold if reservation APIs exist) |
| **W-CONV-3** | Till QR / staff code for voucher + basket intent |
| **W-CONV-4** | Maps + hours CTA |
| **W-CONV-5** | Measurement: redeem rate, visit attribution, LTV by first-offer cohort |

---

## Architecture (sketch)

```text
fran.sg (content + GEO)
    ↓
Offer engine API  ← yuu / brand voucher / store voucher / multi-buy / new-account
    ↓
Assortment + ATS by store (SKUMS)
    ↓
Stores: POS + yuu + redeem
```

Optional later: brand radar feeds **which SKUs to feature** on hubs (movers / new / under-pushed).

---

## Phased delivery

| Phase | Scope | Status |
|-------|--------|--------|
| **P0** | Store pages + GBP + top brand hubs (copy + schema, no heavy offers) | Planned |
| **P1** | Stock near me + Get at store CTA | Planned |
| **P2** | **Offer ladder (W-OFF-*)** — 10% new account, 25% multi-buy, nett display | Planned — *operator priority* |
| **P3** | Drops / missions / points display | Planned |
| **P4** | GEO polish + review loop + ads ROAS dashboards | Planned |
| **P5** | Optional e-com long-tail (secondary) | Later |

---

## Explicit non-goals (web, phase 1)

- Beat brand.com US for global head terms  
- Full brand.com catalog PDPs for unstocked SKUs  
- Static price-only landing pages for Google Ads  
- Thin scraped Shopee mirrors on fran.sg  

---

## Open decisions

1. Domain: fran.sg vs fran.com.sg vs path under existing site  
2. Multi-buy “2 items” = same brand only vs any Fran basket  
3. New-account 10% = first **store** visit only vs first web account  
4. yuu integration depth (deep link only vs API balance later)  
5. Ads: brand campaigns vs store-local campaigns first  

---

## Link to main TODO

| Main `TODO.md` | This file |
|----------------|-----------|
| BR harvest / MH-* / MCP brand listings | **Input data** for what to feature |
| Loyalty / POS / inventory | **Fulfillment** of web offers at till |
| Web offers, GEO, store routing | **Owned here** |

When implementing, prefer thin APIs in SKUMS (offers + ATS) over a separate brain for price lies.
