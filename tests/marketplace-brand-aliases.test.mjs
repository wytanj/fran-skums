/**
 * Brand title aliases must reach the attribution matcher.
 *
 * buildBrandMatchProfile() has always read `brand.aliases`, but nothing
 * populated it: there is no aliases column, and loadBrandsForShopUsername
 * returned only brand_key / display_name / shop_kind / metadata. So the alias
 * mechanism was dead code and no brand could match a short form of its name.
 *
 * Dear Klairs is the case that exposed it. Its needles come out as "dear klairs"
 * and "dearklairs", while every Shopee title on wishtrend.sg says just
 * "Klairs …" — so correcting that shop to multi-brand mode dropped attribution
 * from 94 listings to 9, because the matcher could no longer fall back to the
 * seed brand and could not match the real one either.
 *
 * @see marketplace/distributorShop.mjs (loadBrandsForShopUsername)
 * @see marketplace/attributeBrandFromTitle.mjs (buildBrandMatchProfile)
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attributeBrandFromTitle,
  buildBrandMatchProfile,
} from '../marketplace/attributeBrandFromTitle.mjs'
import { loadBrandsForShopUsername } from '../marketplace/distributorShop.mjs'

const KLAIRS_TITLE = 'Klairs Supple Preparation Unscented Toner 180ml'
const IMFROM_TITLE = "I'm from Black Rice Toner 150ml Glowy not oily for oily skin"
const HOUSE_TITLE = 'Renewal By Wishtrend Mandelic Acid Gentle Exfoliating Toner 150ml'

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------

test('without an alias, "Dear Klairs" cannot match a title that says only "Klairs"', () => {
  const brand = { brand_key: 'dear-klairs', display_name: 'Dear Klairs' }
  const needles = buildBrandMatchProfile(brand).needles
  assert.ok(!needles.includes('klairs'), 'needles should not contain the bare short form')
  assert.equal(attributeBrandFromTitle(KLAIRS_TITLE, [brand]).brand_key, null)
})

test('with the alias, it matches', () => {
  const brand = { brand_key: 'dear-klairs', display_name: 'Dear Klairs', aliases: ['klairs'] }
  const attr = attributeBrandFromTitle(KLAIRS_TITLE, [brand])
  assert.equal(attr.brand_key, 'dear-klairs')
  assert.equal(attr.method, 'title_match')
})

test('apostrophe variants of "I\'m from" all attribute', () => {
  const brand = {
    brand_key: 'im-from',
    display_name: "I'm from",
    aliases: ["i'm from", 'im from', 'imfrom'],
  }
  for (const title of [
    IMFROM_TITLE,
    'I’m from Brightening Beet Refresh Toner Pad 60 sheets',
    'IM FROM Mugwort Essence 160ml',
    'imfrom Fig Cleansing Balm 100ml',
  ]) {
    assert.equal(attributeBrandFromTitle(title, [brand]).brand_key, 'im-from', title)
  }
})

test('a brand not in the list stays unattributed rather than borrowing one', () => {
  // By Wishtrend is the distributor's own line and is not in the universe. It
  // must come back null — attributing it to a shopmate is how 16,649 sold ended
  // up counted as Dear Klairs.
  const brands = [
    { brand_key: 'dear-klairs', display_name: 'Dear Klairs', aliases: ['klairs'] },
    { brand_key: 'im-from', display_name: "I'm from", aliases: ["i'm from"] },
  ]
  assert.equal(attributeBrandFromTitle(HOUSE_TITLE, brands).brand_key, null)
})

test('a longer needle wins over a shorter one', () => {
  // Guards against "klairs" claiming a title that names a more specific brand.
  const brands = [
    { brand_key: 'dear-klairs', display_name: 'Dear Klairs', aliases: ['klairs'] },
    { brand_key: 'im-from', display_name: "I'm from", aliases: ["i'm from"] },
  ]
  const attr = attributeBrandFromTitle('Dear Klairs Midnight Blue Calming Cream', brands)
  assert.equal(attr.brand_key, 'dear-klairs')
})

// ---------------------------------------------------------------------------
// The loader — the half that was missing
// ---------------------------------------------------------------------------

/** Chainable, thenable stand-in for the supabase builder. */
function fakeDb(rows) {
  function builder() {
    const filters = []
    const api = {
      select: () => api,
      eq: (col, val) => (filters.push((r) => r[col] === val), api),
      in: (col, vals) => (filters.push((r) => vals.includes(r[col])), api),
      limit: () => api,
      then: (res, rej) =>
        Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }).then(res, rej),
    }
    return api
  }
  return { from: builder }
}

const WS = 'ws-1'

test('loadBrandsForShopUsername surfaces metadata.aliases as aliases', async () => {
  const profiles = await loadBrandsForShopUsername(
    fakeDb([
      {
        id: '1',
        workspace_id: WS,
        brand_key: 'dear-klairs',
        display_name: 'Dear Klairs',
        shop_username: 'wishtrend.sg',
        shop_kind: 'multi_brand_distributor',
        enabled: true,
        metadata: { aliases: ['klairs'], distributor_brand_keys: ['dear-klairs', 'im-from'] },
      },
      {
        id: '2',
        workspace_id: WS,
        brand_key: 'im-from',
        display_name: "I'm from",
        shop_username: 'wishtrend.sg',
        shop_kind: 'multi_brand_distributor',
        enabled: true,
        metadata: { aliases: ["i'm from", 'imfrom'] },
      },
    ]),
    WS,
    'wishtrend.sg',
  )

  const klairs = profiles.find((p) => p.brand_key === 'dear-klairs')
  assert.deepEqual(klairs.aliases, ['klairs'])
  const imFrom = profiles.find((p) => p.brand_key === 'im-from')
  assert.deepEqual(imFrom.aliases, ["i'm from", 'imfrom'])
})

test('a brand with no metadata.aliases gets an empty array, not undefined', async () => {
  // buildBrandMatchProfile does `brand.aliases || []`, so undefined is survivable
  // — but an explicit [] keeps the profile shape uniform for callers that inspect it.
  const profiles = await loadBrandsForShopUsername(
    fakeDb([
      {
        id: '1',
        workspace_id: WS,
        brand_key: 'aplb',
        display_name: 'APLB',
        shop_username: 'beautyhaussg',
        shop_kind: 'multi_brand_distributor',
        enabled: true,
        metadata: {},
      },
      {
        id: '2',
        workspace_id: WS,
        brand_key: 'abib',
        display_name: 'Abib',
        shop_username: 'beautyhaussg',
        shop_kind: 'multi_brand_distributor',
        enabled: true,
        metadata: {},
      },
    ]),
    WS,
    'beautyhaussg',
  )
  for (const p of profiles) assert.deepEqual(p.aliases, [], p.brand_key)
})

test('junk in metadata.aliases is filtered rather than becoming a needle', async () => {
  const profiles = await loadBrandsForShopUsername(
    fakeDb([
      {
        id: '1',
        workspace_id: WS,
        brand_key: 'dear-klairs',
        display_name: 'Dear Klairs',
        shop_username: 'wishtrend.sg',
        shop_kind: 'multi_brand_distributor',
        enabled: true,
        metadata: { aliases: ['klairs', '', '   ', null, undefined] },
      },
      {
        id: '2',
        workspace_id: WS,
        brand_key: 'im-from',
        display_name: "I'm from",
        shop_username: 'wishtrend.sg',
        shop_kind: 'multi_brand_distributor',
        enabled: true,
        metadata: {},
      },
    ]),
    WS,
    'wishtrend.sg',
  )
  const klairs = profiles.find((p) => p.brand_key === 'dear-klairs')
  assert.deepEqual(klairs.aliases, ['klairs'])
})

test('end to end: loader output feeds the matcher for all three wishtrend cases', async () => {
  const profiles = await loadBrandsForShopUsername(
    fakeDb([
      {
        id: '1',
        workspace_id: WS,
        brand_key: 'dear-klairs',
        display_name: 'Dear Klairs',
        shop_username: 'wishtrend.sg',
        shop_kind: 'multi_brand_distributor',
        enabled: true,
        metadata: { aliases: ['klairs'] },
      },
      {
        id: '2',
        workspace_id: WS,
        brand_key: 'im-from',
        display_name: "I'm from",
        shop_username: 'wishtrend.sg',
        shop_kind: 'multi_brand_distributor',
        enabled: true,
        metadata: { aliases: ["i'm from", 'im from', 'imfrom'] },
      },
    ]),
    WS,
    'wishtrend.sg',
  )

  assert.equal(attributeBrandFromTitle(KLAIRS_TITLE, profiles).brand_key, 'dear-klairs')
  assert.equal(attributeBrandFromTitle(IMFROM_TITLE, profiles).brand_key, 'im-from')
  assert.equal(attributeBrandFromTitle(HOUSE_TITLE, profiles).brand_key, null)
})
