# LOFT SOW — Keep In View (KIV)

**Status:** KIV while commercial SOW is finished  
**Source:** `LOFT_SOW_6.0_with Lise comments_LOFT REPLIES.docx` (Downloads)  
**SOW date:** 24 June 2026 (header still Version 1.0; treat as working draft)  
**Related product docs:**

- `docs/LOFT_OPS_DICTIONARY.md` — **Phase 0** env/auth/status/delivery-method dictionary + Loft email draft
- `docs/WORLDSYNTECH_3PL_INTEGRATION_PLAN.md`
- `docs/POS_SKUMS_3PL_STORE_OPS_HANDOFF.md`
- `TODO-LOFT.md` — phased PR plan (P–D code shipped; Phase 0 live IDs open)
- `fulfillment/worldsyntech-ofs/README.md`

**Last reviewed:** 2026-07-15

---

## Purpose of this note

Capture how Loft’s operational SOW maps to the SKUMS LOFT / WorldSyntech OFS logistics add-on, so product and engineering can pick it up after the SOW is locked — without re-reading the full comment thread.

This SOW is **warehouse operations and commercial process**, not a software integration contract. SKUMS still owns the system of record for identity, approvals, store ops, and the OFS connector.

---

## Operating model (aligned)

```text
Korea / Hong Kong suppliers → Loft Logistics warehouse (OFS) → LISE physical stores
```

| Layer | Owner | Scope |
|--------|--------|--------|
| LOFT SOW | Loft ops + LISE commercial | Pre-alerts, receiving SLAs, FEFO, packing, returns, discrepancies, dispatch, WhatsApp |
| SKUMS LOFT add-on | LISE / Fran + engineering | ASN, product mapping, inventory pull, store replenishment orders, exceptions, POS handoff |

**Architecture decision (do not reopen without cause):**

- Treat Loft/OFS as a **fulfillment / 3PL connector**, not a marketplace channel.
- Primary mode: **store replenishment / warehouse outbound**, not ecommerce fulfillment.
- Flow: **POS → SKUMS → Loft/OFS** (never POS directly to Loft).

---

## Document legend (from the Word draft)

| Marking | Meaning |
|---------|---------|
| Red body text | Lise requirements / comments |
| Yellow highlight | Open / TBA items |
| Insertions by Daryl Chan | Loft replies |
| Empty version-control table | Not yet a locked revision |

---

## Process → product mapping

| SOW process | SKUMS / OFS counterpart | Repo signal | KIV action after SOW lock |
|-------------|-------------------------|-------------|---------------------------|
| 48h pre-alert + inbound template (SKU, description, tracking, qty, UPC, expiry) | `ship_to_warehouse` / create inbound | API + adapter present | Confirm field parity with Loft template; enforce barcode + expiry on ASN |
| Partial inbound stays open | Inbound poll + partial receipt | Designed | Map OFS statuses → UI lifecycle |
| Inventory only after LISE confirm; new SKUs pre-informed | Product handshake before stock post | Pull product/inventory | Block stock trust until mapping + confirm |
| Orders via portal/template; marketplaces “can interface” | `order/create` as **store replenishment** | `create-store-replenishment` | Keep ecom optional; name workflows `store_replenishment` |
| FEFO + expiry alerts + quarantine | Expiry domain + WMS FEFO | Expiry in SKUMS; batch/FEFO not full in OFS mapping | Configurable near-expiry gate on outbound |
| Discrepancies / damage / returns | Attention items + exceptions | Attention items exist; returns grades not in connector | Event trail even if WhatsApp used for speed |
| Store delivery / LISE courier handoff | Delivery method + `reference_no` + order docs | Partial | Scenario 1 vs 2 liability → store receipt mandatory if 1 |
| Category segregation / carton labels | Order payload + optional split rules | Not built | Only after matrix + label ownership confirmed |

---

## Locked-in operational facts (once SOW agrees)

> **Product locks (2026-07-15):** independent of commercial SOW final PDF.  
> Live OFS **IDs/URLs** remain open in `docs/LOFT_OPS_DICTIONARY.md` until Loft replies to the Phase 0 email.

### Product / architecture (locked for implementation)

| Fact | Decision |
|------|----------|
| Connector boundary | Loft/OFS = fulfillment 3PL app (`worldsyntech-ofs`), not marketplace channel |
| Call path | POS → SKUMS only; never POS → Loft credentials |
| Store request | Signal to HQ (`store_ops:approve`); not auto OFS order |
| Baseline cadence | **Monday + Thursday** replenishment waves (workspace-configurable later) |
| Approve vs send | `store_ops:approve` ≠ `store_ops:execute_3pl` |
| Store sellable stock | Increases only on receive apply / verified path — not on send-to-Loft |
| Inbound promote | `LOFT-SG` only after LISE confirm; never write store on_hand from ASN |
| FEFO pick | Loft WMS; SKUMS does not choose pick batch |
| Short-date gate | SKUMS default **9 months** remaining shelf life before send; override needs `inventory:override_expiry` + reason |
| In-transit post (D2 default) | On OFS shipped **or** ready_for_collect |
| Status maps until Loft answers | Provisional string heuristics in poll code — see ops dictionary |

### Inbound / receiving

- Pre-alert **≥ 48 hours** before arrival via Loft inbound template.
- Required inbound fields: SKU, description, tracking no., quantity (UOM), item barcode (UPC), expiry dates.
- Shipper packing list: carton count, SKUs, quantity.
- Barcodes on items and/or cartons must match packing list / uploaded inbound.
- Returns subject to same inbound process.
- Outer-carton damage → notify customer POC for acceptance.
- Open-carton QA only on request; cost quoted case-by-case; **3 working days** notice for QC instructions.
- New SKUs: no inventory update until SKU pre-informed and confirmed.
- Receiving window: Mon–Sat 08:30–18:00.
- Delivery to door unit **04-1A, 4th floor, Krislite Building**; unloading/loading at bay not Loft’s responsibility unless agreed.
- Pallets disposed end of month (misc. charges if applicable).
- Multi-leg visibility in SKUMS: offshore forwarder + local **M&P** + palletization on ASN metadata; OFS gets tracking Loft expects (confirm which leg).

### Receiving SLAs (as drafted — push for tiers if still open)

| Pre-alert | System update after physical receipt |
|-----------|--------------------------------------|
| ≥ 48 hours | 48–60 **business** hours |
| &lt; 48 hours | 72–84 **business** hours |

Loft notes: ranges assume unknown/container-scale; smaller lots and **1 SKU per carton** can be faster.  
**Product implication:** do not assume same-day putaway; surface ASN → receiving → confirmed → available.

### Storage

- Ambient warehouse draft: **27–31°C** (Lise asked ≤25°C; Loft noted AC storage in pricing).
- CBM from supplier packaging as received.

### FEFO & expiry (Lise red + Loft reply)

- **Pick logic: FEFO only** (not dual batch + earliest-receipt as separate pick logics).
- Same expiry, different batches → separate locations; pick still FEFO.
- Lise: remaining shelf life **within 9 months** → flag before despatch; no short-dated despatch without written approval.
- Loft: configurable near-expiry alerts; monthly near-expiry report.
- Expired found on pick/count → quarantine; notify within **x days** (SLA still open).

### Outbound / packing

- Orders: Loft template, portal entry, or (later) marketplace interfaces on Loft side.
- Cancel / hold via Loft system; “completed” when picked and ready for courier pickup.
- Order cutoffs table: **TBA**.
- B2B/wholesale: original customer cartons; special packaging pre-defined.
- Loft packing materials: bubble wrap, shrink-wrap, polymailers; other materials chargeable.
- Carton labels (Lise): system-printed — SKU(s), description(s), qty per SKU, transfer/ITR ref, warning labels (Fragile, This Way Up, Keep Dry, Do Not Stack, Temperature Sensitive — TBC).
- Loft: label content must be supplied on order drop-in; fragile label supply (LISE vs Loft) open.

### Category segregation (TBC)

Makeup largely **NO** with haircare, body care, fragrance, skincare; tools/accessories OK with most. Loft asked to clarify the table.  
**Product implication:** if enforced, either Loft packs by rule or SKUMS splits replenishment lines/orders by category.

### Returns (Lise; process incomplete)

| Grade | Meaning | Action |
|-------|---------|--------|
| A | Resaleable, pack intact | Return to available stock |
| B | Pack damaged, product OK | Customer disposition |
| C | Unsaleable | Quarantine; destroy only on written instruction |

Weekly returns reconciliation requested; Loft: data downloadable anytime; needs return no./label process.

### Discrepancies

- **Inbound:** flag qty variance; record SKU, declared vs physical, damage flag; customer ack within **x** days before close. Loft: visible in inbound UI; **closure often via WhatsApp** for speed.
- **Inventory:** pick variance flagged; cycle counts internal; full stocktake frequency TBC with LISE.
- **Outbound:** ack + written pick/pack account within **x** days; re-despatch cost if Loft pick/pack error; collect wrong item if instructed.
- **Liability scenarios (Daryl):**
  1. **Pick/pack only + LISE courier** → Loft ends at handover; relies on stocktake for variance (weak for store-reported miss).
  2. **Pick/pack + delivery** → fix miss-pick/pack; **no consequential losses**.
- **Damage:** quarantine, photos, report within **x** days; customer disposition within **x**; destroy needs written auth. Loft agreed **monthly** damage reporting in reply.
- **Issue log:** Lise weekly fields (date, type, SKU/qty, root cause, resolution, liability, status). Loft: online issue log, both parties, **monthly** performance review basis.

### Dispatch & comms

- Lise: store delivery ideally before 10:00, ~2×/week.
- Loft: prefer **fixed weekday schedule**; optional shelf-fill commercial upsell.
- Offline channel orders: delivery docs attached in Loft; consolidate by delivery location for transporter pickup.
- Day-to-day: Loft system + WhatsApp ops chat + dedicated COT contact; escalations/commercial email (Daryl: `Daryl_chan@loftlogistic.com`).

### Still TBA in SOW (do not hardcode)

- Service levels / KPIs  
- Liability, insurance, compliance  
- Order processing timings table  
- Most “within **x** business days” SLAs  
- Temperature commercial resolution  
- Category segregation final matrix  
- Label material ownership  

---

## Product implications (after SOW finishes)

### Stay the course

1. Fulfillment adapter boundary (`worldsyntech_ofs` / Loft), not channel.
2. Phase 1: inbound ASN + inventory pull + store replenishment.
3. POS and store staff never call Loft APIs directly.
4. OFS stock = connection-scoped warehouse availability; not blind overwrite of canonical sellable stock.

### Raise priority when SOW is signed

1. **Inbound lifecycle UI** — pre-alert sent → receiving → partial → LISE confirm → putaway complete → available.
2. **Near-expiry / short-dated gate** on outbound replenishment (default 9 months if SOW keeps it; make configurable).
3. **Store receipt + exception capture** if liability scenario 1 (LISE courier) is chosen.
4. **Order payload completeness** for carton labels: SKU, description, qty, transfer/ITR reference, handling flags.
5. **Attention items** for: inbound discrepancy, damage, short-dated hold, pick variance, missing new-SKU master data.
6. **WhatsApp is not the ledger** — record discrepancy close, approvals, and disposition in SKUMS even if humans chat.

### Defer / phase 2 unless SOW forces it

- Full returns Grade A/B/C workflow in connector  
- Category segregation packing engine  
- KPI dashboards against unfilled SLAs  
- Marketplace order routing into OFS  
- Shelf-fill / in-store service productization  

### Data prerequisites Loft will enforce

- Barcode/UPC and SKU master before first inbound  
- Dimensions/weight for CBM and product push (per OFS plan)  
- Unique tracking / shipment reference for ASN  
- Unique `reference_no` for store replenishment / outbound  

---

## Negotiation checklist (commercial — track outside this repo if preferred)

Use when closing SOW; then update this doc’s “Locked-in” section.

- [ ] Tiered receiving SLA (parcel/LCL vs FCL; 1-SKU-1-carton target)
- [ ] AC / ≤25°C storage + pricing for sensitive categories
- [ ] FEFO-only + 9-month (or agreed) short-date block in WMS, not best-effort
- [ ] Explicit liability scenario 1 vs 2
- [ ] If scenario 1: store POD / receive process + re-despatch liability for confirmed pick/pack error
- [ ] Fill all `x` business day SLAs
- [ ] KPIs: receiving cycle time, pick accuracy, fill rate, damage rate, near-expiry compliance
- [ ] Liability, insurance, compliance section completed
- [ ] Fixed store delivery days + cutoff for order drop-in
- [ ] Portal/API as system of record; WhatsApp for escalation only
- [ ] Carton label fields + who supplies warning labels
- [ ] Category segregation matrix confirmed or removed
- [ ] Returns numbering / label process
- [ ] Version control table filled; SOW version number matches filename

---

## Engineering resume checklist (when SOW is done)

1. Diff final SOW PDF/DOCX against this KIV note; update “Locked-in” facts.
2. **Phase 0:** send structured email in `docs/LOFT_OPS_DICTIONARY.md`; paste Loft answers (URLs, delivery_method_ids, status enums); replace poll heuristics with explicit maps.
3. Map SOW template fields → inbound create + product master (UPC/expiry once API confirms).
4. Map store replenishment + transfer/ITR ref → order create payload (done for core fields; complete label fields if SOW requires).
5. ~~Near-expiry policy hook before outbound submit~~ ✅ default 9 months + override scope.
6. ~~Store receive / discrepancy for scenario 1~~ ✅ Phase C receive + `store_ops:verify` exceptions.
7. Add attention-item types for SOW exception classes still missing.
8. Do **not** expand to marketplace ecom fulfillment unless SOW + product roadmap both say so (Phase H deferred).

---

## Open questions for product (post-SOW)

1. Who is system of record for “inbound closed / qty confirmed” — Loft portal only, or SKUMS approval that drives/records the same?
2. Will LISE run fixed replenishment days only, or also ad-hoc urgent store requests?
3. Should short-dated stock be blocked in SKUMS, WMS, or both?
4. How much of the discrepancy log should sync from Loft issue log vs be native SKUMS?
5. Is returns grading in phase 1 volume, or store-side only at go-live?

---

## Changelog

| Date | Note |
|------|------|
| 2026-07-10 | Initial KIV from draft SOW with Lise comments + Daryl (Loft) replies; aligned to WorldSyntech OFS + POS store-ops handoff. |
| 2026-07-15 | Phase 0: product locks table; link `LOFT_OPS_DICTIONARY.md` + Loft email; engineering checklist reflects P–D shipped / live OFS IDs open. |
