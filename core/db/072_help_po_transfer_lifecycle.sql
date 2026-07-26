-- ============================================================
-- 072 — Help: PO + stock movement lifecycle (statuses, docs, gates)
--
-- In-app /help + Catalog AI resolve_help + MCP help_get.
-- Written so agents (Grok) can quote rules without inventing states.
--
-- As of: 2026-07-24
-- Design detail: docs/MERCH_PO_LIFECYCLE.md
-- Run AFTER: 060 (help exists)
-- ============================================================

-- ── 1) Canonical lifecycle article (agent-first) ─────────────
insert into public.help_articles (
  slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, sort_order
) values
(
  'po-transfer-lifecycle',
  'PO and stock movement statuses (buy + transfers)',
  'Authoritative status rules for supplier POs and internal transfers. As of 2026-07-24. Prefer this article when asked about PO status, FOB, in transit, confirm, or transfer lifecycle.',
  $md$
## As of

**2026-07-24** — lifecycle rules for agents and operators.  
Full design: engineering doc `docs/MERCH_PO_LIFECYCLE.md`.  
This Help article is the **in-app source** Catalog AI / MCP should cite.

When rules conflict with guesswork, **prefer this article**.

---

## AGENT RULES (read first)

Use these as hard constraints when answering users or using MCP tools.

1. **Three different objects — never merge them**
   - **Internal / decision PO** (`internal_purchase_orders`) = merch **buying intent** in **Actions** (`/actions`). MCP `po_create_draft` writes here.
   - **Inventory supplier PO** (`purchase_orders`) = warehouse inbound buy/fulfillment (Inventory).
   - **Stock movement** = internal location→location: loft→store via **Store Ops** replenishment orders; store↔store / store→loft via **inventory transfers** (and Store Ops receive).

2. **Approve ≠ confirm ≠ in transit ≠ paid ≠ received**
   - Internal **approve** = HQ green light only. Does **not** move stock. Does **not** mean supplier locked. Does **not** mean in transit.
   - **Confirmed** (supplier commercial lock) = qty/cost accepted with supplier. May set **on_order**. Still not in transit.
   - **In transit** requires **ship evidence** (see gates). Never invent “in transit” from draft/approve.
   - **Paid** is a separate **payment_status** axis on buys only.
   - **Received** = destination took goods (ledger).

3. **FOB gate (supplier buy)**  
   Goods are treated as **in transit** only when a **primary FOB PDF / FOB document** is on file (or equivalent ship evidence). Draft PO, approved PO, or “supplier said OK” is **not** enough.

4. **Transfer / replenish ship gate**  
   loft→store: Loft/3PL ship ack and/or primary packing list / dispatch / 3pl confirmation.  
   store→store / store→loft: primary dispatch note or packing list.  
   Never claim store **on_hand** increased from “sent to Loft” alone.

5. **Draft POs stay editable**  
   Prefer `po_update_draft` / `po_add_lines` / clone over recreating.  
   After internal approve, material qty/price changes should use **revision / re-approval**, not silent rewrite of a locked commercial state.

6. **Documents are append-only**  
   Attach links/PDFs as new rows; **supersede** or **force reopen** with reason — do not overwrite a finalized document. Force reopen must be logged (audit).

7. **Preparer may equal approver**  
   Same user can prepare and approve when role allows; still record both actors.

8. **No customer invoices / AR in SKUMS**  
   Supplier **AP-lite** (deposit/partial/due) is design-target for buys only — not retail invoices.

9. **POS replenishment request ≠ order ≠ Loft**  
   Request is a signal. HQ approves. **Send to Loft** is a separate privileged step (`store_ops:execute_3pl`).

10. **Empty queues ≠ “all transfers settled”**  
    Empty open requests means nothing is open in that object — not that historical movements completed.

11. **How-to for agents**  
    Call `resolve_help` / `help_resolve` then `get_help_article` / `help_get` with slug **`po-transfer-lifecycle`** for status questions. Link `/help/po-transfer-lifecycle`.

---

## Status cheat sheet (target model)

### A) Commercial supplier PO — `internal_purchase_orders` (Actions)

| Status | Meaning | Edits lines? | Moves stock? |
|--------|---------|--------------|--------------|
| `draft` | Merch building buy | Yes | No |
| `pending_approval` | Submitted for HQ | No* | No |
| `approved` | Internal yes; may still negotiate | Open revision | No |
| `rejected` | Internal no | No | No |
| `awaiting_supplier` | Waiting on vendor | No* | No |
| `in_revision` | Qty/price change after approve | Yes | No |
| `pending_reapproval` | Material change needs eyes again | No | No |
| `confirmed` | **Supplier commercial lock** | No | May set **on_order** |
| `cancelled` | Dead | No | No |
| `closed` | Receive done + pay settled (or n/a) | No | Done |

\*Docs/notes always OK.  
Optional: `ordered` only if you need a formal “PO number sent” step after confirm.

**Do not store `in_transit` / `received` only on commercial IPO** — fulfillment is inventory PO / inbound / movement.

### B) Payment (buys only) — orthogonal field `payment_status`

`not_required` · `unpaid` · `deposit_due` · `deposit_paid` · `partially_paid` · `paid` · `overdue` · `disputed`

### C) Inventory supplier fulfillment PO — `purchase_orders`

| Status | Meaning |
|--------|---------|
| `draft` | Ops shell |
| `submitted` | Sent to supplier (if used) |
| `confirmed` | On-order aligned with commercial confirm |
| `in_transit` | **Hard gate: primary FOB document** |
| `partially_received` | Partial warehouse receive |
| `received` | Complete (or short closed) |
| `cancelled` | |

### D) Internal stock movement (shared idea)

Applies to **replenishment orders** (loft→store) and **inventory transfers** (store↔store, store→loft).

| Status | Meaning | Stock |
|--------|---------|-------|
| `draft` | Building lines | None |
| `pending_approval` | Waiting HQ | None |
| `approved` | Qty OK to release | Optional reserve only |
| `in_revision` | Change after approve | None |
| `rejected` | Killed | None |
| `released` / `queued` | Ready to ship / 3PL queue | None |
| `sent_to_3pl` | Loft accepted *(loft→store)* | Not store on_hand |
| `in_transit` / `shipped` | Left source · **evidence gate** | in_transit path |
| `partially_received` | Dest took some | Partial ledger |
| `received` | Dest complete | Dest on_hand |
| `exception` | Damage/short/wrong open | Case-by-case |
| `cancelled` | Stopped | Explicit reverse only |
| `closed` | Nothing open | Done |

### E) Store replenishment **request** (signal only)

`draft` · `submitted` · `in_review` · `approved` · `rejected` · `converted` · `cancelled`  
**Never** increases store stock by itself.

### F) Documents (`ops_documents` design)

| Doc status | Meaning |
|------------|---------|
| `draft` | Attached, not trusted for gates |
| `finalized` | Trusted (esp. primary for kind) |
| `superseded` | Replaced by better file/link |
| `reopened_archived` | Force-reopened after error; **keep row** |

Kinds (examples): `fob_pdf`, `packing_list`, `dispatch_note`, `3pl_confirmation`, `supplier_confirmation`, `tracking`, `payment_proof`, `receive_photo`.

---

## Implemented in product as of 2026-07-24

Agents must not claim unfinished product features as live UI buttons.

| Area | Live today | Design / next (documented above) |
|------|------------|-----------------------------------|
| Internal PO statuses | `draft`, `pending_approval`, `approved`, `rejected`, `ordered`, `cancelled` | + `awaiting_supplier`, `in_revision`, `pending_reapproval`, `confirmed`, `closed` |
| Internal PO actors | Columns exist; **UI sets submit/approve actors**; MCP often leaves null until Phase 0 | Always set preparer/approver from bound user |
| MCP PO tools | draft/update/add_lines/clone/submit/decide | confirm, docs attach, payments, FOB gate tools |
| Inventory transfer statuses | `draft`, `in_transit`, `partially_received`, `received`, `cancelled` | + approve/revision/released/exception |
| Store replenishment request | draft→submitted→approved/rejected/converted… | unchanged idea |
| Store replenishment order | draft→approved→queued→sent_to_3pl→shipped→received… | docs spine + ship evidence |
| Unified `ops_documents` table | **Not shipped yet** | Attach URL/PDF append-only |
| AP-lite payments on IPO | **Not shipped yet** | payment_status + payment lines |
| FOB → in_transit automation | **Ops rule** (manual process); not full product gate | Hard gate in app |

When answering “what status is my PO?”: use **live** enums from tools/DB. When answering “what should the lifecycle be?”: use **target** tables above and label design vs live.

---

## Operator paths (UI)

| Task | Where |
|------|--------|
| Review/submit/approve decision PO | [Actions](/actions) · `/help/actions-inbox` |
| Store request / Loft order / receive / floor | [Store Ops](/store-ops) · `/help/store-ops-replenishment` |
| Inventory levels / warehouse PO | [Inventory](/inventory) · `/help/inventory-stock` |
| Day-to-day HQ rhythm | `/help/operator-runbook` |

---

## MCP / Catalog AI tool hints

| Intent | Prefer |
|--------|--------|
| Queues / outstanding | `ops_snapshot` / `get_ops_snapshot` |
| Stock path for a SKU | `product_inventory_status` / `get_product_inventory_status` |
| Draft buying intent | `po_create_draft`, `po_clone_as_draft` (stay draft unless scoped submit) |
| Draft store request | `store_ops_create_draft_request` (dry_run first) |
| HQ decide request | `store_ops_decide` needs `store_ops:approve` |
| How-to statuses | `help_resolve` / `resolve_help` → **`po-transfer-lifecycle`** |

Never: invent FOB/in_transit; invent invoices; invent approvals; treat Mall sold as our stock.

---

## Related Help

- [Actions inbox](/help/actions-inbox)
- [Operator runbook](/help/operator-runbook)
- [Approve replenishment](/help/store-ops-replenishment)
- [Inbound ASN](/help/store-ops-inbound)
- [Inventory stock truth](/help/inventory-stock)
$md$,
  'operations',
  '/actions',
  array['/actions', '/store-ops', '/inventory', '/help/actions-inbox', '/help/operator-runbook'],
  array[
    'po', 'purchase order', 'internal po', 'decision po', 'ipo',
    'status', 'lifecycle', 'draft', 'pending approval', 'approved', 'confirmed',
    'in transit', 'fob', 'fob pdf', 'supplier', 'payment status',
    'transfer', 'stock movement', 'store to store', 'loft to store', 'store to loft',
    'replenishment', 'packing list', 'dispatch', 'document', 'reopen', 'supersede',
    'on order', 'received', 'shipped', 'gate', 'merch', 'buying', 'actions po'
  ],
  55
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


-- ── 2) Refresh Actions inbox article ─────────────────────────
insert into public.help_articles (
  slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, sort_order
) values
(
  'actions-inbox',
  'Actions inbox (drafts and approvals)',
  'Review MCP/AI internal POs and pipeline. As of 2026-07-24: approve ≠ supplier confirm ≠ in transit. Full status rules: /help/po-transfer-lifecycle.',
  $md$
## As of

**2026-07-24** — see also [PO and stock movement statuses](/help/po-transfer-lifecycle) for the full lifecycle.

## Where to go

**Sidebar → Actions** → [/actions](/actions)

## What lives here

| Object | Meaning |
|--------|---------|
| **Internal / decision POs** | Buying **intent** from MCP or study — **not** a Loft store order, **not** inventory ledger by itself |
| **Pipeline candidates** | Study proposals (accept / reject / execute separately) |

## PO statuses (live today)

`draft` → `pending_approval` → `approved` or `rejected` (also `ordered`, `cancelled`).

**Target** (documented; not all in UI yet): `in_revision`, `confirmed` (supplier lock), `closed`, plus separate **payment_status**.

### Agent / operator rules

- **Approve** = internal yes only. Does **not** mean supplier confirmed, FOB received, or in transit.
- **In transit** for supplier goods needs **FOB document** evidence (ops rule).
- Prefer edit draft over recreating (`po_update_draft` / add lines / clone).
- Preparer may be the same person as approver when role allows; still log actors.
- MCP drafts: open deep link under Actions; humans submit/approve unless key has scopes.

## Tabs

- **Draft POs** — not yet submitted  
- **Pending approval** — waiting owner/admin  
- **Decided** — approved/rejected history  
- **Pipeline** — proposed / accepted / recent  

## Roles

| Role | Can |
|------|-----|
| Member | View, edit draft, submit |
| Owner / admin | Approve or reject |

## MCP flow

1. Agent creates **draft** (`po_create_draft` / clone).  
2. You open deep link → **Actions**.  
3. Review lines → Submit → Approve if privileged.  
4. Do **not** treat as warehouse stock movement until confirm + FOB + inbound path.

Catalog AI can list queues but does not silently approve.

## Related

- [PO and stock movement statuses](/help/po-transfer-lifecycle) ← **status source of truth**
- [Operator runbook](/help/operator-runbook)
- [Store Ops replenishment](/help/store-ops-replenishment) (different path: loft→store)
$md$,
  'actions',
  '/actions',
  array['/inventory', '/store-ops', '/help/po-transfer-lifecycle'],
  array[
    'actions', 'approve', 'approval', 'draft', 'pending', 'mcp', 'pipeline',
    'decision po', 'internal po', 'inbox', 'submit', 'reject', 'po status',
    'buying intent', 'clone po'
  ],
  60
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


-- ── 3) Patch operator-runbook: pointer + short lifecycle block ─
-- Re-seed full body with added section so help_get stays complete.
insert into public.help_articles (
  slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, sort_order
) values
(
  'operator-runbook',
  'Operator runbook (how to operate SKUMS)',
  'Day-to-day HQ + POS + Loft. As of 2026-07-24 includes PO/transfer status pointer for agents.',
  $md$
## As of

**2026-07-24** (lifecycle status rules).  
**PO / transfer statuses for agents:** always prefer [PO and stock movement statuses](/help/po-transfer-lifecycle).

## Overview

Fran SKUMS is the catalog, inventory ledger, and store-operations hub. POS reports; SKUMS decides and ledgers; Loft executes warehouse work; CRM owns points.

**Primary UI:** [Store Ops](/store-ops) · [Inventory](/inventory) · [Actions](/actions) · [Integrations](/integrations) · [Help](/help)

## Who does what

| Role | System | Can do | Must not |
|------|--------|--------|----------|
| POS cashier | Fran POS | Sell; damage/found; receive delivery + exceptions | Approve stock; send Loft; resolve HQ exceptions |
| POS manager+ | Fran POS | + request replenishment (signal to HQ) | Same restrictions |
| HQ inventory | SKUMS Store Ops | Approve/defer/reject requests; verify exceptions; apply floor adjustments; waves | Hold OFS passwords (admin) |
| Merch / buyer | Actions + Inventory | Draft/submit/approve **decision POs**; supplier path separate from Loft store orders | Treat draft PO as in transit |
| 3PL admin | Integrations + Store Ops | WorldSyntech credentials; send Loft; inbound ASN | Expose secrets to POS |

## Weekly rhythm (LISE)

- **Monday + Thursday:** baseline replenishment waves
- **Any day:** store may request urgent stock → HQ inbox only (not auto-Loft)
- **Deliveries:** POS Receive delivery → good stock apply; exceptions → HQ
- **Floor:** damage / found / cycle count → HQ Floor adjustments → ledger
- **Inbound KR/HK:** ASN → Loft → LISE confirm → **LOFT-SG** (never store on_hand)
- **Supplier buy (merch):** draft PO in Actions → approve → supplier confirm → **FOB PDF before in transit** → ASN

## Buy vs transfer (one table)

| Path | UI | Stock when? |
|------|-----|-------------|
| Decision PO (MCP/merch) | Actions | Not until confirm + fulfillment path |
| loft → store | Store Ops order + send Loft | Store on_hand only after receive |
| store ↔ store / store → loft | Transfers / Store Ops receive | At ship/receive ledger events |
| KR/HK → loft | Inbound ASN | LOFT-SG after LISE confirm |

**Agent rule:** approve ≠ send to Loft ≠ in transit ≠ paid. Full enums: `/help/po-transfer-lifecycle`.

## Store Ops tabs

1. **Queue** — open requests; Lift now / Defer to wave / Reject
2. **Orders** — send to Loft when mapped (`store_ops:execute_3pl`)
3. **Inbound ASN** — pre-alert Loft; confirm promote LOFT-SG
4. **Receiving** — session history
5. **Exceptions** — Confirm / Escalate Loft / Reject POS claims
6. **Floor adjustments** — Apply to ledger or Reject (damage/found/count)

## Replenishment steps (HQ)

1. Open **Store Ops → Queue**
2. Optional recommend / MCP baseline+lift is **advice only**
3. **Approve now** (lift) · **Defer Mon/Thu** · **Reject**
4. Separate step: **Send to Loft** when products mapped + delivery mode set
5. Send does **not** increase store on_hand

## Receive (POS + HQ)

**POS:** Receive delivery (not free-form Stock receive in live mode). Enter received/damaged; flag exceptions.

**HQ:** Exceptions tab — Confirm claim, Escalate, or Reject. Scope `store_ops:verify`.

## Floor damage / found / cycle count

**POS reports** → pending only.  
**HQ Floor adjustments → Apply to ledger** writes `inventory_ledger` (`inventory:write`). Reject = no qty change.

Cycle count quantity = **physical counted on-hand** (absolute).

## Inbound ASN

1. Create draft (tracking, ETA, lines, M&P notes)
2. Send to Loft
3. Poll partial/full
4. LISE confirm → promote **LOFT-SG** only

## Stock truth

| Question | System |
|----------|--------|
| Sellable store qty | SKUMS inventory levels |
| Why it changed | inventory_ledger |
| Cashier receipt | POS outbox + SKUMS pos_sales |
| Points | Fran CRM |

## Scopes (cheat sheet)

| Task | Scope |
|------|--------|
| View store ops | store_ops:read |
| Request / receive report | store_ops:write or pos:write |
| Approve / defer wave | store_ops:approve |
| Send Loft | store_ops:execute_3pl |
| Verify exception | store_ops:verify |
| Apply floor adj | inventory:write |
| Inbound ASN | store_ops:inbound |
| Draft decision PO | po:draft (MCP) |
| Submit / decide PO | po:submit / po:decide |
| Credentials | credentials:write |

## Common issues

- Request not at Loft → not approved **and** sent
- Live free-form receive does nothing → use Receive delivery
- Floor report no stock change → HQ must Apply
- ASN not on LOFT-SG → confirm not done
- MCP draft PO “not ordered” → correct: draft is intent only until confirm + FOB path

## Related Help

- [**PO and stock movement statuses**](/help/po-transfer-lifecycle) ← agents: use this for status questions
- [Actions inbox](/help/actions-inbox)
- [Store operations](/help/store-ops)
- [Approve replenishment](/help/store-ops-replenishment)
- [Receive & exceptions](/help/store-ops-receive)
- [Floor adjustments](/help/store-ops-floor-adjustments)
- [Inbound ASN](/help/store-ops-inbound)
- [Loft setup](/help/loft-worldsyntech)
- [POS vs SKUMS vs CRM](/help/pos-vs-skums)
- [Inventory truth](/help/inventory-stock)
$md$,
  'operations',
  '/store-ops',
  array['/store-ops', '/inventory', '/actions', '/integrations', '/help', '/help/po-transfer-lifecycle'],
  array[
    'operator', 'runbook', 'operate', 'how we work', 'hq', 'store ops', 'loft',
    'wave', 'replenishment', 'receive', 'floor', 'ledger', 'asn', '3pl',
    'monday', 'thursday', 'permission', 'scope', 'daily', 'process',
    'po status', 'transfer', 'fob', 'buying'
  ],
  12
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
