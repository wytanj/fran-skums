import { recommendReplenishmentDecision } from '../../../../utils/storeReplenishment'

/**
 * Read-only baseline/lift recommendation (also used by MCP).
 * Requires store_ops:read or intel:read — never mutates.
 */
export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!id || !workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'id and workspace_id are required' })
  }

  const client = getServiceClient()
  await requireScope(event, 'store_ops:read', {
    workspaceId,
    client,
    accessLevel: 'member',
  })

  const recommendation = await recommendReplenishmentDecision(client, {
    workspaceId,
    requestId: id,
  })

  return {
    ok: true,
    advisory_only: true,
    message: 'Recommendation is advisory. Human must call decide with store_ops:approve.',
    ...recommendation,
  }
})
