# Fran grounding plan (before 2nd store)

**Date:** 2026-09-07  
**Status:** approval-ready grounding pack · draft for people + systems · **not a build brief**  
**Owner ask:** ground everybody before 2nd store open; no eng build until J T unlocks  

**Demo shipping SoT (already live):** workspace `c21c057f-ea01-4e19-bc79-fafcf2626b19` · https://fran-skums.vercel.app/apps/shipping  

---

## 1) North star

“Grounded before 2nd store” means:

- One **forced** operating model (not adapted to archaic PPT / Sheet / chat workflows)
- One **system of record** per domain
- **Wrong-lane** work is visible and blocked
- Humans do judgment / relationships / budget
- Bots do capture, routing, fran-skums data checks, and drafts for approval
- No chat-as-DB; no competing SoTs in Drive decks

2nd store must not open with chat / PPT / Sheets as the default ops bus.

---

## 2) Role lanes + wrong-lane flags

### Merch lane (forced)

1. **Soobin** — speak to brands → hand off **insights only**
2. **Fern & Tiff** — trends / judgment, prioritization, **fran-skums** sales / SKU / inventory checks (non-robotic; not filling bay sheets by hand)
3. **Ask Hiok for money** to execute
4. **VM / Benny / Studio J** execute

### Fixture lane (separate)

Store Dev + Studio J. Bay cards keep **fixture-deps ≠ merch-deps**.

### Wrong-lane flags (ops now; software later)

| Flag | Why it is wrong |
|------|-----------------|
| Soobin deep in lightbox briefs | Insights lane only; briefs are Fern/Tiff → Benny after Hiok |
| Fern / Tiff filling bay sheets by hand | Judgment + skums checks, not spreadsheet archaeology |
| Spend / production before Hiok | Money gate skipped |
| Chat / PPT / Sheets treated as SoT | Multi-SoT debt; bots cannot enforce |
| Treating latest Studio J PDF as SoT | Same disease on fixtures; bots cannot enforce bay deps |
| Skipping fran-skums checks | Priors not grounded in catalog / stock / sales |
| Merch blocked on fixtures (or reverse) with no explicit dep | Hides the real blocker on the wrong bay card |

---

## 3) System of record per domain

| Domain | SoT | Not SoT |
|--------|-----|---------|
| **Shipping** | `apps/shipping` + `shipping_*` (timeline, staff notes, curated WhatsApp). Drive = file cabinet only. Demo WS above. | Chat as ops memory |
| **Merch / POG / heroes / endcap / lightbox** | **Target:** fran-skums planogram data model | Today's debt: Merch curation PPTX + Hiok VM Plan sheet + chat as ops bus (Studio J PDFs belong in the **fixture** lane, not merch); no facing-level SKU truth. Flag multi-SoT; do not optimize it. |
| **Fixtures** | **Target:** fran-skums bay **fixture-deps** (+ fran-zone ID map). Studio J / landlord PDFs are **ingest events** only. | Dated AutoCAD/PDF dumps in Drive/chat (`LAYOUT_*`, `BUGIS_LAYOUTS_*`, `TECHNICAL DRAWING SET_*`, elevations, one-offs). Whichever PDF landed last is **not** SoT. |
| **Planogram (direction)** | Data in fran-skums Supabase (`bays` / `shelves` / `facings`, workspace like shipping); 3D stays **fran-zone** loading bay JSON (replace hardcoded `layout.js` merch later); `apps/planogram` for MD/VM | Hardcoded merch / fake bottles as truth |

### Studio J PDF drip (same disease as Merch sheets)

Studio J has **no fixture SoT either**. They keep exporting dated PDFs because there is no system for them — same class of mistake as Merch PPT + VM sheet.

**Observed cadence (Drive, as of 2026-09-08):** not daily. New dated exports every **~3–7 days** while design is hot, burstier for elevations/fixtures. Lineage example:

`LAYOUT_060826` → `BUGIS_LAYOUTS_130826` / `170826` → `Furniture Layout_190826` → tech set `280826` → `010926` (touched again 4 Sep) → elevations / cashier / mask one-offs → `NOA_FP 040926` → elevations `080926` (8 Sep).

**Watch folder (file cabinet, not SoT):** `09 Expansion` → `02 Bugis+ (CapitaLand)` → `00 Store Fit Out` → `03 Store Layout Drafts` → `00 technical drawings` — especially `FRAN_TECHNICAL DRAWING SET_*` dated bumps. Drive does not iterate one living object; each drop is usually a **new PDF**.

**Rule for bots + humans:**
1. Every new Studio J / landlord PDF = an **ingest event** into fran-skums **fixture-deps** on the right bay cards (landlord approval, heights, cabling, graphics, hook alloc, etc.).
2. Never treat "latest PDF in chat/Drive" as the system of record.
3. Until fixture-deps exist, every new PDF is just another competing copy — flag it, do not optimize the drip.
4. Wrong-lane if Merch/Marketing absorbs drawing archaeology instead of Store Dev / Studio J.

### Locked fixture refs (as of 2026-09-07)

- Logo acrylic: **Pantone 2190U** (3 mm)
- Lighting: **2700K** warm / **6000K** cool
- Mask wall: Option 2 + Pantone **476C** (earlier lock)
- Hook bays: historically all hooks + **5 shelves**
- Zone map explicit in chat: gondola / endcap / lightbox / hygiene · **WB-S5 / WB-M / Barrisol** soft until drawings bind IDs

### Planogram dependency graph (practice on live work)

`brand_allocation → pog → hero_sku → lightbox_brief → design → production → installed`

---

## 4) Near-term grounding checklist (now → 2nd store)

### This week — human decides / bot captures

| Item | Lane | Capture |
|------|------|---------|
| Endcap **8 themes** — Fern/Tiff due **Wed 9 Sep** | Merch | Lock decision **out of chat** |
| Soobin hero SKUs → insights handoff; Benny lightbox target **Fri 11 Sep** | Merch | Flag if Soobin still writing briefs |
| Shipping opens: M&P quote approval; Loft inbound date; **CX6305 vs CX635** (prefer **CX635 / 09SEP**); HK storage-fee if dwell slips | Shipping | Decisions into **shipping staff notes** |
| LED checkout specs unresolved since **24 Aug**; vendor vs friendly naming | Merch / ops | **Name an owner** |
| Fixture opens: landlord approval on tech drawing set; hook alloc **4-6 / 6-1 / 2-15**; mask-bay heights; lightbox cabling; modular height revise; signage colour TBC; mirror position TBD; swatches + ceiling lighting cost | Fixture | Stay in Store Dev lane |

### Before 2nd store

- Makeup gondola: **6×900 mm** screens ordered + **graphics owed**; **12×450 mm** → next store — document in fixture SoT
- POG: makeup ready; skincare = brand allocation; hair/body TBD — **Fern/Tiff + fran-skums only**
- Practice the dep graph on live work (heroes → lightbox → design → production → installed)
- Collapse multi-SoT **one domain at a time** (shipping already clean; next = endcaps **or** hero→lightbox path per J T)

---

## 5) Deliberately NOT build yet

- Full `apps/planogram` MD/VM UI
- fran-zone live bay JSON cutover (direction locked only)
- Auto-migrate historical PPT / Sheets into skums
- Fleet-wide bot + MCP rollout beyond current Heyfran agents
- Any WhatsApp / email send or code ship **from this plan alone**

---

## 6) Open decision asks — J T only

| # | Ask |
|---|-----|
| A | Approve this operating model + SoT map as **mandatory** for 2nd-store grounding? |
| B | Confirm wrong-lane flags as **blocking** (esp. Soobin on lightbox; skip fran-skums; chat/PPT as SoT)? |
| C | Lock shipping flight preference **CX635 / 09SEP** over CX6305? |
| D | Who owns LED checkout vendor vs friendly naming until resolved? |
| E | Collapse merch multi-SoT debt first via **endcaps**, or via **hero→lightbox** path? |
| F | Fixture landlord approval: **escalate now**, or next Store Dev cycle? |
| G | Confirm Studio J / landlord PDFs are **ingest-only** into fixture-deps (never Drive/chat SoT)? |

---

## Related

- Implementation queue: [`TODO.md`](../TODO.md) (Plans table + Track **GROUND**)
- Shipping app: [`apps/shipping/README.md`](../apps/shipping/README.md) (on shipping branch / prod deploy; demo workspace only until production workspaces exist)
- Migration: `088_shipping_visualizer` (`shipping_*` tables)
- 3D tender (spatial client later): fran-zone repo — not this SoT

---

*Drafted with Heyfran Director + CoS. Edit requests go to CoS; do not post / send / build from this doc until J T unlocks.*