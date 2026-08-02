/**
 * List research notebooks (study sessions).
 * GET /api/v1/study/sessions?status=&limit=
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { listStudySessions } from '../../../utils/marketplaceStudy'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)

  try {
    const sessions = await listStudySessions(auth.workspaceId, {
      status: typeof query.status === 'string' ? query.status : undefined,
      limit,
    })
    return {
      sessions,
      deep_link: '/research',
      note: 'Research notebooks — park product/brand ideas; Shopee harvest is opt-in via pipeline.',
    }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err?.message?.slice(0, 300) || 'Failed to list sessions',
    })
  }
})
