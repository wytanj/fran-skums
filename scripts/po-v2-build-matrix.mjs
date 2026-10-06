#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listingFromHarvestRow, mergeListings } from '../marketplace/poBrandAliasPack.mjs'
import { parseCsvObjects, renderWideCsv } from '../marketplace/poCompetitiveMatch.mjs'
import { buildWideMatrix } from '../marketplace/poV2Matrix.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function parseArgs(argv) {
  const opts = { xlsx: [], shopee: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--po') opts.po = argv[++i]
    else if (arg === '--out') opts.out = argv[++i]
    else if (arg === '--iherb-refresh') opts.iherbRefresh = argv[++i]
    else if (arg === '--xlsx') opts.xlsx.push(argv[++i])
    else if (arg === '--shopee') opts.shopee.push(argv[++i])
    else if (arg === '--help') opts.help = true
  }
  return opts
}

function usage() {
  return [
    'Usage: node scripts/po-v2-build-matrix.mjs --po <pr1.csv> --out <v2.csv>',
    '       [--iherb-refresh <json>] [--xlsx <workbook>]... [--shopee <harvest.json>]...',
    'Writes the wide CSV and po-competitive-match-v2-stats.json next to it.',
    'iHerb wins when both channels hit. review_note is blank. No database writes.',
  ].join('\n')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function listingsFromXlsx(path) {
  const xlsx = (await import('xlsx')).default
  const book = xlsx.readFile(path)
  const rows = []
  for (const name of book.SheetNames) {
    if (name === '_index') continue
    const sheetRows = xlsx.utils.sheet_to_json(book.Sheets[name], { defval: '' })
    for (const row of sheetRows) {
      const listing = listingFromHarvestRow(row)
      if (listing) rows.push(listing)
    }
  }
  return rows
}

function listingsFromHarvestFile(path) {
  const body = readJson(path)
  const rows = Array.isArray(body) ? body : body.listings || body.rows || []
  return rows.map((row) => listingFromHarvestRow(row)).filter(Boolean)
}

function displayPath(path) {
  const rel = relative(ROOT, resolve(path))
  const text = rel.startsWith('..') ? resolve(path) : rel
  return text.split('\\').join('/')
}

function countSources(rows) {
  const counts = { iherb: 0, shopee: 0, none: 0 }
  for (const row of rows) {
    const source = String(row.match_source || 'none')
    if (source === 'iherb' || source === 'shopee') counts[source] += 1
    else counts.none += 1
  }
  return counts
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.po || !args.out) {
    console.error(usage())
    process.exit(args.help ? 0 : 2)
  }

  const lines = parseCsvObjects(readFileSync(resolve(args.po), 'utf8'))
  let iherbRefreshHits = []
  if (args.iherbRefresh && existsSync(resolve(args.iherbRefresh))) {
    const body = readJson(resolve(args.iherbRefresh))
    iherbRefreshHits = Array.isArray(body) ? body : body.hits || []
  }

  const lists = []
  for (const path of args.xlsx) lists.push(await listingsFromXlsx(resolve(path)))
  for (const path of args.shopee) {
    if (existsSync(resolve(path))) lists.push(listingsFromHarvestFile(resolve(path)))
  }
  const listings = mergeListings(lists)
  const { rows, stats } = buildWideMatrix({ lines, iherbRefreshHits, listings })
  const csv = renderWideCsv(rows)
  const out = resolve(args.out)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, csv)

  const pr1 = countSources(lines)
  const statsBody = {
    ...stats,
    pr1,
    iherb_refresh_hits: iherbRefreshHits.length,
    shopee_listings: listings.length,
    xlsx: args.xlsx.map((path) => displayPath(path)),
    shopee_json: args.shopee.filter((path) => existsSync(resolve(path))).map((path) => displayPath(path)),
    iherb_refresh: args.iherbRefresh && existsSync(resolve(args.iherbRefresh))
      ? displayPath(args.iherbRefresh)
      : null,
    notes: [
      'iHerb prices come from the PR1 sheet until an iherb-refresh file is passed.',
      'Shopee rows are the shared matcher at overlap 0.6 on the workbooks and any harvest json. iHerb still wins when both hit.',
    ],
  }
  const statsPath = resolve(dirname(out), 'po-competitive-match-v2-stats.json')
  writeFileSync(statsPath, `${JSON.stringify(statsBody, null, 2)}\n`)
  console.log(
    `rows=${stats.rows} iherb=${stats.iherb} shopee=${stats.shopee} none=${stats.none} empty_iherb_price=${stats.empty_iherb_price} empty_shopee_price=${stats.empty_shopee_price}`,
  )
  console.log(`pr1 iherb=${pr1.iherb} shopee=${pr1.shopee} none=${pr1.none}`)
  console.log(out)
  console.log(statsPath)
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
