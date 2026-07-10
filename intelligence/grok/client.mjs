/**
 * Minimal xAI Grok chat completions client (Node-friendly).
 */

import {
  enforceEvidenceOnNumericClaims,
  normalizeGroundedGrokResult,
  parseJsonFromModelText,
} from './contracts.mjs'

const XAI_BASE = 'https://api.x.ai/v1'

/**
 * @param {{
 *   apiKey: string
 *   model?: string
 *   system?: string
 *   user: string
 *   temperature?: number
 *   max_tokens?: number
 * }} opts
 */
export async function grokChatJson(opts) {
  if (!opts.apiKey) throw new Error('Grok API key required')

  const model = opts.model || 'grok-3-mini'
  const messages = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push({ role: 'user', content: opts.user })

  const response = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.max_tokens ?? 1200,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`xAI API error ${response.status}: ${text.slice(0, 400)}`)
  }

  const json = await response.json()
  const content = json.choices?.[0]?.message?.content ?? ''
  const parsed = parseJsonFromModelText(content)
  return {
    model,
    content,
    parsed,
    usage: json.usage || null,
  }
}

/**
 * @param {{
 *   apiKey: string
 *   model?: string
 *   hypothesis: string
 *   query?: string | null
 *   evidence: Record<string, unknown>
 * }} input
 */
export async function grokStudyBrief(input) {
  const system = `You are Fran's marketplace study analyst. You ONLY use facts provided in the evidence JSON.
Never invent prices, sold counts, ranks, or seller badges.
Return ONLY valid JSON matching:
{
  "claims": [{"text":"...","evidence_ref":"metrics:price|export:row:0|snapshot:id|..."}],
  "unknowns": ["..."],
  "recommendation": {"action":"watch|pipeline|skip","confidence":0.0},
  "narrative": "...",
  "risks": ["..."],
  "pipeline_suggestion": {"kinds":["watchlist_seed","catalog_product"],"rationale":"..."},
  "numbers_from_model_only": false
}
If a fact is missing, put it in unknowns. evidence_ref must point to keys present in evidence.`

  const user = JSON.stringify(
    {
      hypothesis: input.hypothesis,
      query: input.query || null,
      evidence: input.evidence,
    },
    null,
    2,
  )

  const { model, content, parsed, usage } = await grokChatJson({
    apiKey: input.apiKey,
    model: input.model,
    system,
    user,
    temperature: 0.15,
    max_tokens: 1400,
  })

  const grounded = enforceEvidenceOnNumericClaims(
    normalizeGroundedGrokResult(parsed || { narrative: content, claims: [], unknowns: ['Model returned non-JSON'] }),
  )

  return { model, grounded, usage, raw_content: content }
}

/**
 * @param {{
 *   apiKey: string
 *   model?: string
 *   query?: string | null
 *   rule_matches: any[]
 *   listing_titles: string[]
 * }} input
 */
export async function grokCatalogMatchRerank(input) {
  if (!input.rule_matches?.length) {
    return {
      model: input.model || 'none',
      grounded: normalizeGroundedGrokResult({
        claims: [],
        unknowns: ['No rule-based catalog matches to rerank'],
        recommendation: { action: 'none', confidence: 0 },
        match_candidates: [],
        numbers_from_model_only: false,
      }),
      usage: null,
    }
  }

  const system = `You refine catalog match candidates for Fran SKUMS.
Use only the provided rule_matches and listing titles. Do not invent product ids.
Return ONLY JSON:
{
  "claims": [{"text":"...","evidence_ref":"match:product_id"}],
  "unknowns": [],
  "recommendation": {"action":"link|create_draft|none","confidence":0.0},
  "match_candidates": [{"product_id":"...","confidence":0.0,"reason":"..."}],
  "numbers_from_model_only": false
}
confidence must be 0-1. Only include product_ids from rule_matches.`

  const user = JSON.stringify(
    {
      query: input.query || null,
      listing_titles: input.listing_titles || [],
      rule_matches: input.rule_matches,
    },
    null,
    2,
  )

  const { model, content, parsed, usage } = await grokChatJson({
    apiKey: input.apiKey,
    model: input.model,
    system,
    user,
    temperature: 0.1,
    max_tokens: 900,
  })

  const grounded = enforceEvidenceOnNumericClaims(normalizeGroundedGrokResult(parsed || {}))

  // Keep only product_ids that exist in rule_matches
  const allowed = new Set(input.rule_matches.map((m) => m.product_id))
  if (Array.isArray(grounded.match_candidates)) {
    grounded.match_candidates = grounded.match_candidates.filter((m) => allowed.has(m.product_id))
  }

  return { model, grounded, usage, raw_content: content }
}
