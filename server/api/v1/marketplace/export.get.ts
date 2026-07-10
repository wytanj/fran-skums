/**
 * Sheet-ready BI export (JSON rows or CSV).
 *
 * GET /api/v1/marketplace/export
 *   ?search_query=anua%20official
 *   &seller_type=mall
 *   &format=json|csv
 *   &limit=100
 *   &include_summary=true
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { buildMarketplaceExportTable } from '../../../utils/marketplaceExport'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)

  const format = query.format === 'csv' ? 'csv' : 'json'
  const include_summary = query.include_summary !== 'false'

  try {
    const result = await buildMarketplaceExportTable({
      workspace_id: auth.workspaceId,
      search_query: typeof query.search_query === 'string' ? query.search_query : undefined,
      seller_type: typeof query.seller_type === 'string' ? query.seller_type : undefined,
      marketplace: typeof query.marketplace === 'string' ? query.marketplace : 'shopee',
      country: typeof query.country === 'string' ? query.country : 'sg',
      since: typeof query.since === 'string' ? query.since : undefined,
      until: typeof query.until === 'string' ? query.until : undefined,
      limit: Number(query.limit) || 100,
      format,
      include_summary,
    })

    if (result.format === 'csv') {
      setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
      setHeader(
        event,
        'Content-Disposition',
        `attachment; filename="marketplace-export-${Date.now()}.csv"`,
      )
      // Still return JSON envelope by default for agents; use ?raw=1 for pure CSV body
      if (query.raw === '1' || query.raw === 'true') {
        return result.csv
      }
      return {
        format: 'csv',
        row_count: result.row_count,
        summary: result.summary,
        csv: result.csv,
      }
    }

    return result
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err?.message?.slice(0, 300) || 'export failed',
    })
  }
})
