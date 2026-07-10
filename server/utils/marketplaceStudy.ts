/**
 * Study sessions: open, load evidence from warehouse, brief (Grok or offline), catalog match.
 */

import { buildOfflineStudyBrief } from '../../intelligence/grok/contracts.mjs'
import { grokCatalogMatchRerank, grokStudyBrief } from '../../intelligence/grok/client.mjs'
import { matchCatalogCandidates } from '../../intelligence/match/catalogMatch.mjs'
import { buildExportTable, computeSellerMixMetrics } from '../../marketplace/normalize/metrics.mjs'
import { getServiceClient } from './supabase'

function getXaiKey(): string {
  const config = useRuntimeConfig()
  return config.xaiApiKey || process.env.XAI_API_KEY || ''
}

export async function createStudySession(input: {
  workspace_id: string
  hypothesis: string
  marketplace?: string
  country?: string
  query?: string | null
  opened_by?: string | null
  metadata?: Record<string, unknown>
}) {
  const db = getServiceClient()
  const hypothesis = String(input.hypothesis || '').trim()
  if (!hypothesis) throw new Error('hypothesis is required')

  const row = {
    workspace_id: input.workspace_id,
    status: 'open',
    hypothesis,
    marketplace: input.marketplace || 'shopee',
    country: String(input.country || 'sg').toLowerCase(),
    query: input.query?.trim() || null,
    opened_by: input.opened_by || null,
    metadata: input.metadata || {},
  }

  const { data, error } = await db.from('study_sessions').insert(row).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

export async function getStudySession(workspaceId: string, sessionId: string) {
  const db = getServiceClient()
  const { data: session, error } = await db
    .from('study_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .single()
  if (error || !session) return null

  const { data: artifacts } = await db
    .from('study_artifacts')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })

  return { session, artifacts: artifacts ?? [] }
}

/**
 * Pull latest snapshots for session query and compute metrics + export rows.
 */
export async function loadStudyEvidence(session: Record<string, any>) {
  const db = getServiceClient()
  const query = session.query || session.hypothesis
  const limit = 80

  let q = db
    .from('marketplace_listing_snapshots')
    .select(
      `
      id,
      listing_id,
      crawled_at,
      price,
      original_price,
      currency,
      rating,
      review_count,
      sold_label,
      sold_count_lower_bound,
      rank_position,
      search_query,
      seller_type,
      signals,
      marketplace_listings (
        shop_id,
        item_id,
        title,
        shop_name,
        listing_url,
        seller_type
      )
    `,
    )
    .eq('workspace_id', session.workspace_id)
    .order('crawled_at', { ascending: false })
    .limit(limit)

  if (session.query) {
    q = q.eq('search_query', session.query)
  }

  const { data: snaps, error } = await q
  if (error) throw new Error(error.message)

  // Prefer matching search_query; if empty and query was set, fall back to any recent with title match later
  let rows = snaps ?? []
  if (session.query && rows.length === 0) {
    const { data: anySnaps } = await db
      .from('marketplace_listing_snapshots')
      .select(
        `
        id, listing_id, crawled_at, price, original_price, currency, rating, review_count,
        sold_label, sold_count_lower_bound, rank_position, search_query, seller_type, signals,
        marketplace_listings ( shop_id, item_id, title, shop_name, listing_url, seller_type )
      `,
      )
      .eq('workspace_id', session.workspace_id)
      .order('crawled_at', { ascending: false })
      .limit(limit)
    rows = anySnaps ?? []
  }

  // Dedupe by listing
  const seen = new Set<string>()
  const deduped: any[] = []
  for (const r of rows) {
    if (seen.has(r.listing_id)) continue
    seen.add(r.listing_id)
    deduped.push(r)
  }

  const export_rows = buildExportTable(deduped, {
    marketplace: session.marketplace,
    country: session.country,
    query: session.query || query,
  })

  const metrics = computeSellerMixMetrics(
    export_rows.map((t: any) => ({
      shop_id: t.shop_id,
      item_id: t.item_id,
      title: t.title,
      seller_type: t.seller_type,
      price: t.price,
      sold_count_lower_bound: t.sold_count_lower_bound,
      rank_position: t.rank,
      signals: {
        ships_from_overseas: t.ships_from_overseas,
        preorder: t.preorder,
      },
    })),
    {
      query: session.query || query,
      marketplace: session.marketplace,
      country: session.country,
    },
  )

  return {
    listing_count: export_rows.length,
    export_rows: export_rows.slice(0, 40),
    metrics,
    evidence_refs: [
      ...(export_rows.slice(0, 10).map((r: any, i: number) => `export:row:${i}`)),
      'metrics:seller_mix',
      'metrics:price',
      'metrics:reseller_pressure',
    ],
  }
}

export async function runStudyBrief(sessionId: string, workspaceId: string, opts: { force_offline?: boolean } = {}) {
  const db = getServiceClient()
  const pack = await getStudySession(workspaceId, sessionId)
  if (!pack) throw new Error('Study session not found')

  const evidence = await loadStudyEvidence(pack.session)
  const apiKey = getXaiKey()
  let model = 'offline'
  let grounded
  let usage = null

  if (apiKey && !opts.force_offline) {
    try {
      const result = await grokStudyBrief({
        apiKey,
        hypothesis: pack.session.hypothesis,
        query: pack.session.query,
        evidence: {
          listing_count: evidence.listing_count,
          metrics: evidence.metrics,
          export_rows: evidence.export_rows.slice(0, 15),
        },
      })
      grounded = result.grounded
      model = result.model
      usage = result.usage
    } catch (err: any) {
      grounded = buildOfflineStudyBrief({
        hypothesis: pack.session.hypothesis,
        query: pack.session.query,
        evidence,
      })
      grounded.unknowns = [
        ...(grounded.unknowns || []),
        `Grok unavailable: ${err?.message?.slice(0, 200) || 'error'} — offline brief used`,
      ]
      model = 'offline-fallback'
    }
  } else {
    grounded = buildOfflineStudyBrief({
      hypothesis: pack.session.hypothesis,
      query: pack.session.query,
      evidence,
    })
  }

  // Persist serp_table artifact if we have rows
  if (evidence.export_rows.length) {
    await db.from('study_artifacts').insert({
      workspace_id: workspaceId,
      session_id: sessionId,
      artifact_type: 'serp_table',
      title: `SERP export (${evidence.listing_count})`,
      payload: { rows: evidence.export_rows, metrics: evidence.metrics },
      evidence_refs: evidence.evidence_refs,
      grok_model: null,
    })
  }

  const { data: artifact, error } = await db
    .from('study_artifacts')
    .insert({
      workspace_id: workspaceId,
      session_id: sessionId,
      artifact_type: 'brief',
      title: `Study brief: ${pack.session.hypothesis}`.slice(0, 200),
      payload: { grounded, usage, evidence_summary: {
        listing_count: evidence.listing_count,
        metrics: evidence.metrics,
      } },
      evidence_refs: evidence.evidence_refs,
      grok_model: model,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  await db
    .from('study_sessions')
    .update({ status: 'briefed' })
    .eq('id', sessionId)

  return { artifact, grounded, model, evidence }
}

export async function runStudyMatchCatalog(
  sessionId: string,
  workspaceId: string,
  opts: { force_offline?: boolean; product_limit?: number } = {},
) {
  const db = getServiceClient()
  const pack = await getStudySession(workspaceId, sessionId)
  if (!pack) throw new Error('Study session not found')

  const evidence = await loadStudyEvidence(pack.session)
  const listing_titles = evidence.export_rows.map((r: any) => r.title).filter(Boolean)

  const { data: products, error: pErr } = await db
    .from('products')
    .select('id, title, sku, retail_price, brands(name)')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(opts.product_limit ?? 200)

  if (pErr) throw new Error(pErr.message)

  const productRows = (products || []).map((p: any) => ({
    id: p.id,
    title: p.title,
    sku: p.sku,
    retail_price: p.retail_price,
    brand_name: p.brands?.name || null,
  }))

  const rule_matches = matchCatalogCandidates({
    query: pack.session.query || pack.session.hypothesis,
    listing_titles,
    products: productRows,
    limit: 15,
  })

  let model = 'rule-based'
  let grounded: any = {
    claims: rule_matches.slice(0, 3).map((m: any) => ({
      text: `Candidate ${m.title} (confidence ${m.confidence}) via ${m.match_type}`,
      evidence_ref: `match:${m.product_id}`,
    })),
    unknowns: rule_matches.length ? [] : ['No catalog products overlapped with study query/titles'],
    recommendation: {
      action: rule_matches.length ? (rule_matches[0].confidence >= 0.35 ? 'link' : 'create_draft') : 'create_draft',
      confidence: rule_matches[0]?.confidence ?? 0.2,
    },
    match_candidates: rule_matches,
    numbers_from_model_only: false,
  }

  const apiKey = getXaiKey()
  if (apiKey && !opts.force_offline && rule_matches.length) {
    try {
      const result = await grokCatalogMatchRerank({
        apiKey,
        query: pack.session.query || pack.session.hypothesis,
        rule_matches,
        listing_titles: listing_titles.slice(0, 10),
      })
      model = result.model
      grounded = {
        ...result.grounded,
        match_candidates:
          result.grounded.match_candidates?.length
            ? result.grounded.match_candidates
            : rule_matches,
      }
    } catch {
      model = 'rule-based-fallback'
    }
  }

  const { data: artifact, error } = await db
    .from('study_artifacts')
    .insert({
      workspace_id: workspaceId,
      session_id: sessionId,
      artifact_type: 'match',
      title: 'Catalog match candidates',
      payload: { grounded, rule_matches },
      evidence_refs: rule_matches.map((m: any) => `match:${m.product_id}`),
      grok_model: model,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  return { artifact, grounded, model, rule_matches }
}
