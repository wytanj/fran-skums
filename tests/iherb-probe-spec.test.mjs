/**
 * iHerb structure probe.
 *
 * The probe's whole job is to be trustworthy about what it did and did not find,
 * because the alternative — a selector guessed from memory — fails silently and
 * reads as "this brand delisted everything".
 *
 * @see marketplace/iherb/probeSpec.mjs
 * @see docs/IHERB_COLLECT_DESIGN.md
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IHERB_PROBE_FIELDS,
  diffProbes,
  probeVerdict,
  rankEvidence,
  summarizeProbe,
} from '../marketplace/iherb/probeSpec.mjs'

function raw(overrides = {}) {
  return {
    url: 'https://sg.iherb.com/c/anua',
    captured_at: '2026-08-04T00:00:00.000Z',
    html_bytes: 412_000,
    structured_payloads: [{ type: 'ld+json', count: 24 }],
    tile_candidates: [
      { selector: '[data-testid="product-card"]', count: 24 },
      { selector: '.product-inner', count: 0 },
    ],
    pagination: { kind: 'rel-next', pages: 2, next_href: '/c/anua?p=2' },
    currency_text: 'S$24.50',
    fields: {
      name: { found: true, via: 'jsonld', sample: 'Anua Heartleaf 77% Soothing Toner' },
      brand: { found: true, via: 'jsonld', sample: 'Anua' },
      price: { found: true, via: 'jsonld', sample: '24.50' },
      currency: { found: true, via: 'jsonld', sample: 'SGD' },
      rating: { found: true, via: 'jsonld', sample: 4.6 },
      review_count: { found: true, via: 'jsonld', sample: 1284 },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Field catalogue
// ---------------------------------------------------------------------------

test('the four fields asked for are all probed', () => {
  const keys = IHERB_PROBE_FIELDS.map((f) => f.key)
  for (const k of ['category_breadcrumb', 'sold_per_month', 'price', 'review_count']) {
    assert.ok(keys.includes(k), `missing probe for ${k}`)
  }
})

test('every field says why it is worth collecting', () => {
  // A field nobody can justify is a field that quietly becomes a column nobody reads.
  for (const f of IHERB_PROBE_FIELDS) {
    assert.ok(f.why && f.why.length > 20, `${f.key} has no rationale`)
  }
})

test('sold_per_month is probed by text as well as selector', () => {
  // iHerb may express it only as prose ("500+ bought in past month"), so a
  // selector-only probe would report absence that is really a miss.
  const spec = IHERB_PROBE_FIELDS.find((f) => f.key === 'sold_per_month')
  assert.ok(spec.textPatterns.length > 0)
  assert.ok(spec.textPatterns.some((p) => /bought/.test(p)))
})

test('evidence is ranked payload > attribute > selector > text', () => {
  assert.ok(rankEvidence('jsonld') < rankEvidence('attribute'))
  assert.ok(rankEvidence('attribute') < rankEvidence('selector'))
  assert.ok(rankEvidence('selector') < rankEvidence('text'))
  assert.ok(rankEvidence('text') < rankEvidence('none'))
  assert.equal(rankEvidence('nonsense'), rankEvidence('none'))
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

test('a field the page did not yield is reported as missing, not omitted', () => {
  // Absence is the result. Dropping unfound fields would make the report look
  // complete and hide that there is no volume axis on this channel.
  const report = summarizeProbe(raw())
  assert.ok(report.missing.includes('sold_per_month'))
  assert.ok(report.missing.includes('category_breadcrumb'))
  const sold = report.fields.find((f) => f.key === 'sold_per_month')
  assert.equal(sold.found, false)
  assert.equal(sold.via, 'none')
  assert.equal(sold.sample, null)
})

test('every catalogued field appears in the report even when unobserved', () => {
  const report = summarizeProbe({ fields: {} })
  assert.equal(report.fields.length, IHERB_PROBE_FIELDS.length)
  assert.equal(report.missing.length, IHERB_PROBE_FIELDS.length)
})

test('the most specific repeating tile wins, and empty candidates are dropped', () => {
  const report = summarizeProbe(raw())
  assert.equal(report.tile_selector, '[data-testid="product-card"]')
  assert.equal(report.tile_count, 24)
  assert.ok(!report.tile_candidates.some((t) => t.count === 0))
})

test('a busier generic selector does not beat a specific one', () => {
  // The real Anua capture: .product-cell-container × 48 is the grid, while
  // .product-inner × 88 matches a wrapper inside each tile plus a second
  // carousel. Picking the busier one would split 48 products into 88 fragments
  // and silently double every aggregate built on top.
  const report = summarizeProbe(
    raw({
      structured_payloads: [{ type: 'ld+json', count: 0 }],
      tile_candidates: [
        { selector: '[data-testid="product-card"]', count: 0 },
        { selector: '.product-cell-container', count: 48 },
        { selector: '.product-inner', count: 88 },
      ],
    }),
  )
  assert.equal(report.tile_selector, '.product-cell-container')
  assert.equal(report.tile_count, 48)
})

test('currency is normalised from the rendered text, not assumed', () => {
  assert.equal(summarizeProbe(raw()).currency, 'SGD')
  assert.equal(summarizeProbe(raw({ currency_text: '$24.50 USD' })).currency, 'USD')
  // Unknown must stay null — guessing SGD here is how USD lands in an SGD column.
  assert.equal(summarizeProbe(raw({ currency_text: '24.50' })).currency, null)
  assert.equal(summarizeProbe(raw({ currency_text: null })).currency, null)
})

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

test('a rich structured payload wins outright', () => {
  const report = summarizeProbe(raw())
  assert.equal(report.verdict.approach, 'structured_payload')
  assert.equal(report.verdict.confidence, 'high')
  assert.match(report.verdict.reason, /survives redesigns/)
})

test('no payload but a repeating tile falls back to DOM selectors', () => {
  const report = summarizeProbe(
    raw({
      structured_payloads: [],
      fields: {
        name: { found: true, via: 'selector', sample: 'Anua Toner' },
        price: { found: true, via: 'selector', sample: 'S$24.50' },
        rating: { found: true, via: 'selector', sample: '4.6' },
        review_count: { found: true, via: 'text', sample: '1,284 reviews' },
      },
    }),
  )
  assert.equal(report.verdict.approach, 'dom_selectors')
  assert.equal(report.verdict.confidence, 'low')
  assert.match(report.verdict.reason, /fixture/)
})

test('a tile that matches once is page chrome, not a grid', () => {
  const report = summarizeProbe(
    raw({
      structured_payloads: [],
      tile_candidates: [{ selector: '.product-inner', count: 1 }],
      fields: { name: { found: true, via: 'selector' }, price: { found: true, via: 'selector' } },
    }),
  )
  assert.equal(report.verdict.approach, 'insufficient')
})

test('an empty capture is called insufficient and names the likely causes', () => {
  const report = summarizeProbe({ structured_payloads: [], tile_candidates: [], fields: {} })
  assert.equal(report.verdict.approach, 'insufficient')
  assert.equal(report.verdict.confidence, 'none')
  // A 403 body is the single most likely thing to be holding, so say so.
  assert.match(report.verdict.reason, /Access Denied|bot wall/i)
})

test('a payload with only one product does not beat the DOM', () => {
  // One ld+json Product is usually the page-level entity, not the grid.
  const verdict = probeVerdict({
    structured_payload: { type: 'ld+json', count: 1 },
    tiles: [{ selector: '[data-testid="product-card"]', count: 24 }],
    fields: IHERB_PROBE_FIELDS.slice(0, 6).map((f) => ({ ...f, found: true, via: 'selector' })),
  })
  assert.equal(verdict.approach, 'dom_selectors')
})

// ---------------------------------------------------------------------------
// Re-probe diffing
// ---------------------------------------------------------------------------

test('a lost field is flagged as a regression', () => {
  const before = summarizeProbe(raw())
  const after = summarizeProbe(
    raw({ fields: { ...raw().fields, review_count: { found: false } } }),
  )
  const d = diffProbes(before, after)
  assert.deepEqual(d.fields_lost, ['review_count'])
  assert.equal(d.regressed, true)
})

test('a tile count collapsing to zero is a regression even if nothing else moved', () => {
  const before = summarizeProbe(raw())
  const after = summarizeProbe(raw({ tile_candidates: [] }))
  const d = diffProbes(before, after)
  assert.equal(d.tile_count_collapsed, true)
  assert.equal(d.regressed, true)
})

test('dropping from a payload to selectors is a regression', () => {
  // Same data, more fragile route — worth a look before the next harvest.
  const before = summarizeProbe(raw())
  const after = summarizeProbe(
    raw({
      structured_payloads: [],
      fields: {
        name: { found: true, via: 'selector' },
        price: { found: true, via: 'selector' },
        rating: { found: true, via: 'selector' },
        review_count: { found: true, via: 'selector' },
        brand: { found: true, via: 'selector' },
        currency: { found: true, via: 'selector' },
      },
    }),
  )
  assert.equal(diffProbes(before, after).approach_changed, true)
  assert.equal(diffProbes(before, after).regressed, true)
})

// ---------------------------------------------------------------------------
// The extension's copy must not drift
// ---------------------------------------------------------------------------

test('the in-page field list matches the shared spec', async () => {
  // MV3 content scripts cannot import the ESM module, so the selector half is
  // mirrored in probeFields.js. Only the observation half is duplicated — but a
  // silently diverged key would mean the probe reports on a field the summariser
  // never renders, or vice versa.
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const src = readFileSync(join(root, 'extensions/skums-iherb-probe/probeFields.js'), 'utf8')

  const inPage = [...src.matchAll(/^\s*key:\s*'([a-z_]+)'/gm)].map((m) => m[1])
  const shared = IHERB_PROBE_FIELDS.map((f) => f.key)
  assert.deepEqual(inPage, shared, 'probeFields.js has drifted from IHERB_PROBE_FIELDS')
})

test('the probe endpoint requires a scope and stores nothing yet', async () => {
  const { readFileSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const src = readFileSync(join(root, 'server/api/v1/marketplace/iherb/probe.post.ts'), 'utf8')

  assert.match(src, /requireScope\(event, 'intel:read'\)/)
  assert.match(src, /summarizeProbe\(raw\)/)
  // No schema before the first probe — that would be guessing at the shape of
  // the data the probe exists to discover.
  assert.ok(!/\.from\('iherb_/.test(src), 'endpoint should not write a table yet')
})

test('gaining a field is not a regression', () => {
  const before = summarizeProbe(raw())
  const after = summarizeProbe(
    raw({ fields: { ...raw().fields, sold_per_month: { found: true, via: 'text', sample: '500+ bought' } } }),
  )
  const d = diffProbes(before, after)
  assert.deepEqual(d.fields_gained, ['sold_per_month'])
  assert.equal(d.fields_lost.length, 0)
  assert.equal(d.regressed, false)
})
