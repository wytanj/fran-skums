import { serverSupabaseUser } from '#supabase/server'
import { requireX402Payment } from '../../utils/x402-adapter'
import { scrapeAndScoreProduct } from '../../utils/scrapeProduct'

/**
 * Instant quality scan — x402-paywalled ($0.05 USDC per product).
 *
 * Scrapes all marketplaces in real-time using Puppeteer,
 * scores deterministically, and uses AI for summary only.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  // x402 payment gate — returns 402 if no payment, or receipt if paid
  const receipt = await requireX402Payment(
    event,
    '$0.05',
    'Instant product quality scan (4 marketplaces)'
  )

  const body = await readBody(event)
  const {
    product_id,
    workspace_id,
    product_title,
    brand_name,
    category_name,
    ean,
    asin,
    retail_price,
    currency = 'SGD',
  } = body

  if (!product_id || !workspace_id) {
    throw createError({ statusCode: 400, statusMessage: 'product_id and workspace_id are required' })
  }
  if (!product_title) {
    throw createError({ statusCode: 400, statusMessage: 'product_title is required' })
  }

  // Run the full scrape → score → AI pipeline
  const result = await scrapeAndScoreProduct({
    product_id,
    workspace_id,
    product_title,
    brand_name,
    category_name,
    ean,
    asin,
    retail_price,
    currency,
  })

  // Record payment
  const db = getServiceClient()
  await db.from('quality_payments').insert({
    workspace_id,
    payment_type: 'instant',
    product_ids: [product_id],
    amount_usdc: 0.05,
    tx_hash: receipt.txHash,
    network: useRuntimeConfig().x402Network || 'base',
    payer_address: receipt.payerAddress,
    status: 'verified',
  })

  return {
    product_id,
    ...result,
    data_source: 'scraped',
    payment: {
      amount_usdc: 0.05,
      tx_hash: receipt.txHash,
      network: useRuntimeConfig().x402Network || 'base',
    },
    generated_at: result.analysis.analysed_at,
  }
})
