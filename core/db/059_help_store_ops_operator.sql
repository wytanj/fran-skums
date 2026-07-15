-- ============================================================
-- 059 — Help Center: Store Ops / inventory operator guides
-- Idempotent upserts by slug (in-app /help + Catalog AI resolve_help)
-- ============================================================

insert into public.help_articles (
  slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, sort_order
) values
(
  'getting-started',
  'Getting started with Fran SKUMS',
  'Where to land after login and what the main areas of the app do.',
  $md$
## Overview

Fran SKUMS is your product catalog, inventory, and store-operations hub. After login you work inside a **workspace**.

## Start here

1. Confirm the correct **workspace** in the left sidebar.
2. Open **Dashboard** for queue counts and shortcuts.
3. Use **Products** for catalog master data (titles, SKUs, prices).
4. Use **Inventory** for stock quantities and warehouse POs.
5. Use **Store Ops** for store replenishment, Loft receive exceptions, floor adjustments, and inbound ASN.
6. Use **Actions** to review AI/MCP **decision** drafts (buying intent — not Loft send).

## Retail ops (LISE / Loft)

| Who | System | Job |
|-----|--------|-----|
| Cashier | Fran POS | Sell; report damage/found; receive deliveries |
| Store manager | Fran POS | Request stock (signal to HQ only) |
| HQ inventory | SKUMS Store Ops | Approve / defer waves; verify exceptions; apply floor stock changes |
| Admin | Integrations | WorldSyntech / Loft credentials |

**Stock truth** lives in SKUMS. POS on-hand is a display cache. Points/members live in Fran CRM.

## Catalog AI vs Help

- **Help** (this section) — how-to and navigation.
- **Catalog AI** — live questions on *your* data (counts, search).
- **MCP** — external agents that **draft** work; humans approve in **Actions** or Store Ops.

## Next reads

- [Store operations (HQ)](/help/store-ops)
- [Approve store replenishment](/help/store-ops-replenishment)
- [Receive deliveries & exceptions](/help/store-ops-receive)
- [Floor damage, found, cycle count](/help/store-ops-floor-adjustments)
- [Inventory and stock truth](/help/inventory-stock)
- [Connect Claude (remote MCP)](/help/connect-claude)
$md$,
  'getting-started',
  '/',
  array['/products', '/store-ops', '/actions', '/help'],
  array['start', 'intro', 'overview', 'home', 'dashboard', 'where', 'begin', 'onboarding', 'how to use'],
  10
),
(
  'inventory-stock',
  'Inventory and stock truth',
  'Where sellable stock lives, what the ledger is, and how POS relates to SKUMS.',
  $md$
## Where to go

**Sidebar → Inventory** → [/inventory](/inventory)

## Stock truth

| Fact | System |
|------|--------|
| Sellable on-hand per store / warehouse | SKUMS **inventory levels** |
| Why quantity changed | SKUMS **inventory ledger** (append-only) |
| POS register display | Cache from SKUMS catalog — **not** a second ledger |
| Member points | Fran CRM — not Inventory |

Every applied movement (sale, receive, approved damage, inbound promote) should appear on the **ledger**. Pending POS floor reports do **not** change stock until HQ applies them under **Store Ops → Floor adjustments**.

## Inventory screen vs Store Ops

| Surface | Purpose |
|---------|---------|
| **Inventory** | Levels, warehouse POs, classic transfers |
| **Store Ops** | Store requests, Loft orders, receive exceptions, floor apply, inbound ASN |
| **Actions** | AI/MCP decision POs (buying intent) |

## Rules of thumb

- Store on_hand increases on **receive** (or approved found/count) — **not** when you send an order to Loft.
- Loft warehouse ATS lives on location code **LOFT-SG** after LISE inbound confirm.
- In transit legs use codes like **XFER-LOFT-STORE**.

## Related

- [Floor damage, found, cycle count](/help/store-ops-floor-adjustments)
- [Receive deliveries & exceptions](/help/store-ops-receive)
- [Store operations](/help/store-ops)
$md$,
  'inventory',
  '/inventory',
  array['/store-ops', '/actions'],
  array['inventory', 'stock', 'on hand', 'ats', 'warehouse', 'po', 'purchase order', 'transfer', 'low stock', 'ledger', 'truth', 'quantity'],
  50
),
(
  'store-ops',
  'Store operations (overview)',
  'HQ hub for replenishment, Loft receive, exceptions, floor adjustments, and inbound ASN.',
  $md$
## Where to go

**Sidebar → Store Ops** → [/store-ops](/store-ops)

## Tabs

| Tab | Use |
|-----|-----|
| **Queue** | Store replenishment requests; approve now, defer to Mon/Thu wave, or reject |
| **Orders** | Replenishment orders; send to Loft when ready |
| **Inbound ASN** | KR/HK goods pre-alert to Loft; confirm → LOFT-SG stock |
| **Receiving** | Receiving session history |
| **Exceptions** | POS short/damaged/wrong claims — verify |
| **Floor adjustments** | Pending damage / found / cycle count — apply to ledger or reject |

## Operating model

```text
POS request  →  HQ approve / defer  →  (optional) Send to Loft
POS receive  →  good stock applied  →  exceptions to HQ
POS floor    →  pending adjustment  →  HQ Apply = ledger
```

POS **never** talks to Loft. Approve **≠** send to Loft.

## Default cadence

**Monday + Thursday** baseline waves. Ad-hoc store requests are **signals** for HQ, not automatic warehouse orders.

## Detailed guides

- [Approve store replenishment](/help/store-ops-replenishment)
- [Receive deliveries & exceptions](/help/store-ops-receive)
- [Floor damage, found, cycle count](/help/store-ops-floor-adjustments)
- [Inbound ASN to Loft](/help/store-ops-inbound)
- [Loft / WorldSyntech setup](/help/loft-worldsyntech)
$md$,
  'operations',
  '/store-ops',
  array['/inventory', '/integrations', '/help'],
  array['store', 'store ops', 'replenishment', 'store floor', 'request', 'loft', '3pl', 'wave', 'monday', 'thursday'],
  70
),
(
  'store-ops-replenishment',
  'Approve store replenishment (waves & lift)',
  'How HQ turns a store stock request into a wave or lift order — without auto-sending to Loft.',
  $md$
## Where to go

**Store Ops → Queue** → [/store-ops](/store-ops)

## Who can approve

Needs **`store_ops:approve`** (inventory ops / admin packages). POS managers only **submit** requests.

## Steps

1. Open a **submitted** request in the queue.
2. Read store, priority, lines, needed-by.
3. Optional: use recommend / MCP baseline+lift — **advice only**.
4. Choose:
   - **Lift / approve now** — urgent path; creates order for later send
   - **Defer to wave** — attach to next **Monday or Thursday** wave
   - **Reject** — close with reason if needed
5. When the order is ready and mapped: **Send to Loft** (separate step; needs **`store_ops:execute_3pl`**).

## Important

| Do | Don’t |
|----|--------|
| Treat request as HQ signal | Expect Loft to be notified on request submit |
| Use Mon/Thu as default pipe | Auto-increase store stock on send |
| Keep approve and send as two human steps | Give POS staff approve rights |

## Related

- [Store operations overview](/help/store-ops)
- [Loft / WorldSyntech setup](/help/loft-worldsyntech)
$md$,
  'operations',
  '/store-ops',
  array['/store-ops', '/integrations'],
  array['approve', 'replenishment', 'request', 'wave', 'lift', 'defer', 'monday', 'thursday', 'send to loft', 'hq'],
  71
),
(
  'store-ops-receive',
  'Receive deliveries and exceptions',
  'POS confirms Loft deliveries; HQ verifies short, damaged, over, or wrong SKU claims.',
  $md$
## POS (Fran POS)

1. Open **Receive delivery** (not free-form “Receive stock” on the Stock page).
2. Pick the expected order from SKUMS.
3. Enter **received** and **damaged** quantities.
4. Set exception type when needed (short / damaged / over / wrong SKU).
5. Self-collect: enter collector name/time if prompted.
6. Submit.

Good units can apply to store sellable stock. Exception lines open HQ work.

## HQ (SKUMS)

**Store Ops → Exceptions**

| Action | Meaning |
|--------|---------|
| **Confirm claim** | Accept the POS report |
| **Escalate Loft** | Follow up with 3PL (still record here — chat is not the ledger) |
| **Reject claim** | Deny the claim |

Needs **`store_ops:verify`**. Stock corrections may need **`inventory:write`**.

## Rules

- Labels on POS: **reported**, not **resolved**.
- Idempotent resubmit should not double-count stock.
- Delivery vs self-collect is the same receive UX; only fields/copy change.

## Related

- [Floor adjustments](/help/store-ops-floor-adjustments)
- [Inventory and stock truth](/help/inventory-stock)
$md$,
  'operations',
  '/store-ops',
  array['/store-ops', '/inventory'],
  array['receive', 'receiving', 'delivery', 'exception', 'short', 'damaged', 'wrong sku', 'self collect', 'pod'],
  72
),
(
  'store-ops-floor-adjustments',
  'Floor damage, found stock, and cycle count',
  'POS reports floor issues; HQ applies or rejects so the inventory ledger stays correct.',
  $md$
## POS

On **Stock** (floor tools):

| Action | Meaning |
|--------|---------|
| **Damage** | Write-off report (qty damaged) |
| **Found stock** | Extra units found (qty found) |
| **Cycle count** | Physical **counted on-hand** (absolute), not a delta |

Reports go to SKUMS as **pending**. Live free-form “Receive stock” does **not** update the SKUMS ledger — use **Receive delivery** for Loft trucks.

## HQ

**Store Ops → Floor adjustments**

1. Review variance (system vs counted).
2. **Apply to ledger** — quantity truth updates (`inventory_ledger`).
3. **Reject** — no stock change.

Requires **`inventory:write`**.

## Why two steps?

Store staff capture reality quickly. HQ protects sellable ATS from silent overwrites. Every apply is audited.

## Related

- [Inventory and stock truth](/help/inventory-stock)
- [Receive deliveries](/help/store-ops-receive)
$md$,
  'operations',
  '/store-ops',
  array['/inventory', '/store-ops'],
  array['damage', 'found', 'cycle count', 'stocktake', 'floor', 'adjustment', 'apply', 'ledger', 'shrink'],
  73
),
(
  'store-ops-inbound',
  'Inbound ASN (KR/HK → Loft)',
  'Pre-alert Loft for inbound goods; promote LOFT-SG stock only after LISE confirm.',
  $md$
## Where to go

**Store Ops → Inbound ASN** → [/store-ops](/store-ops)

## Steps

1. Create draft ASN: tracking, ETA, lines (SKU/qty), M&P / pallet notes.
2. Ensure products map to OFS.
3. **Send to Loft** (needs inbound / execute scopes).
4. Poll status as goods land (partial vs full).
5. **LISE confirm** — set received/spoil as needed.
6. Promote trusted stock to **LOFT-SG**.

## Rules

- Aim for **≥ 48h** pre-alert (SOW).
- Inbound **never** increases **store** on_hand.
- POS has **no** inbound ASN UI (by design).

## Related

- [Loft / WorldSyntech setup](/help/loft-worldsyntech)
- [Store operations](/help/store-ops)
$md$,
  'operations',
  '/store-ops',
  array['/integrations', '/store-ops'],
  array['inbound', 'asn', 'ship to warehouse', 'kr', 'hk', 'm&p', 'loft-sg', 'pre-alert'],
  74
),
(
  'loft-worldsyntech',
  'Loft / WorldSyntech setup',
  'Connect the 3PL, map products, and know what admin vs inventory ops own.',
  $md$
## Where to go

**Sidebar → Integrations** → WorldSyntech OFS

## Admin setup

1. Install / enable **WorldSyntech OFS** app (needs apps install + credentials write).
2. Enter base URL, Basic token, user, password (HTTPS only).
3. **Test credentials**.
4. **Sync reference data** (delivery methods, countries, zones).
5. **Pull products** and map to SKUMS SKUs / UPCs.
6. Optional: pull inventory snapshot (warehouse view — does not overwrite store levels).

## Ops usage

- Store orders: **Store Ops → Orders → Send to Loft**
- Inbound: **Store Ops → Inbound ASN**
- Never put OFS passwords in POS or browser env vars for cashiers

## Delivery modes

| Mode | Meaning |
|------|---------|
| **delivery** | Loft delivers to store door |
| **self_collect** | Ready for LISE / courier collect at warehouse |

Exact `delivery_method_id` values come from Loft tenant reference data (see ops dictionary).

## Related

- [Approve replenishment](/help/store-ops-replenishment)
- [Inbound ASN](/help/store-ops-inbound)
- [Store operations](/help/store-ops)
$md$,
  'integrations',
  '/integrations',
  array['/store-ops', '/settings'],
  array['loft', 'worldsyntech', 'ofs', '3pl', 'credentials', 'mapping', 'delivery method', 'fulfillment'],
  75
),
(
  'pos-vs-skums',
  'POS vs SKUMS vs CRM',
  'Which system owns sales, stock, and loyalty points.',
  $md$
## Split of ownership

| Concern | System |
|---------|--------|
| Cashier UX, payment, receipt, outbox | **Fran POS** |
| Products, multi-store stock, Loft, receive verify | **Fran SKUMS** |
| Members, points, tiers, loyalty analysis | **Fran CRM** |

## Flows

```text
Sale complete
  → POS receipt + outbox
  → SKUMS sale (stock down)
  → CRM points / member events

Stock damage
  → POS report
  → SKUMS floor adjustment apply
  → ledger

Loyalty redeem
  → CRM policy + commit
  → SKUMS quote / reservation when configured
```

## Rules

- Do not store “true” points only on the POS customer row.
- Do not use CRM as the inventory ledger.
- Do not use POS free-form receive as multi-store stock truth.

## Related

- [Inventory and stock truth](/help/inventory-stock)
- [Getting started](/help/getting-started)
$md$,
  'getting-started',
  '/help',
  array['/store-ops', '/inventory', '/fran'],
  array['pos', 'crm', 'loyalty', 'points', 'which system', 'ownership', 'architecture'],
  15
)
on conflict (slug) do update set
  title = excluded.title,
  summary = excluded.summary,
  body_md = excluded.body_md,
  category = excluded.category,
  primary_path = excluded.primary_path,
  related_paths = excluded.related_paths,
  intent_tags = excluded.intent_tags,
  sort_order = excluded.sort_order,
  published = true,
  updated_at = now();
