/**
 * Grounded Grok output validation — numbers must come from tools/DB, not free invent.
 */

/**
 * @param {unknown} raw
 * @returns {{
 *   claims: Array<{ text: string, evidence_ref: string }>
 *   unknowns: string[]
 *   recommendation: { action: string, confidence: number }
 *   numbers_from_model_only: false
 *   narrative?: string
 *   risks?: string[]
 *   pipeline_suggestion?: { kinds: string[], rationale: string } | null
 *   match_candidates?: Array<Record<string, unknown>>
 *   raw?: unknown
 * }}
 */
export function normalizeGroundedGrokResult(raw) {
  const obj = raw && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {}

  const claims = Array.isArray(obj.claims)
    ? obj.claims
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          text: String(c.text || '').slice(0, 2000),
          evidence_ref: String(c.evidence_ref || 'unknown'),
        }))
        .filter((c) => c.text)
    : []

  const unknowns = Array.isArray(obj.unknowns)
    ? obj.unknowns.map((u) => String(u).slice(0, 500)).filter(Boolean)
    : []

  const rec = obj.recommendation && typeof obj.recommendation === 'object' ? obj.recommendation : {}
  const confidence = Number(rec.confidence)
  const recommendation = {
    action: String(rec.action || 'unknown').slice(0, 120),
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
  }

  /** @type {any} */
  const out = {
    claims,
    unknowns,
    recommendation,
    numbers_from_model_only: false,
  }

  if (typeof obj.narrative === 'string') out.narrative = obj.narrative.slice(0, 8000)
  if (Array.isArray(obj.risks)) {
    out.risks = obj.risks.map((r) => String(r).slice(0, 500)).filter(Boolean)
  }

  if (obj.pipeline_suggestion && typeof obj.pipeline_suggestion === 'object') {
    const kinds = Array.isArray(obj.pipeline_suggestion.kinds)
      ? obj.pipeline_suggestion.kinds.map(String)
      : []
    out.pipeline_suggestion = {
      kinds,
      rationale: String(obj.pipeline_suggestion.rationale || '').slice(0, 2000),
    }
  } else {
    out.pipeline_suggestion = null
  }

  if (Array.isArray(obj.match_candidates)) {
    out.match_candidates = obj.match_candidates.slice(0, 20)
  }

  return out
}

/**
 * Parse model text into JSON object (handles fenced code / prose wrappers).
 * @param {string} text
 */
export function parseJsonFromModelText(text) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* continue */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    try {
      return JSON.parse(fence[1].trim())
    } catch {
      /* continue */
    }
  }
  const brace = trimmed.match(/\{[\s\S]*\}/)
  if (brace) {
    try {
      return JSON.parse(brace[0])
    } catch {
      return null
    }
  }
  return null
}

/**
 * Reject claims that invent numeric market stats without evidence_ref prefix.
 * Soft check: if claim text has prices/sold counts but evidence_ref is missing/unknown, move to unknowns.
 * @param {ReturnType<typeof normalizeGroundedGrokResult>} result
 */
export function enforceEvidenceOnNumericClaims(result) {
  const numericHint = /(\$|S\$|SGD|RM|₱|sold|k\+|%|rank\s*#?\d)/i
  const claims = []
  const unknowns = [...(result.unknowns || [])]

  for (const c of result.claims || []) {
    if (numericHint.test(c.text) && (!c.evidence_ref || c.evidence_ref === 'unknown')) {
      unknowns.push(`Unverified numeric claim removed: ${c.text.slice(0, 200)}`)
      continue
    }
    claims.push(c)
  }

  return {
    ...result,
    claims,
    unknowns,
    numbers_from_model_only: false,
  }
}

/**
 * Deterministic offline brief when Grok is unavailable (still grounded on evidence).
 * @param {{
 *   hypothesis: string
 *   query?: string | null
 *   evidence: {
 *     export_rows?: any[]
 *     metrics?: any
 *     listing_count?: number
 *   }
 * }} input
 */
export function buildOfflineStudyBrief(input) {
  const metrics = input.evidence?.metrics || null
  const rows = input.evidence?.export_rows || []
  const listingCount = input.evidence?.listing_count ?? rows.length
  const claims = []

  if (metrics?.seller_mix) {
    claims.push({
      text: `Official/Mall share about ${metrics.seller_mix.official_store_share_pct}% of ${listingCount} listings in the latest pull.`,
      evidence_ref: 'metrics:seller_mix',
    })
    claims.push({
      text: `Trusted seller share (mall/preferred/official) ${metrics.seller_mix.trusted_share_pct}%.`,
      evidence_ref: 'metrics:seller_mix',
    })
  }
  if (metrics?.price) {
    claims.push({
      text: `Price band min ${metrics.price.min} / p50 ${metrics.price.p50} / max ${metrics.price.max} (from snapshots).`,
      evidence_ref: 'metrics:price',
    })
  }
  if (metrics?.reseller_pressure) {
    claims.push({
      text: `${metrics.reseller_pressure.undercut_count} listings undercut Mall/official p50.`,
      evidence_ref: 'metrics:reseller_pressure',
    })
  }
  if (!claims.length) {
    claims.push({
      text: `Study opened for "${input.hypothesis}" with ${listingCount} listing rows available.`,
      evidence_ref: listingCount ? 'export:rows' : 'study:session',
    })
  }

  const unknowns = []
  if (!listingCount) unknowns.push('No marketplace snapshots yet — run a collect job for this query.')
  if (!metrics) unknowns.push('No metrics summary computed for this query.')

  const officialShare = metrics?.seller_mix?.official_store_share_pct ?? 0
  const undercut = metrics?.reseller_pressure?.undercut_count ?? 0
  let action = 'watch'
  let confidence = 0.45
  if (listingCount >= 3 && officialShare >= 20) {
    action = 'pipeline'
    confidence = 0.55
  }
  if (listingCount === 0) {
    action = 'skip'
    confidence = 0.3
  }

  return enforceEvidenceOnNumericClaims(
    normalizeGroundedGrokResult({
      claims,
      unknowns,
      recommendation: { action, confidence },
      narrative: `Offline study brief for "${input.hypothesis}" (query: ${input.query || 'n/a'}). Grok API not used — metrics derived from warehouse only.`,
      risks:
        undercut > 0
          ? ['Reseller undercutting present — verify brand authorization and grey-import risk.']
          : [],
      pipeline_suggestion: {
        kinds: action === 'pipeline' ? ['watchlist_seed', 'catalog_product'] : action === 'watch' ? ['watchlist_seed'] : [],
        rationale:
          action === 'pipeline'
            ? 'Enough SERP coverage and official presence to watch and draft catalog.'
            : action === 'watch'
              ? 'Limited signal — start with watchlist only.'
              : 'Insufficient marketplace data.',
      },
      numbers_from_model_only: false,
    }),
  )
}
