/**
 * iHerb PDP enrich — top-N catalogue rows get gtin, platform breadcrumb,
 * weight, and product rankings (best-seller #N in category).
 *
 * Economics match Shopee MH-4: catalogue harvest is cheap; one navigation per
 * SKU is not. Prefer products with high sold_lower_bound that lack pdp_enriched_at.
 *
 * @see marketplace/iherb/parseProduct.mjs
 * @see marketplace/iherb/upsertPdp.mjs
 * @see docs/IHERB_HANDOFF.md
 */

import {
  humanPreNavPause,
  humanScrollPage,
  humanIdleMouse,
  jitterMs,
  waitForRecovery,
} from '../computerHarvest.mjs'
import { parseIherbProduct } from './parseProduct.mjs'
import { upsertIherbPdp } from './upsertPdp.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Session health for a product page (not catalogue tiles).
 * @param {{
 *   title?: string
 *   bodyText?: string
 *   url?: string
 *   foundProduct?: boolean
 *   status?: number | null
 * }} probe
 * @returns {'ok' | 'blocked' | 'unknown'}
 */
export function detectIherbPdpHealth(probe = {}) {
  const status = probe.status
  if (status === 403 || status === 429) return 'blocked'

  const title = String(probe.title || '')
  const body = String(probe.bodyText || '')
  const blob = `${title}\n${body}`.toLowerCase()
  const url = String(probe.url || '').toLowerCase()

  // iHerb rarely shows a bespoke press-and-hold (not CF captcha) on long runs.
  if (
    /access denied|request blocked|permission denied|unusual traffic|bot detection|cf-error|just a moment|checking your browser|rate limit|too many requests|recaptcha|captcha|verify you are human|are you a human|press and hold|press\s*&\s*hold|hold (the )?button|hold to continue|security check|bot check/.test(
      blob,
    )
  ) {
    return 'blocked'
  }

  if (probe.foundProduct === true) return 'ok'

  // URL looks like a PDP but parser found nothing — unknown, never false ok (MH-8)
  if (/iherb\.com\/pr\//i.test(url) || /iherb\.com/.test(url)) return 'unknown'

  return 'unknown'
}

/**
 * Load PDP enrich candidates from warehouse (needs prior catalogue harvest).
 *
 * @param {any} db
 * @param {string} workspaceId
 * @param {{
 *   brand_key?: string
 *   brand_keys?: string[]
 *   top?: number
 *   only_missing?: boolean
 *   min_sold?: number
 *   country?: string
 * }} [opts]
 */
export async function loadIherbPdpCandidates(db, workspaceId, opts = {}) {
  // Cap high enough for full-brand catalogues (K-Beauty mono brands are ~1–150 SKUs).
  const top = Math.min(Math.max(opts.top ?? 20, 1), 500)
  const onlyMissing = opts.only_missing !== false
  const country = (opts.country || 'sg').toLowerCase()
  const brandKeys = opts.brand_keys?.length
    ? opts.brand_keys.map((k) => String(k).toLowerCase())
    : opts.brand_key
      ? [String(opts.brand_key).toLowerCase()]
      : null

  // Fetch a window of products, then join latest snaps for sold ranking
  let pq = db
    .from('iherb_products')
    .select(
      'id, part_number, product_id, gtin, name, brand_key, brand_name, url, metadata, last_seen_at',
    )
    .eq('workspace_id', workspaceId)
    .eq('country', country)
    .order('last_seen_at', { ascending: false })

  if (brandKeys?.length === 1) {
    pq = pq.eq('brand_key', brandKeys[0]).limit(Math.max(top * 10, 150))
  } else if (brandKeys?.length > 1) {
    pq = pq.in('brand_key', brandKeys).limit(Math.max(top * 15, 400))
  } else {
    pq = pq.limit(Math.max(top * 20, 500))
  }

  const { data: products, error } = await pq
  if (error) throw new Error(error.message)
  const list = products || []
  if (!list.length) return []

  const ids = list.map((p) => p.id)
  const snaps = []
  const chunk = 80
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk)
    const { data, error: sErr } = await db
      .from('iherb_product_snapshots')
      .select(
        'product_row_id, sold_lower_bound, sold_label, price, currency, captured_at, signals',
      )
      .in('product_row_id', slice)
      .order('captured_at', { ascending: false })
      .limit(slice.length * 15)
    if (sErr) throw new Error(sErr.message || String(sErr))
    snaps.push(...(data || []))
  }

  const latest = new Map()
  for (const s of snaps) {
    if (!s.product_row_id || latest.has(s.product_row_id)) continue
    latest.set(s.product_row_id, s)
  }

  let candidates = list.map((p) => {
    const s = latest.get(p.id) || {}
    const meta = p.metadata && typeof p.metadata === 'object' ? p.metadata : {}
    const hasPdp =
      Boolean(meta.pdp_enriched_at) ||
      Boolean(p.gtin) ||
      (Array.isArray(meta.last_rankings) && meta.last_rankings.length > 0)
    const signals = s.signals && typeof s.signals === 'object' ? s.signals : {}
    const hasPdpSnap = signals.harvest_source === 'iherb_pdp_enrich'
    return {
      product_row_id: p.id,
      part_number: p.part_number,
      product_id: p.product_id,
      gtin: p.gtin,
      name: p.name,
      brand_key: p.brand_key,
      brand_name: p.brand_name,
      url: p.url,
      sold_lower_bound: s.sold_lower_bound ?? null,
      sold_label: s.sold_label ?? null,
      price: s.price ?? null,
      currency: s.currency ?? null,
      has_pdp_enrich: hasPdp || hasPdpSnap,
      pdp_enriched_at: meta.pdp_enriched_at || null,
      rank_best: meta.rank_best || signals.rank_best || null,
    }
  })

  if (brandKeys) {
    candidates = candidates.filter((c) =>
      brandKeys.includes(String(c.brand_key || '').toLowerCase()),
    )
  }
  if (onlyMissing) {
    candidates = candidates.filter((c) => !c.has_pdp_enrich)
  }
  if (opts.min_sold != null) {
    const min = Number(opts.min_sold)
    candidates = candidates.filter((c) => (c.sold_lower_bound ?? 0) >= min)
  }

  // Prefer high 30-day sold; then name stability; skip rows with no URL
  candidates = candidates
    .filter((c) => c.url && /iherb\.com\/pr\//i.test(c.url))
    .sort(
      (a, b) =>
        (b.sold_lower_bound ?? -1) - (a.sold_lower_bound ?? -1) ||
        String(a.part_number || '').localeCompare(String(b.part_number || '')),
    )
    .slice(0, top)

  return candidates
}

/**
 * Navigate to a PDP, parse product + rankings, classify health.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {{
 *   label?: string
 *   fast?: boolean
 *   skipPreNavPause?: boolean
 *   recoveryDeadlineMs?: number
 *   recoveryPollMs?: number
 *   onBlocked?: Function
 *   onResolved?: Function
 * }} [opts]
 */
export async function openAndParseIherbPdp(page, url, opts = {}) {
  const label = opts.label || url
  const fast = opts.fast === true

  if (!fast && opts.skipPreNavPause !== true) {
    await humanPreNavPause({
      minMs: opts.preNavMinMs ?? 2000,
      maxMs: opts.preNavMaxMs ?? 6000,
      label: `pdp ${label}`,
    })
  } else if (fast && opts.skipPreNavPause !== true) {
    await sleep(rand(opts.preNavShortMinMs ?? 150, opts.preNavShortMaxMs ?? 400))
  }

  let response = null
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  } catch (e) {
    console.error(`[iherb-pdp] goto soft-fail: ${e?.message || e}`)
  }

  await sleep(fast ? rand(350, 700) : rand(1200, 2500))

  if (!fast) {
    try {
      await humanIdleMouse(page)
    } catch {
      /* ignore */
    }
    try {
      await humanScrollPage(page, { bursts: 2 })
    } catch {
      /* ignore */
    }
    await sleep(rand(400, 900))
  } else {
    try {
      await page.evaluate(() => window.scrollBy(0, 900))
    } catch {
      /* ignore */
    }
    await sleep(rand(120, 280))
  }

  const status = response?.status?.() ?? null
  let probe = await page
    .evaluate(() => ({
      title: document.title || '',
      bodySnippet: (document.body?.innerText || '').slice(0, 1500),
      page_url: location.href,
      hasProductLd: !!document.querySelector('script[type="application/ld+json"]'),
      hasRankBlock: !!document.querySelector('.best-selling-rank'),
    }))
    .catch(() => ({
      title: '',
      bodySnippet: '',
      page_url: url,
      hasProductLd: false,
      hasRankBlock: false,
    }))

  let html = await page.content().catch(() => '')
  let pdp = parseIherbProduct(html, {
    url: probe.page_url || url,
    captured_at: new Date().toISOString(),
  })
  let health = detectIherbPdpHealth({
    title: probe.title,
    bodyText: probe.bodySnippet,
    url: probe.page_url || url,
    foundProduct: pdp.found === true,
    status,
  })

  // Recovery only on block
  if (health === 'blocked') {
    console.error(
      `[iherb-pdp] ${label}: BLOCKED — waiting for recovery (press-and-hold / security check in Chrome if shown)…`,
    )
    const recovery = await waitForRecovery({
      probe: async () => {
        const backoff = Math.min(60_000, 4000 * 2 ** Math.min(3, 4))
        await sleep(jitterMs(backoff, 0.2))
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
        } catch {
          /* ignore */
        }
        await sleep(rand(1000, 2000))
        const p = await page
          .evaluate(() => ({
            title: document.title || '',
            bodySnippet: (document.body?.innerText || '').slice(0, 1500),
            page_url: location.href,
          }))
          .catch(() => ({ title: '', bodySnippet: '', page_url: url }))
        const h = await page.content().catch(() => '')
        const parsed = parseIherbProduct(h, {
          url: p.page_url || url,
          captured_at: new Date().toISOString(),
        })
        const hh = detectIherbPdpHealth({
          title: p.title,
          bodyText: p.bodySnippet,
          url: p.page_url || url,
          foundProduct: parsed.found === true,
          status: null,
        })
        return {
          health: hh,
          productCount: parsed.found ? 1 : 0,
          harvest: { probe: p, html: h, pdp: parsed },
        }
      },
      label: `pdp ${label}`,
      deadlineMs: opts.recoveryDeadlineMs ?? 10 * 60 * 1000,
      pollMs: opts.recoveryPollMs ?? 6000,
      requireProducts: true,
      onBlocked: opts.onBlocked,
      onResolved: opts.onResolved,
    })
    if (recovery.harvest?.pdp) {
      pdp = recovery.harvest.pdp
      html = recovery.harvest.html || html
      probe = recovery.harvest.probe || probe
    }
    health = recovery.health
  }

  return {
    url: probe.page_url || url,
    html,
    pdp,
    health,
    probe,
    status,
  }
}

/**
 * Process one candidate on one page (navigate → parse → optional write).
 * @param {import('puppeteer').Page} page
 * @param {Record<string, any>} c
 * @param {object} ctx
 */
async function processOnePdpCandidate(page, c, ctx) {
  const {
    workspace_id,
    brand_key,
    db,
    dry_run,
    fast,
    skipPreNavPause,
    onBlocked,
    onResolved,
    recoveryDeadlineMs,
    workerLabel,
  } = ctx
  const label = `${workerLabel || ''}${c.part_number || c.product_id || '?'}`.replace(/^:+/, '')

  if (dry_run) {
    return {
      part_number: c.part_number,
      url: c.url,
      dry_run: true,
      sold_lower_bound: c.sold_lower_bound,
      ok: false,
      skipped: true,
    }
  }

  const opened = await openAndParseIherbPdp(page, c.url, {
    label,
    fast,
    skipPreNavPause,
    onBlocked,
    onResolved,
    recoveryDeadlineMs,
  })

  if (opened.health === 'blocked') {
    return {
      part_number: c.part_number,
      url: c.url,
      ok: false,
      health: 'blocked',
      blocked: true,
    }
  }

  if (!opened.pdp?.found) {
    return {
      part_number: c.part_number,
      url: c.url,
      ok: false,
      health: opened.health,
      reason: opened.pdp?.reason || 'parse failed',
    }
  }

  if (!db) {
    return {
      part_number: opened.pdp.part_number || c.part_number,
      gtin: opened.pdp.gtin,
      rankings: opened.pdp.rankings,
      rank_best: opened.pdp.rank_best,
      breadcrumb: opened.pdp.breadcrumb,
      ok: true,
      write: null,
    }
  }

  try {
    const write = await upsertIherbPdp(db, {
      workspace_id,
      brand_key: c.brand_key || brand_key || null,
      product_row_id: c.product_row_id || null,
      part_number: c.part_number || opened.pdp.part_number,
      pdp: opened.pdp,
    })
    console.error(
      `[iherb-pdp] wrote ${write.part_number}`
      + (write.rank_best
        ? ` rank=#${write.rank_best.rank} in ${write.rank_best.category}`
        : ' (no rankings)')
      + (write.gtin ? ` gtin=${write.gtin}` : '')
      + (workerLabel ? ` ${workerLabel}` : ''),
    )
    return {
      part_number: write.part_number,
      gtin: write.gtin,
      rankings_count: write.rankings_count,
      rank_best: write.rank_best,
      breadcrumb: write.breadcrumb,
      ok: true,
      write,
    }
  } catch (e) {
    console.error(`[iherb-pdp] write fail ${c.part_number}: ${e?.message || e}`)
    return {
      part_number: c.part_number,
      url: c.url,
      ok: false,
      error: e?.message || String(e),
    }
  }
}

/**
 * Run PDP enrich for a list of candidates (or load them).
 *
 * Supports multi-tab parallelism: pass a Page[] or set concurrency + pages.
 * iHerb has no login and rarely hard-blocks; a few concurrent tabs (~3–4)
 * is a good speedup without thrashing the session.
 *
 * @param {import('puppeteer').Page | import('puppeteer').Page[]} pageOrPages
 * @param {{
 *   workspace_id: string
 *   db?: any
 *   dry_run?: boolean
 *   brand_key?: string
 *   brand_keys?: string[]
 *   top?: number
 *   only_missing?: boolean
 *   min_sold?: number
 *   delay_ms?: number
 *   fast?: boolean
 *   concurrency?: number
 *   candidates?: Array<Record<string, any>>
 *   onBlocked?: Function
 *   onResolved?: Function
 * }} opts
 */
export async function enrichIherbPdps(pageOrPages, opts) {
  const workspace_id = opts.workspace_id
  if (!workspace_id) throw new Error('enrichIherbPdps: workspace_id required')

  const pages = (Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages]).filter(Boolean)
  if (!pages.length) throw new Error('enrichIherbPdps: page(s) required')

  const concurrency = Math.min(
    Math.max(opts.concurrency ?? pages.length, 1),
    pages.length,
    6, // hard cap — polite to iHerb + CDP stability
  )
  // Parallel tabs: shorter default gaps (each tab still paces itself)
  const delayMs = opts.delay_ms ?? (
    concurrency > 1
      ? (opts.fast !== false ? 400 : 900)
      : (opts.fast !== false ? 900 : 3500)
  )
  const fast = opts.fast !== false || concurrency > 1

  let candidates = opts.candidates
  if (!candidates) {
    if (!opts.db) throw new Error('enrichIherbPdps: db required to load candidates')
    candidates = await loadIherbPdpCandidates(opts.db, workspace_id, {
      brand_key: opts.brand_key,
      brand_keys: opts.brand_keys,
      top: opts.top ?? 20,
      only_missing: opts.only_missing,
      min_sold: opts.min_sold,
    })
  }

  const result = {
    candidates: candidates.length,
    ok: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    dry_run: opts.dry_run === true,
    concurrency,
    rows: /** @type {any[]} */ ([]),
  }

  console.error(
    `[iherb-pdp] enriching ${candidates.length} PDP(s)`
    + (opts.brand_key ? ` brand=${opts.brand_key}` : '')
    + (concurrency > 1 ? ` tabs=${concurrency}` : '')
    + (opts.dry_run ? ' (dry-run)' : ''),
  )

  if (opts.dry_run) {
    for (const c of candidates) {
      result.rows.push({
        part_number: c.part_number,
        url: c.url,
        dry_run: true,
        sold_lower_bound: c.sold_lower_bound,
      })
      result.skipped++
    }
    return result
  }

  // Shared cursor — single-threaded JS so ++ is safe across concurrent awaits
  let nextIndex = 0
  let stop = false
  let consecutiveBlocked = 0
  const maxBlocked = opts.max_consecutive_blocked ?? 3

  async function worker(page, workerId) {
    const tag = concurrency > 1 ? `[t${workerId + 1}]` : ''
    while (!stop) {
      const i = nextIndex++
      if (i >= candidates.length) break
      const c = candidates[i]
      const label = `${c.part_number || c.product_id || i + 1}`
      console.error(
        `[iherb-pdp] ${i + 1}/${candidates.length} ${label}`
        + ` sold30d=${c.sold_lower_bound ?? '—'} ${tag}`,
      )

      const row = await processOnePdpCandidate(page, c, {
        workspace_id,
        brand_key: opts.brand_key,
        db: opts.db,
        dry_run: false,
        fast,
        skipPreNavPause: true, // multi-tab: skip long human pre-nav
        onBlocked: opts.onBlocked,
        onResolved: opts.onResolved,
        recoveryDeadlineMs: opts.recoveryDeadlineMs,
        workerLabel: tag,
      })

      if (row.skipped) {
        result.skipped++
      } else if (row.blocked) {
        result.blocked++
        result.failed++
        consecutiveBlocked++
        if (consecutiveBlocked >= maxBlocked) {
          console.error(`[iherb-pdp] stop — ${consecutiveBlocked} consecutive blocks`)
          stop = true
        }
      } else if (row.ok) {
        result.ok++
        consecutiveBlocked = 0
      } else {
        result.failed++
      }
      result.rows.push(row)

      if (!stop && delayMs > 0 && nextIndex < candidates.length) {
        const gap = Math.floor(delayMs * (0.7 + Math.random() * 0.7))
        if (concurrency === 1) {
          console.error(`[iherb-pdp] gap ${Math.round(gap / 1000)}s`)
        }
        await sleep(gap)
      }
    }
  }

  await Promise.all(
    pages.slice(0, concurrency).map((page, wi) => worker(page, wi)),
  )

  console.error(
    `[iherb-pdp] done ok=${result.ok} failed=${result.failed} blocked=${result.blocked}`
    + ` tabs=${concurrency} dry=${result.dry_run}`,
  )
  return result
}
