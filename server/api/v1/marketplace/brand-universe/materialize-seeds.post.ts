/**
 * Materialize weekly brand_portfolio crawl seeds from brand universe.
 * POST /api/v1/marketplace/brand-universe/materialize-seeds
 * Scope: intel:write
 *
 * Body:
 *   brand_keys?: string[]
 *   pilot_tier?: 'pilot' | 'mid' | 'full'
 *   pilot_allowlist?: boolean  // Appendix A keys
 *   set_pilot_tier?: string    // e.g. 'pilot' when activating allowlist
 *   collector_id?: string      // default shopee_puppeteer; use mock in CI
 *   enabled?: boolean          // seed enabled (default true)
 *
 * preferred_hour=10 UTC (≈ 18:00 SGT). detail_top_n=0.
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { materializeBrandSeeds } from '../../../../utils/marketplaceBrandUniverse'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:write')
  const body = await readBody(event)

  try {
    const result = await materializeBrandSeeds(auth.workspaceId, {
      brand_keys: body?.brand_keys,
      pilot_tier: body?.pilot_tier,
      pilot_allowlist: Boolean(body?.pilot_allowlist),
      set_pilot_tier: body?.set_pilot_tier,
      collector_id: body?.collector_id,
      enabled: body?.enabled,
    })
    return result
  } catch (e: any) {
    throw createError({
      statusCode: e?.statusCode || 500,
      statusMessage: e?.message || 'materialize failed',
    })
  }
})
