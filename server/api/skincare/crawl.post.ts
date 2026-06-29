import { getServiceClient } from '../../utils/supabase'
import { getBrowser, createStealthPage, closeBrowser } from '../../utils/browser-manager'
import { humanDelay } from '../../utils/scrapers/base'
import { HWAHAE_SKINCARE_CATEGORIES, HWAHAE_MAKEUP_CATEGORIES, scrapeHwahaeRankingPage, scrapeHwahaeProductDetail } from '../../utils/scrapers/hwahae'
import { OLIVEYOUNG_SKINCARE_CATEGORIES, OLIVEYOUNG_EXTRA_CATEGORIES, scrapeOliveYoungCategory, scrapeOliveYoungProductDetail } from '../../utils/scrapers/oliveyoung'
import { computeSkincareScores } from '../../utils/skincare-scoring'
import { crawlLog } from '../../utils/crawl-logger'
import type { Browser, Page } from 'puppeteer'

/** Get a fresh browser, killing the old one if disconnected */
async function ensureBrowser(jobId: string): Promise<Browser> {
  try {
    const b = await getBrowser()
    if (b.connected) return b
  } catch {}
  crawlLog(jobId, 'warn', 'Browser disconnected — restarting...')
  await closeBrowser()
  const b = await getBrowser()
  crawlLog(jobId, 'info', 'Browser restarted')
  return b
}

/** Navigate a single reusable page, with auto-recovery */
async function safeGoto(page: Page, url: string, jobId: string): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    return true
  } catch (err: any) {
    crawlLog(jobId, 'warn', `Navigation failed for ${url}: ${err.message?.slice(0, 120)}`)
    return false
  }
}

const WORKSPACE_ID = '4fdea5f5-413a-40b8-9b39-9fcad66ebf17'

interface CrawlRequest {
  source: 'hwahae' | 'oliveyoung'
  job_type?: 'full_catalog' | 'category' | 'bestsellers'
  categories?: string[]
  detail_pages?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CrawlRequest>(event)
  const { source, job_type = 'full_catalog', categories, detail_pages = true } = body

  if (!source || !['hwahae', 'oliveyoung'].includes(source)) {
    throw createError({ statusCode: 400, message: 'source must be "hwahae" or "oliveyoung"' })
  }

  const db = getServiceClient()

  // Check for existing running job
  const { data: runningJobs } = await db
    .from('skincare_crawl_jobs')
    .select('id')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('source', source)
    .in('status', ['pending', 'running'])
    .limit(1)

  if (runningJobs && runningJobs.length > 0) {
    throw createError({
      statusCode: 409,
      message: `A ${source} crawl is already running. Wait for it to complete.`,
    })
  }

  // Determine categories to crawl
  let categoriesToCrawl: Array<{ id: string; label: string; [key: string]: any }>

  if (source === 'hwahae') {
    const all = [...HWAHAE_SKINCARE_CATEGORIES, ...HWAHAE_MAKEUP_CATEGORIES]
    categoriesToCrawl = categories
      ? all.filter(c => categories.includes(c.id))
      : all
  } else {
    const all = [...OLIVEYOUNG_SKINCARE_CATEGORIES, ...OLIVEYOUNG_EXTRA_CATEGORIES]
    categoriesToCrawl = categories
      ? all.filter(c => categories.includes(c.id))
      : all
  }

  // Create crawl job
  const { data: job, error: jobError } = await db
    .from('skincare_crawl_jobs')
    .insert({
      workspace_id: WORKSPACE_ID,
      source,
      job_type,
      status: 'running',
      categories_to_crawl: categoriesToCrawl.map(c => c.id),
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (jobError || !job) {
    throw createError({ statusCode: 500, message: `Failed to create crawl job: ${jobError?.message ?? 'unknown'}` })
  }

  crawlLog(job.id, 'info', `Job created for ${source}, ${categoriesToCrawl.length} categories: ${categoriesToCrawl.map(c => c.id).join(', ')}`)

  // Run crawl in background (non-blocking)
  runCrawl(job.id, source, categoriesToCrawl, detail_pages).catch(err => {
    console.error(`[skincare-crawl] Job ${job.id} top-level error:`, err)
  })

  return {
    job_id: job.id,
    source,
    categories: categoriesToCrawl.map(c => c.id),
    detail_pages,
    message: `Crawl started. ${categoriesToCrawl.length} categories queued.`,
  }
})

// ── Background Crawl Runner ─────────────────────────────────

async function runCrawl(
  jobId: string,
  source: 'hwahae' | 'oliveyoung',
  categories: Array<{ id: string; label: string; [key: string]: any }>,
  crawlDetails: boolean
) {
  const db = getServiceClient()
  let totalProducts = 0
  let processedProducts = 0
  let failedProducts = 0

  // Helper to persist progress to DB every N products
  async function persistProgress(currentCategory?: string) {
    await db
      .from('skincare_crawl_jobs')
      .update({
        current_category: currentCategory,
        total_products: totalProducts,
        processed_products: processedProducts,
        failed_products: failedProducts,
      })
      .eq('id', jobId)
  }

  try {
    crawlLog(jobId, 'info', `Starting browser...`)
    let browser = await ensureBrowser(jobId)
    crawlLog(jobId, 'info', `Browser ready`)

    for (const category of categories) {
      crawlLog(jobId, 'info', `── Category: ${source}/${category.id} ──`)
      await persistProgress(category.id)

      // Ensure browser is still alive before each category
      browser = await ensureBrowser(jobId)

      try {
        if (source === 'hwahae') {
          await crawlHwahaeCategory(jobId, browser, category, crawlDetails, db,
            (inc) => {
              if (inc === 'total') totalProducts++
              else if (inc === 'processed') processedProducts++
              else if (inc === 'failed') failedProducts++
            },
            persistProgress
          )
        } else {
          await crawlOliveYoungCategory(jobId, browser, category, crawlDetails, db,
            (inc) => {
              if (inc === 'total') totalProducts++
              else if (inc === 'processed') processedProducts++
              else if (inc === 'failed') failedProducts++
            },
            persistProgress
          )
        }
      } catch (catErr: any) {
        crawlLog(jobId, 'error', `Category ${category.id} error: ${catErr.message}`)
        // Continue to next category
      }

      // Persist after each category
      await persistProgress(category.id)

      // Anti-bot delay between categories
      await humanDelay(3000, 6000)
    }

    // Mark complete
    await db
      .from('skincare_crawl_jobs')
      .update({
        status: 'completed',
        total_products: totalProducts,
        processed_products: processedProducts,
        failed_products: failedProducts,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    crawlLog(jobId, 'info', `✓ Completed: ${processedProducts}/${totalProducts} products (${failedProducts} failed)`)
  } catch (err: any) {
    crawlLog(jobId, 'error', `✗ Job failed: ${err.message}`)

    await db
      .from('skincare_crawl_jobs')
      .update({
        status: 'failed',
        total_products: totalProducts,
        processed_products: processedProducts,
        failed_products: failedProducts,
        error: err.message?.slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  }
}

// ── Shared: upsert a product + compute scores ──────────────

async function upsertProduct(
  db: any,
  source: 'hwahae' | 'oliveyoung',
  product: { sourceProductId: string; productUrl: string; productName: string; brandName: string; rating: number | null; reviewCount: number | null; imageUrl: string | null; price?: number | null },
  category: any,
  detail: { ingredients: string[]; ingredientsRaw: string; skinTypeRatings?: any; concerns: string[]; awards?: string[]; volume: string | null } | null,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void,
  counter: (type: 'processed' | 'failed') => void,
) {
  const ingredients = detail?.ingredients ?? []
  const scores = await computeSkincareScores(ingredients)

  const { error: upsertErr } = await db
    .from('external_products')
    .upsert({
      workspace_id: WORKSPACE_ID,
      source,
      source_product_id: product.sourceProductId,
      source_url: product.productUrl,
      product_name: product.productName,
      brand_name: product.brandName,
      category: 'skincare',
      subcategory: category.id,
      price: product.price ?? null,
      currency: source === 'oliveyoung' ? 'SGD' : 'USD',
      volume: detail?.volume ?? null,
      rating: product.rating,
      review_count: product.reviewCount,
      ingredients,
      ingredients_raw: detail?.ingredientsRaw ?? '',
      skin_type_ratings: detail?.skinTypeRatings ?? null,
      concerns: (detail?.concerns?.length ?? 0) > 0 ? detail!.concerns : scores.concern_tags,
      awards: detail?.awards ?? [],
      image_url: product.imageUrl,
      ips_score: scores.ips_score,
      skin_type_fit: scores.skin_type_fit,
      concern_tags: scores.concern_tags,
      top_tier_ingredient: scores.top_tier_ingredient,
      ingredient_trend_signal: scores.ingredient_trend_signal,
      conflict_flags: scores.conflict_flags,
      crawled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'workspace_id,source,source_product_id',
    })

  if (upsertErr) {
    log('error', `DB upsert error for ${product.sourceProductId}: ${upsertErr.message}`)
    counter('failed')
  } else {
    counter('processed')
  }
}

// ── Hwahae Category Crawl ───────────────────────────────────

async function crawlHwahaeCategory(
  jobId: string,
  browser: Browser,
  category: any,
  crawlDetails: boolean,
  db: any,
  counter: (type: 'total' | 'processed' | 'failed') => void,
  persistProgress: (cat?: string) => Promise<void>
) {
  const log = (level: 'info' | 'warn' | 'error', msg: string) => crawlLog(jobId, level, `[hwahae/${category.id}] ${msg}`)

  // Use ONE page for listing, ONE reusable page for details
  const listPage = await createStealthPage(browser)

  try {
    log('info', `Scraping ranking page: ${category.rankingUrl}`)
    const products = await scrapeHwahaeRankingPage(listPage, category.rankingUrl)
    log('info', `Found ${products.length} products in ranking`)

    if (products.length === 0) {
      try {
        const title = await listPage.title()
        const bodyText = await listPage.evaluate(() => document.body?.innerText?.slice(0, 300) || '(empty)')
        log('warn', `⚠ No products — title: "${title}" — body: ${bodyText}`)
      } catch {}
    }

    // Close listing page before detail scraping to save memory
    await listPage.close().catch(() => {})

    // Reuse a single detail page for all products
    let detailPage: Page | null = null

    for (let i = 0; i < products.length; i++) {
      const product = products[i]
      counter('total')

      try {
        let detail: any = null

        if (crawlDetails && product.productUrl) {
          // Create detail page lazily, reuse it
          if (!detailPage || detailPage.isClosed()) {
            detailPage = await createStealthPage(await ensureBrowser(jobId))
          }

          try {
            detail = await scrapeHwahaeProductDetail(detailPage, product.productUrl)
            if (detail) {
              log('info', `${i + 1}/${products.length} "${product.productName?.slice(0, 40)}" — ${detail.ingredients.length} ingredients`)
            } else {
              log('warn', `${i + 1}/${products.length} "${product.productName?.slice(0, 40)}" — detail returned null`)
            }
          } catch (detailErr: any) {
            log('warn', `${i + 1}/${products.length} detail error: ${detailErr.message?.slice(0, 100)}`)
            // Page may be dead — recreate on next iteration
            await detailPage.close().catch(() => {})
            detailPage = null
          }

          await humanDelay(2000, 4000)
        } else {
          log('info', `${i + 1}/${products.length} "${product.productName?.slice(0, 40)}" — listing only`)
        }

        await upsertProduct(db, 'hwahae', product, category, detail, log, counter)
      } catch (err: any) {
        log('error', `Failed ${product.sourceProductId}: ${err.message?.slice(0, 120)}`)
        counter('failed')
      }

      if (i % 5 === 4) await persistProgress(category.id)
    }

    if (detailPage && !detailPage.isClosed()) await detailPage.close().catch(() => {})
  } catch (err: any) {
    log('error', `Category error: ${err.message?.slice(0, 200)}`)
    await listPage.close().catch(() => {})
  }
}

// ── Olive Young Category Crawl ──────────────────────────────

async function crawlOliveYoungCategory(
  jobId: string,
  browser: Browser,
  category: any,
  crawlDetails: boolean,
  db: any,
  counter: (type: 'total' | 'processed' | 'failed') => void,
  persistProgress: (cat?: string) => Promise<void>
) {
  const log = (level: 'info' | 'warn' | 'error', msg: string) => crawlLog(jobId, level, `[oliveyoung/${category.id}] ${msg}`)

  const listPage = await createStealthPage(browser)

  try {
    log('info', `Scraping category listing: ctgrNo=${category.ctgrNo}`)
    const products = await scrapeOliveYoungCategory(listPage, category.ctgrNo, 5)
    log('info', `Found ${products.length} products`)

    if (products.length === 0) {
      try {
        const title = await listPage.title()
        const bodyText = await listPage.evaluate(() => document.body?.innerText?.slice(0, 300) || '(empty)')
        log('warn', `⚠ No products — title: "${title}" — body: ${bodyText}`)
      } catch {}
    }

    await listPage.close().catch(() => {})

    let detailPage: Page | null = null

    for (let i = 0; i < products.length; i++) {
      const product = products[i]
      counter('total')

      try {
        let detail: any = null

        if (crawlDetails && product.productUrl) {
          if (!detailPage || detailPage.isClosed()) {
            detailPage = await createStealthPage(await ensureBrowser(jobId))
          }

          try {
            detail = await scrapeOliveYoungProductDetail(detailPage, product.productUrl)
            if (detail) {
              log('info', `${i + 1}/${products.length} "${product.productName?.slice(0, 40)}" — ${detail.ingredients.length} ingredients`)
            } else {
              log('warn', `${i + 1}/${products.length} "${product.productName?.slice(0, 40)}" — detail returned null`)
            }
          } catch (detailErr: any) {
            log('warn', `${i + 1}/${products.length} detail error: ${detailErr.message?.slice(0, 100)}`)
            await detailPage.close().catch(() => {})
            detailPage = null
          }

          await humanDelay(2000, 4000)
        } else {
          log('info', `${i + 1}/${products.length} "${product.productName?.slice(0, 40)}" — listing only`)
        }

        await upsertProduct(db, 'oliveyoung', { ...product, price: product.price }, category, detail, log, counter)
      } catch (err: any) {
        log('error', `Failed ${product.sourceProductId}: ${err.message?.slice(0, 120)}`)
        counter('failed')
      }

      if (i % 5 === 4) await persistProgress(category.id)
    }

    if (detailPage && !detailPage.isClosed()) await detailPage.close().catch(() => {})
  } catch (err: any) {
    log('error', `Category error: ${err.message?.slice(0, 200)}`)
    await listPage.close().catch(() => {})
  }
}
