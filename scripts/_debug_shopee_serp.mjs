/**
 * Debug what Puppeteer sees on a Shopee SG keyword SERP.
 * Usage: node scripts/_debug_shopee_serp.mjs
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer'
import { loadShopeeSessionCookies } from '../marketplace/collectors/shopee-puppeteer/adapter.mjs'
import { shopeeSearchUrl } from '../marketplace/shopee/urls.mjs'
import { detectSessionHealth } from '../marketplace/shopee/parseSearch.mjs'

function loadEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    process.env[m[1]] = v
  }
}

loadEnv()
process.env.SHOPEE_SG_SESSION_JSON = readFileSync('sample-cookie.json', 'utf8')
const cookies = loadShopeeSessionCookies('sg')
console.log('cookies loaded', cookies.length)

// Use system Chrome when available — bundled Chromium is often traffic-blocked.
const launchOpts = {
  headless: false,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1920,1080',
  ],
  defaultViewport: { width: 1920, height: 1080 },
  channel: 'chrome',
}
let browser
try {
  browser = await puppeteer.launch(launchOpts)
  console.log('launched channel=chrome headless=false')
} catch (err) {
  console.warn('channel=chrome failed, fallback bundled', err.message)
  delete launchOpts.channel
  browser = await puppeteer.launch(launchOpts)
}
const page = await browser.newPage()
await page.setUserAgent(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
)
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  // @ts-ignore
  window.chrome = { runtime: {} }
})
page.setDefaultNavigationTimeout(60000)

/** @type {any[]} */
const apiHits = []
page.on('response', async (response) => {
  try {
    const u = response.url()
    if (!/search/i.test(u)) return
    if (!/item|search_items|v4\/search|v2\/search|search_filter/i.test(u)) return
    const status = response.status()
    const ct = (response.headers()['content-type'] || '').toLowerCase()
    const json = await response.json().catch(() => null)
    let keys = null
    let itemCount = null
    let pathHint = null
    if (json) {
      keys = Object.keys(json).slice(0, 16)
      const candidates = [
        json?.items,
        json?.data?.items,
        json?.data?.item,
        json?.data?.sections,
        json?.data?.nominal_search_resp,
      ]
      for (const c of candidates) {
        if (Array.isArray(c)) {
          itemCount = c.length
          break
        }
      }
      // deeper item arrays
      try {
        const sections = json?.data?.sections
        if (Array.isArray(sections)) {
          for (const s of sections) {
            const items = s?.data?.item
            if (Array.isArray(items)) {
              itemCount = items.length
              pathHint = 'data.sections[].data.item'
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
    apiHits.push({
      status,
      ct: ct.slice(0, 50),
      url: u.slice(0, 180),
      keys,
      itemCount,
      pathHint,
    })
  } catch {
    /* ignore */
  }
})

await page.setCookie(...cookies)
await page.goto('https://shopee.sg/', { waitUntil: 'domcontentloaded', timeout: 45000 })
await new Promise((r) => setTimeout(r, 1500))
console.log('home', { title: await page.title(), url: page.url() })

const searchUrl = shopeeSearchUrl('anua official', 'sg', 0)
console.log('searchUrl', searchUrl)
try {
  await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 })
} catch {
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
}
await new Promise((r) => setTimeout(r, 3000))
await page.evaluate(() => window.scrollBy(0, 900))
await new Promise((r) => setTimeout(r, 1500))
await page.evaluate(() => window.scrollBy(0, 1200))
await new Promise((r) => setTimeout(r, 1500))

const title = await page.title()
const pageUrl = page.url()
const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2500) || '')
const health = detectSessionHealth({ title, bodyText, url: pageUrl })
const counts = await page.evaluate(() => {
  const allLinks = Array.from(document.querySelectorAll('a[href]'))
    .map((a) => a.getAttribute('href') || '')
    .filter((h) => h.includes('-i.') || h.includes('/product/'))
  return {
    dataSqe: document.querySelectorAll('[data-sqe="item"]').length,
    itemResult: document.querySelectorAll('.shopee-search-item-result__item').length,
    shopResult: document.querySelectorAll('.shop-search-result-view__item').length,
    liSqe: document.querySelectorAll('li[data-sqe="item"]').length,
    anySqe: document.querySelectorAll('[data-sqe]').length,
    productishLinks: allLinks.length,
    sampleLinks: allLinks.slice(0, 5),
    bodyLen: document.body?.innerText?.length || 0,
    rootHtml: document.documentElement?.outerHTML?.length || 0,
  }
})

console.log({ title, pageUrl, health, counts })
console.log('body_preview', bodyText.slice(0, 500).replace(/\s+/g, ' '))
console.log('apiHits', apiHits.length)
for (const h of apiHits.slice(0, 12)) console.log('  hit', h)

await page.screenshot({ path: 'scripts/_shopee_live_debug.png', fullPage: false })
writeFileSync(
  'scripts/_shopee_live_debug.txt',
  JSON.stringify(
    {
      title,
      pageUrl,
      health,
      counts,
      bodyText: bodyText.slice(0, 4000),
      apiHits,
    },
    null,
    2,
  ),
)
console.log('wrote scripts/_shopee_live_debug.png and .txt')
await browser.close()
