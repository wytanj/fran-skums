/**
 * Toggle / update a report subscription.
 * Scope: reports:write
 */
import { setSubscriptionEnabled } from '../../../utils/reportRegistry'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'subscription id is required' })
  }

  const body = await readBody(event).catch(() => ({}))
  const workspaceId = String(body?.workspace_id || getQuery(event).workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  await requireScope(event, 'reports:write', {
    workspaceId,
    client,
    accessLevel: 'member',
  })

  if (typeof body?.enabled !== 'boolean') {
    throw createError({
      statusCode: 400,
      statusMessage: 'enabled (boolean) is required',
    })
  }

  try {
    const data = await setSubscriptionEnabled(client, workspaceId, id, body.enabled)
    return { data }
  } catch (e: any) {
    const msg = e?.message || 'Failed to update subscription'
    throw createError({
      statusCode: msg.includes('not found') ? 404 : 500,
      statusMessage: msg,
    })
  }
})
