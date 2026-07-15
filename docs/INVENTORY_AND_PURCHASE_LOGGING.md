# Inventory movement logging & purchase data ownership

**Date:** 2026-07-15  
**Status:** plan + Phase E foundation  
**Related:** `docs/SKUMS_OPERATOR_RUNBOOK.md` (how to operate) · `TODO-LOFT.md` Phase E · `docs/LOFT_OPS_DICTIONARY.md` · fran-pos / fran-crm contracts

---

## 1. Inventory movement logging (SKUMS)

### Principle

| Layer | Role |
|-------|------|
| **`inventory_ledger`** | **Quantity source of truth** — every applied stock change is one or more signed rows via `upsert_inventory_level` |
| **`inventory_levels`** | Materialized balances only; never write directly from app |
| **Workflow tables** | Pending work: adjustments, receiving sessions, exceptions, POS events |
| **`audit_events`** | Actor / channel / approve / reject provenance (who decided) |
| **`domain_events`** | Cross-app bus (POS → attention, agents) |

**Rule:** POS and store staff **report**; SKUMS **approves** (where required) then **ledger applies**. No second on-hand authority in POS.

### What must be logged (every applied movement)

| Field | Notes |
|-------|--------|
| workspace, product, location | Required |
| quantity_type + signed delta + quantity_after | From RPC |
| movement_type | Normalized enum (see below) |
| reference_type / reference_id / line_id | adjustment, receiving_session, pos_sale, inbound_shipment, … |
| notes | Human-readable cause |
| created_by | User when known |

Plus **audit** on apply/reject:

| Field | Notes |
|-------|--------|
| channel | `ui` \| `api` \| `pos` (as api-key) \| `system` |
| actor_user_id / source_id | User or API key |
| event_type | e.g. `inventory.adjustment.applied` |
| before/after | Adjustment status + line deltas |

### Movement type map (canonical)

| Business event | `movement_type` | When ledgered |
|----------------|-----------------|---------------|
| POS sale | `sale` | Sale ingest commit |
| POS return | `return` | Return ingest |
| Reserve / release | `reservation` / `unreservation` | Basket holds |
| Loft ASN promote to LOFT-SG | `po_received` | LISE confirm |
| Store receive good units | `transfer_received` | Phase C apply |
| Clear in_transit on receive | `transfer_received` (or paired debit) | Phase C |
| POS damage (approved) | `damage` | Phase E apply |
| POS found / stocktake variance | `adjustment` | Phase E apply |
| HQ exception adjust | `adjustment` | Exception verify adjust |
| PO receive (supplier) | `po_received` | Existing PO RPC |

### Intake vs apply

```text
POS damage/found/cycle count
  → pos_inventory_events (status pending_approval)
  → inventory_adjustments (status pending)
  → attention item
  → [HQ] apply / reject
       apply → upsert_inventory_level + ledger + audit
       reject → status only + audit (no qty change)
```

### Unified read (later)

View or list API: applied `inventory_ledger` ∪ pending `pos_inventory_events` / open `inventory_exceptions` for one ops timeline. Not required for E.1 MVP if adjust + exception queues are visible in Store Ops.

### Gaps still after E.1

- Loft send does not yet debit LOFT-SG / post in_transit (policy open)
- Full `recordAudit` on every historical path (sale, inbound) — add incrementally
- Explicit ID status maps from Loft Phase 0

---

## 2. Customer purchase logging — where the database sits

Three repos already encode ownership. **Do not merge into one DB.**

```text
Fran POS (register)          Fran SKUMS (ops)           Fran CRM (member)
─────────────────          ─────────────────          ─────────────────
basket / pay / receipt       product + price quote      identity + policy
local outbox (durable)       pos_sales (ops SoT)        points ledger SoT
company Supabase audit       inventory_ledger           crm_events / analytics
                             multi-store ATS            commerce projections
```

### Recommended sources of truth

| Concern | Database / system | Why |
|---------|-------------------|-----|
| **Register audit** (what cashier tendered, voids, device outbox) | **Fran POS** Supabase (`pos_outbox_events`, harden `pos_sales`) + local queue until acked | Offline-first; never block payment on SKUMS/CRM |
| **Multi-store product sale log + inventory commit** | **Fran SKUMS** `pos_sales` + `inventory_ledger` | Stock and ops trust this; one workspace spanning stores |
| **Member purchase facts, points earn/burn, LTV, tier analysis** | **Fran CRM** `crm_events` → loyalty ledger + commerce projections | Points economics, consent, identity merge live here |
| **Floor stock reports** | POS queue → **SKUMS** ledger after approve | No POS on_hand authority |

### Purchase event flow (target)

```text
completeSale (POS)
  1. Receipt + outbox always (POS DB)     ← register truth
  2. POST SKUMS /pos/sales (idempotent)  ← stock + ops sale log
  3. CRM events: pos.sale.completed +
     loyalty execution / earn commit     ← points + customer analytics
```

Cross-links (required for reconciliation):

- SKUMS sale metadata: CRM member_id, policy_version, reward_commit_id  
- CRM ledger / events: SKUMS sale id or receipt + store code + line SKUs  

### What not to do

| Anti-pattern | Why |
|--------------|-----|
| Points balance only in POS customers table | Diverges offline; CRM is ledger |
| CRM as inventory ledger | Wrong domain; no ATS / location model |
| SKUMS as loyalty points ledger | No member graph / policy versions |
| Rely on browser `localStorage` alone as multi-day sale truth | Prefer POS Supabase outbox first |
| Duplicate full sale lines into CRM as a second priced warehouse | Project events; join product identity when needed |

### Offline / multi-store tradeoffs

| Choice | Prefer |
|--------|--------|
| Payment when CRM/SKUMS down | Always complete locally; queue SKUMS sale + CRM earn |
| Points **redeem** | Online-first (or manager override policy) |
| Points **earn** offline | Queue with `sync_on_reconnect`; receipt shows “queued” |
| Store ATS display on POS | Cache from SKUMS catalog; not a second ledger |
| Multi-store | One SKUMS workspace + location codes; CRM program/workspace aligned to brand |

### Practical split for LISE

1. **SKUMS** — inventory movement log + ops purchase log (this Phase E work).  
2. **CRM** — points tabulation and customer purchase analysis (ingest POS outbox / sale events).  
3. **POS** — durable outbox + receipt; optional company `pos_sales` for local audit; never invent stock or points.

---

## 3. Phase E implementation map

| PR | Work |
|----|------|
| **E.0 logging** | Plan (this doc); fix receive movement types; audit on adjustment apply |
| **E.1** | Apply/reject pending POS damage & found → ledger |
| **E.2** | Cycle count event → pending stocktake adjustment → same apply |
| **E.3** | POS: free-form inbound is not ledger authority; Loft path = receive-delivery |

---

## Changelog

| Date | Note |
|------|------|
| 2026-07-15 | Initial plan; Phase E.1 apply path shipped alongside |
