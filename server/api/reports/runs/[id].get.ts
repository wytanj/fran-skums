/**
 * Get one report run by id.
 * Scope: reports:read
 */
import { getReportRun } from '../../../utils/reportRegistry'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '').trim()
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'run id is required' })
  }

  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  await requireScope(event, 'reports:read', {
    workspaceId,
    client,
    accessLevel: 'member',
  })

  try {
    const data = await getReportRun(client, workspaceId, id)
    if (!data) {
      throw createError({ statusCode: 404, statusMessage: 'Report run not found' })
    }
    return { data }
  } catch (e: any) {
    if (e?.statusCode) throw e
    throw createError({
      statusCode: 500,
      statusMessage: e?.message || 'Failed to load report run',
    })
  }
})
