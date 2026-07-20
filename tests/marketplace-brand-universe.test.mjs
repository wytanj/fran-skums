import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  brandKeyFromDisplayName,
  brandUniversePriority,
  mergeCategories,
  parseCategories,
  parseSampleBrandsCsv,
  parseYesNoNull,
  PILOT_BRAND_KEYS,
} from '../marketplace/brandKey.mjs'

const core068 = readFileSync(
  new URL('../core/db/068_marketplace_brand_universe.sql', import.meta.url),
  'utf8',
)
const sb068 = readFileSync(
  new URL('../supabase/migrations/202607200068_marketplace_brand_universe.sql', import.meta.url),
  'utf8',
)
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')
const sampleCsv = readFileSync(new URL('../sample-brands.csv', import.meta.url), 'utf8')
const typesMp = readFileSync(
  new URL('../packages/@skums-types/marketplace-intelligence.ts', import.meta.url),
  'utf8',
)

test('068 migration registered and mirrored', () => {
  assert.match(migrationsDoc, /068\s+\|\s+marketplace_brand_universe\.sql/)
  assert.equal(core068, sb068)
  assert.match(core068, /create table if not exists public\.marketplace_brand_universe/)
  assert.match(core068, /pilot_tier in \('pilot', 'mid', 'full', 'paused'\)/)
  assert.match(core068, /unique \(workspace_id, marketplace, country, brand_key\)/)
  assert.match(core068, /primary_seed_id/)
  assert.match(core068, /enable row level security/)
  assert.match(core068, /get_my_writable_workspace_ids/)
})

test('types export MarketplaceBrandUniverse', () => {
  assert.match(typesMp, /MarketplaceBrandUniverse/)
  assert.match(typesMp, /BrandUniversePilotTier/)
  assert.match(typesMp, /brand_key/)
})

test('brand_key golden examples', () => {
  const cases = [
    ['Anua', 'anua'],
    ['House of Hur', 'house-of-hur'],
    ["d'Alba", 'dalba'],
    ["I'm from", 'im-from'],
    ['Su:m37', 'sum37'],
    ['Dr. Reju-All', 'dr-reju-all'],
    ['Cell Fusion C', 'cell-fusion-c'],
    ['COSRX', 'cosrx'],
    ['Glad2Glow', 'glad2glow'],
    ['Beauty of Joseon', 'beauty-of-joseon'],
    ['Dr. Althea', 'dr-althea'],
    ['Haruharu Wonder', 'haruharu-wonder'],
  ]
  for (const [display, key] of cases) {
    assert.equal(brandKeyFromDisplayName(display), key, display)
  }
})

test('parseYesNoNull', () => {
  assert.equal(parseYesNoNull(''), null)
  assert.equal(parseYesNoNull(null), null)
  assert.equal(parseYesNoNull('Yes'), true)
  assert.equal(parseYesNoNull('No'), false)
  assert.equal(parseYesNoNull('  yes '), true)
})

test('parseCategories keeps Hair / Body; splits Glad2Glow style', () => {
  assert.deepEqual(parseCategories('Hair / Body'), ['Hair / Body'])
  assert.deepEqual(parseCategories('Skincare'), ['Skincare'])
  assert.deepEqual(parseCategories('Skincare/ Cosmetics'), ['Skincare', 'Cosmetics'])
  assert.deepEqual(parseCategories('Skincare/Cosmetics'), ['Skincare', 'Cosmetics'])
})

test('brandUniversePriority', () => {
  assert.equal(brandUniversePriority(true, false), 120)
  assert.equal(brandUniversePriority(false, true), 120)
  assert.equal(brandUniversePriority(null, true), 120)
  assert.equal(brandUniversePriority(false, false), 80)
  assert.equal(brandUniversePriority(null, false), 80)
})

test('mergeCategories preserves order unique', () => {
  assert.deepEqual(mergeCategories(['Skincare'], ['Cosmetics', 'Skincare']), [
    'Skincare',
    'Cosmetics',
  ])
})

test('parse sample-brands.csv — unique brands + House of Hur merge', () => {
  const { rows, stats, skipped } = parseSampleBrandsCsv(sampleCsv)
  assert.ok(stats.input_data_rows >= 120, `expected many data rows, got ${stats.input_data_rows}`)
  assert.equal(stats.unique_brands, 125, `expected 125 unique brands, got ${stats.unique_brands}`)
  assert.ok(rows.length === 125)

  const hoh = rows.find((r) => r.brand_key === 'house-of-hur')
  assert.ok(hoh, 'House of Hur present')
  assert.ok(hoh.categories.includes('Skincare'))
  assert.ok(hoh.categories.includes('Cosmetics'))

  const cosrx = rows.find((r) => r.brand_key === 'cosrx')
  assert.ok(cosrx)
  assert.equal(cosrx.official_interest, true)
  assert.equal(cosrx.shopee_mall_interest, true)
  assert.equal(cosrx.followers_note, '205.3K')
  assert.equal(cosrx.priority, 120)

  const skintific = rows.find((r) => r.brand_key === 'skintific')
  assert.ok(skintific)
  assert.equal(skintific.official_interest, null) // blank Official
  assert.equal(skintific.shopee_mall_interest, true)
  assert.equal(skintific.priority, 120)

  const glad = rows.find((r) => r.brand_key === 'glad2glow')
  assert.ok(glad)
  assert.ok(glad.categories.includes('Skincare') || glad.categories.some((c) => /Skincare/i.test(c)))
  // CSV: Skincare/ Cosmetics → dual
  assert.ok(glad.categories.length >= 1)

  const dalba = rows.find((r) => r.brand_key === 'dalba')
  assert.ok(dalba)

  // All pilot keys must exist
  for (const key of PILOT_BRAND_KEYS) {
    assert.ok(
      rows.some((r) => r.brand_key === key),
      `pilot brand missing from CSV parse: ${key}`,
    )
  }

  assert.ok(Array.isArray(skipped))
})

test('re-import produces stable brand_keys', () => {
  const a = parseSampleBrandsCsv(sampleCsv).rows.map((r) => r.brand_key).sort()
  const b = parseSampleBrandsCsv(sampleCsv).rows.map((r) => r.brand_key).sort()
  assert.deepEqual(a, b)
})
