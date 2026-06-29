import { getServiceClient } from '../../utils/supabase'

const WORKSPACE_ID = '4fdea5f5-413a-40b8-9b39-9fcad66ebf17'

export default defineEventHandler(async () => {
  const db = getServiceClient()

  // Total products per source
  const { count: hwahaeTotal } = await db
    .from('external_products')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('source', 'hwahae')

  const { count: oyTotal } = await db
    .from('external_products')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('source', 'oliveyoung')

  // IPS distribution
  const { count: cleanCount } = await db
    .from('external_products')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .gte('ips_score', 85)

  const { count: standardCount } = await db
    .from('external_products')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .gte('ips_score', 60)
    .lt('ips_score', 85)

  const { count: cautionCount } = await db
    .from('external_products')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .gte('ips_score', 30)
    .lt('ips_score', 60)

  const { count: avoidCount } = await db
    .from('external_products')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .lt('ips_score', 30)

  // Trend distribution
  const { count: risingCount } = await db
    .from('external_products')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('ingredient_trend_signal', 'rising')

  // Top concerns
  const { data: allProducts } = await db
    .from('external_products')
    .select('concern_tags')
    .eq('workspace_id', WORKSPACE_ID)
    .not('concern_tags', 'is', null)

  const concernCounts: Record<string, number> = {}
  for (const p of allProducts ?? []) {
    for (const tag of p.concern_tags ?? []) {
      concernCounts[tag] = (concernCounts[tag] || 0) + 1
    }
  }

  // Recent crawl jobs
  const { data: recentJobs } = await db
    .from('skincare_crawl_jobs')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .order('created_at', { ascending: false })
    .limit(5)

  return {
    total_products: (hwahaeTotal ?? 0) + (oyTotal ?? 0),
    by_source: {
      hwahae: hwahaeTotal ?? 0,
      oliveyoung: oyTotal ?? 0,
    },
    ips_distribution: {
      clean: cleanCount ?? 0,
      standard: standardCount ?? 0,
      caution: cautionCount ?? 0,
      avoid: avoidCount ?? 0,
    },
    trending_products: risingCount ?? 0,
    concern_coverage: concernCounts,
    recent_jobs: recentJobs ?? [],
  }
})
