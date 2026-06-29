import { attachFranContext, productSelectWithFranContext } from '../../../../fran/productContext'

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'pos:read')
  const client = getAdminClient()
  const body = await readBody(event)

  const identifier = String(body.identifier || body.scanned_value || '').trim()
  if (!identifier) {
    throw createError({ statusCode: 400, statusMessage: 'identifier is required' })
  }

  const { data, error } = await client.rpc('resolve_pos_scan', {
    p_workspace_id: ctx.workspaceId,
    p_identifier: identifier,
    p_channel_id: body.channel_id || null,
    p_location_id: body.location_id || null,
  })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const resolution = data || {}
  const matches = Array.isArray(resolution.matches) ? resolution.matches : []
  const productIds = [...new Set(matches.map((match: any) => match.product_id).filter(Boolean))]

  let productsById = new Map<string, any>()
  if (productIds.length > 0) {
    const { data: products, error: productError } = await client
      .from('products')
      .select(productSelectWithFranContext())
      .eq('workspace_id', ctx.workspaceId)
      .in('id', productIds)

    if (productError) throw createError({ statusCode: 500, statusMessage: productError.message })
    productsById = new Map((products || []).map((product: any) => [product.id, product]))
  }

  return {
    data: {
      ...resolution,
      matches: matches.map((match: any) => attachFranContext(match, productsById.get(match.product_id) || match)),
    },
  }
})
