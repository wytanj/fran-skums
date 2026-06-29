import { getServiceClient } from '../../utils/supabase'

const WORKSPACE_ID = '4fdea5f5-413a-40b8-9b39-9fcad66ebf17'

export default defineEventHandler(async () => {
  const db = getServiceClient()

  const { count: productCount } = await db
    .from('external_products')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)

  const { error: prodErr } = await db
    .from('external_products')
    .delete()
    .eq('workspace_id', WORKSPACE_ID)

  if (prodErr) throw createError({ statusCode: 500, message: prodErr.message })

  const { error: jobErr } = await db
    .from('skincare_crawl_jobs')
    .delete()
    .eq('workspace_id', WORKSPACE_ID)

  if (jobErr) throw createError({ statusCode: 500, message: jobErr.message })

  return { deleted_products: productCount ?? 0, message: 'All crawled products and jobs cleared.' }
})
