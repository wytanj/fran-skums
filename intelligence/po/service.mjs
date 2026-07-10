/**
 * Internal PO helpers (pure + db-agnostic builders).
 */

/**
 * @param {Array<{ quantity: number, unit_cost: number }>} lines
 */
export function recomputePoTotals(lines) {
  const list = Array.isArray(lines) ? lines : []
  let subtotal = 0
  const withTotals = list.map((l, i) => {
    const quantity = Math.max(0, Number(l.quantity) || 0)
    const unit_cost = Math.max(0, Number(l.unit_cost) || 0)
    const line_total = Math.round(quantity * unit_cost * 100) / 100
    subtotal += line_total
    return {
      ...l,
      line_number: l.line_number ?? i + 1,
      quantity,
      unit_cost,
      line_total,
    }
  })
  return {
    lines: withTotals,
    subtotal: Math.round(subtotal * 100) / 100,
    line_count: withTotals.length,
  }
}

/**
 * Generate a simple PO number.
 */
export function makePoNumber(prefix = 'IPO') {
  const d = new Date()
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${prefix}-${stamp}-${rand}`
}

export function canSubmitPo(status) {
  return status === 'draft'
}

export function canDecidePo(status, decision) {
  if (status !== 'pending_approval') return false
  return decision === 'approved' || decision === 'rejected'
}

/**
 * Flatten PO + lines for export / projection.
 */
export function exportPoPayload(po, lines) {
  const totals = recomputePoTotals(lines)
  return {
    po_number: po.po_number,
    status: po.status,
    supplier_name: po.supplier_name,
    currency: po.currency,
    needed_by: po.needed_by,
    notes: po.notes,
    subtotal: totals.subtotal,
    line_count: totals.line_count,
    lines: totals.lines.map((l) => ({
      title: l.title,
      sku: l.sku,
      quantity: l.quantity,
      unit_cost: l.unit_cost,
      line_total: l.line_total,
      product_id: l.product_id,
      listing_id: l.listing_id,
      shop_id: l.shop_id,
      item_id: l.item_id,
    })),
  }
}
