/**
 * Pure financial projection engine (no I/O, no Grok).
 */

/**
 * @param {{
 *   unit_cost: number
 *   retail_price: number
 *   units_per_week_low: number
 *   units_per_week_high: number
 *   horizon_weeks: number
 *   payment_fees_pct?: number
 *   shipping_per_unit?: number
 *   returns_pct?: number
 *   quantity_on_order?: number
 *   currency?: string
 * }} input
 */
export function computeProjection(input) {
  const unit_cost = num(input.unit_cost, 0)
  const retail_price = num(input.retail_price, 0)
  const units_low = Math.max(0, num(input.units_per_week_low, 0))
  const units_high = Math.max(units_low, num(input.units_per_week_high, units_low))
  const horizon = Math.max(1, Math.min(104, Math.trunc(num(input.horizon_weeks, 12))))
  const fees = clamp01(num(input.payment_fees_pct, 0.03))
  const shipping = Math.max(0, num(input.shipping_per_unit, 0))
  const returns = clamp01(num(input.returns_pct, 0.05))
  const qtyOrder = Math.max(0, num(input.quantity_on_order, 0))
  const currency = input.currency || 'SGD'

  const units_low_total = units_low * horizon
  const units_high_total = units_high * horizon

  const net_price = retail_price * (1 - fees)
  const variable_cost = unit_cost + shipping
  const contribution_per_unit = net_price * (1 - returns) - variable_cost

  const revenue_low = round2(retail_price * units_low_total)
  const revenue_high = round2(retail_price * units_high_total)
  const cogs_low = round2(unit_cost * units_low_total)
  const cogs_high = round2(unit_cost * units_high_total)
  const shipping_low = round2(shipping * units_low_total)
  const shipping_high = round2(shipping * units_high_total)
  const fees_low = round2(retail_price * fees * units_low_total)
  const fees_high = round2(retail_price * fees * units_high_total)
  const returns_cost_low = round2(retail_price * returns * units_low_total)
  const returns_cost_high = round2(retail_price * returns * units_high_total)

  const contribution_low = round2(contribution_per_unit * units_low_total)
  const contribution_high = round2(contribution_per_unit * units_high_total)

  const margin_pct_low =
    revenue_low > 0 ? round2((contribution_low / revenue_low) * 100) : null
  const margin_pct_high =
    revenue_high > 0 ? round2((contribution_high / revenue_high) * 100) : null

  const cash_tied = round2(unit_cost * (qtyOrder > 0 ? qtyOrder : units_high_total))

  const break_even_units =
    contribution_per_unit > 0 && qtyOrder > 0
      ? Math.ceil((unit_cost * qtyOrder) / contribution_per_unit)
      : null

  return {
    currency,
    horizon_weeks: horizon,
    units: {
      per_week_low: units_low,
      per_week_high: units_high,
      total_low: round2(units_low_total),
      total_high: round2(units_high_total),
      quantity_on_order: qtyOrder || null,
    },
    unit_economics: {
      unit_cost,
      retail_price,
      payment_fees_pct: fees,
      shipping_per_unit: shipping,
      returns_pct: returns,
      net_price_after_fees: round2(net_price),
      contribution_per_unit: round2(contribution_per_unit),
    },
    revenue_low,
    revenue_high,
    cogs_low,
    cogs_high,
    fees_low,
    fees_high,
    shipping_low,
    shipping_high,
    returns_cost_low,
    returns_cost_high,
    contribution_low,
    contribution_high,
    margin_pct_low,
    margin_pct_high,
    cash_tied_stock: cash_tied,
    break_even_units,
  }
}

/**
 * Suggest weekly unit band from sold lower bounds (very rough).
 * @param {number[]} soldLowerBounds
 * @param {{ weeks_implied?: number }} [opts]
 */
export function suggestWeeklyUnitsFromSold(soldLowerBounds, opts = {}) {
  const weeks = opts.weeks_implied || 26
  const vals = (soldLowerBounds || []).filter((n) => Number.isFinite(n) && n >= 0)
  if (!vals.length) {
    return { units_per_week_low: 1, units_per_week_high: 5, basis: 'default_no_sold_signal' }
  }
  vals.sort((a, b) => a - b)
  const mid = vals[Math.floor(vals.length / 2)]
  const top = vals[vals.length - 1]
  const low = Math.max(0.5, round2(mid / weeks / 2))
  const high = Math.max(low, round2(top / weeks))
  return {
    units_per_week_low: low,
    units_per_week_high: high,
    basis: `sold_lower_bound_proxy/${weeks}w`,
  }
}

/**
 * Suggest order qty from weekly high * cover weeks.
 */
export function suggestOrderQty(unitsPerWeekHigh, coverWeeks = 8) {
  const u = Math.max(0, num(unitsPerWeekHigh, 0))
  const w = Math.max(1, num(coverWeeks, 8))
  return Math.max(1, Math.ceil(u * w))
}

function num(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function clamp01(n) {
  return Math.min(1, Math.max(0, n))
}

function round2(n) {
  return Math.round(n * 100) / 100
}
