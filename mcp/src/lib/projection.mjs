/**
 * Projection operations for MCP.
 */
import { grokChatJson } from '../../../intelligence/grok/client.mjs'
import {
  enforceEvidenceOnNumericClaims,
  normalizeGroundedGrokResult,
} from '../../../intelligence/grok/contracts.mjs'
import {
  computeProjection,
  suggestWeeklyUnitsFromSold,
} from '../../../intelligence/projection/engine.mjs'
import { getDb, getXaiApiKey } from '../context.mjs'
import * as po from './po.mjs'

async function loadDefaults(workspaceId) {
  const db = getDb()
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

async function commentary(title, assumptions, results, force_offline) {
  const apiKey = getXaiApiKey()
  if (!apiKey || force_offline) {
    return {
      model: 'offline',
      grounded: normalizeGroundedGrokResult({
        claims: [
          {
            text: `Contribution ${results.contribution_low}–${results.contribution_high} ${results.currency}.`,
            evidence_ref: 'results:contribution',
          },
        ],
        unknowns: apiKey ? [] : ['XAI_API_KEY not set'],
        recommendation: {
          action: (results.contribution_high || 0) > 0 ? 'consider_order' : 'review_costs',
          confidence: 0.4,
        },
        narrative: 'Offline commentary from engine results only.',
        numbers_from_model_only: false,
      }),
    }
  }
  try {
    const { model, parsed } = await grokChatJson({
      apiKey,
      model: 'grok-3-mini',
      system: `Comment on Fran financial projection. Never invent numbers. JSON only:
{"claims":[{"text":"...","evidence_ref":"results:..."}],"unknowns":[],"recommendation":{"action":"...","confidence":0.0},"narrative":"...","numbers_from_model_only":false}`,
      user: JSON.stringify({ title, assumptions, results }),
      temperature: 0.2,
      max_tokens: 800,
    })
    return {
      model,
      grounded: enforceEvidenceOnNumericClaims(
        normalizeGroundedGrokResult(parsed || { unknowns: ['bad json'] }),
      ),
    }
  } catch (err) {
    return {
      model: 'offline-fallback',
      grounded: normalizeGroundedGrokResult({
        claims: [],
        unknowns: [err?.message?.slice(0, 200) || 'grok failed'],
        recommendation: { action: 'review', confidence: 0.3 },
        narrative: 'Numbers valid; commentary unavailable.',
        numbers_from_model_only: false,
      }),
    }
  }
}

export async function create(input) {
  const db = getDb()
  const defaults = await loadDefaults(input.workspace_id)
  const a = {
    payment_fees_pct: defaults.payment_fees_pct,
    shipping_per_unit: defaults.shipping_per_unit,
    returns_pct: defaults.returns_pct,
    horizon_weeks: defaults.default_horizon_weeks,
    currency: defaults.currency,
    ...input.assumptions,
  }
  const results = computeProjection(a)
  const c = await commentary(input.title, a, results, input.force_offline)
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
      grok_commentary: c.grounded,
      evidence_refs: input.evidence_refs || ['results:engine'],
      linked_po_id: input.linked_po_id || null,
      linked_study_id: input.linked_study_id || null,
      linked_product_id: input.linked_product_id || null,
      model_id: c.model,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function fromPo(workspaceId, poId, opts = {}) {
  const pack = await po.getPo(workspaceId, poId)
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
  return create({
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
    },
    evidence_refs: [`po:${poId}`],
    force_offline: opts.force_offline,
  })
}

export async function fromStudy(workspaceId, studyId, opts) {
  const db = getDb()
  const { data: session } = await db
    .from('study_sessions')
    .select('*')
    .eq('id', studyId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!session) throw new Error('Study session not found')

  let q = db
    .from('marketplace_listing_snapshots')
    .select('sold_count_lower_bound, price')
    .eq('workspace_id', workspaceId)
    .order('crawled_at', { ascending: false })
    .limit(40)
  if (session.query) q = q.eq('search_query', session.query)
  const { data: snaps } = await q
  const sold = (snaps || []).map((s) => Number(s.sold_count_lower_bound)).filter(Number.isFinite)
  const prices = (snaps || [])
    .map((s) => Number(s.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
  const weekly = suggestWeeklyUnitsFromSold(sold)
  const retail =
    opts.retail_price ??
    (prices.length ? prices[Math.floor(prices.length / 2)] : opts.unit_cost * 2)

  return create({
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
    },
    evidence_refs: [`study:${studyId}`],
    force_offline: opts.force_offline,
  })
}

export async function get(workspaceId, id) {
  const db = getDb()
  const { data, error } = await db
    .from('projection_runs')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single()
  if (error || !data) return null
  return data
}

export async function list(workspaceId, filters = {}) {
  const db = getDb()
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

export function exportRun(run) {
  const r = run.results || {}
  return {
    title: run.title,
    source_type: run.source_type,
    currency: run.currency,
    horizon_weeks: run.horizon_weeks,
    assumptions: run.assumptions,
    revenue_low: r.revenue_low,
    revenue_high: r.revenue_high,
    contribution_low: r.contribution_low,
    contribution_high: r.contribution_high,
    margin_pct_low: r.margin_pct_low,
    margin_pct_high: r.margin_pct_high,
    cash_tied_stock: r.cash_tied_stock,
    commentary: run.grok_commentary?.narrative || null,
    recommendation: run.grok_commentary?.recommendation || null,
  }
}
