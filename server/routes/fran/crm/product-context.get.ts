import { toFranProductContext, productSelectWithFranContext } from '../../../fran/productContext'

function boolQuery(value: unknown): boolean | null {
  if (value === undefined || value === null || value === '') return null
  return ['true', '1', 'yes', 'y'].includes(String(value).toLowerCase())
}

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const query = getQuery(event)
  const limit = Math.min(Math.max(Math.floor(Number(query.limit) || 100), 1), 250)
  const search = String(query.search || '').trim()
  const rewardEligible = boolQuery(query.reward_eligible)
  const sampleEligible = boolQuery(query.sample_eligible)

  let productQuery = client
    .from('products')
    .select(productSelectWithFranContext())
    .eq('workspace_id', ctx.workspaceId)
    .eq('status', 'active')
    .order('title')
    .limit(limit)

  if (query.product_id) productQuery = productQuery.eq('id', String(query.product_id))
  if (query.sku) productQuery = productQuery.eq('sku', String(query.sku))
  if (search) {
    productQuery = productQuery.or(`title.ilike.%${search}%,sku.ilike.%${search}%,ean.eq.${search},upc.eq.${search},gtin.eq.${search}`)
  }

  const { data, error } = await productQuery
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const rows = (data || [])
    .map((product: any) => toFranProductContext(product))
    .filter((item: any) => rewardEligible === null || item.reward_eligible === rewardEligible)
    .filter((item: any) => sampleEligible === null || item.sample_eligible === sampleEligible)

  return { data: rows, limit }
})
