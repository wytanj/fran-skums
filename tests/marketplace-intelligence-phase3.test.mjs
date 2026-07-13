import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildOfflineStudyBrief,
  enforceEvidenceOnNumericClaims,
  normalizeGroundedGrokResult,
  parseJsonFromModelText,
} from '../intelligence/grok/contracts.mjs'
import { matchCatalogCandidates, tokenOverlap, tokenSet } from '../intelligence/match/catalogMatch.mjs'
import {
  buildCatalogProductPayload,
  buildWatchlistSeedPayload,
  canDecide,
  canExecute,
} from '../intelligence/pipeline/execute.mjs'

const studyUtil = readFileSync(new URL('../server/utils/marketplaceStudy.ts', import.meta.url), 'utf8')
const pipeUtil = readFileSync(new URL('../server/utils/marketplacePipeline.ts', import.meta.url), 'utf8')
const sessionsPost = readFileSync(new URL('../server/api/v1/study/sessions.post.ts', import.meta.url), 'utf8')
const briefPost = readFileSync(
  new URL('../server/api/v1/study/sessions/[id]/brief.post.ts', import.meta.url),
  'utf8',
)
const matchPost = readFileSync(
  new URL('../server/api/v1/study/sessions/[id]/match.post.ts', import.meta.url),
  'utf8',
)
const proposeStudy = readFileSync(
  new URL('../server/api/v1/study/sessions/[id]/propose.post.ts', import.meta.url),
  'utf8',
)
const candidatesPost = readFileSync(
  new URL('../server/api/v1/pipeline/candidates.post.ts', import.meta.url),
  'utf8',
)
const decidePost = readFileSync(
  new URL('../server/api/v1/pipeline/candidates/[id]/decide.post.ts', import.meta.url),
  'utf8',
)
const executePost = readFileSync(
  new URL('../server/api/v1/pipeline/candidates/[id]/execute.post.ts', import.meta.url),
  'utf8',
)
const majorUpdate = readFileSync(new URL('../Major Update.md', import.meta.url), 'utf8')
const intelReadme = readFileSync(new URL('../intelligence/README.md', import.meta.url), 'utf8')

test('grounded contracts normalize and strip unverified numeric claims', () => {
  const parsed = parseJsonFromModelText('```json\n{"claims":[{"text":"hi","evidence_ref":"a"}],"recommendation":{"action":"watch","confidence":0.5},"unknowns":[],"numbers_from_model_only":false}\n```')
  assert.ok(parsed)
  const g = normalizeGroundedGrokResult(parsed)
  assert.equal(g.numbers_from_model_only, false)
  assert.equal(g.recommendation.action, 'watch')

  const cleaned = enforceEvidenceOnNumericClaims(
    normalizeGroundedGrokResult({
      claims: [
        { text: 'Price is S$19.90', evidence_ref: 'unknown' },
        { text: 'Mall share is solid', evidence_ref: 'metrics:seller_mix' },
      ],
      unknowns: [],
      recommendation: { action: 'watch', confidence: 0.4 },
    }),
  )
  assert.equal(cleaned.claims.length, 1)
  assert.ok(cleaned.unknowns.some((u) => /Unverified/.test(u)))
})

test('offline study brief is grounded on metrics evidence', () => {
  const brief = buildOfflineStudyBrief({
    hypothesis: 'Anua Heartleaf toner',
    query: 'anua official',
    evidence: {
      listing_count: 3,
      metrics: {
        seller_mix: {
          official_store_share_pct: 33.3,
          trusted_share_pct: 66.7,
        },
        price: { min: 18, p50: 24, max: 30 },
        reseller_pressure: { undercut_count: 2 },
      },
    },
  })
  assert.ok(brief.claims.length >= 2)
  assert.equal(brief.numbers_from_model_only, false)
  assert.ok(['watch', 'pipeline', 'skip'].includes(brief.recommendation.action))
  assert.ok(brief.pipeline_suggestion)
})

test('catalog match scores overlapping titles', () => {
  assert.ok(tokenOverlap(tokenSet('anua heartleaf toner'), tokenSet('anua toner serum')) > 0.2)
  const matches = matchCatalogCandidates({
    query: 'anua heartleaf toner',
    listing_titles: ['ANUA Heartleaf 77% Soothing Toner Official'],
    products: [
      { id: 'p1', title: 'Anua Heartleaf Toner 250ml', brand_name: 'Anua', sku: 'ANUA-HL-250' },
      { id: 'p2', title: 'Random Sunscreen SPF50', brand_name: 'Other', sku: 'X' },
    ],
  })
  assert.ok(matches.length >= 1)
  assert.equal(matches[0].product_id, 'p1')
  assert.ok(matches[0].confidence > matches[matches.length - 1]?.confidence || matches.length === 1)
})

test('pipeline payload builders and status guards', () => {
  const seed = buildWatchlistSeedPayload({
    id: 'c1',
    title: 'Watch Anua',
    source_study_id: 's1',
    payload: { target: 'anua official', country: 'sg' },
  })
  assert.equal(seed.target, 'anua official')
  assert.equal(seed.mode, 'keyword')

  const product = buildCatalogProductPayload({
    id: 'c2',
    title: 'Anua Heartleaf',
    summary: 'from study',
    evidence_refs: ['metrics:price'],
    payload: { brand_name: 'Anua', retail_price: 25 },
  })
  assert.equal(product.status, 'draft')
  assert.equal(product.brand_name, 'Anua')
  assert.equal(product.product_data.source, 'pipeline_execute')
  assert.equal(product.product_data.pos_enabled, false)
  assert.equal(product.product_data.sellable_in_pos, false)

  // M5: payload cannot force active / POS-on at execute
  const forced = buildCatalogProductPayload({
    id: 'c3',
    title: 'Sneaky Active',
    payload: {
      status: 'active',
      product_data: { pos_enabled: true, sellable_in_pos: true },
    },
  })
  assert.equal(forced.status, 'draft')
  assert.equal(forced.product_data.pos_enabled, false)
  assert.equal(forced.product_data.sellable_in_pos, false)

  assert.equal(canDecide('proposed', 'accepted'), true)
  assert.equal(canDecide('executed', 'accepted'), false)
  assert.equal(canExecute('accepted'), true)
  assert.equal(canExecute('proposed'), false)

  assert.throws(() => buildWatchlistSeedPayload({ payload: {} }), /target/)
})

test('phase 3 routes and services are wired', () => {
  assert.match(studyUtil, /runStudyBrief/)
  assert.match(studyUtil, /runStudyMatchCatalog/)
  assert.match(studyUtil, /buildOfflineStudyBrief|grokStudyBrief/)
  assert.match(pipeUtil, /executeWatchlistSeed|watchlist_seed/)
  assert.match(pipeUtil, /executeCatalogProduct|catalog_product/)
  assert.match(pipeUtil, /proposeFromStudyBrief/)
  assert.match(sessionsPost, /study:write/)
  assert.match(briefPost, /runStudyBrief/)
  assert.match(matchPost, /runStudyMatchCatalog/)
  assert.match(proposeStudy, /pipeline:propose/)
  assert.match(candidatesPost, /proposePipelineCandidate/)
  assert.match(decidePost, /pipeline:decide/)
  assert.match(executePost, /pipeline:execute/)
  assert.match(intelReadme, /Phase 3/)
  assert.match(majorUpdate, /Phase 3/)
})
