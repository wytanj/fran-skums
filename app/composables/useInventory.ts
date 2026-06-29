export interface InventoryLocation {
  id: string
  workspace_id: string
  name: string
  code: string
  location_type: 'warehouse' | 'store' | 'in_transit' | 'supplier' | 'fba' | '3pl' | 'damaged' | 'returns' | 'virtual'
  address: Record<string, string>
  is_active: boolean
  is_default: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InventorySummaryRow {
  product_id: string
  variant_id: string | null
  product_title: string
  product_sku: string | null
  total_on_hand: number
  total_reserved: number
  total_available: number
  total_on_order: number
  total_in_transit: number
  total_owned: number
  by_location: Array<{
    location_id: string
    location_name: string
    location_code: string
    location_type: string
    on_hand: number
    reserved: number
    available: number
    in_transit: number
    on_order: number
  }>
}

export interface PurchaseOrder {
  id: string
  workspace_id: string
  po_number: string
  supplier_name: string
  supplier_ref: string | null
  status: 'draft' | 'submitted' | 'confirmed' | 'in_transit' | 'partially_received' | 'received' | 'cancelled'
  destination_location_id: string
  destination_name: string
  destination_code: string
  carrier: string | null
  tracking_number: string | null
  shipping_method: string | null
  shipped_at: string | null
  expected_arrival: string | null
  currency: string
  notes: string | null
  created_at: string
  updated_at: string
  line_count: number
  total_ordered: number
  total_received: number
  total_remaining: number
  lines?: PurchaseOrderLine[]
}

export interface PurchaseOrderLine {
  id: string
  po_id: string
  product_id: string
  variant_id: string | null
  product_title?: string
  product_sku?: string
  ordered_qty: number
  received_qty: number
  unit_cost: number | null
  case_qty: number
  notes: string | null
}

export interface InventoryTransfer {
  id: string
  workspace_id: string
  transfer_number: string
  from_location_id: string
  to_location_id: string
  from_location_name?: string
  to_location_name?: string
  status: 'draft' | 'in_transit' | 'partially_received' | 'received' | 'cancelled'
  carrier: string | null
  tracking_number: string | null
  expected_arrival: string | null
  created_at: string
  updated_at: string
  lines?: TransferLine[]
}

export interface TransferLine {
  id: string
  transfer_id: string
  product_id: string
  variant_id: string | null
  product_title?: string
  product_sku?: string
  requested_qty: number
  shipped_qty: number
  received_qty: number
}

export function useInventory() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()

  const locations = ref<InventoryLocation[]>([])
  const stockSummary = ref<InventorySummaryRow[]>([])
  const purchaseOrders = ref<PurchaseOrder[]>([])
  const transfers = ref<InventoryTransfer[]>([])
  const loading = ref(false)

  function wsId() { return currentWorkspace.value?.id }

  // ── Locations ──────────────────────────────────────────────

  async function loadLocations() {
    if (!wsId()) return
    const { data, error } = await client
      .from('inventory_locations')
      .select('*')
      .eq('workspace_id', wsId()!)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('name')
    if (!error) locations.value = (data || []) as InventoryLocation[]
    return { error }
  }

  async function createLocation(payload: Partial<InventoryLocation>) {
    const { data, error } = await client
      .from('inventory_locations')
      .insert({ ...payload, workspace_id: wsId()! })
      .select()
      .single()
    if (!error && data) locations.value.push(data as InventoryLocation)
    return { data, error }
  }

  async function updateLocation(id: string, payload: Partial<InventoryLocation>) {
    const { data, error } = await client
      .from('inventory_locations')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (!error && data) {
      const idx = locations.value.findIndex(l => l.id === id)
      if (idx >= 0) locations.value[idx] = data as InventoryLocation
    }
    return { data, error }
  }

  async function seedDefaultLocations() {
    if (!wsId()) return
    const { error } = await client.rpc('seed_workspace_inventory_locations', {
      p_workspace_id: wsId()!,
    })
    if (!error) await loadLocations()
    return { error }
  }

  // ── Stock summary ──────────────────────────────────────────

  async function loadStockSummary() {
    if (!wsId()) return
    loading.value = true
    const { data, error } = await client
      .from('v_inventory_summary')
      .select('*')
      .eq('workspace_id', wsId()!)
      .order('product_title')
    loading.value = false
    if (!error) stockSummary.value = (data || []) as InventorySummaryRow[]
    return { error }
  }

  // ── Purchase Orders ────────────────────────────────────────

  async function loadPurchaseOrders() {
    if (!wsId()) return
    const { data, error } = await client
      .from('v_purchase_orders')
      .select('*')
      .eq('workspace_id', wsId()!)
      .order('created_at', { ascending: false })
    if (!error) purchaseOrders.value = (data || []) as PurchaseOrder[]
    return { error }
  }

  async function loadPoLines(poId: string): Promise<PurchaseOrderLine[]> {
    const { data } = await client
      .from('purchase_order_lines')
      .select(`
        *,
        product:products(title, sku)
      `)
      .eq('po_id', poId)
      .order('sort_order')
    return (data || []).map((l: any) => ({
      ...l,
      product_title: l.product?.title,
      product_sku: l.product?.sku,
    })) as PurchaseOrderLine[]
  }

  async function createPurchaseOrder(
    po: Partial<PurchaseOrder>,
    lines: Array<{ product_id: string; variant_id?: string; ordered_qty: number; unit_cost?: number; case_qty?: number }>
  ) {
    // Generate PO number
    const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`
    const { data: poData, error: poError } = await client
      .from('purchase_orders')
      .insert({
        workspace_id: wsId()!,
        po_number: poNumber,
        supplier_name: po.supplier_name,
        supplier_ref: po.supplier_ref || null,
        destination_location_id: po.destination_location_id,
        currency: po.currency || 'USD',
        notes: po.notes || null,
        status: 'draft',
      })
      .select()
      .single()
    if (poError) return { data: null, error: poError }

    const lineRows = lines.map((l, i) => ({
      po_id: poData.id,
      product_id: l.product_id,
      variant_id: l.variant_id || null,
      ordered_qty: l.ordered_qty,
      unit_cost: l.unit_cost || null,
      case_qty: l.case_qty || 1,
      sort_order: i,
    }))

    const { error: linesError } = await client.from('purchase_order_lines').insert(lineRows)
    if (linesError) return { data: null, error: linesError }

    await loadPurchaseOrders()
    return { data: poData, error: null }
  }

  async function confirmPo(poId: string) {
    const user = await client.auth.getUser()
    const { data, error } = await client.rpc('confirm_purchase_order', {
      p_po_id: poId,
      p_created_by: user.data.user?.id || null,
    })
    if (!error) await loadPurchaseOrders()
    return { data, error }
  }

  async function markPoInTransit(poId: string, details: {
    carrier?: string
    tracking_number?: string
    shipping_method?: string
    expected_arrival?: string
  }) {
    const user = await client.auth.getUser()
    const { data, error } = await client.rpc('mark_po_in_transit', {
      p_po_id: poId,
      p_carrier: details.carrier || null,
      p_tracking_number: details.tracking_number || null,
      p_shipping_method: details.shipping_method || null,
      p_expected_arrival: details.expected_arrival || null,
      p_created_by: user.data.user?.id || null,
    })
    if (!error) {
      await loadPurchaseOrders()
      await loadStockSummary()
    }
    return { data, error }
  }

  async function receiveGoods(poId: string, receipts: Array<{ line_id: string; qty: number }>) {
    const user = await client.auth.getUser()
    const { data, error } = await client.rpc('receive_purchase_order', {
      p_po_id: poId,
      p_receipts: receipts,
      p_created_by: user.data.user?.id || null,
    })
    if (!error) {
      await loadPurchaseOrders()
      await loadStockSummary()
    }
    return { data, error }
  }

  async function cancelPo(poId: string) {
    const { error } = await client
      .from('purchase_orders')
      .update({ status: 'cancelled' })
      .eq('id', poId)
    if (!error) await loadPurchaseOrders()
    return { error }
  }

  // ── Transfers ──────────────────────────────────────────────

  async function loadTransfers() {
    if (!wsId()) return
    const { data, error } = await client
      .from('inventory_transfers')
      .select(`
        *,
        from_loc:inventory_locations!from_location_id(name, code),
        to_loc:inventory_locations!to_location_id(name, code)
      `)
      .eq('workspace_id', wsId()!)
      .order('created_at', { ascending: false })
    if (!error) {
      transfers.value = (data || []).map((t: any) => ({
        ...t,
        from_location_name: t.from_loc?.name,
        to_location_name: t.to_loc?.name,
      })) as InventoryTransfer[]
    }
    return { error }
  }

  async function createTransfer(
    transfer: { from_location_id: string; to_location_id: string; expected_arrival?: string; notes?: string },
    lines: Array<{ product_id: string; variant_id?: string; requested_qty: number }>
  ) {
    const transferNumber = `TR-${Date.now().toString(36).toUpperCase()}`
    const { data: trData, error: trError } = await client
      .from('inventory_transfers')
      .insert({
        workspace_id: wsId()!,
        transfer_number: transferNumber,
        from_location_id: transfer.from_location_id,
        to_location_id: transfer.to_location_id,
        expected_arrival: transfer.expected_arrival || null,
        status: 'draft',
      })
      .select()
      .single()
    if (trError) return { data: null, error: trError }

    const lineRows = lines.map((l, i) => ({
      transfer_id: trData.id,
      product_id: l.product_id,
      variant_id: l.variant_id || null,
      requested_qty: l.requested_qty,
      sort_order: i,
    }))
    const { error: linesError } = await client.from('inventory_transfer_lines').insert(lineRows)
    if (linesError) return { data: null, error: linesError }

    await loadTransfers()
    return { data: trData, error: null }
  }

  // ── Helpers ────────────────────────────────────────────────

  function locationTypeBadge(type: InventoryLocation['location_type']) {
    const map: Record<string, { label: string; cls: string }> = {
      warehouse:  { label: 'Warehouse',   cls: 'bg-blue-500/10 text-blue-400' },
      store:      { label: 'Store',       cls: 'bg-green-500/10 text-green-400' },
      in_transit: { label: 'In Transit',  cls: 'bg-amber-500/10 text-amber-400' },
      supplier:   { label: 'Supplier',    cls: 'bg-purple-500/10 text-purple-400' },
      fba:        { label: 'Amazon FBA',  cls: 'bg-orange-500/10 text-orange-400' },
      '3pl':      { label: '3PL',         cls: 'bg-cyan-500/10 text-cyan-400' },
      damaged:    { label: 'Damaged',     cls: 'bg-red-500/10 text-red-400' },
      returns:    { label: 'Returns',     cls: 'bg-yellow-500/10 text-yellow-400' },
      virtual:    { label: 'Virtual',     cls: 'bg-gray-500/10 text-gray-400' },
    }
    return map[type] ?? { label: type, cls: 'bg-gray-500/10 text-gray-400' }
  }

  function poStatusBadge(status: PurchaseOrder['status']) {
    const map: Record<string, { label: string; cls: string }> = {
      draft:               { label: 'Draft',               cls: 'bg-gray-500/10 text-gray-400' },
      submitted:           { label: 'Submitted',           cls: 'bg-blue-500/10 text-blue-400' },
      confirmed:           { label: 'Confirmed',           cls: 'bg-indigo-500/10 text-indigo-400' },
      in_transit:          { label: 'In Transit',          cls: 'bg-amber-500/10 text-amber-400' },
      partially_received:  { label: 'Partial Receipt',     cls: 'bg-orange-500/10 text-orange-400' },
      received:            { label: 'Received',            cls: 'bg-emerald-500/10 text-emerald-400' },
      cancelled:           { label: 'Cancelled',           cls: 'bg-red-500/10 text-red-400' },
    }
    return map[status] ?? { label: status, cls: 'bg-gray-500/10 text-gray-400' }
  }

  function transferStatusBadge(status: InventoryTransfer['status']) {
    const map: Record<string, { label: string; cls: string }> = {
      draft:               { label: 'Draft',           cls: 'bg-gray-500/10 text-gray-400' },
      in_transit:          { label: 'In Transit',      cls: 'bg-amber-500/10 text-amber-400' },
      partially_received:  { label: 'Partial',         cls: 'bg-orange-500/10 text-orange-400' },
      received:            { label: 'Received',        cls: 'bg-emerald-500/10 text-emerald-400' },
      cancelled:           { label: 'Cancelled',       cls: 'bg-red-500/10 text-red-400' },
    }
    return map[status] ?? { label: status, cls: 'bg-gray-500/10 text-gray-400' }
  }

  return {
    locations,
    stockSummary,
    purchaseOrders,
    transfers,
    loading,
    loadLocations,
    createLocation,
    updateLocation,
    seedDefaultLocations,
    loadStockSummary,
    loadPurchaseOrders,
    loadPoLines,
    createPurchaseOrder,
    confirmPo,
    markPoInTransit,
    receiveGoods,
    cancelPo,
    loadTransfers,
    createTransfer,
    locationTypeBadge,
    poStatusBadge,
    transferStatusBadge,
  }
}
