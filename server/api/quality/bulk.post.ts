import { serverSupabaseUser } from '#supabase/server'
import { requireX402Payment } from '../../utils/x402-adapter'
import { scrapeAndScoreProduct } from '../../utils/scrapeProduct'
import { humanDelay } from '../../utils/scrapers/base'

/**
 * Bulk quality scan — x402-paywalled ($0.03 USDC per product).
 *
 * Scrapes multiple products sequentially with anti-bot delays.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const body = await readBody(event)
  const { workspace_id, products } = body

  if (!workspace_id) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }
  if (!Array.isArray(products) || products.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'products array is required and must not be empty' })
  }
  if (products.length > 50) {
    throw createError({ statusCode: 400, statusMessage: 'Maximum 50 products per bulk scan' })
  }

  // Dynamic pricing: $0.03 per product
  const totalCost = (products.length * 0.03).toFixed(2)

  // x402 payment gate
  const receipt = await requireX402Payment(
    event,
    `$${totalCost}`,
    `Bulk quality scan (${products.length} products × $0.03)`
  )

  // Process each product sequentially
  const results: any[] = []
  const productIds: string[] = []

  for (const product of products) {
    const {
      product_id,
      product_title,
      brand_name,
      category_name,
      ean,
      asin,
      retail_price,
      currency = 'SGD',
    } = product

    if (!product_id || !product_title) {
      results.push({
        product_id: product_id ?? 'unknown',
        error: 'Missing product_id or product_title',
        data_source: 'error',
      })
      continue
    }

    productIds.push(product_id)

    try {
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

      results.push({
        product_id,
        ...result,
        data_source: 'scraped',
      })
    } catch (err: any) {
      results.push({
        product_id,
        error: err.message?.slice(0, 200) ?? 'Scrape failed',
        data_source: 'error',
      })
    }

    // Anti-bot delay between products
    await humanDelay(5000, 8000)
  }

  // Record payment
  const db = getServiceClient()
  await db.from('quality_payments').insert({
    workspace_id,
    payment_type: 'bulk',
    product_ids: productIds,
    amount_usdc: parseFloat(totalCost),
    tx_hash: receipt.txHash,
    network: useRuntimeConfig().x402Network || 'base',
    payer_address: receipt.payerAddress,
    status: 'verified',
  })

  const succeeded = results.filter(r => r.data_source === 'scraped').length
  const failed = results.filter(r => r.data_source === 'error').length

  return {
    total: products.length,
    succeeded,
    failed,
    results,
    payment: {
      amount_usdc: parseFloat(totalCost),
      tx_hash: receipt.txHash,
      network: useRuntimeConfig().x402Network || 'base',
    },
  }
})
