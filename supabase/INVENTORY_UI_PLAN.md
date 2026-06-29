# Inventory — Full UI Plan

## Quantity Model (always show these four)

| Label | Column | Meaning |
|---|---|---|
| **On Hand** | `on_hand` | Physically present at this location |
| **Reserved** | `reserved` | On hand but locked (orders, holds, safety stock) |
| **Available to Sell** | `on_hand - reserved` | What can actually be sold right now |
| **In Transit** | `in_transit` | En route to this location (PO or transfer) |
| **On Order** | `on_order` | Ordered from supplier, not yet shipped |
| **Total Owned** | `on_hand + in_transit + on_order` | Everything you own/expect |

---

## Pages & Routes

```
/inventory                        Overview dashboard
/inventory/locations              Location management
/inventory/locations/[id]         Single location stock view
/inventory/purchase-orders        PO list
/inventory/purchase-orders/new    Create PO
/inventory/purchase-orders/[id]   PO detail + receive flow
/inventory/transfers              Transfer list
/inventory/transfers/new          Create transfer
/inventory/transfers/[id]         Transfer detail + receive flow
/inventory/adjustments            Stocktake / correction list
/inventory/adjustments/new        New adjustment
/inventory/adjustments/[id]       Adjustment detail + apply flow
/inventory/history                Ledger / audit trail
```

---

## 1. Overview Dashboard `/inventory`

### Summary bar (4 stat cards)
- **SKUs Tracked** — count of products with track_inventory
- **Total On Hand** — sum across all locations (units)
- **In Transit** — units currently moving between/into locations
- **Low Stock Alerts** — count from `v_low_stock`

### Main table — `v_inventory_summary`
Columns: Product | SKU | On Hand | Reserved | **Available ▼** | In Transit | On Order | Total Owned

- Click a product row → expands inline showing the by_location breakdown
- Click a location chip → navigates to `/inventory/locations/[id]`
- Row turns amber if `total_available <= low_stock_threshold`
- Row turns red if `total_available <= 0`

### Filters (top bar)
- Location (multi-select)
- Status: All / Low Stock / Out of Stock / In Transit
- Category / Brand
- Search (SKU, title)

### Quick actions (top right)
`+ New PO` | `+ Transfer` | `+ Adjustment`

---

## 2. Locations `/inventory/locations`

### Card grid (or table)
Each card: Location name + code + type badge + total SKUs on hand + action menu (Edit, View Stock, Deactivate)

### Location types with icons
`warehouse` 🏭 | `store` 🏪 | `in_transit` 🚚 | `fba` 📦 | `3pl` 🏗 | `damaged` ⚠️ | `returns` ↩️

### Add Location slide-over
Fields: Name, Code, Type, Address (collapsible), Set as Default, Notes

### Location detail `/inventory/locations/[id]`
- Header: location name, type badge, address
- Stock table filtered to this location (same columns as overview)
- Quick adjustment button for this location
- Active transfers in/out

---

## 3. Purchase Orders `/inventory/purchase-orders`

### List table
Columns: PO # | Supplier | Status | Destination | Lines | Expected Arrival | Total Value | Actions

Status badge colours:
- `draft` — grey
- `submitted` — blue
- `confirmed` — indigo  ← on_order quantities live
- `in_transit` — amber  ← in_transit quantities live
- `partially_received` — orange
- `received` — green
- `cancelled` — red

### Create PO `/inventory/purchase-orders/new`
1. Header form: Supplier name, Supplier ref, Destination location, Currency, Notes
2. Lines table: search/add product/variant, enter ordered qty, unit cost, case qty
3. Save as Draft → Submit to Supplier

### PO Detail `/inventory/purchase-orders/[id]`

**Status bar** (horizontal stepper):
`Draft → Submitted → Confirmed → In Transit → Received`

**Action buttons change based on status:**

| Status | Primary Action | Secondary |
|---|---|---|
| draft | Submit to Supplier | Edit |
| submitted | Mark as Confirmed | Edit, Cancel |
| confirmed | **Mark as Shipped** | Edit, Cancel |
| in_transit | **Receive Goods** | Cancel |
| partially_received | **Receive More** | — |
| received | — | Duplicate |
| cancelled | — | Duplicate |

---

### Key User Flow: Receiving a Shipment Notice (ASN)

**When supplier sends tracking info → user clicks "Mark as Shipped":**

1. Slide-over opens with fields:
   - Carrier (select: DHL, FedEx, Sea Freight, Air Freight, Other)
   - Tracking Number (text)
   - Shipping Method (sea_freight / air_freight / road / courier / express)
   - Expected Arrival (date picker)
   - Internal notes

2. User clicks **Confirm — Mark as In Transit**

3. System calls `mark_po_in_transit()` RPC which:
   - `on_order ↓` for each remaining line
   - `in_transit ↑` for each remaining line
   - PO status → `in_transit`
   - Writes ledger entries

4. UI feedback:
   - Toast: "PO #1042 is now in transit — 3 SKUs tracking to Warehouse Sydney"
   - Status stepper advances to **In Transit**
   - The inventory overview now shows those units under "In Transit"
   - Tracking number becomes a clickable link to carrier tracking

---

### Key User Flow: Receiving Goods

**User clicks "Receive Goods":**

1. Full-page receive form (or large modal for small POs):
   - Table of lines: Product | Ordered | Previously Received | **Receive Now** (editable int) | Remaining
   - "Receive Now" pre-fills with `ordered - received` (full receipt)
   - User can reduce qty for partial receipt
   - Notes field

2. User clicks **Confirm Receipt**

3. System calls `receive_purchase_order()` RPC:
   - `in_transit ↓` per line
   - `on_hand ↑` per line
   - Writes ledger entries
   - PO status → `received` or `partially_received`

4. UI feedback:
   - Toast: "Received 45 units across 3 SKUs at Warehouse Sydney"
   - If partially received: banner on PO "12 units still outstanding — receive remainder"

---

## 4. Transfers `/inventory/transfers`

### List table
Columns: Transfer # | From → To | Status | SKUs | Expected Arrival | Actions

### Create Transfer
1. Select From location, To location (can't be same)
2. Add lines: search product/variant, enter qty
3. Save → status = `draft`
4. Click **Ship** → slide-over for carrier/tracking → status = `in_transit`

### Transfer Receive Flow
Same pattern as PO receive. Calls equivalent RPCs that move `in_transit ↓` and `on_hand ↑` at destination.

---

## 5. Adjustments `/inventory/adjustments`

### Types
| Type | Use case |
|---|---|
| `stocktake` | Full or partial physical count. System qty shown alongside counted qty. |
| `correction` | Fix a known data error |
| `damage` | Write off damaged goods |
| `theft` | Shrinkage write-off |
| `expiry` | Expired / obsolete stock |
| `found` | Discovered unrecorded stock |

### Stocktake Flow
1. Select location, click **New Stocktake**
2. Table loads with all products at that location pre-filled with current `on_hand` as `system_qty`
3. User enters `counted_qty` for each line (or leaves blank to skip)
4. Differences highlighted: green (surplus), red (deficit)
5. Review & Approve → status = `pending` → admin approves → status = `approved`
6. Apply → calls RPC, adjusts `on_hand` per diff, writes ledger entries with `movement_type = 'adjustment'`

### Quick Adjustment
For single-item corrections: product search → enter new qty or delta → reason → apply immediately.

---

## 6. Reservations (inline — not a separate page)

Accessible from the product detail page's Inventory tab and from the overview table.

### Reserve Stock slide-over
Fields:
- Location
- Quantity
- Reason type (order / channel / manual / safety stock)
- Reason label (e.g. "Shopify Order #1042")
- Expires at (optional)

### Reserve column in overview
Shows total reserved with a breakdown tooltip:
```
Reserved: 12
  • 8 — Shopify Order #1042
  • 4 — Safety Stock Buffer
```
Click → manage reservations modal

---

## 7. Ledger / History `/inventory/history`

### Filters
- Product (search)
- Location
- Movement type
- Date range

### Table
Date/Time | Product | Location | Movement | Quantity Change | After | Reference | User

Colour coding: green rows = positive delta, red = negative.
Click reference → navigate to PO/transfer/adjustment.

---

## Component Breakdown

```
components/inventory/
  InventoryOverviewTable.vue      — main product × location grid
  InventoryStatCards.vue          — 4 summary cards
  LocationCard.vue
  LocationForm.vue                — create/edit slide-over
  PurchaseOrderList.vue
  PurchaseOrderForm.vue           — create/edit
  PurchaseOrderDetail.vue
  MarkAsShippedModal.vue          — ASN form
  ReceiveGoodsForm.vue            — receipt entry table
  TransferForm.vue
  TransferDetail.vue
  AdjustmentForm.vue
  StocktakeForm.vue
  ReservationManager.vue
  InventoryLedgerTable.vue
  QuantityBadge.vue               — coloured badge: on_hand / reserved / available
  StockBreakdownTooltip.vue       — per-location breakdown on hover
  LowStockBanner.vue
```

---

## Data Flow Summary

```
Supplier confirms PO
  └─ confirm_purchase_order()  →  on_order ↑  (ledger: po_confirmed)

Supplier ships / ASN received
  └─ mark_po_in_transit()      →  on_order ↓  in_transit ↑  (ledger: po_shipped)
                                  PO status = in_transit
                                  Tracking # stored on PO

Goods arrive at warehouse
  └─ receive_purchase_order()  →  in_transit ↓  on_hand ↑  (ledger: po_received)
                                  PO status = received / partially_received

Order placed (from integration or manual)
  └─ create reservation        →  reserved ↑  (ledger: reservation)
  └─ available = on_hand - reserved  ↓

Order fulfilled / shipped
  └─ release reservation       →  reserved ↓  on_hand ↓  (ledger: unreservation + sale)

Physical count differs from system
  └─ apply adjustment          →  on_hand ± delta  (ledger: adjustment)
```
