# POS to SKUMS Store Operations Handoff

Date: 2026-06-24

Audience: POS engineers implementing store-floor workflows that feed SKUMS and, downstream, a 3PL/WMS such as Loft Logistics using WorldSyntech OFS.

## Boundary

POS captures store reality. SKUMS decides, approves, reconciles, and executes against the 3PL.

Do not connect POS directly to Loft/OFS. POS should submit store events and requests to SKUMS using the POS connector API. SKUMS then owns SKU mapping, warehouse visibility, replenishment approval, WorldSyntech/OFS calls, reconciliation, and exception handling.

## Staff Roles

### Part-Time POS Staff

Part-time staff should only create store-floor facts:

- Complete sale or return.
- Report damaged, tester, shrinkage, or found stock.
- Scan delivery items during receiving.
- Flag barcode/SKU issues.
- Submit counted quantities during a stock count.

They should not approve adjustments, create 3PL orders, edit SKU mappings, or override warehouse quantities.

### Full-Time POS Staff / Store Leads

Full-time store staff can initiate store requests:

- Submit a replenishment request when shelf or backroom stock is low.
- Mark a request urgent with a reason.
- Confirm store receipt from Loft.
- Record delivery shortage, overage, damage, or wrong SKU.
- Run cycle counts and explain variance reasons.

They still should not call Loft/OFS directly. Their requests land in SKUMS for manager review.

### Store Managers

Store managers may approve store-level actions within limits:

- Approve low-risk stock adjustments.
- Confirm delivery exceptions before escalation.
- Approve replenishment requests under an agreed quantity/value threshold.

SKUMS inventory managers own final approval for 3PL execution unless the workspace explicitly configures store-level approval rules later.

## Existing SKUMS POS API Surface

The POS connector already supports:

- `GET /api/v1/pos/catalog`
- `POST /api/v1/pos/sales`
- `POST /api/v1/pos/scan`
- `POST /api/v1/pos/inventory-events`

Use API keys scoped to `pos:read` and/or `pos:write`.

## POS Events To Implement First

### Sale

Use the existing sale endpoint.

```json
{
  "receipt_number": "LIS-ION-20260624-0001",
  "sale_type": "sale",
  "status": "completed",
  "location_id": "pos_location_uuid",
  "register_id": "register_uuid",
  "cashier_user_id": "pos_staff_ref",
  "currency": "SGD",
  "items": [
    {
      "sku": "LIS-SKU-001",
      "quantity": 1,
      "unit_price": 42
    }
  ],
  "payments": [
    {
      "payment_method": "card",
      "amount": 42,
      "currency": "SGD"
    }
  ],
  "idempotency_key": "pos-sale:LIS-ION-20260624-0001"
}
```

Expected SKUMS behavior: record sell-through and feed replenishment planning.

### Damage, Shrinkage, Tester, Found Stock

Use `POST /api/v1/pos/inventory-events`.

```json
{
  "event_type": "inventory.damage.reported",
  "idempotency_key": "pos-inv:LIS-ION:20260624:DMG:001",
  "pos_location_code": "LIS-ION",
  "sku": "LIS-SKU-001",
  "quantity": 1,
  "reason_code": "damaged_tester",
  "reference": "floor-note-123",
  "occurred_at": "2026-06-24T10:00:00+08:00",
  "payload": {
    "staff_role": "part_time",
    "note": "Broken tester cap"
  }
}
```

Expected SKUMS behavior: create a pending adjustment or attention item when product, location, or quantity cannot be resolved.

### Store Replenishment Request

New POS work: add a store request flow. This should call the future SKUMS store-ops endpoint or write to the equivalent API contract once exposed.

Suggested request shape:

```json
{
  "request_type": "manual",
  "priority": "urgent",
  "pos_location_code": "LIS-ION",
  "requested_by_ref": "staff-123",
  "needed_by": "2026-06-27",
  "reason": "Shelf stock below visual minimum after campaign weekend",
  "idempotency_key": "replenishment-request:LIS-ION:20260624:001",
  "lines": [
    {
      "sku": "LIS-SKU-001",
      "requested_qty": 12,
      "reason": "Top seller"
    },
    {
      "sku": "LIS-SKU-002",
      "requested_qty": 6,
      "reason": "Low shelf stock"
    }
  ]
}
```

Expected SKUMS behavior: create a `store_replenishment_request` in `submitted` status, resolve SKUs, and queue it for inventory-manager approval.

### Store Receiving From Loft

New POS work: add a receiving workflow that starts from expected deliveries shown by SKUMS.

Minimum POS screens:

- Expected deliveries list by store.
- Scan carton/item.
- Confirm received quantity.
- Record missing, damaged, overage, or wrong-SKU lines.
- Submit receipt summary.

Suggested receipt shape:

```json
{
  "receipt_type": "store_replenishment",
  "source_ref": "SKUMS-RO-000123",
  "pos_location_code": "LIS-ION",
  "received_by_ref": "staff-123",
  "received_at": "2026-06-24T15:30:00+08:00",
  "idempotency_key": "receiving:LIS-ION:SKUMS-RO-000123",
  "lines": [
    {
      "sku": "LIS-SKU-001",
      "expected_qty": 12,
      "received_qty": 11,
      "damaged_qty": 0,
      "exception_type": "short"
    },
    {
      "sku": "LIS-SKU-002",
      "expected_qty": 6,
      "received_qty": 6,
      "damaged_qty": 1,
      "exception_type": "damaged"
    }
  ]
}
```

Expected SKUMS behavior: reconcile expected vs received, create inventory exceptions, and update the relevant replenishment order once manager rules allow it.

### Barcode Issue

For unknown or mismatched scans, POS should create an inventory event or a dedicated SKU issue event with:

- scanned value
- product label selected by staff, if any
- store code
- register/session
- staff reference
- photo/reference if available

Expected SKUMS behavior: create a SKU mapping task, not silently create a new product.

## POS UI Requirements

### Part-Time Staff UI

Keep the surface task-based:

- `Report damage`
- `Report found stock`
- `Receive delivery`
- `Flag barcode`

Avoid terms like 3PL, WorldSyntech, OFS, ASN, or warehouse allocation.

### Full-Time Staff UI

Expose store-led workflows:

- `Request replenishment`
- `Urgent restock reason`
- `Cycle count`
- `Delivery exceptions`
- `Receiving history`

### Store Manager UI

Expose review queues:

- Pending store replenishment requests.
- Pending stock adjustments.
- Delivery exceptions awaiting manager note.

Do not expose Loft credentials, reference sync, OFS inventory pull, or direct 3PL order creation.

## POS Acceptance Checks

- Every write request has an idempotency key.
- Every store event includes a store/location code.
- Part-time users cannot approve or send replenishment.
- POS can show SKUMS expected deliveries without exposing 3PL credentials.
- Unknown SKU scans create review tasks, not product duplicates.
- Short/damaged receipt lines are submitted as exceptions.
- POS can operate if Loft/OFS is temporarily down because SKUMS queues and reconciles centrally.

## Implementation Order For POS

1. Show SKUMS catalog and store stock in existing POS product lookup.
2. Add `Report damage/found stock` using `POST /api/v1/pos/inventory-events`.
3. Add `Request replenishment` as a new store request workflow.
4. Add `Receive delivery` using SKUMS expected delivery data.
5. Add role gates for part-time, full-time, and store manager users.
6. Add barcode/SKU issue reporting.

## SKUMS-Owned Work

The SKUMS repo will own:

- Replenishment request and order tables.
- Manager approval/status workflow.
- WorldSyntech/OFS order creation.
- Warehouse inventory pulls.
- Store receiving reconciliation.
- Inventory exception inbox.
- SKU/POS/Loft mapping center.

The POS repo should only send store-side facts and requests.
