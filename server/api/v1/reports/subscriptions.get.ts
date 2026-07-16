/**
 * List report packs for a workspace (API key / n8n).
 * Scope: reports:read
 */
import { listSubscriptionsWithLastRun } from '../../../utils/reportRegistry'

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKeyScope(event, 'reports:read')
  const client = getServiceClient()

  try {
    const data = await listSubscriptionsWithLastRun(client, ctx.workspaceId)
    return { data }
  } catch (e: any) {
    throw createError({
      statusCode: 500,
      statusMessage: e?.message || 'Failed to list report subscriptions',
    })
  }
})
