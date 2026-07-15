import { getOrCreateStoreOpsSettings } from '../../utils/storeDeliveryCalendar'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  await requireScope(event, 'store_ops:read', { workspaceId, client, accessLevel: 'member' })

  const settings = await getOrCreateStoreOpsSettings(client, workspaceId)
  return { data: settings }
})
