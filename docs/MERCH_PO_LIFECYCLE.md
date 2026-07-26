# Design: Buy & transfer movement lifecycle

**Product:** Fran SKUMS — supplier buys (Track **J** / Actions IPO) **and** internal stock transfers (store ↔ store, loft ↔ store, store ↔ loft)  
**Status:** Design for implementation (phased; not yet migrated)  
**Date:** 2026-07-24 (rev 3 — finalize / force-reopen logging)  
**In-app Help (agents):** `/help/po-transfer-lifecycle` — migration `072_help_po_transfer_lifecycle.sql` (as of 2026-07-24). Catalog AI / MCP should `get_help_article` / `help_get` that slug for status rules.  
**Related:** `TODO.md` § Supplier order lifecycle · Store Ops / Loft · `docs/MCP_ACTION_BACKLOG.md` · `docs/INVENTORY_AND_PURCHASE_LOGGING.md` · `docs/POS_SKUMS_3PL_STORE_OPS_HANDOFF.md` · `core/db/049_internal_purchase_orders.sql` · `core/db/016_inventory.sql` · `core/db/044_store_operations.sql`

**Filename note:** Kept as `MERCH_PO_LIFECYCLE.md` for stable links; scope is **all material stock movements** that need draft → approve → ship evidence → receive → close, with append-only documents and actors.

---

## 0. Shared principles (apply everywhere)

These principles are **domain-agnostic**. They apply to:

| Domain | Primary objects today |
|--------|------------------------|
| **Supplier buy** | `internal_purchase_orders` → inventory `purchase_orders` / inbound ASN |
| **Warehouse → store** | `store_replenishment_requests` → `store_replenishment_orders` (Loft leg) |
| **Internal transfer** | `inventory_transfers` (store↔store, loft↔store, store↔loft, loft↔loft if ever) |
| **Inbound to loft** | `inbound_shipments` (forwarder → LOFT-SG; often fed by supplier FOB) |

### 0.1 Lifecycle skeleton

```text
intent/draft  →  submit  →  approve  →  (revision if needed)
    →  release / ship evidence  →  in_transit
    →  partial/full receive  →  close
    +  documents append at every stage
    +  actors on every decision
    +  money only when commercial (supplier AP-lite)
```

Approve ≠ ship ≠ receive ≠ paid. Each step has its own gate.

### 0.2 Non-negotiable rules

| # | Principle | Buy (supplier) | Transfer (internal) |
|---|-----------|----------------|---------------------|
| 1 | **Actors always** | preparer / submitter / approver / confirmer | preparer / approver / shipper / receiver |
| 2 | **Preparer may = approver** | Yes (policy / threshold) | Yes (HQ can self-approve under rules) |
| 3 | **Edit without recreate** | Same PO number; revision status | Same transfer/order number; re-open draft or revision |
| 4 | **Documents append-only** | PI, FOB, portal links, payment proofs | Dispatch note, packing list, Loft/portal PDF, receive photos, carrier tracking |
| 5 | **External URL and/or upload** | Merchant portal links OK | Loft portal / WhatsApp Drive / email PDF links OK |
| 6 | **Supersede, don’t overwrite** | New FOB replaces primary; history kept | New packing list replaces primary; history kept |
| 7 | **Ship / transit has a hard evidence gate** | Default: primary `fob_pdf` | Default: primary `dispatch_note` or `packing_list` (policy per leg type) |
| 8 | **Stock moves only at defined events** | on_order at commercial confirm; ATS at receive | `in_transit` debit/credit rules; receive applies destination on-hand |
| 9 | **MCP + UI same state machine** | `po_*` tools | `transfer_*` / existing `store_ops_*` |
| 10 | **Audit every mutation** | `audit_events` | same |
| 11 | **Channel provenance** | ui \| mcp \| api \| pos \| system | same (+ `integration` for Loft) |
| 12 | **Money optional** | AP-lite required for buys | Usually N/A; optional courier cost only if needed later |

### 0.3 Document spine (one table, many entity types)

Do **not** build separate ad-hoc URL columns per workflow.

**Table name (preferred):** `ops_documents`  
(If already sketched as `purchase_order_documents`, rename/alias — same shape.)

```text
ops_documents
  id, workspace_id
  entity_type     -- see below
  entity_id
  document_kind
  title, description
  lifecycle_stage          -- status when attached
  external_url, external_url_label
  storage_bucket, storage_path, source_filename, mime_type, file_size_bytes, content_sha256
  source_channel, source_ref
  actor_user_id
  supersedes_document_id
  is_primary_for_kind
  payment_id               -- only when linked to AP payment (buy path)
  line_id                  -- optional: doc about one line (damage photo)
  metadata jsonb
  archived_at, archived_by
  created_at, updated_at
  CHECK (external_url IS NOT NULL OR (storage_bucket IS NOT NULL AND storage_path IS NOT NULL))
```

**`entity_type` values:**

| entity_type | Use |
|-------------|-----|
| `internal_purchase_order` | Merch / supplier commercial |
| `purchase_order` | Inventory supplier PO |
| `inbound_shipment` | Forwarder → Loft ASN |
| `inventory_transfer` | Generic location→location |
| `store_replenishment_request` | Store ask (pre-order) |
| `store_replenishment_order` | Approved outbound (often Loft) |
| `receiving_session` | Floor receive batch |

Same MCP pattern: `ops_attach_document` / list / archive / set_primary with `entity_type` + `entity_id` (or thin wrappers `po_attach_document`, `transfer_attach_document`).

### 0.3a Finalize & force-reopen (documents + parent status)

**Problem:** A doc (or gate that depends on it) is marked final — e.g. primary FOB, primary packing list, supplier confirmation — then ops discovers an error (wrong qty, wrong PDF, wrong portal link) and must **reopen**. Silent URL edits from UI or MCP destroy provenance. Both channels must leave the same logs.

#### Rule: never mutate a finalized document in place

| Do | Don't |
|----|--------|
| Explicit **finalize** and **reopen** actions | PATCH `external_url` on a finalized row |
| Append a **new** doc row after reopen | Overwrite bytes / URL on the old row |
| Require **reason** (+ optional reason_code) on reopen | Reopen without explanation |
| One **shared service** used by web GUI and MCP | Separate UI-only and MCP-only code paths with different audit |

#### Document status (on `ops_documents`)

```text
status: draft | finalized | superseded | reopened_archived
```

| Status | Meaning |
|--------|---------|
| `draft` | Attached, not yet trusted for gates |
| `finalized` | Trusted for gates when also `is_primary_for_kind` (or policy allows any finalized) |
| `superseded` | Replaced by a newer doc of same kind (normal replace) |
| `reopened_archived` | Was finalized; force-reopen invalidated it; row **kept** for history |

Also store on finalize/reopen:

```text
finalized_at, finalized_by
reopened_at, reopened_by, reopen_reason, reopen_reason_code
reopen_of_document_id   -- on the NEW draft that continues the chain (optional)
```

Normal “replace FOB with better PDF” = **supersede** (new finalized row, old → `superseded`).  
Error-driven unlock = **force reopen** (old → `reopened_archived`, clear primary, parent may leave locked status).

#### Shared service (UI and MCP call the same function)

```text
core/ops/documents.mjs  (or server/utils/opsDocuments.ts)

  attachDocument(...)           → status=draft, audit ops.document.added
  finalizeDocument(id, actor)   → status=finalized, set primary if requested
                                  audit ops.document.finalized
  supersedeDocument(old, new…)  → old superseded, new draft/finalized
                                  audit ops.document.superseded
  forceReopenDocument({
    document_id,
    actor_user_id,
    channel,            // 'ui' | 'mcp' | 'api'
    reason,             // required free text
    reason_code,        // enum: wrong_file | wrong_qty | wrong_supplier | gate_error | other
    also_reopen_parent, // bool — e.g. confirmed → in_revision, in_transit → approved
    parent_reopen_to,   // optional target status
  })
```

**`forceReopenDocument` steps (atomic as practical):**

1. Load doc; reject if not `finalized` (or not primary when policy requires).  
2. Require non-empty `reason` (min length).  
3. Update doc: `status = reopened_archived`, clear `is_primary_for_kind`, set reopen_* fields.  
4. If `also_reopen_parent`: transition parent status via the **same** status machine as normal revision (e.g. `confirmed` → `in_revision`, clear ship gate flags if needed). **Do not reverse ledger** automatically — stock reversals are explicit separate ops.  
5. **Always** `recordAudit` on **both**:  
   - `entity_type = ops_documents`, `entity_id = document_id`  
   - `entity_type = parent` (IPO / transfer / order), `entity_id = parent id`  
6. Return envelope with `next_allowed_actions` (attach replacement, re-finalize, etc.).

#### Audit payload (minimum)

```text
event_type:  ops.document.force_reopened   (doc row)
             po.reopened | transfer.reopened | store_ops.order.reopened  (parent)

operation:   UPDATE
channel:     ui | mcp | api
actor_user_id: required for human-bound paths; system only for integration

before_data: { document snapshot, parent.status }
after_data:  { document snapshot, parent.status }
diff:        { status, is_primary_for_kind, parent_status }

metadata: {
  reason, reason_code,
  document_kind, document_id,
  was_primary, was_gate: 'fob_pdf' | 'dispatch_note' | …,
  tool_name, request_id, client_name,   // MCP
  force: true
}
```

UI timeline and MCP `po_get` / transfer get should both surface these events (Actions already loads `audit_events` for IPOs).

#### Parent status reopen vs document-only reopen

| Case | Document action | Parent status |
|------|-----------------|---------------|
| Wrong PDF but status still draft/approved | force reopen doc only | unchanged |
| Finalized FOB but goods not really shipped | force reopen FOB | may drop “FOB on file” / block in_transit; if already in_transit → **explicit** `force_reopen_movement` (separate, higher privilege) |
| Confirmed PO qty wrong | force reopen confirmation doc **and** parent → `in_revision` | re-approve/re-confirm later |
| Already received / ledger applied | reopen docs for evidence only | **no** silent status rewind; correction via exception / adjustment |

Movement-level force reopen (in_transit → earlier) is **privileged** (`po:decide` / `store_ops:approve` or a dedicated scope), always reason-required, always audited, and **never** invents reverse stock without a ledger correction path.

#### Web GUI

- Finalized docs: **read-only** fields; buttons: “Supersede with new file/link”, “Force reopen…”.  
- Force reopen modal: reason_code select + reason text (required) → calls same API as MCP.  
- Show banner: “FOB reopened by X at T — reason”.  
- Do not offer inline edit of URL on finalized rows.

#### MCP

```text
ops_finalize_document { document_id }
ops_force_reopen_document {
  document_id,
  reason,              # required
  reason_code?,
  also_reopen_parent?,
  parent_reopen_to?
}
ops_supersede_document { old_document_id, …new attach fields }
```

Agent instructions: prefer supersede for “better file”; use force_reopen only when gates/errors require unlock; always pass reason; never invent a silent URL patch.

#### Why not only `audit_events` without doc status?

Audit alone is necessary but not sufficient: gates need a **queryable** “is this FOB still valid?” flag. Status `finalized` vs `reopened_archived` + primary flag is that. Audit explains **who/when/why**.

#### Why not edit-in-place + audit?

You lose a stable snapshot of “what was trusted when we went in_transit.” Reopen/supersede keeps the old row immutable for disputes.

### 0.4 Shared document kinds (union vocabulary)

| Kind | Buy | Transfer / replenish |
|------|-----|----------------------|
| `analysis_note` | ✓ | ✓ (ATS snapshot, low-stock pack) |
| `quote` / `pi` / `proforma_invoice` | ✓ | — |
| `supplier_confirmation` | ✓ | — |
| `fob_pdf` | ✓ hard gate in_transit | — |
| `purchase_order_pdf` | ✓ | — |
| `payment_proof` / `payment_request` | ✓ | rare |
| `dispatch_note` | optional | ✓ hard/soft gate ship |
| `packing_list` | ✓ | ✓ |
| `transfer_slip` | — | ✓ internal paperwork |
| `loft_order_pdf` / `3pl_confirmation` | — | ✓ Loft / OFS portal link or PDF |
| `shipped_notice` | ✓ merchant portal | ✓ carrier / Loft “shipped” |
| `tracking` | ✓ | ✓ |
| `bill_of_lading` / `air_waybill` | ✓ | rare for store runs |
| `receive_photo` / `discrepancy_photo` | ✓ | ✓ |
| `damage_report` | ✓ | ✓ |
| `pod` (proof of delivery) | rare | ✓ |
| `customs` / `permit` | ✓ | rare |
| `other` | ✓ | ✓ |

### 0.5 Shared actor pattern

| Role | Meaning |
|------|---------|
| **Preparer** | Created draft / request (`created_by` / `requested_by`) |
| **Submitter** | Sent for approval if different |
| **Approver** | Internal yes/no (`approved_by`) — may equal preparer |
| **Releaser / shipper** | Marked shipped / sent to 3PL / in transit |
| **Receiver** | Confirmed goods at destination |
| **Doc attacher** | On each `ops_documents` row |

Always log even when the same person holds multiple roles.

### 0.6 What differs by domain

| Concern | Supplier buy | Internal transfer |
|---------|--------------|-------------------|
| Counterparty | External supplier | Another Fran location / Loft |
| Payment | AP-lite first-class | Usually none |
| Hard transit gate | FOB PDF | Dispatch/packing/3pl confirm (by leg type) |
| 3PL | Inbound ASN after FOB | Outbound order (Loft) for loft→store |
| Qty negotiation | Common | Less common; short-ship / partial receive common |
| Source of draft | Merch + MCP study/ATS | Store request, HQ push, MCP low-stock pack |

---

## 1. Problem & goals

### Problem

**Buys:** Merch builds intent via MCP/UI; IPO is draft/approve only; weak actors; no negotiation/confirm/pay/docs spine. FOB must gate in-transit (Track J).

**Transfers:** Operators need the **same discipline** for:

- loft → store (primary replenishment via Loft)  
- store → store (balance stock between ION / other)  
- store → loft (return, overstock, recall, near-expiry pullback)  
- loft → loft / other location pairs later  

Today:

| Object | Strengths | Gaps vs principles |
|--------|-----------|---------------------|
| `inventory_transfers` | from/to locations; draft→in_transit→receive; line requested/shipped/received | Thin statuses; no submit/approve; only `created_by`; **no documents**; ship not evidence-gated |
| `store_replenishment_requests` | draft/submit/approve; requested_by/approved_by; line approved_qty | Docs missing; not a stock movement until converted |
| `store_replenishment_orders` | full outbound status incl. sent_to_3pl / partial ship/receive | Docs missing; actors thin; Loft portal evidence not first-class |
| `inbound_shipments` | ASN path to Loft | Docs partial; link from supplier FOB not unified |
| MCP `store_ops_*` | draft request + decide | No transfer doc attach; no generic transfer lifecycle tools |

Agents already confuse “no classic transfer object” with store replenishment — we need **one principles layer** and clear mapping of leg types.

### Goals

1. One **ops document + actor + audit** model for buys **and** transfers.  
2. Explicit **transfer leg types** and status machines that match real ops.  
3. Draft → approve → ship evidence → in transit → receive → close for transfers.  
4. Preparer may equal approver; always recorded.  
5. Append documents (portal links, PDFs, receive photos) throughout.  
6. Stock ledger only at defined events (see `INVENTORY_AND_PURCHASE_LOGGING.md`).  
7. Loft loft→store remains connector-based; **evidence + status still live in SKUMS**.  
8. MCP/UI share rules; never invent in-transit without evidence policy.

### Non-goals

| Non-goal | Why |
|----------|-----|
| Full GL / customer AR | Unchanged |
| POS talking to Loft directly | SKUMS owns 3PL |
| Auto-send to Loft from draft request | Approve + execute_3pl remain separate |
| Merging buy PO into transfer tables | Different commercial vs internal domains; **shared docs/actors only** |
| Email inbox as SoT | Attach/link v1 |

---

## 2. Transfer domain model

### 2.1 Leg types (`transfer_leg` or `movement_kind`)

| Code | From → to | Primary object | 3PL? |
|------|-----------|----------------|------|
| `loft_to_store` | LOFT-SG → store | Usually `store_replenishment_order` | Yes (Loft OFS) |
| `store_to_store` | store → store | `inventory_transfers` | Rarely (courier) |
| `store_to_loft` | store → LOFT-SG | `inventory_transfers` (+ optional inbound at loft) | Optional |
| `loft_to_loft` | future | `inventory_transfers` | Maybe |
| `other_location` | any inventory_locations pair | `inventory_transfers` | Case-by-case |

**Recommendation:** Keep **two operational objects** but unify UX language as “Transfers”:

1. **Request** (optional) — store asks: `store_replenishment_requests` (also usable metadata for store→store ask).  
2. **Movement** — the thing that ships:  
   - loft→store → `store_replenishment_orders` (3PL-backed)  
   - other legs → `inventory_transfers`  

Link: `store_replenishment_orders.metadata.inventory_transfer_id` or explicit FK later if dual-written. Prefer **one stock-moving header per physical shipment**.

### 2.2 Canonical transfer flow

```text
1. DRAFT              preparer (store manager / HQ / MCP); lines mutable
2. PENDING_APPROVAL   submitted (if policy requires)
3. APPROVED           approver (may = preparer); qty lock → approved_qty / allocated
4. IN_REVISION        qty change after approve (short pick, HQ edit) → may re-approve
5. RELEASED / QUEUED  ready to ship or send_to_3pl (not yet in transit)
6. IN_TRANSIT         ★ after ship evidence gate (+ optional Loft ack)
7. PARTIALLY_RECEIVED destination scanned some lines
8. RECEIVED           all expected (or short closed)
9. EXCEPTION          damage / short / wrong SKU → docs + exception queue
10. CANCELLED / CLOSED
```

Map onto existing enums without a big-bang rename:

| Target step | `inventory_transfers.status` (evolve) | `store_replenishment_orders.status` (exists) |
|-------------|----------------------------------------|-----------------------------------------------|
| draft | `draft` | `draft` |
| pending approve | add `pending_approval` | (request object holds this) |
| approved | add `approved` | `approved` |
| released | add `released` or use metadata | `queued` / `sent_to_3pl` / `acknowledged` |
| in transit | `in_transit` | `shipped` / `partially_shipped` |
| partial receive | `partially_received` | `partially_received` |
| received | `received` | `received` |
| exception | add or use `exception` | `exception` |
| cancelled | `cancelled` | `cancelled` |

**Today’s gap:** `inventory_transfers` jumps `draft` → `in_transit` with no approve step — **add** pending/approved (and actors) in Phase T1.

### 2.3 Actors on transfers

| Column | When |
|--------|------|
| `created_by` / `requested_by` | Draft / request |
| `submitted_by` / `submitted_at` | Submit for approve |
| `approved_by` / `approved_at` | Approve / reject |
| `shipped_by` / `shipped_at` | In transit / sent |
| `received_by` / last receive session | Destination confirm |
| `cancelled_by` | Cancel |

`store_replenishment_requests` already has `requested_by`, `approved_by`.  
`store_replenishment_orders` has `approved_by` only — add ship/receive actors over time.  
`inventory_transfers` has only `created_by` — extend.

### 2.4 Line quantities

Align language across objects:

| Stage | Field |
|-------|--------|
| Asked | `requested_qty` |
| Approved / allocated | `approved_qty` / `allocated_qty` |
| Shipped | `shipped_qty` |
| Received good | `received_qty` |
| Damaged / short | `damaged_qty` / `short_qty` |

Store replenishment order lines **already** have most of this. Transfer lines have requested/shipped/received — add damaged/short if missing when exceptions land.

### 2.5 Document patterns by leg

```text
DRAFT / REQUEST     analysis_note, low_stock pack link, photos of empty shelf
APPROVED            transfer_slip PDF export
RELEASE / 3PL       loft_order_pdf or 3pl_confirmation (portal URL OK)
SHIP                packing_list, dispatch_note, tracking, shipped_notice
                    ★ gate: primary packing_list OR dispatch_note OR 3pl shipped (policy)
IN_TRANSIT          more tracking updates (append)
RECEIVE             receive_photo, discrepancy_photo, pod
EXCEPTION           damage_report + photos
```

**Loft portal link example:**  
`https://…/order/12345` → `ops_documents` row  
`entity_type = store_replenishment_order`, `document_kind = loft_order_pdf` or `3pl_confirmation`, `external_url = …`, `is_primary_for_kind` as needed.

**Store→store courier:** tracking URL as `tracking`; optional `pod` photo on receive.

### 2.6 Transit gates by leg type (policy matrix)

| Leg | Default hard gate for in_transit / shipped | Soft (recommended) |
|-----|--------------------------------------------|--------------------|
| `loft_to_store` | Loft/OFS status **or** primary `3pl_confirmation` / `dispatch_note` | packing_list |
| `store_to_store` | primary `dispatch_note` or `packing_list` | tracking |
| `store_to_loft` | primary `dispatch_note` + optional inbound ASN draft | receive at loft later |
| Supplier buy | primary `fob_pdf` | — |

Workspace settings can relax loft_to_store to “OFS shipped webhook alone” once Loft IDs stable — still **write a system document row** (source_channel=`integration`) so the timeline is complete.

### 2.7 Stock ledger events (internal)

| Event | Ledger effect (principle) |
|-------|---------------------------|
| Approve transfer | Optional reserve / allocated (if you use reservations) |
| Ship / in_transit | Source: on_hand ↓ or in_transit ↑ (pair); dest: in_transit inbound ↑ |
| Receive | Dest on_hand ↑; clear in_transit |
| Short close | Adjust; exception |
| Cancel before ship | Release reserve only |

Exact movement_types already sketched in inventory docs (`transfer_received`, etc.). Design rule: **no ledger on draft/approve alone** unless explicit reserve feature is on.

### 2.8 Relationship to store replenishment waves

- **Waves** = planning cadence (Mon/Thu), not a shipment.  
- Request can be deferred to a wave; order ships later.  
- Documents attach to **request** (intent) and **order/transfer** (movement), not to the wave calendar row.

### 2.9 MCP surface (transfers)

| Tool | Scope | Notes |
|------|-------|-------|
| Existing `store_ops_create_draft_request` | store_ops:write | Keep; set actors |
| Existing `store_ops_decide` | store_ops:approve | Keep; audit |
| `transfer_create_draft` | store_ops:write | inventory_transfers for store↔store / store→loft |
| `transfer_submit` / `transfer_decide` | approve | Mirror PO |
| `transfer_mark_shipped` | store_ops:write or execute | Evidence gate |
| `transfer_attach_document` | docs | Or unified `ops_attach_document` |
| `store_ops_send_to_loft` | execute_3pl | After approve; attach 3pl confirmation when returned |
| Receive | existing receive sessions / POS events | Attach receive photos |

Agent rules:

- Prefer edit draft transfer/request over recreate.  
- Never claim in transit without gate satisfied.  
- loft→store: send_to_loft ≠ store received.  
- store→store: not a Loft order.

---

## 3. Supplier buy domain (summary)

Full detail remains the merch commercial path:

```text
analysis → draft → pending_approval → approved → awaiting_supplier / in_revision
  → confirmed → (ordered) → FOB docs → in_transit → receive → pay → closed
```

| Gate | Requirement |
|------|-------------|
| Confirm | Soft: supplier_confirmation / PI doc |
| In transit | **Hard: primary `fob_pdf`** |
| Pay | AP-lite payments + optional payment_proof docs |
| Stock on_order | At commercial confirm → linked inventory PO |

See §4–§6 below for status/payment/schema detail (unchanged intent from rev 1).

**Dual object:** internal IPO = commercial SoT; inventory PO / inbound = stock SoT; link at confirm.

---

## 4. Status model — supplier commercial

### 4.1 `internal_purchase_orders.status`

| Status | Meaning | Lines editable? |
|--------|---------|-----------------|
| `draft` | Working buy list | Yes |
| `pending_approval` | Awaiting internal approve | No (or notes only) |
| `approved` | Internal yes | No by default; open revision to edit |
| `rejected` | Internal no | No |
| `awaiting_supplier` | Sent / waiting on vendor | No (or notes) |
| `in_revision` | Supplier/ops changed terms | Yes (scoped) |
| `pending_reapproval` | Material change needs eyes | No |
| `confirmed` | Supplier commercial lock | No |
| `ordered` | Optional formal order stage | No |
| `cancelled` | Dead | No |
| `closed` | Receive + pay done | No |

### 4.2 Payment status (buy only)

`not_required` | `unpaid` | `deposit_due` | `deposit_paid` | `partially_paid` | `paid` | `overdue` | `disputed`

Rollups: `amount_confirmed`, `amount_paid`, `amount_due`, `next_payment_due_date`, `payment_terms`.

### 4.3 Material change → re-approval

Default: after approved/confirmed, qty or unit_cost change **> 5%** → `pending_reapproval`. Document-only adds never re-open approval.

---

## 5. Documents (detail)

### 5.1 Principles (repeat for implementers)

1. Rows, not a single URL column.  
2. Append by default; supersede for replacements.  
3. External URL and/or storage.  
4. Kind + stage + actor + channel.  
5. Soft archive only.  
6. Gates query non-archived (+ primary) by kind.  
7. **Same table for PO, transfer, replenishment order, inbound, receiving session.**

### 5.2 Supersede flow

1. Insert new row (same kind).  
2. `supersedes_document_id` → old.  
3. Move `is_primary_for_kind`.  
4. Audit `*.document.added` + `*.document.superseded`.  
5. Never hard-delete.

### 5.3 Storage

- Bucket: `ops-documents` (or `po-documents` generalized).  
- Path: `{workspace_id}/{entity_type}/{entity_id}/{doc_id}/{filename}`.  
- MCP: pass URL; do not server-side fetch arbitrary URLs (SSRF).

### 5.4 API / MCP

| Tool | Behavior |
|------|----------|
| `ops_attach_document` | entity_type, entity_id, kind, external_url and/or storage fields |
| `ops_list_documents` | filter by entity, kind, include_archived |
| `ops_archive_document` | soft archive |
| `ops_set_primary_document` | primary for kind (FOB, packing list, …) |

Thin aliases: `po_attach_document`, `transfer_attach_document`.

---

## 6. Payments (buy only)

`purchase_order_payments` (or `ops_payments` with entity_type restricted to buy entities):

- types: deposit | progress | balance | adjustment | refund  
- status: scheduled | due | paid | cancelled | failed  
- amount, currency, fx, due_at, paid_at, method, reference  
- optional link to `ops_documents` payment_proof  

Transfers: **no payment table required** in v1.

---

## 7. Actors, audit, MCP attribution

| Path | Actor source |
|------|----------------|
| UI | Supabase user id |
| Cloud MCP | API key `bound_user_id` |
| Local MCP | `FRAN_MCP_ACTOR_USER_ID` |
| Loft webhook | `actor_kind=system`, source_id=connection |

**Phase 0 (all domains):** mutations that today omit actors must set them (PO create/submit/decide first; then store_ops + transfers).

Audit event families:

- `po.*` — commercial buy  
- `transfer.*` — inventory_transfers  
- `store_ops.request.*` / `store_ops.order.*`  
- `ops.document.*` — shared  
- `po.fob_received`, `transfer.ship_evidence_recorded` — gate signals  

---

## 8. Handoff matrix

| Domain event | Stock | Documents |
|--------------|-------|-----------|
| Buy: approve internal | none | optional |
| Buy: confirm supplier | on_order via inventory PO | PI / confirmation |
| Buy: FOB primary | enable in_transit | **required** |
| Buy: receive | ledger po_received | optional discrepancy |
| Transfer: approve | optional reserve | optional |
| Transfer: ship evidence | enable in_transit | **required by policy** |
| loft→store: send_to_loft | external + status sent_to_3pl | attach 3pl confirm when available |
| Transfer: receive | ledger transfer_received | receive photos optional |
| Store request only | none | analysis only |

---

## 9. UI

### Actions / Buys

Commercial IPO detail: status + payments + documents timelines.

### Store Ops / Transfers

Unified **Transfer detail** (whether backed by replenishment order or inventory_transfer):

1. Status + actors  
2. Documents (append; open external links)  
3. Lines with requested / shipped / received  
4. Exceptions  

Badges: leg type, channel, “ship evidence on file”, 3pl status.

---

## 10. Schema outline

### Shared

1. `ops_documents` + RLS + indexes.  
2. Optional storage bucket.  
3. Expand document_kind check as kinds grow.

### Buy (Phase B)

- IPO status expand; payment columns; payments table; line confirmed qty/cost; `linked_inventory_po_id`; actor columns filled.

### Transfer (Phase T)

- `inventory_transfers`: add `pending_approval`, `approved`, `exception`; `submitted_by`, `approved_by`, `shipped_by`; `transfer_leg` text; maybe `replenishment_order_id` FK.  
- `store_replenishment_orders`: `shipped_by`, document usage; optional `inventory_transfer_id`.  
- Align receive path to always allow `ops_documents` on `receiving_session`.

### Phase 0 (no migration)

MCP/API actor fill for PO + store_ops decide/create.

---

## 11. Phased delivery

| Phase | Scope | Exit |
|-------|--------|------|
| **0** | Actors + audit on existing PO + store_ops mutations | Preparer/approver visible when bound |
| **1** | `ops_documents` + attach/list for IPO **and** replenishment order + inventory_transfer | Can attach Loft/merchant/carrier links without overwrite |
| **2a** | Buy: confirm, revision, FOB hard gate | No in_transit without FOB |
| **2b** | Transfer: approve steps on inventory_transfers; ship evidence gate | No in_transit without dispatch/packing/3pl policy |
| **3** | Buy AP-lite payments | Partial pay + dues |
| **4** | Buy ↔ inventory PO link; transfer ↔ ledger discipline | ATS trustworthy |
| **5** | Upload UX, supplier master, FX | Polish |

PRs can split 2a/2b so merch and store-ops ship independently once docs exist.

---

## 12. Open decisions

1. Is store→store always `inventory_transfers`, never replenishment_order? **(Recommend yes.)**  
2. loft→store: single SoT = replenishment_order only, or dual-write transfer? **(Recommend order only + docs.)**  
3. Hard vs soft ship evidence for loft→store when OFS webhook fires.  
4. Self-approve thresholds for store requests vs HQ transfers.  
5. Can MCP mark store→store shipped, or human-only?  
6. Buy FOB hard gate remains? **(Yes.)**

---

## 13. PR plan

| PR | Scope |
|----|--------|
| **PR-A** | Phase 0 actors (PO + critical store_ops) |
| **PR-B** | `ops_documents` migration + generic attach API/MCP |
| **PR-C** | Wire docs UI on IPO + transfer/order detail |
| **PR-D** | Buy confirm/revision + FOB gate |
| **PR-E** | Transfer approve + ship gate on inventory_transfers |
| **PR-F** | Payments (buy) |
| **PR-G** | Confirm→inventory PO; receive/exception doc kinds |

---

## 14. Success metrics

- Same PO/transfer shows **≥3 document rows** over life (e.g. approve pack, ship evidence, receive photo) without overwrite.  
- MCP loft→store path never claims in transit without evidence or OFS+system doc.  
- store→store transfer has preparer + approver (can be same user) + shipper.  
- Supplier path still: zero in_transit without primary `fob_pdf`.  
- Agents use one document vocabulary; entity_type distinguishes buy vs transfer.

---

## 15. Summary

**Same principles for buys and internal transfers:** multi-step lifecycle, actors (preparer may equal approver), edit-in-place revisions, append-only documents (external links + uploads), evidence gates before in-transit, ledger only at defined stock events, shared audit/MCP rules.

**Different product content:** money and suppliers for buys; leg types and 3PL outbound for transfers. **One `ops_documents` spine** attaches to IPO, inventory transfer, replenishment order, inbound, and receiving session so Loft PDFs, merchant shipped links, packing lists, and receive photos all accumulate safely.

**Next implementation step:** Phase 0 actors, then **PR-B `ops_documents`** used by both merch POs and Store Ops transfers so document capture is not blocked on full status-machine work.
