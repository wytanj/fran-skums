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
 * Filter PO lines for clone/preview (exclude brands / skus / title tokens).
 * @param {Array<Record<string, any>>} lines
 * @param {{
 *   exclude_brands?: string[],
 *   exclude_skus?: string[],
 *   exclude_title_contains?: string[],
 * }} filters
 */
export function filterPoLinesForClone(lines, filters = {}) {
  const brands = (filters.exclude_brands || []).map((b) => String(b).toLowerCase().trim()).filter(Boolean)
  const skus = (filters.exclude_skus || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean)
  const titleTokens = (filters.exclude_title_contains || [])
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean)

  const kept = []
  const dropped = []

  for (const line of lines || []) {
    const title = String(line.title || '').toLowerCase()
    const sku = String(line.sku || '').toLowerCase()
    const brandMeta = String(line.metadata?.brand || line.brand || line.brand_name || '').toLowerCase()
    const hay = `${title} ${brandMeta} ${sku}`

    let reason = null
    if (skus.length && sku && skus.includes(sku)) reason = `sku:${line.sku}`
    if (!reason && brands.length) {
      for (const b of brands) {
        if (hay.includes(b) || brandMeta === b) {
          reason = `brand:${b}`
          break
        }
      }
    }
    if (!reason && titleTokens.length) {
      for (const t of titleTokens) {
        if (title.includes(t)) {
          reason = `title:${t}`
          break
        }
      }
    }

    if (reason) dropped.push({ ...line, drop_reason: reason })
    else kept.push(line)
  }

  const keptTotals = recomputePoTotals(kept)
  const droppedTotals = recomputePoTotals(dropped)

  return {
    kept_lines: keptTotals.lines,
    dropped_lines: droppedTotals.lines,
    kept_count: keptTotals.line_count,
    dropped_count: droppedTotals.line_count,
    kept_subtotal: keptTotals.subtotal,
    dropped_subtotal: droppedTotals.subtotal,
    filters: {
      exclude_brands: brands,
      exclude_skus: skus,
      exclude_title_contains: titleTokens,
    },
  }
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
