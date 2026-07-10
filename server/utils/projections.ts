/**
 * Projection runs: code engine + optional Grok commentary.
 */
import { grokChatJson } from '../../intelligence/grok/client.mjs'
import {
  enforceEvidenceOnNumericClaims,
  normalizeGroundedGrokResult,
} from '../../intelligence/grok/contracts.mjs'
import {
  computeProjection,
  suggestWeeklyUnitsFromSold,
} from '../../intelligence/projection/engine.mjs'
import { getInternalPo } from './internalPo'
import { getServiceClient } from './supabase'

function getXaiKey() {
  const config = useRuntimeConfig()
  return config.xaiApiKey || process.env.XAI_API_KEY || ''
}

async function loadAssumptionDefaults(workspaceId: string) {
  const db = getServiceClient()
  const { data } = await db
    .from('projection_assumption_defaults')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return (
    data || {
      payment_fees_pct: 0.03,
      shipping_per_unit: 0,
      returns_pct: 0.05,
      default_horizon_weeks: 12,
      currency: 'SGD',
    }
  )
}

async function maybeGrokCommentary(input: {
  title: string
  assumptions: Record<string, any>
  results: Record<string, any>
  force_offline?: boolean
}) {
  const apiKey = getXaiKey()
  if (!apiKey || input.force_offline) {
    return {
      model: 'offline',
      grounded: normalizeGroundedGrokResult({
        claims: [
          {
            text: `Contribution range ${input.results.contribution_low}–${input.results.contribution_high} ${input.results.currency} over ${input.results.horizon_weeks} weeks.`,
            evidence_ref: 'results:contribution',
          },
        ],
        unknowns: apiKey ? [] : ['XAI_API_KEY not set — offline commentary only'],
        recommendation: {
          action: (input.results.contribution_high || 0) > 0 ? 'consider_order' : 'review_costs',
          confidence: 0.4,
        },
        narrative:
          'Offline commentary: numbers are from the projection engine only. Review unit cost, fees, and sell-through assumptions before buying.',
        numbers_from_model_only: false,
      }),
    }
  }

  try {
    const system = `You comment on a Fran financial projection. NEVER invent or change numbers.
Only reference fields present in assumptions/results. Return JSON:
{
  "claims": [{"text":"...","evidence_ref":"results:revenue_high|assumptions:unit_cost|..."}],
  "unknowns": [],
  "recommendation": {"action":"consider_order|reduce_qty|skip|watch","confidence":0.0},
  "narrative": "...",
  "numbers_from_model_only": false
}`
    const { model, parsed, usage } = await grokChatJson({
      apiKey,
      model: 'grok-3-mini',
      system,
      user: JSON.stringify({
        title: input.title,
        assumptions: input.assumptions,
        results: input.results,
      }),
      temperature: 0.2,
      max_tokens: 800,
    })
    const grounded = enforceEvidenceOnNumericClaims(
      normalizeGroundedGrokResult(parsed || { unknowns: ['Non-JSON model output'] }),
    )
    return { model, grounded, usage }
  } catch (err: any) {
    return {
      model: 'offline-fallback',
      grounded: normalizeGroundedGrokResult({
        claims: [],
        unknowns: [`Grok failed: ${err?.message?.slice(0, 200)}`],
        recommendation: { action: 'review', confidence: 0.3 },
        narrative: 'Projection numbers are valid; commentary unavailable.',
        numbers_from_model_only: false,
      }),
    }
  }
}

export async function createProjection(input: {
  workspace_id: string
  title: string
  source_type?: string
  assumptions: Record<string, any>
  linked_po_id?: string | null
  linked_study_id?: string | null
  linked_product_id?: string | null
  evidence_refs?: string[]
  force_offline?: boolean
  created_by?: string | null
}) {
  const db = getServiceClient()
  const defaults = await loadAssumptionDefaults(input.workspace_id)
  const a = {
    payment_fees_pct: defaults.payment_fees_pct,
    shipping_per_unit: defaults.shipping_per_unit,
    returns_pct: defaults.returns_pct,
    horizon_weeks: defaults.default_horizon_weeks,
    currency: defaults.currency,
    ...input.assumptions,
  }

  const results = computeProjection({
    unit_cost: a.unit_cost,
    retail_price: a.retail_price,
    units_per_week_low: a.units_per_week_low,
    units_per_week_high: a.units_per_week_high,
    horizon_weeks: a.horizon_weeks,
    payment_fees_pct: a.payment_fees_pct,
    shipping_per_unit: a.shipping_per_unit,
    returns_pct: a.returns_pct,
    quantity_on_order: a.quantity_on_order,
    currency: a.currency,
  })

  const commentary = await maybeGrokCommentary({
    title: input.title,
    assumptions: a,
    results,
    force_offline: input.force_offline,
  })

  const { data, error } = await db
    .from('projection_runs')
    .insert({
      workspace_id: input.workspace_id,
      title: input.title,
      source_type: input.source_type || 'manual',
      status: 'completed',
      horizon_weeks: results.horizon_weeks,
      currency: results.currency,
      assumptions: a,
      results,
      grok_commentary: commentary.grounded,
      evidence_refs: input.evidence_refs || ['results:engine', 'assumptions'],
      linked_po_id: input.linked_po_id || null,
      linked_study_id: input.linked_study_id || null,
      linked_product_id: input.linked_product_id || null,
      model_id: commentary.model,
      created_by: input.created_by || null,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function projectFromPo(
  workspaceId: string,
  poId: string,
  opts: {
    retail_price?: number
    units_per_week_low?: number
    units_per_week_high?: number
    horizon_weeks?: number
    force_offline?: boolean
  } = {},
) {
  const pack = await getInternalPo(workspaceId, poId)
  if (!pack) throw new Error('PO not found')

  const qty = pack.lines.reduce((s, l) => s + Number(l.quantity || 0), 0)
  const costTotal = pack.lines.reduce((s, l) => s + Number(l.line_total || 0), 0)
  const unit_cost = qty > 0 ? costTotal / qty : 0
  const retail_price = opts.retail_price ?? unit_cost * 2

  const weekly =
    opts.units_per_week_high != null
      ? {
          units_per_week_low: opts.units_per_week_low ?? opts.units_per_week_high * 0.5,
          units_per_week_high: opts.units_per_week_high,
        }
      : suggestWeeklyUnitsFromSold([])

  return createProjection({
    workspace_id: workspaceId,
    title: `Projection from ${pack.po.po_number}`,
    source_type: 'internal_po',
    linked_po_id: poId,
    assumptions: {
      unit_cost,
      retail_price,
      units_per_week_low: weekly.units_per_week_low,
      units_per_week_high: weekly.units_per_week_high,
      quantity_on_order: qty,
      horizon_weeks: opts.horizon_weeks,
      currency: pack.po.currency,
      weekly_basis: (weekly as any).basis || 'default',
    },
    evidence_refs: [`po:${poId}`, 'results:engine'],
    force_offline: opts.force_offline,
  })
}

export async function projectFromStudy(
  workspaceId: string,
  studyId: string,
  opts: {
    unit_cost: number
    retail_price?: number
    horizon_weeks?: number
    force_offline?: boolean
  },
) {
  const db = getServiceClient()
  const { data: session } = await db
    .from('study_sessions')
    .select('*')
    .eq('id', studyId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!session) throw new Error('Study session not found')

  // Pull sold bounds from latest export-like snapshots
  let q = db
    .from('marketplace_listing_snapshots')
    .select('sold_count_lower_bound, price, search_query')
    .eq('workspace_id', workspaceId)
    .order('crawled_at', { ascending: false })
    .limit(40)
  if (session.query) q = q.eq('search_query', session.query)
  const { data: snaps } = await q

  const sold = (snaps || [])
    .map((s: any) => Number(s.sold_count_lower_bound))
    .filter((n: number) => Number.isFinite(n))
  const prices = (snaps || [])
    .map((s: any) => Number(s.price))
    .filter((n: number) => Number.isFinite(n) && n > 0)
  const weekly = suggestWeeklyUnitsFromSold(sold)
  const retail =
    opts.retail_price ??
    (prices.length ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)] : opts.unit_cost * 2)

  return createProjection({
    workspace_id: workspaceId,
    title: `Projection from study: ${session.hypothesis}`.slice(0, 200),
    source_type: 'study',
    linked_study_id: studyId,
    assumptions: {
      unit_cost: opts.unit_cost,
      retail_price: retail,
      units_per_week_low: weekly.units_per_week_low,
      units_per_week_high: weekly.units_per_week_high,
      horizon_weeks: opts.horizon_weeks,
      currency: 'SGD',
      weekly_basis: weekly.basis,
      market_price_p50: prices.length
        ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]
        : null,
    },
    evidence_refs: [`study:${studyId}`, 'metrics:sold_proxy', 'results:engine'],
    force_offline: opts.force_offline,
  })
}

export async function getProjection(workspaceId: string, id: string) {
  const db = getServiceClient()
  const { data, error } = await db
    .from('projection_runs')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single()
  if (error || !data) return null
  return data
}

export async function listProjections(
  workspaceId: string,
  filters: { limit?: number; source_type?: string } = {},
) {
  const db = getServiceClient()
  let q = db
    .from('projection_runs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200))
  if (filters.source_type) q = q.eq('source_type', filters.source_type)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export function exportProjection(run: any) {
  const r = run.results || {}
  const a = run.assumptions || {}
  return {
    title: run.title,
    source_type: run.source_type,
    currency: run.currency,
    horizon_weeks: run.horizon_weeks,
    assumptions: a,
    revenue_low: r.revenue_low,
    revenue_high: r.revenue_high,
    contribution_low: r.contribution_low,
    contribution_high: r.contribution_high,
    margin_pct_low: r.margin_pct_low,
    margin_pct_high: r.margin_pct_high,
    cash_tied_stock: r.cash_tied_stock,
    units_total_low: r.units?.total_low,
    units_total_high: r.units?.total_high,
    commentary: run.grok_commentary?.narrative || null,
    recommendation: run.grok_commentary?.recommendation || null,
  }
}
