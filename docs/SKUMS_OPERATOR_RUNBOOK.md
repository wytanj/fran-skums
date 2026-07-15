# Fran SKUMS — Operator runbook

**Audience:** HQ inventory ops, store managers (SKUMS UI), POS staff, admins  
**Last updated:** 2026-07-15  
**In-app Help:** [/help](/help) · article **operator-runbook** (+ store-ops-* guides)  
**Catalog AI / MCP:** tools `resolve_help` / `get_help_article` (in-app) and `help_resolve` / `help_get` (MCP) read the same Help articles for fast accurate answers  
**Related:** `docs/INVENTORY_AND_PURCHASE_LOGGING.md` · `docs/LOFT_OPS_DICTIONARY.md` · `docs/ORG_PERMISSION_SCOPES.md`

This is the **how we operate** guide. Engineering plans live in `TODO-LOFT.md` / `TODO.md`.

---

## 1. Who does what

| Role | Works in | Can do | Must not do |
|------|----------|--------|-------------|
| **POS cashier** | Fran POS | Sell; report damage/found; receive Loft delivery + flag exceptions | Approve stock; send to Loft; resolve HQ exceptions |
| **POS manager+** | Fran POS | Above + **request replenishment** (signal to HQ) | Same as above — request ≠ order |
| **HQ inventory ops** | SKUMS Store Ops | Approve / defer / reject requests; verify receive exceptions; apply floor adjustments; build Mon/Thu waves | Store OFS credentials (admin only) |
| **3PL / admin** | SKUMS Integrations + Store Ops | Install WorldSyntech; send/cancel Loft orders; ASN inbound; credentials | Give POS the Loft password |
| **Member / viewer** | SKUMS | Catalog, read stock | Privileged approve / execute 3PL |

**Architecture in one line:** POS reports facts → SKUMS decides & ledgers → Loft executes warehouse work.

```text
POS  →  sales, receive claims, damage/found, replenishment REQUESTS
SKUMS →  approve / wave / ledger / exceptions / OFS calls
Loft  →  pick/pack, FEFO, dispatch or ready-for-collect
CRM   →  members & points (not stock)
```

---

## 2. Daily / weekly rhythm (LISE retail)

| Cadence | What happens |
|---------|----------------|
| **Monday + Thursday** | Default **replenishment waves** (baseline store stock) |
| **Any day** | Store may **request** urgent/ad-hoc stock → HQ inbox only |
| **As trucks land** | POS **Receive delivery** → good stock applied; exceptions → HQ verify |
| **Ongoing** | Floor damage / found / cycle count → HQ **Floor adjustments** → ledger |
| **Inbound KR/HK** | HQ creates ASN → send to Loft → poll → **LISE confirm** → stock on `LOFT-SG` |

Store requests **never** auto-create a Loft order.  
Approve ≠ send: **Send to Loft** needs `store_ops:execute_3pl`.

---

## 3. Screens map (SKUMS)

| Screen | Path | Use for |
|--------|------|---------|
| Dashboard | `/` | Queue counts, shortcuts |
| Products | `/products` | Master data, Activate for POS |
| Inventory | `/inventory` | Levels, warehouse POs (not store Loft waves) |
| **Store Ops** | `/store-ops` | Requests, orders, inbound ASN, receiving, exceptions, **floor adjustments** |
| Actions | `/actions` | AI/MCP draft POs (buying intent) — not Loft store ops |
| Integrations | `/integrations` | WorldSyntech OFS connection, pull products/inventory |
| Settings | `/settings` | Team, API keys (POS / Claude MCP) |
| Help | `/help` | How-to articles |

### Store Ops tabs

| Tab | Operator use |
|-----|----------------|
| **Queue** | Open store replenishment requests; Lift now / Defer to wave / Reject |
| **Orders** | Approved/sent replenishment orders; send to Loft when ready |
| **Inbound ASN** | KR/HK → Loft pre-alerts; send ASN; confirm & promote to LOFT-SG |
| **Receiving** | Receiving sessions history |
| **Exceptions** | POS short/damaged/wrong claims — Confirm / Escalate / Reject |
| **Floor adjustments** | Pending damage / found / cycle count — **Apply to ledger** or Reject |

---

## 4. Replenishment (HQ)

### 4.1 Store request arrives

1. POS manager submits **Request stock** (“Sent to HQ for review”).
2. HQ with `store_ops:approve` sees it under **Store Ops → Queue** (and inbox if wired).
3. Optional: open recommend (baseline / lift) — **advisory only**.
4. Choose:
   - **Lift / approve now** → creates or queues order (still not Loft until send)
   - **Defer to Mon/Thu wave** → attaches to next wave
   - **Reject** → closes request

### 4.2 Weekly wave

1. Ensure waves exist (**Waves** / queue tools with `ensure=1` if available).
2. Review deferred + baseline lines.
3. Convert wave → orders when ready.
4. **Send to Loft** only when product mappings + delivery method config are OK.

### 4.3 Send to Loft checklist

- [ ] WorldSyntech app connected; credentials work (test connection)
- [ ] Each line has OFS product mapping
- [ ] Delivery mode set (`delivery` vs `self_collect`) and method id configured when known
- [ ] Near-expiry gate: short-dated SKUs need override + reason (`inventory:override_expiry`)
- [ ] Actor has `store_ops:execute_3pl` (+ integrations execute as required)

**Stock rule:** Send does **not** increase store on_hand. Store stock rises only after **receive**.

---

## 5. Store receive (POS + HQ)

### 5.1 POS

1. Open **Receive delivery** (not free-form “Receive stock” on Stock page).
2. Select expected order from SKUMS.
3. Enter received / damaged; set exception type if needed.
4. Self-collect: fill collector name/time when prompted.
5. Submit. Good units may auto-apply; exceptions go to HQ.

Copy to staff: *“Reported to HQ for verification”* when exceptions exist — not “resolved”.

### 5.2 HQ exception verify

**Store Ops → Exceptions**

| Action | Meaning |
|--------|---------|
| **Confirm claim** | Accept POS report as filed |
| **Escalate Loft** | Ops follow-up with 3PL (WhatsApp is not the ledger — still record here) |
| **Reject claim** | Deny claim; may require later stock correction |

Scopes: `store_ops:verify`; ledger adjust needs `inventory:write`.

---

## 6. Floor damage, found, cycle count

### 6.1 POS

| Action | Event | Effect until HQ applies |
|--------|--------|-------------------------|
| Damage | `inventory.damage.reported` | Pending only |
| Found | `inventory.found_stock.reported` | Pending only |
| Cycle count | `inventory.cycle_count.reported` | Pending; qty = **physical count** |

Live POS **must not** treat free-form receive as the stock ledger. Display on-hand is a **cache** of SKUMS.

### 6.2 HQ

**Store Ops → Floor adjustments**

1. Review type, location, system vs counted, variance.
2. **Apply to ledger** → writes `inventory_ledger` (quantity truth).
3. **Reject** → no stock change.

Requires `inventory:write`.

---

## 7. Inbound KR/HK → Loft (HQ)

1. **Inbound ASN** tab → create draft (tracking, ETA, lines, M&P/pallet notes).
2. Map products to OFS SKUs as needed.
3. **Send to Loft** (`store_ops:inbound` / execute).
4. Poll receiving status.
5. On variance: fix quantities / spoil at confirm.
6. **LISE confirm** → promote available stock to **`LOFT-SG`** only.  
   Never writes store on_hand from inbound.

Pre-alert SOW: aim **≥ 48 hours** before arrival.

---

## 8. Stock truth (do not invent a second ledger)

| Question | Answer lives in |
|----------|-----------------|
| How much can we sell at store X? | SKUMS `inventory_levels` (store location) |
| What changed stock and why? | SKUMS `inventory_ledger` |
| Who approved a damage write-off? | `audit_events` + adjustment status |
| What did the cashier ring up? | POS outbox + SKUMS `pos_sales` |
| Points / member balance? | **Fran CRM** (not SKUMS) |

See `docs/INVENTORY_AND_PURCHASE_LOGGING.md`.

---

## 9. Integrations (WorldSyntech / Loft)

**Integrations → WorldSyntech OFS**

| Action | When |
|--------|------|
| Test credentials | After install / password rotate |
| Sync reference data | Delivery methods, countries, zones |
| Pull products | Map OFS product_id ↔ SKUMS |
| Pull inventory | Warehouse snapshot (does not overwrite store levels) |
| Poll orders / inbound | After send / ASN |

Credentials: admin + `credentials:write`. POS never holds OFS secrets.

Until Loft fills Phase 0 dictionary IDs, status polling uses provisional maps — see `docs/LOFT_OPS_DICTIONARY.md`.

---

## 10. Permissions cheat sheet

| Task | Min scope (human) |
|------|-------------------|
| View store ops | `store_ops:read` |
| Create request (or POS key) | `store_ops:write` / `pos:write` |
| Approve / defer wave | `store_ops:approve` |
| Send to Loft / poll mutate | `store_ops:execute_3pl` + integrations execute |
| Verify receive exception | `store_ops:verify` |
| Apply floor adjustment | `inventory:write` |
| Inbound ASN lifecycle | `store_ops:inbound` |
| Near-expiry override on send | `inventory:override_expiry` |
| OFS credentials | `credentials:write` + apps install |

POS connector package: request + receive + sales only — **no** approve / verify / execute_3pl.

---

## 11. Common problems

| Symptom | Check |
|---------|--------|
| “Send to Loft” blocked | Mapping missing; app not enabled; missing `execute_3pl`; near-expiry gate |
| Store stock wrong after truck | Was receive submitted? Exceptions pending? Applied floor adj? |
| POS free-form receive does nothing in live | Expected — use **Receive delivery** |
| Request never became Loft order | Did HQ approve **and** someone send? |
| ASN not on LOFT-SG | LISE confirm not done; still partial at Loft |
| Cashier can’t request stock | Role is cashier — need manager+ |
| MCP recommended approve but nothing happened | MCP is advisory; human must use Approve UI |

---

## 12. First-week checklist (new workspace)

1. [ ] Workspace + members; inventory_ops / admin schemas as needed  
2. [ ] Locations: `LOFT-SG`, stores, `XFER-LOFT-STORE` (migration 055+)  
3. [ ] POS locations bound to inventory locations  
4. [ ] Products POS-enabled + barcodes  
5. [ ] WorldSyntech connection + product map  
6. [ ] POS API key = least privilege (`pos` package)  
7. [ ] Smoke: request → approve → (sandbox) send → receive → exception verify  
8. [ ] Smoke: damage report → Floor adjustments → Apply  
9. [ ] Confirm Help Center shows store-ops articles  

---

## 13. Doc index for operators

| Doc | Purpose |
|-----|---------|
| **This runbook** | Day-to-day HQ + POS operating model |
| `/help` articles | Click-path how-tos inside the app |
| `docs/INVENTORY_AND_PURCHASE_LOGGING.md` | Ledger + POS/SKUMS/CRM ownership |
| `docs/LOFT_OPS_DICTIONARY.md` | OFS enums, email to Loft, status maps |
| `docs/ORG_PERMISSION_SCOPES.md` | Full scope catalog |
| `docs/POS_SKUMS_3PL_STORE_OPS_HANDOFF.md` | Engineer contract for POS ↔ SKUMS |
| `docs/LOFT_SOW_KIV.md` | Warehouse SOW commercial process |

---

## Changelog

| Date | Note |
|------|------|
| 2026-07-15 | Initial operator runbook aligned to P–E (waves, receive, floor ledger apply, inbound) |
