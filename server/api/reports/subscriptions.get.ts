/**
 * List agentic report packs for a workspace (templates + toggle + last run).
 * Scope: reports:read
 */
import {
  listSubscriptionsWithLastRun,
  ensureDefaultSubscriptions,
} from '../../utils/reportRegistry'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  const actor = await requireScope(event, 'reports:read', {
    workspaceId,
    client,
    accessLevel: 'member',
  })

  try {
    await ensureDefaultSubscriptions(client, workspaceId, actor.userId || null)
    const data = await listSubscriptionsWithLastRun(client, workspaceId)
    return { data }
  } catch (e: any) {
    throw createError({
      statusCode: 500,
      statusMessage: e?.message || 'Failed to list report subscriptions',
    })
  }
})
