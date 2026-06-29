import { getServiceClient } from '../../utils/supabase'

const WORKSPACE_ID = '4fdea5f5-413a-40b8-9b39-9fcad66ebf17'

export default defineEventHandler(async () => {
  const db = getServiceClient()

  const { data: jobs, error } = await db
    .from('skincare_crawl_jobs')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    throw createError({ statusCode: 500, message: error.message })
  }

  // Also get total product counts per source
  const { data: hwahaeCount } = await db
    .from('external_products')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('source', 'hwahae')

  const { data: oyCount } = await db
    .from('external_products')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('source', 'oliveyoung')

  return {
    jobs: jobs ?? [],
    product_counts: {
      hwahae: hwahaeCount?.length ?? 0,
      oliveyoung: oyCount?.length ?? 0,
    },
  }
})
