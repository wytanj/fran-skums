import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  cardsFromSearchPayload,
  detectSessionHealth,
  mapApiItemToCard,
  normalizeShopeePrice,
} from '../marketplace/shopee/parseSearch.mjs'
import { parseShopeeItemIds, shopeeSearchUrl } from '../marketplace/shopee/urls.mjs'
import { extractCardsFromHtml } from '../marketplace/collectors/cloudflare-browser-run/adapter.mjs'
import { listCollectAdapterIds } from '../marketplace/collectors/registry.mjs'
import { upsertObservationCards } from '../marketplace/writers/upsertObservations.mjs'

const collectUtil = readFileSync(new URL('../server/utils/marketplaceCollect.ts', import.meta.url), 'utf8')
const processRoute = readFileSync(
  new URL('../server/api/internal/marketplace/process-jobs.post.ts', import.meta.url),
  'utf8',
)
const snapshotsRoute = readFileSync(
  new URL('../server/api/v1/marketplace/snapshots.get.ts', import.meta.url),
  'utf8',
)
const majorUpdate = readFileSync(new URL('../Major Update.md', import.meta.url), 'utf8')
const marketplaceReadme = readFileSync(new URL('../marketplace/README.md', import.meta.url), 'utf8')

test('phase 1 registers shopee and cloudflare collectors', () => {
  const ids = listCollectAdapterIds()
  assert.ok(ids.includes('mock'))
  assert.ok(ids.includes('shopee_puppeteer'))
  assert.ok(ids.includes('cloudflare_browser_run'))
  assert.ok(ids.includes('browserbase'))
})

test('shopee URLs and item id parsing', () => {
  assert.equal(
    shopeeSearchUrl('anua official', 'sg', 1),
    'https://shopee.sg/search?keyword=anua%20official&page=1',
  )
  assert.deepEqual(parseShopeeItemIds('https://shopee.sg/foo-i.123.456'), {
    shop_id: '123',
    item_id: '456',
  })
  assert.deepEqual(parseShopeeItemIds('/product/99/88'), { shop_id: '99', item_id: '88' })
})

test('normalizeShopeePrice divides micro-units', () => {
  assert.equal(normalizeShopeePrice(1890000), 18.9)
  assert.equal(normalizeShopeePrice(24.5), 24.5)
})

test('cardsFromSearchPayload maps mall / preferred / overseas fixtures', async () => {
  const raw = await readFile(
    new URL('../marketplace/shopee/fixtures/search-items-sample.json', import.meta.url),
    'utf8',
  )
  const payload = JSON.parse(raw)
  const cards = cardsFromSearchPayload(payload, { query: 'anua official', country: 'sg' })
  assert.equal(cards.length, 3)
  assert.equal(cards[0].seller_type, 'mall')
  assert.ok(cards[0].price != null && cards[0].price < 100)
  assert.ok(cards[0].sold_count_lower_bound >= 5000)
  assert.ok(['preferred', 'preferred_plus', 'official_brand', 'normal'].includes(cards[1].seller_type))
  assert.equal(cards[2].signals?.ships_from_overseas, true)
  assert.equal(cards[2].signals?.preorder, true)
})

test('mapApiItemToCard requires shop and item ids', () => {
  assert.equal(mapApiItemToCard({ name: 'x' }, { rank: 1 }), null)
})

test('detectSessionHealth flags login and captcha', () => {
  assert.equal(detectSessionHealth({ url: 'https://shopee.sg/buyer/login' }), 'login_required')
  assert.equal(
    detectSessionHealth({ bodyText: 'Please verify you are human with captcha' }),
    'blocked',
  )
  assert.equal(detectSessionHealth({ title: 'anua - Shopee', bodyText: 'results' }), 'ok')
})

test('cloudflare HTML extractor finds -i.shop.item links', () => {
  const html = `
    <a href="/ANUA-Toner-i.111.222">x</a>
    <div>S$19.90 · 1.2k sold · Mall</div>
    <a href="https://shopee.sg/Other-i.333.444">y</a>
  `
  const rows = extractCardsFromHtml(html)
  assert.ok(rows.length >= 2)
  assert.ok(rows.some((r) => String(r.href).includes('111.222')))
})

test('upsertObservationCards writes shops listings snapshots via client mock', async () => {
  const shops = []
  const listings = []
  const snapshots = []

  const db = {
    from(table) {
      return {
        upsert(row) {
          if (table === 'marketplace_shops') {
            const id = `shop-${row.shop_id}`
            shops.push({ ...row, id })
            return {
              select() {
                return {
                  single: async () => ({ data: { id }, error: null }),
                }
              },
            }
          }
          if (table === 'marketplace_listings') {
            const id = `list-${row.shop_id}-${row.item_id}`
            listings.push({ ...row, id })
            return {
              select() {
                return {
                  single: async () => ({ data: { id }, error: null }),
                }
              },
            }
          }
          return {
            select() {
              return { single: async () => ({ data: null, error: { message: 'unexpected' } }) }
            },
          }
        },
        insert(row) {
          if (table === 'marketplace_listing_snapshots') {
            snapshots.push(row)
            return Promise.resolve({ error: null })
          }
          return Promise.resolve({ error: { message: 'unexpected insert' } })
        },
      }
    },
  }

  const result = await upsertObservationCards(db, {
    workspace_id: 'ws-1',
    marketplace: 'shopee',
    country: 'sg',
    crawl_job_id: 'job-1',
    cards: [
      {
        shop_id: '1',
        item_id: '2',
        title: 'Test',
        listing_url: 'https://shopee.sg/x-i.1.2',
        seller_type: 'mall',
        price: 10,
        currency: 'SGD',
        rank_position: 1,
        search_query: 'anua official',
        raw: {},
      },
    ],
  })

  assert.equal(result.listings_upserted, 1)
  assert.equal(result.snapshots_inserted, 1)
  assert.equal(shops.length, 1)
  assert.equal(listings[0].title, 'Test')
  assert.equal(snapshots[0].crawl_job_id, 'job-1')
  assert.equal(snapshots[0].price, 10)
})

test('process-jobs and collect runner are wired for phase 1', () => {
  assert.match(collectUtil, /processMarketplaceJobs/)
  assert.match(collectUtil, /shopee_puppeteer/)
  assert.match(collectUtil, /cloudflare_browser_run/)
  assert.match(collectUtil, /browserbase/)
  assert.match(collectUtil, /upsertObservationCards/)
  assert.match(collectUtil, /scrapeShopeeWithPuppeteer/)
  assert.match(processRoute, /processMarketplaceJobs/)
  assert.match(snapshotsRoute, /marketplace_listing_snapshots/)
  assert.match(marketplaceReadme, /shopee_puppeteer|browserbase|Phase 1/)
  assert.match(majorUpdate, /Phase 1/)
})
