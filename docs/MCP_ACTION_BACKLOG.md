# MCP action backlog (#8)

**Date:** 2026-07-15  
**Status:** **Shipped (priority pack)** · **Tracked from root `TODO.md`** (composites #1–8 index + this file in Plans/Links)  
**Principle:** Agents draft / propose / read composites; humans approve and execute privileged steps in UI.

## Shipped tools (#8)

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

**Catalog AI twins:** `get_expiry_snapshot`, `get_exceptions_snapshot`, `get_integrations_health`, `get_attention_snapshot`, `get_low_stock_request_pack`, `get_pos_enable_proposal`.

**Never on cloud:** approve requests, send Loft, apply floor ledger, bulk POS activate.

## Earlier composites (still live)

catalog_*, inventory_ats, product_inventory_status, ops_snapshot, capabilities, store_ops_*, catalog_export/data_ops, help_*.

## Still optional / later

- Bind MCP key to other member UI (A2.5)  
- Forecast summary composite  
- Import job status composite  
- Draft product create beyond pipeline  

## Safety checklist

- [x] Writes audit + deep_link + stop-for-human  
- [x] store_ops:write for drafts only  
- [x] Catalog AI read twins  
- [x] A2 scopes apply via toolScopes + effective key  
