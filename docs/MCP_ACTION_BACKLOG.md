# MCP action backlog (#8 — for review)

**Date:** 2026-07-15  
**Status:** Review only — not a commit to build everything.  
**Principle:** Agents draft / propose / read composites; humans approve and execute privileged steps in UI (or full-profile local MCP).

## Already shipped (do not re-scope)

| Area | Tools |
|------|--------|
| Catalog research | `catalog_health`, `catalog_sample`, `catalog_search_summary`, stats/search/get |
| Catalog ops | `catalog_export_csv`, `catalog_data_ops` |
| Inventory status | `inventory_ats`, `product_inventory_status` |
| Ops queues | `ops_snapshot`, `capabilities` |
| Store ops | list requests/waves, recommend, **`store_ops_create_draft_request`** (#7) |
| Decision PO | draft/clone/list (safe); submit/decide (full only) |
| Pipeline / study / BI | propose + read; execute/seed-write full only |
| Help | resolve / get / list |
| Instructions | composite-first (#4) |

**A2 (permissions):** Design in `docs/MCP_USER_PERMISSION_DESIGN.md` — MCP roles = web login scopes; owner revokes keys.

---

## App surface → MCP opportunity map

Walk of major app areas (`app/pages`, `server/api`, Store Ops, POS handoff).

### A. Store Ops (`/store-ops`) — high value, carefully gated

| Idea | Mode | Notes |
|------|------|--------|
| Draft request | **Shipped #7** | draft / optional submit; no approve/Loft |
| Low-stock → draft request lines | Composite read + draft | From `v_low_stock` + `inventory_ats`; still human confirms |
| Draft inbound ASN | Write draft | Lines + forwarder fields; human send-to-loft |
| Preview wave allocation | Read | Already partially waves + recommend |
| Exception triage summary | Read composite | Open exceptions by severity; link verify UI |
| Floor adjustment **draft** from POS events | Write draft only | **Never** apply to ledger from cloud |
| Ready-for-collect / expected deliveries digest | Read | Operator morning brief |

**Keep human-only (or full local):** approve, convert wave, send-to-loft, apply/reject floor, exception verify.

### B. Inventory (`/inventory`)

| Idea | Mode | Notes |
|------|------|--------|
| Multi-SKU ATS matrix | Extend `inventory_ats` | Already solid for status Q |
| Transfer **preview** loft→store | Read | No classic transfer object; describe Store Ops path |
| Location health (empty LOFT-SG, missing ST-MAIN) | Read | Seed/migration hints |
| Ledger movement tail for SKU | Read bounded | Audit-ish; privacy/noise limits |

### C. Products / Import (`/products`, `/import-export`)

| Idea | Mode | Notes |
|------|------|--------|
| Bulk retail fill via CSV | Shipped export | Re-import stays in UI |
| Propose POS-enable list | Propose only | Pipeline or Actions list; no bulk flip without human |
| Draft product create | Write draft | Status draft + POS off (pipeline already does) |
| Brand/category cleanup suggestions | Read | Duplicates, null category |
| Import job status composite | Read | Last N jobs, failures |

### D. Actions (`/actions`) — already MCP-native

| Idea | Mode | Notes |
|------|------|--------|
| PO from low stock / data_ops | Draft | Clone/create with suggested lines |
| Pipeline from attention items | Propose | API exists: agent-proposals / attention |
| Projection from study/PO | Run projection | Already MCP projection_* |

### E. Expiry (`/expiry`)

| Idea | Mode | Notes |
|------|------|--------|
| `expiry_snapshot` | Read composite | Expired / 30d / 90d + top SKUs |
| Draft “pull from floor” request lines | Draft | Map near-expiry store qty → replenishment reason |

### F. Forecasting (`/forecasting`)

| Idea | Mode | Notes |
|------|------|--------|
| Forecast summary for SKU set | Read | Only if forecasts exist; else honest empty |
| Link forecast → draft PO qty | Suggest | Uses `po_suggest_qty` pattern |

### G. Integrations / Loft (`/integrations`, WorldSyntech)

| Idea | Mode | Notes |
|------|------|--------|
| Integration health composite | Read | Connection status, last sync, Phase 0 dictionary gaps |
| Poll status (inbound/orders) | Read | No silent execute_3pl |
| Dictionary completeness | Read | delivery_method_ids missing flags |

### H. Quality / attention (`/product-quality`, attention API)

| Idea | Mode | Notes |
|------|------|--------|
| Attention queue snapshot | Read | Open items by type |
| Propose resolution candidate | Propose | Existing agent-proposals path |

### I. Settings / team / keys

| Idea | Mode | Notes |
|------|------|--------|
| **A2** member↔MCP scopes | Design | User deferred intentionally |
| Connector key health | Read | Last used, scopes, never expose secret |

### J. CRM / Fran / POS (external)

| Idea | Mode | Notes |
|------|------|--------|
| Product context for CRM | Read | Existing fran CRM product-context |
| Do **not** put POS sale/commit on cloud MCP | — | Keep POS API separate |

### K. Catalog AI (in-app) parity

Mirror any new MCP read composites as `get_*` tools so web assistant stays equal for ops Q&A. Write drafts: MCP-first unless product wants in-app create.

---

## Suggested priority for #8 implementation (when approved)

1. **Read composites (fast, safe):** `expiry_snapshot`, `exceptions_snapshot` (or fold deeper into `ops_snapshot`), `integrations_health`, `attention_snapshot`  
2. **Suggest → draft:** low-stock → `store_ops_create_draft_request` dry_run pack  
3. **Draft ASN (write, no send):** `inbound_create_draft`  
4. **Floor adj draft only:** create pending adjustment; apply stays UI  
5. **POS-enable proposal list:** export CSV of candidates + Actions note, no mass update  

---

## Explicit non-goals for cloud MCP

- Approve store requests / send Loft / apply floor ledger  
- Supplier invoices / AR  
- Silent bulk POS activation of 10k SKUs  
- Live marketplace scrape every tool call  
- Full-catalog CSV dump  

---

## Review checklist

- [ ] Product: which #8 items are v1 vs parked?  
- [ ] Safety: any write must audit + deep_link + “stop for human”  
- [ ] Scopes: new writes under safe `store_ops:write` / `po:draft` / `pipeline:propose` only  
- [ ] Catalog AI: which tools need in-app twins?  
- [ ] A2 permissions still separate  
