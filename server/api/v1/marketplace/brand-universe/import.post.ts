/**
 * Import brand universe from CSV text or rows JSON.
 * Does NOT materialize crawl seeds (pilot_tier stays paused).
 * POST /api/v1/marketplace/brand-universe/import
 * Scope: intel:write
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { importBrandUniverse } from '../../../../utils/marketplaceBrandUniverse'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const body = await readBody(event)

  try {
    const result = await importBrandUniverse(auth.workspaceId, {
      csv_text: body?.csv_text,
      rows: body?.rows,
      dry_run: Boolean(body?.dry_run),
      marketplace: body?.marketplace,
      country: body?.country,
      source: body?.source,
    })
    return result
  } catch (e: any) {
    throw createError({
      statusCode: e?.statusCode || 500,
      statusMessage: e?.message || 'import failed',
    })
  }
})
