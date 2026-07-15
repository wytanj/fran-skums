import { updateStoreOpsSettings } from '../../utils/storeDeliveryCalendar'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  try {
    await requireScope(event, 'store_ops:approve', { workspaceId, client, accessLevel: 'write' })
  } catch {
    await requireScope(event, 'locations:write', { workspaceId, client, accessLevel: 'write' })
  }

  const settings = await updateStoreOpsSettings(client, workspaceId, body)
  return { ok: true, data: settings }
})
