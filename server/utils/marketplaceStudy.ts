/**
 * Study sessions: notebook cover + artifacts (notes, brief, match).
 * Opening a session does NOT enqueue Shopee crawls.
 */

import { buildOfflineStudyBrief } from '../../intelligence/grok/contracts.mjs'
import { grokCatalogMatchRerank, grokStudyBrief } from '../../intelligence/grok/client.mjs'
import { matchCatalogCandidates } from '../../intelligence/match/catalogMatch.mjs'
import { buildExportTable, computeSellerMixMetrics } from '../../marketplace/normalize/metrics.mjs'
import { getServiceClient } from './supabase'

const ARTIFACT_TYPES = new Set([
  'serp_table',
  'brief',
  'match',
  'chart_spec',
  'raw_job',
  'export_table',
  'note',
  'other',
])

const SESSION_STATUSES = new Set(['open', 'briefed', 'proposed', 'closed', 'cancelled'])

function getXaiKey(): string {
  const config = useRuntimeConfig()
  return config.xaiApiKey || process.env.XAI_API_KEY || ''
}

export function normalizeNotebookMetadata(
  raw: Record<string, unknown> = {},
  extras: {
    subject_kind?: string
    brand_key?: string
    crawl_intent?: string
    discovery?: unknown
    title?: string
    description?: string | null
  } = {},
): Record<string, unknown> {
  const meta: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}

  const subject =
    extras.subject_kind ||
    meta.subject_kind ||
    (meta.discovery || meta.discovery_url ? 'product' : null)
  if (subject && ['product', 'brand', 'other'].includes(String(subject))) {
    meta.subject_kind = String(subject)
  } else if (!meta.subject_kind) {
    meta.subject_kind = 'product'
  }

  if (extras.brand_key || meta.brand_key) {
    meta.brand_key = String(extras.brand_key || meta.brand_key)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  const crawl = extras.crawl_intent || meta.crawl_intent || 'none'
  meta.crawl_intent = ['none', 'later', 'active'].includes(String(crawl)) ? String(crawl) : 'none'

  if (extras.title != null && String(extras.title).trim()) {
    meta.title = String(extras.title).trim()
  } else if (meta.title != null) {
    meta.title = String(meta.title).trim()
  }
  if (extras.description !== undefined) {
    const d = extras.description != null ? String(extras.description).trim() : ''
    if (d) meta.description = d
    else delete meta.description
  } else if (meta.description != null) {
    const d = String(meta.description).trim()
    if (d) meta.description = d
    else delete meta.description
  }

  if (!Array.isArray(meta.discovery)) meta.discovery = []
  if (extras.discovery) {
    if (Array.isArray(extras.discovery)) {
      meta.discovery = [...(meta.discovery as unknown[]), ...extras.discovery]
    } else if (typeof extras.discovery === 'object') {
      meta.discovery = [...(meta.discovery as unknown[]), extras.discovery]
    }
  }
  if (meta.discovery_url && typeof meta.discovery_url === 'string') {
    const url = meta.discovery_url
    const list = meta.discovery as Array<{ url?: string }>
    if (!list.some((d) => d && d.url === url)) {
      list.push({
        channel: (meta.discovery_channel as string) || 'external',
        url,
        note: (meta.discovery_note as string) || undefined,
      } as any)
    }
  }
  meta.discovery = (meta.discovery as unknown[]).filter((d) => d && typeof d === 'object')

  return meta
}

export function researchDeepLink(sessionId: string) {
  return `/research/${sessionId}`
}

export async function createStudySession(input: {
  workspace_id: string
  /** Product/brand name. Prefer `title`; `hypothesis` kept for API compatibility. */
  hypothesis?: string
  title?: string
  description?: string | null
  marketplace?: string
  country?: string
  query?: string | null
  opened_by?: string | null
  metadata?: Record<string, unknown>
  subject_kind?: string
  brand_key?: string
  crawl_intent?: string
  discovery?: unknown
}) {
  const db = getServiceClient()
  const title = String(input.title || input.hypothesis || '').trim()
  if (!title) throw new Error('title (or hypothesis) is required')

  const metadata = normalizeNotebookMetadata(input.metadata || {}, {
    subject_kind: input.subject_kind,
    brand_key: input.brand_key,
    crawl_intent: input.crawl_intent,
    discovery: input.discovery,
    title,
    description: input.description,
  })
  if (!metadata.title) metadata.title = title

  const row = {
    workspace_id: input.workspace_id,
    status: 'open',
    hypothesis: title,
    marketplace: input.marketplace || 'shopee',
    country: String(input.country || 'sg').toLowerCase(),
    query: input.query != null && String(input.query).trim() ? String(input.query).trim() : null,
    opened_by: input.opened_by || null,
    metadata,
  }

  const { data, error } = await db.from('study_sessions').insert(row).select('*').single()
  if (error) throw new Error(error.message)

  if (Array.isArray(metadata.discovery) && (metadata.discovery as unknown[]).length) {
    try {
      await addStudyArtifact({
        workspace_id: input.workspace_id,
        session_id: data.id,
        artifact_type: 'note',
        title: 'Discovery sources',
        body: (metadata.discovery as Array<{ channel?: string; url?: string; note?: string }>)
          .map((d) => {
            const ch = d.channel ? `[${d.channel}] ` : ''
            const note = d.note ? ` — ${d.note}` : ''
            return `${ch}${d.url || ''}${note}`.trim()
          })
          .filter(Boolean)
          .join('\n'),
        payload: { discovery: metadata.discovery, source: 'study_start' },
        evidence_refs: (metadata.discovery as Array<{ url?: string }>)
          .map((d) => (d.url ? `discovery:${d.url}` : null))
          .filter(Boolean) as string[],
      })
    } catch {
      // non-fatal
    }
  }

  return data
}

export async function addStudyArtifact(input: {
  workspace_id: string
  session_id: string
  artifact_type?: string
  title?: string | null
  body?: string | null
  url?: string | null
  channel?: string | null
  payload?: Record<string, unknown>
  evidence_refs?: string[]
  grok_model?: string | null
  allow_system_types?: boolean
}) {
  const db = getServiceClient()
  const sessionId = String(input.session_id || '').trim()
  if (!sessionId) throw new Error('session_id is required')

  const pack = await getStudySession(input.workspace_id, sessionId)
  if (!pack) throw new Error('Study session not found')

  let artifact_type = String(input.artifact_type || 'note').trim()
  if (!ARTIFACT_TYPES.has(artifact_type)) {
    throw new Error(`Invalid artifact_type: ${artifact_type}`)
  }
  if (['brief', 'match', 'serp_table'].includes(artifact_type) && !input.allow_system_types) {
    throw new Error(`Use study brief / match endpoints for artifact_type=${artifact_type}`)
  }

  const title =
    input.title != null
      ? String(input.title).slice(0, 200)
      : artifact_type === 'note'
        ? 'Note'
        : artifact_type

  const payload: Record<string, unknown> =
    input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? { ...input.payload }
      : {}
  if (input.body != null && String(input.body).trim()) payload.body = String(input.body)
  if (input.url != null && String(input.url).trim()) payload.url = String(input.url).trim()
  if (input.channel != null) payload.channel = String(input.channel)

  const evidence_refs = Array.isArray(input.evidence_refs)
    ? input.evidence_refs.map(String)
    : payload.url
      ? [`discovery:${payload.url}`]
      : []

  const { data, error } = await db
    .from('study_artifacts')
    .insert({
      workspace_id: input.workspace_id,
      session_id: sessionId,
      artifact_type,
      title,
      payload,
      evidence_refs,
      grok_model: input.grok_model || null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateStudySession(input: {
  workspace_id: string
  session_id: string
  hypothesis?: string
  title?: string
  description?: string | null
  query?: string | null
  status?: string
  linked_product_id?: string | null
  metadata?: Record<string, unknown>
  subject_kind?: string
  brand_key?: string
  crawl_intent?: string
  discovery?: unknown
}) {
  const db = getServiceClient()
  const sessionId = String(input.session_id || '').trim()
  if (!sessionId) throw new Error('session_id is required')

  const pack = await getStudySession(input.workspace_id, sessionId)
  if (!pack) throw new Error('Study session not found')

  const patch: Record<string, unknown> = {}
  const nextTitle =
    input.title != null
      ? String(input.title).trim()
      : input.hypothesis != null
        ? String(input.hypothesis).trim()
        : null
  if (nextTitle != null) {
    if (!nextTitle) throw new Error('title cannot be empty')
    patch.hypothesis = nextTitle
  }
  if (input.query !== undefined) {
    patch.query =
      input.query != null && String(input.query).trim() ? String(input.query).trim() : null
  }
  if (input.status != null) {
    const s = String(input.status)
    if (!SESSION_STATUSES.has(s)) throw new Error(`Invalid status: ${s}`)
    patch.status = s
    if (s === 'closed' || s === 'cancelled') {
      patch.closed_at = new Date().toISOString()
    }
  }
  if (input.linked_product_id !== undefined) {
    patch.linked_product_id = input.linked_product_id || null
  }
  if (
    input.metadata != null ||
    input.subject_kind != null ||
    input.brand_key != null ||
    input.crawl_intent != null ||
    input.discovery != null ||
    nextTitle != null ||
    input.description !== undefined
  ) {
    const nextMeta = normalizeNotebookMetadata(
      {
        ...((pack.session.metadata as Record<string, unknown>) || {}),
        ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
      },
      {
        subject_kind: input.subject_kind,
        brand_key: input.brand_key,
        crawl_intent: input.crawl_intent,
        discovery: input.discovery,
        title: nextTitle != null ? nextTitle : undefined,
        description: input.description,
      },
    )
    if (nextTitle != null) nextMeta.title = nextTitle
    patch.metadata = nextMeta
  }

  if (!Object.keys(patch).length) throw new Error('No fields to update')

  const { data, error } = await db
    .from('study_sessions')
    .update(patch)
    .eq('id', sessionId)
    .eq('workspace_id', input.workspace_id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function listStudySessions(
  workspaceId: string,
  filters: { status?: string; limit?: number } = {},
) {
  const db = getServiceClient()
  let q = db
    .from('study_sessions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200))
  if (filters.status) q = q.eq('status', filters.status)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
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

  // M6: token-based pool instead of last-N updated (works on 10k catalogs)
  const { fetchCatalogMatchPool } = await import('../../core/catalog/index.mjs')
  const pool = await fetchCatalogMatchPool(db, {
    workspace_id: workspaceId,
    query: pack.session.query || pack.session.hypothesis,
    listing_titles,
    limit: opts.product_limit ?? 200,
  })
  const productRows = pool.products

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
