#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dateSeen, parseCsvObjects } from '../marketplace/poCompetitiveMatch.mjs'
import {
  PO_BRAND_ALIAS_PACK,
  brandKeyForPoBrand,
  listingFromHarvestRow,
  mallHarvestPlan,
  mergeListings,
  shopeePriceRefreshTargets,
} from '../marketplace/poBrandAliasPack.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function parseArgs(argv) {
  const opts = { brands: [], maxPages: 3, dryRun: false, priceRefresh: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--brands') {
      opts.brands = String(argv[++i] || '').split(',').map((part) => part.trim()).filter(Boolean)
    } else if (arg === '--max-pages') opts.maxPages = Number(argv[++i])
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--price-refresh') opts.priceRefresh = true
    else if (arg === '--price-refresh-only') {
      opts.priceRefresh = true
      opts.priceRefreshOnly = true
    }
    else if (arg === '--po') opts.po = argv[++i]
    else if (arg === '--out') opts.out = argv[++i]
    else if (arg === '--resume') opts.resume = argv[++i]
    else if (arg === '--connect') opts.connect = argv[++i]
    else if (arg === '--delay-ms') opts.delayMs = Number(argv[++i])
    else if (arg === '--help') opts.help = true
  }
  return opts
}

function usage() {
  return [
    'Usage: node scripts/po-v2-shopee-mall-harvest.mjs --dry-run [--po <pr1.csv>] [--brands a,b] [--max-pages 3]',
    '       [--price-refresh] [--out <file.json>] [--resume <file.json>] [--connect http://127.0.0.1:9222]',
    'Attaches to Chrome from scripts/start-shopee-chrome-cdp.ps1. Writes local JSON only.',
    'Brands with shop_verified false are skipped. Shop ids are not guessed.',
  ].join('\n')
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sgtDay() {
  return dateSeen(new Date().toISOString())
}

function browserListingPriceEvaluate() {
  const text = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 2000)
  const match = text.match(/(?:S\$|SGD)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i)
  const price = match ? Number(match[1].replace(/,/g, '')) : null
  const title = document.querySelector('meta[property="og:title"]')?.content || document.title || ''
  return {
    price: Number.isFinite(price) ? price : null,
    title: String(title).replace(/\s+/g, ' ').trim(),
    url: location.href,
    bodySnippet: text.slice(0, 400),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const day = sgtDay()
  const outDir = resolve(ROOT, '.local', 'po-v2')
  const outPath = resolve(args.out || resolve(outDir, `shopee-mall-${day}.json`))
  const resumePath = resolve(args.resume || resolve(outDir, 'shopee-mall-resume.json'))
  const resume = readJson(resumePath, { brands: {}, price_refresh: { done: [] } })
  const sheet = args.po ? parseCsvObjects(readFileSync(resolve(args.po), 'utf8')) : []
  const targets = shopeePriceRefreshTargets(sheet)
  const priceRefreshRows = sheet.filter((row) => row.match_source === 'shopee' && !String(row.price_sgd || '').trim()).length
  const maxPages = Math.min(Math.max(Number(args.maxPages) || 3, 1), 15)
  const plan = args.priceRefreshOnly
    ? []
    : mallHarvestPlan(PO_BRAND_ALIAS_PACK, {
      brands: args.brands,
      maxPages,
      resume,
    })
  const fetchCount = plan.reduce((sum, entry) => sum + entry.urls.length, 0)
  const skipped = plan.filter((entry) => entry.skipped === 'unverified_shop').length

  const existing = readJson(outPath, { listings: [] })
  const listings = Array.isArray(existing.listings) ? existing.listings : []

  const body = {
    generated_at: new Date().toISOString(),
    seen_at: day,
    dry_run: args.dryRun,
    read_only: true,
    db_writes: false,
    brands: plan,
    price_refresh_rows: priceRefreshRows,
    price_refresh_targets: targets.length,
    listings,
  }

  function save() {
    mkdirSync(dirname(outPath), { recursive: true })
    mkdirSync(dirname(resumePath), { recursive: true })
    body.listings = mergeListings([body.listings])
    writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`)
    writeFileSync(resumePath, `${JSON.stringify(resume, null, 2)}\n`)
  }

  if (args.dryRun || (fetchCount === 0 && !(args.priceRefresh && targets.length))) {
    body.dry_run = true
    save()
    console.log(
      `brands=${plan.length} fetch_pages=${fetchCount} skipped_unverified=${skipped} price_refresh_rows=${priceRefreshRows} price_refresh_targets=${targets.length} dry_run=true`,
    )
    console.log(outPath)
    return
  }

  const { connectComputerBrowser, withComputerDefaults } = await import('../marketplace/computerHarvest.mjs')
  const { openAndHarvestPage } = await import('../marketplace/mallHarvestWorker.mjs')
  const pace = withComputerDefaults({ delay_ms: args.delayMs })
  const { browser } = await connectComputerBrowser(args.connect || process.env.SHOPEE_CDP_URL || 'http://127.0.0.1:9222')
  try {
    const pages = await browser.pages()
    const page = pages[0] || await browser.newPage()

    for (const entry of plan) {
      for (let index = 0; index < entry.urls.length; index++) {
        const url = entry.urls[index]
        const pageNo = Number(new URL(url).searchParams.get('page') || 0)
        const { harvest, session_health: health } = await openAndHarvestPage(page, url, {
          ...pace,
          label: `${entry.brand_key} p${pageNo}`,
        })
        if (health === 'blocked' || health === 'login_required') {
          save()
          throw new Error(`Shopee ${health} on ${entry.brand_key} page ${pageNo}. Clear it in Chrome and rerun.`)
        }
        const found = (harvest.products || []).map((product) => listingFromHarvestRow({
          brand_key: entry.brand_key,
          title: product.name,
          price: product.price,
          currency: 'SGD',
          seller_type: 'mall',
          shop_id: product.shop_id,
          item_id: product.item_id,
          listing_url: product.listing_url,
          crawled_at: harvest.harvested_at || new Date().toISOString(),
        })).filter(Boolean)
        body.listings = mergeListings([body.listings, found])
        const state = resume.brands[entry.brand_key] || { pages_done: 0, done: false, item_ids: [] }
        const itemIds = [...new Set([...(state.item_ids || []), ...found.map((row) => row.item_id).filter(Boolean)])]
        const pagesDone = Math.max(Number(state.pages_done || 0), pageNo + 1)
        const done = found.length === 0 || pagesDone >= maxPages
        resume.brands[entry.brand_key] = { pages_done: pagesDone, done, item_ids: itemIds }
        save()
        if (found.length === 0) break
        if (pace.delay_ms > 0 && index + 1 < entry.urls.length) {
          const gap = Math.floor(pace.delay_ms * (0.7 + Math.random() * 0.7))
          await new Promise((resolveWait) => setTimeout(resolveWait, gap))
        }
      }
    }

    if (args.priceRefresh) {
      const done = new Set(resume.price_refresh?.done || [])
      for (const target of targets) {
        const key = `${target.shop_id}:${target.item_id}`
        if (done.has(key)) continue
        const { session_health: health } = await openAndHarvestPage(page, target.url, {
          ...pace,
          label: `price ${key}`,
        })
        if (health === 'blocked' || health === 'login_required') {
          save()
          throw new Error(`Shopee ${health} on ${target.url}. Clear it in Chrome and rerun.`)
        }
        const probe = await page.evaluate(browserListingPriceEvaluate)
        const crawledAt = new Date().toISOString()
        body.listings = mergeListings([body.listings, [{
          brand_key: brandKeyForPoBrand(target.brand),
          title: target.product_name,
          price: probe.price,
          price_sgd: probe.price,
          currency: 'SGD',
          seller_type: 'mall',
          shop_id: target.shop_id,
          item_id: target.item_id,
          listing_url: target.url,
          crawled_at: crawledAt,
          price_only: true,
        }]])
        done.add(key)
        resume.price_refresh = { done: [...done] }
        save()
      }
    }
  } finally {
    await browser.disconnect()
  }

  console.log(
    `brands=${plan.length} fetch_pages=${fetchCount} skipped_unverified=${skipped} price_refresh_rows=${priceRefreshRows} price_refresh_targets=${targets.length} listings=${body.listings.length} dry_run=false`,
  )
  console.log(outPath)
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
