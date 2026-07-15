# MCP action backlog

**Date:** 2026-07-15  
**Tracked from:** root **`TODO.md`** (Plans, composites index, Links)  
**Permissions:** **`docs/MCP_USER_PERMISSION_DESIGN.md`** — cloud MCP is **permission-based** (key ∩ bound web user).

**Principle:** Same scopes as web. Owner/admin may approve when scoped. Member/viewer cannot. Credentials never on cloud keys. Approve ≠ send to Loft.

---

## Composites #1–8 (all shipped)

| # | Purpose | Tools |
|---|---------|--------|
| **1** | Catalog research | `catalog_health`, `catalog_sample`, `catalog_search_summary` |
| **2** | Stock / logistics path | `inventory_ats`, `product_inventory_status` |
| **3** | Queues + what can I do | `ops_snapshot`, `capabilities` |
| **4** | Composite-first instructions | `agentInstructions.mjs` + Catalog AI prompt |
| **5** | Bounded CSV | `catalog_export_csv` |
| **6** | Retail/POS intent + seed plan | `catalog_data_ops` |
| **7** | Store request draft + HQ decide | `store_ops_create_draft_request`, list/waves/recommend, **`store_ops_decide`** (`store_ops:approve`) |
| **8** | Digests + drafts + floor apply | See table below |

### #8 tools

| Tool | Mode | Scope |
|------|------|--------|
| `expiry_snapshot` | Read | intel:read |
| `exceptions_snapshot` | Read | store_ops:read |
| `integrations_health` | Read | intel:read |
| `attention_snapshot` | Read | intel:read |
| `low_stock_request_pack` | Suggest | inventory:read |
| `pos_enable_proposal` | Suggest | intel:read |
| `inbound_create_draft` | Write draft | store_ops:write |
| `floor_adjustment_create_draft` | Write draft/pending | store_ops:write |
| `floor_adjustment_apply` | Apply ledger | inventory:write |

**Catalog AI twins (reads):** `get_expiry_snapshot`, `get_exceptions_snapshot`, `get_integrations_health`, `get_attention_snapshot`, `get_low_stock_request_pack`, `get_pos_enable_proposal`, plus earlier catalog/ops twins.

**Also live:** help_*, catalog_*, bi_*/market_*, po_* (draft always; submit/decide when scoped), pipeline_*, study_*, projection_*.

---

## Permission snapshot

| Scope | Example tools |
|-------|----------------|
| intel:read | catalog_*, capabilities, ops_snapshot, expiry, integrations, attention, pos_enable_proposal |
| inventory:read | inventory_ats, product_inventory_status, low_stock_request_pack |
| inventory:write | floor_adjustment_apply |
| store_ops:read | list requests/waves, recommend, exceptions_snapshot |
| store_ops:write | create draft request, inbound draft, floor adj draft |
| store_ops:approve | **store_ops_decide** |
| store_ops:execute_3pl | send-to-Loft (UI primary; scope may be on key) |
| po:draft / po:decide | draft PO / approve PO when scoped |
| credentials:* | **never** on cloud keys |

Owner/admin web elevation + `mcp:ops_safe` key → approve available. Viewer bound key → approve stripped.

---

## Next MCP (POS → HQ loop) — see `TODO.md` Roles & MCP next

| # | Tool / pack | Scope | Notes |
|---|-------------|-------|-------|
| **M1** | Request status pack (lines + recommend + wave) | `store_ops:read` | Manager requested stock on POS |
| **M2** | Floor adjustment queue digest | `inventory:read` | Cashier damage/found/count pending HQ |
| **M3** | `exception_verify` | `store_ops:verify` | Receive exceptions from POS |
| **M4** | `store_ops_send_to_loft` | `store_ops:execute_3pl` | After Loft Phase 0 IDs |
| **M5** | POS sync health (if data available) | `pos:read` | Outbox / failed events |
| **S** | Login MFA | Google Workspace | Not an MCP tool; enforce MFA on IdP (see TODO Phase S) |

## Optional leftovers (not blocking)

- [ ] A2.5 Settings UI: bind MCP key to **another** member  
- [ ] Full `store_ops_send_to_loft` MCP tool (shipping address + connection_id)  
- [ ] Forecast summary composite  
- [ ] Import job status composite  
- [ ] Brand/category cleanup suggestions  
- [ ] Empty **non-MCP** API keys ≠ full (legacy cleanup)  
- [ ] Phase S: Google Workspace MFA policy for SKUMS users (see TODO.md; no in-app TOTP v1)  

## Explicit non-goals

- Invoices / AR  
- Bulk POS activate of 10k SKUs from MCP  
- Live marketplace scrape on every tool call  
- Credentials management via MCP  

## Safety checklist

- [x] Effective scopes = key ∩ web user  
- [x] Cloud approve when `store_ops:approve`  
- [x] Writes audit + deep_link where applicable  
- [x] Catalog AI filtered by session scopes  
- [x] Member remove revokes bound keys  
- [x] Tracked from `TODO.md`  
