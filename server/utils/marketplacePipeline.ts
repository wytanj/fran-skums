/**
 * Pipeline candidates: propose → decide → execute (watchlist + catalog draft).
 */

import {
  buildCatalogProductPayload,
  buildWatchlistSeedPayload,
  canDecide,
  canExecute,
} from '../../intelligence/pipeline/execute.mjs'
import { computeNextRunAt } from '../../marketplace/scheduler.mjs'
import { getServiceClient } from './supabase'

export async function proposePipelineCandidate(input: {
  workspace_id: string
  kind: string
  title: string
  summary?: string | null
  payload?: Record<string, unknown>
  evidence_refs?: string[]
  source_study_id?: string | null
  listing_id?: string | null
  product_id?: string | null
  proposed_by?: string | null
  idempotency_key?: string | null
}) {
  const db = getServiceClient()
  const allowed = [
    'watchlist_seed',
    'catalog_product',
    'purchase_interest',
    'price_model',
    'forecast_input',
    'supplier_research',
    'channel_listing',
  ]
  if (!allowed.includes(input.kind)) {
    throw new Error(`Invalid pipeline kind: ${input.kind}`)
  }

  if (input.idempotency_key) {
    const { data: existing } = await db
      .from('pipeline_candidates')
      .select('*')
      .eq('workspace_id', input.workspace_id)
      .eq('idempotency_key', input.idempotency_key)
      .maybeSingle()
    if (existing) return { candidate: existing, deduped: true }
  }

  const row = {
    workspace_id: input.workspace_id,
    source_study_id: input.source_study_id || null,
    kind: input.kind,
    status: 'proposed',
    title: String(input.title).slice(0, 500),
    summary: input.summary || null,
    payload: input.payload || {},
    evidence_refs: input.evidence_refs || [],
    listing_id: input.listing_id || null,
    product_id: input.product_id || null,
    proposed_by: input.proposed_by || null,
    idempotency_key: input.idempotency_key || null,
  }

  const { data, error } = await db.from('pipeline_candidates').insert(row).select('*').single()
  if (error) throw new Error(error.message)

  if (input.source_study_id) {
    await db
      .from('study_sessions')
      .update({ status: 'proposed' })
      .eq('id', input.source_study_id)
      .eq('workspace_id', input.workspace_id)
  }

  return { candidate: data, deduped: false }
}

export async function listPipelineCandidates(
  workspaceId: string,
  filters: { status?: string; kind?: string; limit?: number } = {},
) {
  const db = getServiceClient()
  let q = db
    .from('pipeline_candidates')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200))

  if (filters.status) q = q.eq('status', filters.status)
  if (filters.kind) q = q.eq('kind', filters.kind)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function decidePipelineCandidate(input: {
  workspace_id: string
  candidate_id: string
  decision: 'accepted' | 'rejected' | 'deferred'
  decision_note?: string | null
  decided_by?: string | null
}) {
  const db = getServiceClient()
  const { data: existing, error } = await db
    .from('pipeline_candidates')
    .select('*')
    .eq('id', input.candidate_id)
    .eq('workspace_id', input.workspace_id)
    .single()

  if (error || !existing) throw new Error('Candidate not found')
  if (!canDecide(existing.status, input.decision)) {
    throw new Error(`Cannot decide from status ${existing.status} to ${input.decision}`)
  }

  const { data, error: upErr } = await db
    .from('pipeline_candidates')
    .update({
      status: input.decision,
      decided_at: new Date().toISOString(),
      decided_by: input.decided_by || null,
      decision_note: input.decision_note || null,
    })
    .eq('id', input.candidate_id)
    .select('*')
    .single()

  if (upErr) throw new Error(upErr.message)
  return data
}

async function executeWatchlistSeed(candidate: Record<string, any>, context: Record<string, any>) {
  const db = getServiceClient()
  const seedBody = buildWatchlistSeedPayload(candidate, context)
  const now = new Date()
  const next = computeNextRunAt(now, {
    schedule_kind: seedBody.schedule_kind,
    preferred_hour: seedBody.preferred_hour,
    weekly_day: seedBody.weekly_day,
  })

  const row = {
    workspace_id: candidate.workspace_id,
    ...seedBody,
    next_run_at: next ? next.toISOString() : null,
  }

  const { data, error } = await db
    .from('marketplace_crawl_seeds')
    .upsert(row, { onConflict: 'workspace_id,marketplace,country,mode,target' })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return { type: 'watchlist_seed', seed: data }
}

async function executeCatalogProduct(candidate: Record<string, any>, context: Record<string, any>) {
  const db = getServiceClient()
  const body = buildCatalogProductPayload(candidate, context)

  let brand_id: string | null = null
  if (body.brand_name) {
    const name = String(body.brand_name).trim()
    const { data: existing } = await db
      .from('brands')
      .select('id')
      .eq('workspace_id', candidate.workspace_id)
      .ilike('name', name)
      .limit(1)
    if (existing?.length) {
      brand_id = existing[0].id
    } else {
      const { data: created } = await db
        .from('brands')
        .insert({ workspace_id: candidate.workspace_id, name })
        .select('id')
        .single()
      brand_id = created?.id || null
    }
  }

  const product: Record<string, any> = {
    workspace_id: candidate.workspace_id,
    title: body.title,
    status: body.status || 'draft',
    description: body.description,
    retail_price: body.retail_price,
    currency: body.currency,
    tags: body.tags,
    product_data: body.product_data,
  }
  if (brand_id) product.brand_id = brand_id

  const { data, error } = await db.from('products').insert(product).select('*').single()
  if (error) throw new Error(error.message)

  return { type: 'catalog_product', product: data }
}

export async function executePipelineCandidate(input: {
  workspace_id: string
  candidate_id: string
}) {
  const db = getServiceClient()
  const { data: candidate, error } = await db
    .from('pipeline_candidates')
    .select('*')
    .eq('id', input.candidate_id)
    .eq('workspace_id', input.workspace_id)
    .single()

  if (error || !candidate) throw new Error('Candidate not found')
  if (!canExecute(candidate.status)) {
    throw new Error(`Candidate must be accepted before execute (status=${candidate.status})`)
  }

  // Load study context if present
  let context: Record<string, any> = {}
  if (candidate.source_study_id) {
    const { data: session } = await db
      .from('study_sessions')
      .select('*')
      .eq('id', candidate.source_study_id)
      .maybeSingle()
    if (session) {
      context = {
        query: session.query || session.hypothesis,
        marketplace: session.marketplace,
        country: session.country,
        hypothesis: session.hypothesis,
      }
    }
  }

  let execution_result: Record<string, any>
  try {
    if (candidate.kind === 'watchlist_seed') {
      execution_result = await executeWatchlistSeed(candidate, context)
    } else if (candidate.kind === 'catalog_product') {
      execution_result = await executeCatalogProduct(candidate, context)
    } else {
      throw new Error(
        `Execute not implemented for kind=${candidate.kind} in Phase 3 (only watchlist_seed, catalog_product)`,
      )
    }
  } catch (err: any) {
    const { data: failed } = await db
      .from('pipeline_candidates')
      .update({
        status: 'failed',
        execution_result: { error: err?.message || String(err) },
        executed_at: new Date().toISOString(),
      })
      .eq('id', candidate.id)
      .select('*')
      .single()
    throw Object.assign(new Error(err?.message || 'execute failed'), { candidate: failed })
  }

  const product_id =
    execution_result.type === 'catalog_product' ? execution_result.product?.id : candidate.product_id

  const { data: updated, error: upErr } = await db
    .from('pipeline_candidates')
    .update({
      status: 'executed',
      executed_at: new Date().toISOString(),
      execution_result,
      product_id: product_id || candidate.product_id,
    })
    .eq('id', candidate.id)
    .select('*')
    .single()

  if (upErr) throw new Error(upErr.message)

  if (candidate.source_study_id) {
    await db
      .from('study_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', candidate.source_study_id)
  }

  return updated
}

/**
 * Helper: from a study brief, propose watchlist + catalog candidates in one shot.
 */
export async function proposeFromStudyBrief(input: {
  workspace_id: string
  study_session_id: string
  kinds?: string[]
}) {
  const db = getServiceClient()
  const { data: session } = await db
    .from('study_sessions')
    .select('*')
    .eq('id', input.study_session_id)
    .eq('workspace_id', input.workspace_id)
    .single()
  if (!session) throw new Error('Study session not found')

  const { data: briefArt } = await db
    .from('study_artifacts')
    .select('*')
    .eq('session_id', session.id)
    .eq('artifact_type', 'brief')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const grounded = briefArt?.payload?.grounded || {}
  const suggested =
    input.kinds ||
    grounded.pipeline_suggestion?.kinds ||
    ['watchlist_seed']

  const created = []
  for (const kind of suggested) {
    if (kind === 'watchlist_seed') {
      const r = await proposePipelineCandidate({
        workspace_id: input.workspace_id,
        kind: 'watchlist_seed',
        title: `Watch: ${session.query || session.hypothesis}`,
        summary: grounded.narrative?.slice(0, 500) || session.hypothesis,
        source_study_id: session.id,
        evidence_refs: briefArt?.evidence_refs || [],
        payload: {
          target: session.query || session.hypothesis,
          marketplace: session.marketplace,
          country: session.country,
          mode: 'keyword',
          schedule_kind: 'daily',
          collector_id: 'mock',
        },
        idempotency_key: `study:${session.id}:watchlist_seed`,
      })
      created.push(r.candidate)
    }
    if (kind === 'catalog_product') {
      const r = await proposePipelineCandidate({
        workspace_id: input.workspace_id,
        kind: 'catalog_product',
        title: String(session.hypothesis).slice(0, 200),
        summary: grounded.narrative?.slice(0, 500) || null,
        source_study_id: session.id,
        evidence_refs: briefArt?.evidence_refs || [],
        payload: {
          title: session.hypothesis,
          marketplace: session.marketplace,
          country: session.country,
          currency: 'SGD',
          status: 'draft',
        },
        idempotency_key: `study:${session.id}:catalog_product`,
      })
      created.push(r.candidate)
    }
  }

  return { candidates: created, session }
}
