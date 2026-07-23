/**
 * L-skums — bulk product context for POS/CRM loyalty evaluation.
 *
 * POST /fran/pos/products/context
 * Body: { product_ids?: string[], skus?: string[], barcodes?: string[] }
 * Scope: pos:read | products:read
 *
 * Returns Fran product context only (category/collection/reward flags).
 * Does not compute points or tiers.
 */
import { toFranProductContext, productSelectWithFranContext } from '../../../../fran/productContext'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'pos:read')
  const body = (await readBody(event)) || {}
  const client = getAdminClient()

  const productIds = Array.isArray(body.product_ids)
    ? body.product_ids.map((v: unknown) => String(v).trim()).filter(Boolean)
    : []
  const skus = Array.isArray(body.skus)
    ? body.skus.map((v: unknown) => String(v).trim()).filter(Boolean)
    : []
  const barcodes = Array.isArray(body.barcodes)
    ? body.barcodes.map((v: unknown) => String(v).trim()).filter(Boolean)
    : []

  if (!productIds.length && !skus.length && !barcodes.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'product_ids, skus, or barcodes required',
      message: 'product_ids, skus, or barcodes required',
    })
  }

  const limit = Math.min(
    Math.max(Math.floor(Number(body.limit) || 100), 1),
    250,
  )

  let query = client
    .from('products')
    .select(productSelectWithFranContext())
    .eq('workspace_id', auth.workspaceId)
    .limit(limit)

  if (productIds.length) {
    query = query.in('id', productIds.slice(0, limit))
  } else if (skus.length) {
    query = query.in('sku', skus.slice(0, limit))
  } else {
    // barcodes may match ean / upc / gtin
    const codes = barcodes.slice(0, limit)
    const or = codes
      .flatMap((c) => [`ean.eq.${c}`, `upc.eq.${c}`, `gtin.eq.${c}`])
      .join(',')
    query = query.or(or)
  }

  const { data, error } = await query
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const rows = (data || []).map((product: any) => toFranProductContext(product))

  return {
    ok: true,
    count: rows.length,
    data: rows,
  }
})
