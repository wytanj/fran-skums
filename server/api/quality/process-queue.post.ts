import { scrapeAndScoreProduct } from '../../utils/scrapeProduct'
import { closeBrowser } from '../../utils/browser-manager'
import { humanDelay } from '../../utils/scrapers/base'

/**
 * Overnight queue processor — processes pending free-tier scrape requests.
 *
 * Protected by API key (QUEUE_PROCESSOR_KEY), intended to be called by cron job.
 * Processes items in priority order, with anti-bot delays between products.
 *
 * Usage: POST /api/quality/process-queue
 * Headers: { Authorization: Bearer <QUEUE_PROCESSOR_KEY> }
 * Body: { limit?: number } — max items to process (default 50)
 */
export default defineEventHandler(async (event) => {
  // Authenticate via API key (not user session — this is a cron endpoint)
  const config = useRuntimeConfig()
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '')

  if (!config.queueProcessorKey || token !== config.queueProcessorKey) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing API key' })
  }

  const body = await readBody(event).catch(() => ({}))
  const limit = Math.min(Math.max(body?.limit ?? 50, 1), 200)

  const db = getServiceClient()

  // Fetch pending items
  const { data: pendingItems, error: fetchErr } = await db
    .from('scrape_queue')
    .select(`
      id,
      workspace_id,
      product_id,
      products!inner (
        id,
        title,
        brand_id,
        category_id,
        ean,
        asin,
        retail_price,
        currency,
        brands ( name ),
        categories ( name )
      )
    `)
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('queued_at', { ascending: true })
    .limit(limit)

  if (fetchErr) {
    throw createError({ statusCode: 500, statusMessage: `Failed to fetch queue: ${fetchErr.message}` })
  }

  if (!pendingItems || pendingItems.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, message: 'Queue is empty' }
  }

  let succeeded = 0
  let failed = 0

  for (const item of pendingItems) {
    const product = (item as any).products

    // Mark as processing
    await db
      .from('scrape_queue')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', item.id)

    try {
      await scrapeAndScoreProduct({
        product_id: item.product_id,
        workspace_id: item.workspace_id,
        product_title: product.title,
        brand_name: product.brands?.name ?? null,
        category_name: product.categories?.name ?? null,
        ean: product.ean,
        asin: product.asin,
        retail_price: product.retail_price,
        currency: product.currency,
      })

      // Mark as completed
      await db
        .from('scrape_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', item.id)

      succeeded++
    } catch (err: any) {
      // Mark as failed
      await db
        .from('scrape_queue')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: err.message?.slice(0, 500) ?? 'Unknown error',
        })
        .eq('id', item.id)

      failed++
    }

    // Anti-bot delay between products (longer for overnight batch)
    await humanDelay(5000, 10000)
  }

  // Close browser when done
  await closeBrowser()

  return {
    processed: pendingItems.length,
    succeeded,
    failed,
    message: `Processed ${pendingItems.length} items: ${succeeded} succeeded, ${failed} failed`,
  }
})
