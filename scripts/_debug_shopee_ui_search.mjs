/**
 * Try homepage → type into search box (less botty than direct /search? URL).
 */
import { readFileSync, existsSync } from 'node:fs'
import puppeteer from 'puppeteer'
import { loadShopeeSessionCookies } from '../marketplace/collectors/shopee-puppeteer/adapter.mjs'

if (existsSync('.env')) {
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
process.env.SHOPEE_SG_SESSION_JSON = readFileSync('sample-cookie.json', 'utf8')
const cookies = loadShopeeSessionCookies('sg')

const browser = await puppeteer.launch({
  headless: false,
  channel: 'chrome',
  args: [
    '--disable-blink-features=AutomationControlled',
    '--window-size=1400,900',
  ],
  defaultViewport: null,
})
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
})
await page.setCookie(...cookies)
await page.goto('https://shopee.sg/', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 2500))
console.log('home', page.url())

const selectors = [
  'input.shopee-searchbar-input__input',
  'input[placeholder*="Search"]',
  'form input[type="text"]',
  'input[type="search"]',
  'header input',
]
let box = null
for (const sel of selectors) {
  box = await page.$(sel)
  if (box) {
    console.log('found box', sel)
    break
  }
}
if (!box) {
  console.log('no search box — dumping input count')
  const n = await page.evaluate(() => document.querySelectorAll('input').length)
  console.log('inputs', n)
  await page.screenshot({ path: 'scripts/_shopee_ui_search.png' })
  await browser.close()
  process.exit(1)
}

await box.click({ clickCount: 3 })
await box.type('anua official', { delay: 90 })
await page.keyboard.press('Enter')
await new Promise((r) => setTimeout(r, 6000))
await page.evaluate(() => window.scrollBy(0, 800))
await new Promise((r) => setTimeout(r, 2000))

const body = await page.evaluate(() => document.body?.innerText?.slice(0, 1000) || '')
const counts = await page.evaluate(() => ({
  items: document.querySelectorAll('[data-sqe="item"]').length,
  links: document.querySelectorAll('a[href*="-i."]').length,
  anySqe: document.querySelectorAll('[data-sqe]').length,
}))
console.log('after_search', { url: page.url(), title: await page.title(), counts })
console.log('body', body.replace(/\s+/g, ' ').slice(0, 450))
await page.screenshot({ path: 'scripts/_shopee_ui_search.png' })
await browser.close()
