import { serverSupabaseUser } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const config = useRuntimeConfig()
  const xaiApiKey = config.xaiApiKey
  if (!xaiApiKey) throw createError({ statusCode: 500, statusMessage: 'xAI API key not configured' })

  const body = await readBody(event)
  const {
    product_id,
    product_title,
    product_sku,
    category_name,
    // Per-day sales history array for Croston / ARIMA (optional, last 90 entries)
    daily_sales_history,
    // Pre-computed velocity windows from v_demand_velocity
    velocity_7d,
    velocity_30d,
    velocity_90d,
    days_with_sales,
    total_days_observed,       // total days since first sale (for sparse detection)
    // Category peer velocity (for cold start)
    category_avg_velocity,
    category_peer_count,
    // Inventory
    available_to_sell,
    days_of_stock_remaining,
    lead_time_days,
    // Expiry
    expiry_batches,
    // Event calendar
    upcoming_events,
  } = body

  if (!product_id) throw createError({ statusCode: 400, statusMessage: 'product_id is required' })

  // ── Method selection ──────────────────────────────────────────
  // Sparse = more than 50% of observed days had zero sales
  const zeroDayRatio = days_with_sales > 0 && total_days_observed > 0
    ? 1 - (days_with_sales / total_days_observed)
    : 1

  const isSparse = zeroDayRatio > 0.5
  const isColdStart = days_with_sales < 14

  type Maturity = '<14d' | '14-59d' | '60d+'
  const maturity: Maturity =
    isColdStart ? '<14d' : days_with_sales < 60 ? '14-59d' : '60d+'

  // ── Build method-specific prompt section ─────────────────────
  let methodSection = ''

  if (isColdStart) {
    methodSection = `
FORECASTING METHOD: Bayesian prior from category peers (cold start — only ${days_with_sales} days of data)

Category: ${category_name || 'Unknown'}
Category average velocity: ${category_avg_velocity ?? 'unknown'} units/day (from ${category_peer_count ?? 0} peer products)

INSTRUCTION: Since this product has fewer than 14 days of sales history, base your forecast primarily
on the category peer average velocity. Apply a conservative 20% discount to the peer average to
account for new-product ramp-up. Adjust for any upcoming events in the forecast window.
Set confidence to "low". If no peer data is available, use the product's own velocity but note
high uncertainty.`
  } else if (isSparse) {
    const nonZeroDays = days_with_sales
    const avgQtyPerSaleDay = velocity_90d > 0
      ? Math.round((velocity_90d * 90) / Math.max(nonZeroDays, 1))
      : null

    methodSection = `
FORECASTING METHOD: Croston's method (intermittent/sparse demand — ${Math.round(zeroDayRatio * 100)}% of days had zero sales)

This product has lumpy, intermittent demand — common for premium serums, limited editions, or niche SKUs.
Croston's method separates two components:
  1. DEMAND INTERVAL: Average days between sale events = ${total_days_observed / Math.max(days_with_sales, 1)} days
  2. DEMAND SIZE: Average units sold on a sale day = ${avgQtyPerSaleDay ?? 'unknown'} units

INSTRUCTION: Forecast using Croston's logic:
  - Estimate how many sale events will occur in 30/60/90 days based on the demand interval
  - Multiply by average demand size per event
  - Apply event multipliers only to the windows overlapping with upcoming events
  - Do NOT average demand size across zero-sale days (that's the SMA mistake Croston corrects)
  - Set confidence to "${days_with_sales >= 30 ? 'medium' : 'low'}"`
  } else {
    // Regular demand — EWMA for 14-59d, ARIMA logic for 60d+
    const useArima = maturity === '60d+'
    methodSection = useArima
      ? `
FORECASTING METHOD: ARIMA(2,1,1) with event dummies (${days_with_sales} days of history)

ARIMA configuration for Singapore tropical market:
  - NO seasonal component (no quarterly or monthly seasons in SG)
  - d=1: first-order differencing to remove any slow trend
  - p=2: autoregressive term — yesterday's and 2 days ago predict today
  - q=1: moving average term for shock recovery after spikes

Recent velocity signals:
  - 7-day:  ${velocity_7d} units/day (most recent, highest weight)
  - 30-day: ${velocity_30d} units/day
  - 90-day: ${velocity_90d} units/day (structural baseline)

INSTRUCTION: Use the ARIMA(2,1,1) framework:
  - Base trend from 90d velocity
  - Short-term momentum from ratio of 7d vs 30d (if 7d > 30d, demand is accelerating)
  - Apply event multipliers as additive dummy variables for the overlapping forecast windows
  - Set confidence to "high" if 7d/30d/90d are consistent (within 30% of each other), else "medium"`
      : `
FORECASTING METHOD: EWMA with event multipliers (${days_with_sales} days of history)

Exponentially weighted moving average — recent days weighted more heavily.
  - 7-day velocity:  ${velocity_7d} units/day (weight: 50%)
  - 30-day velocity: ${velocity_30d} units/day (weight: 35%)
  - 90-day velocity: ${velocity_90d} units/day (weight: 15%)

EWMA baseline = (${velocity_7d} × 0.5) + (${velocity_30d} × 0.35) + (${velocity_90d} × 0.15)

INSTRUCTION: Use this EWMA baseline as the daily demand rate. Multiply by 30/60/90 for base forecasts.
Then adjust upward for any days that fall within upcoming event windows using the event multiplier.
Set confidence to "${days_with_sales >= 30 ? 'medium' : 'low'}"`
  }

  // ── Shared context ────────────────────────────────────────────
  const upcomingEventText = upcoming_events?.length
    ? upcoming_events
        .map((e: any) => `• ${e.event_name} (${e.date_from} to ${e.date_to || e.date_from}, ${e.multiplier}× demand)`)
        .join('\n')
    : 'None in next 90 days.'

  const expiryText = expiry_batches?.length
    ? expiry_batches
        .map((b: any) =>
          `• ${b.remaining_qty} units expiring in ${b.days_until_expiry} days (risk: ${b.risk_status})`
        )
        .join('\n')
    : 'No expiry-tracked batches.'

  const prompt = `You are a demand forecasting analyst for a Singapore-based skincare and makeup retailer.
Singapore context: tropical climate, no traditional seasons. Key demand drivers are shopping festivals
(11.11, 12.12, 9.9, CNY, Hari Raya, GSS), payday cycles (last 3 days of month), and K-beauty trends.
SPF products have steady year-round demand. Powder formulas see slightly lower demand in Oct–Jan monsoon.

PRODUCT: ${product_title} (SKU: ${product_sku || 'N/A'}, Category: ${category_name || 'N/A'})
${methodSection}

CURRENT INVENTORY:
- Available to sell: ${available_to_sell} units
- Days of stock remaining at current velocity: ${days_of_stock_remaining ?? 'unknown'}
- Supplier lead time: ${lead_time_days} days

EXPIRY BATCHES:
${expiryText}

UPCOMING SINGAPORE DEMAND EVENTS (next 90 days):
${upcomingEventText}

TASK: Using the forecasting method specified above, output ONLY this JSON (no markdown, no prose):
{
  "forecast_30d": <integer>,
  "forecast_60d": <integer>,
  "forecast_90d": <integer>,
  "confidence": "<high|medium|low>",
  "method_used": "<brief label, e.g. EWMA+events, Croston, ARIMA(2,1,1)+events, Bayesian-cold-start>",
  "recommendation": "<1-2 sentences: actionable stocking or promotional advice>",
  "event_impact": "<how upcoming events affect this specific forecast, or null if none>"
}`

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${xaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-3-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,   // lower = more deterministic math
      max_tokens: 600,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw createError({ statusCode: 502, statusMessage: `xAI API error: ${text}` })
  }

  const json = await response.json()
  const raw = json.choices?.[0]?.message?.content ?? '{}'

  let parsed: any = {}
  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* leave empty */ }
    }
  }

  // Fallback values if xAI returns incomplete JSON
  const baseVelocity = velocity_30d || velocity_90d || category_avg_velocity || 0
  return {
    product_id,
    product_title,
    current_velocity: baseVelocity,
    forecast_30d: parsed.forecast_30d ?? Math.round(baseVelocity * 30),
    forecast_60d: parsed.forecast_60d ?? Math.round(baseVelocity * 60),
    forecast_90d: parsed.forecast_90d ?? Math.round(baseVelocity * 90),
    confidence: parsed.confidence ?? (isColdStart ? 'low' : maturity === '60d+' ? 'medium' : 'low'),
    data_maturity: maturity,
    method_used: parsed.method_used ?? (isColdStart ? 'Bayesian-cold-start' : isSparse ? 'Croston' : maturity === '60d+' ? 'ARIMA(2,1,1)+events' : 'EWMA+events'),
    upcoming_events: upcoming_events ?? [],
    recommendation: parsed.recommendation ?? 'Insufficient sales history for a confident forecast.',
    event_impact: parsed.event_impact ?? null,
    generated_at: new Date().toISOString(),
  }
})
