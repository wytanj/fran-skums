# Loft / WorldSyntech OFS — Ops Dictionary

**Status:** working draft (fill from Loft email + sandbox)  
**Plan:** `TODO-LOFT.md` Phase 0  
**Last updated:** 2026-07-14

This file is the single place for OFS enum maps, delivery methods, and field parity.  
Do not hardcode unknown IDs in product code — read from connection config / reference sync.

---

## Environments

| Env | Base URL | Notes |
|-----|----------|--------|
| Demo / apidoc | `https://orderfulfillmentdemo3.worldsyntech.com` | Public apidoc host (may be slow) |
| Sandbox (LISE) | _TBD from Loft_ | |
| Production (LISE) | _TBD from Loft_ | |

Auth:

1. `Authorization: Basic <basic_token>` + body `user_name`, `password`  
2. Route: `rest_customer/customer_security/api_login&grant_type=client_credentials`  
3. Subsequent: `Authorization: Bearer <access_token>`  
4. Envelope: trust `success === 1` (or true), not HTTP alone

---

## Delivery modes (SKUMS → OFS)

| SKUMS `delivery_mode` | Meaning | OFS `delivery_method_id` | Address rule |
|-----------------------|---------|--------------------------|--------------|
| `delivery` | Loft delivers to store | _TBD_ | Store door address |
| `self_collect` | Pick/pack; LISE collect | _TBD_ | _TBD warehouse collect address_ |

Sync methods via `POST .../sync-reference-data` → `delivery_method/get_list`.  
Store defaults on credential: `default_delivery_method_id`, `default_country_id`, `default_zone_id`.

---

## Order status map (OFS → SKUMS)

| OFS status / id | SKUMS `store_replenishment_orders.status` | Notes |
|-----------------|-------------------------------------------|--------|
| _TBD_ | `sent_to_3pl` | After create |
| _TBD_ | `acknowledged` | |
| _TBD_ | `partially_shipped` / `shipped` | |
| _TBD ready for collect_ | treat as ready for POS expected list | Self-collect |
| _TBD_ | `received` | Only after store receive (not OFS alone) |
| _TBD_ | `cancelled` / `exception` | |

**Default in-transit post:** when OFS status is shipped **or** ready_for_collect → `XFER-LOFT-STORE` / store path `in_transit` (see TODO-LOFT D2).

---

## Inbound (`ship_to_warehouse`) status map

| OFS field / status | SKUMS meaning |
|--------------------|---------------|
| `stock_incoming_id` | External ASN line/id |
| `stock_incoming_main_id` | External ASN header |
| pending qty | Not yet received |
| received / additional / spoil | Variance inputs |
| _status ids TBD_ | draft → receiving → partial/full → confirmed |

**SOW fields vs API (parity):**

| SOW template | OFS create payload today | Action |
|--------------|--------------------------|--------|
| SKU | `sku` / `product_id` | OK |
| description | `product_description` | OK |
| tracking | `tracking_number` | OK |
| quantity | `quantity` | OK |
| UPC | product master / not on ASN line | Confirm with Loft |
| expiry | not in SKUMS ASN map | Ops entry at LISE confirm until API fields known |
| pallet full/partial | metadata in SKUMS only | OK for MVP |

---

## Weekly replenishment cadence (LISE)

| Day | Role |
|-----|------|
| **Monday** | Baseline wave |
| **Thursday** | Baseline wave |

Store POS requests are **signals** to HQ (`store_ops:approve` inbox), not automatic Loft orders.  
HQ uses MCP baseline + lift to **approve now** vs **defer to next Mon/Thu wave**.

---

## Inventory locations (SKUMS codes)

| Code | Type | Meaning |
|------|------|---------|
| `LOFT-SG` | `3pl` | Loft warehouse ATS (policy-gated trust) |
| `XFER-LOFT-STORE` | `in_transit` | Released from Loft, not store-received |
| `ST-*` / `LIS-*` | `store` | Retail store (via `ensure_store_inventory_location`) |
| `WH-MAIN` | `warehouse` | Optional non-3PL warehouse |
| `DAMAGED` / `RETURNS` | quarantine | |

Seeded by migration `055_loft_permissions_topology.sql`.

---

## Scopes (machine)

| Package | Scopes (summary) |
|---------|------------------|
| `pos_connector` | `pos:read/write`, `store_ops:read/write`, `products:read` — **no** approve/verify/execute_3pl |
| `worldsyntech_ofs` | inventory, store_ops execute/inbound, integrations:execute, locations, products:read |

See `server/utils/scopes.ts` and `docs/ORG_PERMISSION_SCOPES.md`.

---

## Open questions for Loft (email checklist)

- [ ] Prod + sandbox base URLs  
- [ ] Basic token issuance / rotation  
- [ ] Rate limits  
- [ ] `delivery_method_id` for delivery vs self-collect  
- [ ] Self-collect shipping address rule  
- [ ] Full order + inbound status id tables  
- [ ] SKU-only vs product_id required on order/ASN  
- [ ] Expiry/UPC on ASN  
- [ ] Webhooks? (assume poll if none)  
- [ ] Duplicate `reference_no` / tracking behavior  

---

## Implemented APIs (Phase B)

| Action | Route | Scope |
|--------|-------|--------|
| Store request (signal) | `POST /fran/store-ops/requests` | `pos:write` or `store_ops:write` |
| HQ inbox | `GET /api/store-ops/inbox?workspace_id=` | `store_ops:read` (+ approve holders) |
| List requests | `GET /api/store-ops/requests?workspace_id=` | `store_ops:read` / `pos:read` |
| Recommend (baseline/lift) | `GET /api/store-ops/requests/:id/recommend` | `store_ops:read` |
| Decide | `POST /api/store-ops/requests/:id/decide` | `store_ops:approve` |
| Waves | `GET /api/store-ops/waves?workspace_id=&ensure=1` | `store_ops:read` |
| Convert wave | `POST /api/store-ops/waves/:id/convert` | `store_ops:approve` |
| Send to Loft | `POST /api/store-ops/orders/:id/send-to-loft` | `store_ops:execute_3pl` |
| Poll OFS orders | `POST /api/integrations/worldsyntech-ofs/poll-orders` | connection write |
| Expected deliveries | `GET /api/store-ops/expected-deliveries` | pos:read / store_ops:read |
| Submit receive | `POST /api/store-ops/receive` | pos:write / store_ops:write |
| List exceptions | `GET /api/store-ops/exceptions` | store_ops:read |
| Verify exception | `POST /api/store-ops/exceptions/:id/verify` | store_ops:verify |

MCP (safe, advisory): `store_ops_list_requests`, `store_ops_list_waves`, `store_ops_recommend`

## Progress

| Date | Note |
|------|------|
| 2026-07-14 | Skeleton created with LISE cadence + location codes; OFS IDs pending Loft |
| 2026-07-14 | Phase B APIs + waves + MCP tools landed |
