import { attachFranContext, productSelectWithFranContext } from '../../../../fran/productContext'

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'pos:read')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')

  const { data, error } = await client
    .from('products')
    .select(productSelectWithFranContext())
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Product not found' })

  return { data: attachFranContext(data) }
})
