# Loft / WorldSyntech OFS — Ops Dictionary

**Status:** working draft — structure complete; **live OFS IDs pending Loft reply**  
**Plan:** `TODO-LOFT.md` Phase 0 (PR-0.1)  
**Last updated:** 2026-07-15  
**Related:** `docs/SKUMS_OPERATOR_RUNBOOK.md` (day-to-day ops) · `docs/LOFT_SOW_KIV.md` · `docs/WORLDSYNTECH_3PL_INTEGRATION_PLAN.md` · `fulfillment/worldsyntech-ofs/`

This file is the **single place** for OFS enum maps, delivery methods, field parity, and LISE operating rules used by the connector.

**Rule:** do not hardcode unknown OFS IDs in product code. Prefer connection credential defaults + `sync-reference-data`. Status mappers today use **provisional string heuristics** (documented below) until Loft confirms official tables.

---

## Why this phase exists

Phases **P–D** (permissions, topology, waves, receive, inbound ASN) are implemented against **placeholders**. Live pilot still needs:

1. Production / sandbox base URLs and credentials  
2. Real `delivery_method_id` values for store delivery vs self-collect  
3. Official order + inbound status enums (replace heuristics)  
4. Confirmation of SKU-only vs required `product_id`, ASN field parity, rate limits  

Until those land, send/poll works only with provisional maps and config on the connection.

---

## Environments

| Env | Base URL | Notes |
|-----|----------|--------|
| Public apidoc / demo | `https://orderfulfillmentdemo3.worldsyntech.com` | Apidoc: `/apidoc/`. May be slow or non-LISE tenant data. |
| Sandbox (LISE) | **_TBD from Loft_** | Expected: same path shape as demo; LISE-scoped products/orders. |
| Production (LISE) | **_TBD from Loft_** | Must be HTTPS. Store on connection `base_url`. |

**API path shape (all envs):**

```text
POST {base_url}/index.php?route=rest_customer/<resource>/<action>
```

Login special-cases `grant_type=client_credentials` on the query string (see client).

**Connector defaults** (`fulfillment/worldsyntech-ofs/client.ts`):

| Setting | Value |
|---------|--------|
| Default page limit | 250 |
| Default `language_id` | 1 |
| Token refresh skew | 60s before `expires_at` |
| Success envelope | `success === 1` \| `true` \| `'1'` (not HTTP alone) |
| User-Agent | `SKUMS WorldSyntech OFS Connector/1.0` |

---

## Auth model

### Token ownership

| Secret | Owner | Where stored |
|--------|-------|----------------|
| Basic API token | Loft / WorldSyntech issues to LISE | `integration_credentials.credential_data.basic_token` (admin install; `credentials:write`) |
| API user name | LISE account for OFS portal/API | `user_name` on same credential blob |
| API password | LISE; rotate with Loft | `password` (secret) |
| Bearer `access_token` | Derived at login | Same blob; **not** user-edited; refresh on expiry |

POS **never** holds these. Only SKUMS WorldSyntech connection + workers with `integrations:execute` / `store_ops:execute_3pl`.

### Login flow

1. `POST .../customer_security/api_login&grant_type=client_credentials`  
2. Headers: `Authorization: Basic <basic_token>`, `Content-Type: application/json`  
3. Body: `{ "user_name", "password" }`  
4. Response `data.access_token`, optional `expires_in`, `token_type`, customer metadata  
5. Subsequent calls: `Authorization: Bearer <access_token>`

### Rotation / ops

| Event | Action |
|-------|--------|
| Password or Basic token rotated by Loft | Update connection credentials in SKUMS Integrations UI; re-test login |
| Bearer expired mid-job | Client re-logins when missing or within skew of `expires_at` |
| Compromised key | Disable connection; rotate with Loft; issue new `basic_token` / password; audit `credentials:write` |

**Open (ask Loft):** who issues Basic token; multi-user vs shared API user; forced password interval; IP allowlist.

---

## Rate limits / concurrency

| Topic | Guidance until Loft answers |
|-------|----------------------------|
| Documented limits | **Unknown** — treat as unknown |
| Inventory / order / inbound poll | Conservative: one page at a time; limit ≤ 250; avoid parallel full-catalog pulls |
| Token login | Cache bearer; do not login per product row |
| Product pull | Paginate with offset/limit; stop when page &lt; limit |
| Concurrent jobs | Prefer single workspace worker for mutating OFS calls (create order, create ASN) |
| On `success !== 1` / 429 / 5xx | Fail execution row; do not silent-retry create (idempotency risk); safe to re-poll get_list |

If Loft provides RPS or concurrent-session limits, record them here and wire throttles in the worker.

---

## Delivery modes (SKUMS → OFS)

| SKUMS `delivery_mode` | Meaning (ops) | OFS `delivery_method_id` | Shipping address rule |
|-----------------------|---------------|--------------------------|------------------------|
| `delivery` | Loft (or Loft courier) delivers to store door | **_TBD_** — map after `delivery_method/get_list` | Store door address (name, phone, street, city, postcode, `country_id`, `zone_id`) |
| `self_collect` | Loft pick/pack; LISE or LISE courier collects | **_TBD_** | **_TBD_** — usually Loft warehouse collect address (Krislite / door unit per SOW), **not** store door |

**Credential defaults** (connection config, not POS):

- `default_delivery_method_id`  
- `default_country_id`  
- `default_zone_id`  

**Sync:** `POST /api/integrations/worldsyntech-ofs/sync-reference-data` → OFS `delivery_method/get_list` (+ countries, zones, addresses). Cache on connection; ops picks IDs into dictionary + defaults.

**Payload:** `mapStoreReplenishmentToWorldsyntechPayload` sets `delivery_method_id` from order then credential default (must not stay `0` in production).

**SOW context:**

- Scenario 1: pick/pack only + LISE courier → often models as ready-for-collect / self_collect path.  
- Scenario 2: Loft delivery → `delivery` mode.  
- Fixed weekday store windows preferred; SKUMS Mon/Thu **replenishment waves** are planning cadence (not the same as Loft delivery-method IDs).

---

## Order status map (OFS → SKUMS)

SKUMS table: `store_replenishment_orders.status`  
Remote fields polled: `order_status` or `status` on `order/get_list`  
Code: `server/api/integrations/worldsyntech-ofs/poll-orders.post.ts`

### Official OFS enum

| OFS status / id | Label | **_TBD — fill from Loft_** |
|-----------------|-------|----------------------------|
| | | Full table pending email reply |

### Provisional heuristic map (shipped today — replace when official table lands)

Matching is **case-insensitive substring** on the remote status string:

| If remote string contains… | SKUMS status | Notes |
|----------------------------|--------------|--------|
| `cancel` | `cancelled` | |
| `deliver` or `complete` | `shipped` (unless already `received`) | Store `received` only after POS/HQ receive path |
| `ship` or `dispatch` | `shipped` | |
| `pick` / `ready` / `collect` | `shipped` | Treated as released from Loft for expected-deliveries |
| `process` or `ack` | `acknowledged` | |
| `fail` / `error` / `stockout` | `exception` | |
| (empty / other) | keep current, else `sent_to_3pl` | After successful create |

### Ready-for-collect flag

`metadata.ready_for_collect` + `pickup_ready_at` when remote contains `ready`, `collect`, `picked`, or `pick complete`.

### In-transit posting policy (product default D2)

When OFS status maps to **shipped** or **ready_for_collect** → post / treat store path as in transit via `XFER-LOFT-STORE` (see topology). **Do not** increment store `on_hand` until receive apply (Phase C).

| SKUMS status | Meaning |
|--------------|---------|
| `approved` / `queued` | Local only; not at Loft |
| `sent_to_3pl` | OFS create succeeded; external_order_id set |
| `acknowledged` | Loft accepted / processing |
| `shipped` | Dispatched or ready for collect (see flag) |
| `partially_shipped` / `partially_received` | Partial physical receive at store |
| `received` | Store receive complete (SKUMS, not OFS alone) |
| `cancelled` / `exception` / `failed` | Terminal or retry paths |

---

## Inbound (`ship_to_warehouse`) status map

SKUMS: `inbound_shipments.status`  
Poll: `ship_to_warehouse/get_list`  
Code: `server/utils/inboundShipment.ts` → `mapInboundRemoteStatus`

### OFS identity fields

| OFS field | SKUMS meaning |
|-----------|---------------|
| `stock_incoming_id` (array or scalar) | Line / stock-incoming external id(s) |
| `stock_incoming_main_id` | ASN header external id |
| `tracking_number` | Match key to local ASN (preferred) |
| `pending_quantity` | Not yet received at Loft |
| `received_quantity` / `quantity_received` | Physical qty Loft booked |
| additional / spoil (when present) | Variance inputs → LISE confirm |
| `status` / `status_id` | Remote lifecycle (**ids TBD**) |

Create success fixture shape: `tracking_number`, `stock_incoming_main_id`, `stock_incoming_id[]`.

### SKUMS inbound lifecycle (local)

```text
draft → asn_sent → in_transit → loft_receiving → partial_received | fully_received
  → lise_confirmed → available   (promote LOFT-SG only after confirm policy)
```

### Provisional remote → local map

| If remote string contains… | SKUMS status |
|----------------------------|--------------|
| `cancel` | `cancelled` |
| `partial` | `partial_received` |
| `receiv` / `complete` / `close` | `fully_received` |
| `arriv` / `dock` | `loft_receiving` |
| `transit` / `ship` | `in_transit` |
| (other / empty) | keep current or `asn_sent` |

**Policy:** never write **store** `on_hand` from inbound. Promote warehouse stock to **`LOFT-SG`** only after LISE confirm (`store_ops:inbound` + `inventory:write`).

---

## SKU vs `product_id`

| Surface | Connector behavior today | Production rule (target) |
|---------|--------------------------|---------------------------|
| Order create lines | Sends **both** `product_id` (Number) and `sku` | **Require OFS `product_id`** from `integration_entity_mappings`; block send if unmapped (PR-A.2) |
| ASN create lines | Same | Prefer mapped `product_id`; SKU alone only if Loft confirms SKU-only is accepted |
| Product pull | Maps by `product_id`, SKU, UPC | Match order: mapping → SKU → UPC |

**Open (ask Loft):** is SKU-only create accepted, or does OFS reject `product_id: 0`?

---

## ASN field parity (SOW template vs OFS create)

SOW inbound template wants: SKU, description, tracking, qty (UOM), **UPC**, **expiry**, carton/pallet context.

| SOW / ops need | OFS create payload (today) | SKUMS handling | Action |
|----------------|----------------------------|----------------|--------|
| SKU | `sku` (+ `product_id`) | Required | OK |
| Description | `product_description` | Optional line text | OK |
| Tracking | `tracking_number` | Required on send | Unique per shipment |
| Quantity | `quantity` | Required | OK |
| Product name / price / dim / weight | optional product_* fields | Optional | For CBM later |
| **UPC** | Not on ASN line in mapper | Product master / mapping | Confirm with Loft whether ASN accepts UPC |
| **Expiry** | Not in create map | Ops entry at **LISE confirm** (`expiry_*` on lines) until API fields known | Default open decision D3 |
| Carton count | — | `metadata` / shipment fields | Metadata MVP |
| Pallet full/partial | — | `palletization`: `full_pallet` \| `partial_pallet` \| `loose` \| `mixed`; `pallet_count` | Metadata MVP (D4) |
| ETA | `date_estimate` | Optional | OK |
| Pre-alert ≥ 48h | — | Ops process + UI timing | SOW locked fact |

---

## FEFO + short-date rule

| Rule | Owner | Status |
|------|-------|--------|
| **FEFO pick** at warehouse | Loft WMS | SOW: FEFO only (not dual batch logic) — **confirm still true** |
| Near-expiry **flag / block** before despatch | SKUMS gate + Loft WMS alerts | Lise: remaining shelf life **&lt; 9 months** → no despatch without written approval |
| SKUMS default gate | `checkNearExpiryGate` | Default **9 months** (~273 days); block send unless `override_expiry` + `inventory:override_expiry` |
| Override audit | SKUMS order metadata | Actor + reason on send |
| Monthly near-expiry report | Loft | Process, not connector MVP |

---

## M&P / multi-leg tracking (what goes in ASN metadata)

Physical flow:

```text
KR/HK suppliers → offshore forwarder → M&P (local) → Loft warehouse
```

SKUMS `inbound_shipments` / metadata (local; not all fields pushed to OFS):

| Field | Purpose |
|-------|---------|
| `local_forwarder` | Default **`M&P`** |
| `offshore_forwarder` | KR/HK leg (optional string) |
| `palletization` | full / partial / loose / mixed |
| `pallet_count` | Count when known |
| `carton_count` | When known |
| `tracking_number` | **Primary OFS + match key** — use the leg Loft expects on ASN (confirm with Loft: M&P last-mile vs master BL) |
| `date_estimate` | ETA to Loft |
| `metadata.origin` | e.g. `kr_hk_inbound` |

**Open (ask Loft):** which tracking number they want on `ship_to_warehouse/create` when multi-leg (master BL vs M&P vs container).

---

## Weekly replenishment cadence (LISE)

| Day | Role |
|-----|------|
| **Monday** | Baseline wave |
| **Thursday** | Baseline wave |

Store POS requests are **signals** to HQ (`store_ops:approve` inbox), not automatic Loft orders.  
HQ uses MCP baseline + lift to **approve now** vs **defer to next Mon/Thu wave**.  
Wave release still requires human/job with `store_ops:execute_3pl` to call OFS.

---

## Inventory locations (SKUMS codes)

| Code | Type | Meaning |
|------|------|---------|
| `LOFT-SG` | `3pl` | Loft warehouse ATS (policy-gated trust after LISE confirm) |
| `XFER-LOFT-STORE` | `in_transit` | Released from Loft, not store-received |
| `ST-*` / `LIS-*` | `store` | Retail store (`ensure_store_inventory_location`) |
| `WH-MAIN` | `warehouse` | Optional non-3PL warehouse |
| `DAMAGED` / `RETURNS` | quarantine | |

Seeded by migration `055_loft_permissions_topology.sql`.  
Loft door unit (ops): **04-1A, 4th floor, Krislite Building** (SOW) — address book entry for self-collect / delivery method reference when IDs known.

---

## Scopes (machine)

| Package | Scopes (summary) |
|---------|------------------|
| `pos_connector` | `pos:read/write`, `store_ops:read/write`, `products:read` — **no** approve / verify / execute_3pl |
| `worldsyntech_ofs` | inventory, `store_ops:execute_3pl` / inbound, `integrations:execute`, locations, products:read |

See `server/utils/scopes.ts` and `docs/ORG_PERMISSION_SCOPES.md`.

---

## Open questions for Loft (email checklist)

Copy into the email body in the next section. Leave checked only when answered and pasted into this file.

- [ ] Production + sandbox **base URLs** (and whether demo URL is usable for LISE UAT)
- [ ] **Basic token** issuance process + rotation procedure  
- [ ] API **user/password** model (shared vs named users)  
- [ ] **Rate limits** / recommended poll interval / concurrency  
- [ ] Full **`delivery_method` list** for LISE tenant (IDs + labels); which ID = store delivery vs self-collect  
- [ ] **Self-collect shipping address** rule (warehouse address fields to send on order create)  
- [ ] Full **order status** id/name table + meaning for pick complete / ready for courier / delivered  
- [ ] Full **inbound (`ship_to_warehouse`) status** id/name table + partial / spoil / additional fields  
- [ ] **SKU-only** vs required **`product_id`** on order create and ASN create  
- [ ] ASN support for **UPC** and **expiry** on lines  
- [ ] Preferred **tracking number** when multi-leg (supplier → M&P → Loft)  
- [ ] **Webhooks** for order/inbound status? (assume **poll** if none)  
- [ ] Behavior on **duplicate** `reference_no` / tracking_number (reject vs return existing id)  
- [ ] Confirm **FEFO-only** pick + near-expiry WMS behavior vs SKUMS 9-month gate  
- [ ] Sandbox credentials for LISE dry-run  

---

## Structured email to Loft (ready to send)

**To:** Daryl Chan (`Daryl_chan@loftlogistic.com`) + Loft COT / technical contact  
**Cc:** LISE ops owner; WorldSyntech if Loft routes API support there  
**Subject:** LISE × Loft OFS integration — Phase 0 dictionary (URLs, delivery methods, status enums)

```text
Hi Daryl / Loft team,

We are wiring LISE’s warehouse system of record (SKUMS) to Loft via the
WorldSyntech OFS API (store replenishment orders + ship_to_warehouse ASN,
not ecommerce marketplaces). Implementation is largely ready; before we
run a production pilot we need a short “ops dictionary” from your side.

Please confirm or fill in:

1) Environments
   - Sandbox base URL for LISE
   - Production base URL for LISE
   - Is https://orderfulfillmentdemo3.worldsyntech.com valid for our UAT,
     or LISE-only hosts only?

2) Auth
   - How Basic token + API user/password are issued and rotated
   - Any IP allowlist or concurrent-session limits

3) Rate limits
   - Recommended max requests/minute and safe poll interval for
     order/get_list, inventory/get_list, ship_to_warehouse/get_list

4) Delivery methods
   - Full delivery_method list for our tenant (id + name)
   - Which id we should use for:
        a) Loft delivery to LISE store door
        b) Pick/pack ready for LISE self-collect / LISE courier pickup
   - Exact shipping_address fields for (b)

5) Outbound order statuses
   - Complete status id → label table for order/get and get_list
   - Which statuses mean: accepted, picking, ready for collect,
     handed to courier, delivered, cancelled, exception/stockout

6) Inbound ship_to_warehouse
   - Status id → label table
   - Field names for pending / received / additional / spoil quantities
   - Whether UPC and expiry can be sent on create lines
   - Whether product_id is required or SKU alone is enough

7) References & idempotency
   - Duplicate reference_no on order/create — reject or return existing?
   - Duplicate tracking_number on ship_to_warehouse/create?
   - Which tracking number to use when goods move KR/HK → M&P → Loft

8) Webhooks
   - Any status webhooks, or poll-only?

9) FEFO / short date
   - Confirm FEFO-only pick at Loft
   - How near-expiry blocks work on your side (we gate ≤9 months shelf
     life in SKUMS before send; written override on our side)

We will keep answers in our LOFT_OPS_DICTIONARY and map them 1:1 into
status polling and delivery-method config. Happy to jump on a short call
or receive a spreadsheet export from the portal.

Thank you,
[LISE / Fran contact]
```

After reply: paste tables into this file, check open-question boxes, update `docs/LOFT_SOW_KIV.md` **Locked-in**, and replace provisional heuristics in poll mappers with explicit id maps.

---

## Implemented APIs (reference)

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
| Poll OFS orders | `POST /api/integrations/worldsyntech-ofs/poll-orders` | connection write / execute |
| Expected deliveries | `GET /api/store-ops/expected-deliveries` | pos:read / store_ops:read |
| Submit receive | `POST /api/store-ops/receive` | pos:write / store_ops:write |
| List exceptions | `GET /api/store-ops/exceptions` | store_ops:read |
| Verify exception | `POST /api/store-ops/exceptions/:id/verify` | store_ops:verify |
| List inbound ASN | `GET /api/store-ops/inbound` | store_ops:read |
| Create ASN draft | `POST /api/store-ops/inbound` | store_ops:inbound |
| Send ASN to Loft | `POST /api/store-ops/inbound/:id/send-to-loft` | store_ops:inbound / execute_3pl |
| Poll inbound | `POST /api/integrations/worldsyntech-ofs/poll-inbound` | connection write |
| LISE confirm + promote LOFT-SG | `POST /api/store-ops/inbound/:id/confirm` | store_ops:inbound + inventory:write |
| Sync reference data | `POST /api/integrations/worldsyntech-ofs/sync-reference-data` | integrations / credentials path |

MCP (safe, advisory): `store_ops_list_requests`, `store_ops_list_waves`, `store_ops_recommend`

---

## Code map (where dictionary is consumed)

| Concern | Location |
|---------|----------|
| Auth + HTTPS base URL | `fulfillment/worldsyntech-ofs/client.ts` |
| Order / ASN payloads | `fulfillment/worldsyntech-ofs/mapping.ts` |
| Order status heuristics | `poll-orders.post.ts` → `mapRemoteOrderStatus` / `isReadyForCollect` |
| Inbound status heuristics | `server/utils/inboundShipment.ts` → `mapInboundRemoteStatus` |
| Near-expiry gate (9 mo) | `server/utils/storeReplenishment.ts` → `checkNearExpiryGate` |
| Delivery method on send | order + `default_delivery_method_id` on credentials |
| M&P / pallet metadata | `inboundShipment` create fields |

When Loft answers: prefer a small explicit map module (e.g. `fulfillment/worldsyntech-ofs/statusMaps.ts`) fed by this doc, and drop fragile substring matching.

---

## Progress

| Date | Note |
|------|------|
| 2026-07-14 | Skeleton: LISE cadence + location codes; OFS IDs pending Loft |
| 2026-07-14 | Phase B–D APIs + waves + MCP tools landed against provisional maps |
| 2026-07-15 | **Phase 0 expand:** auth, rate guidance, provisional status maps aligned to code, ASN/SOW parity, FEFO/M&P, structured Loft email draft |
