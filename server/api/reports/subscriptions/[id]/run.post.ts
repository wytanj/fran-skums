/**
 * Run a report pack now (stub sections until Rpt-6).
 * Scope: reports:run
 * Disabled packs are skipped unless force=true + reports:write.
 */
import { runSubscriptionNow } from '../../../../utils/reportRegistry'
import { hasScope } from '../../../../utils/scopes'

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
  const actor = await requireScope(event, 'reports:run', {
    workspaceId,
    client,
    accessLevel: 'member',
  })

  const force = Boolean(body?.force)
  if (force && !hasScope(actor.scopes, 'reports:write', { emptyMeansFull: false })) {
    throw createError({
      statusCode: 403,
      statusMessage: 'force run requires reports:write',
    })
  }

  try {
    const data = await runSubscriptionNow(client, {
      workspaceId,
      subscriptionId: id,
      triggerSource: 'manual',
      createdBy: actor.userId || null,
      force,
    })
    return { data }
  } catch (e: any) {
    const msg = e?.message || 'Failed to run report'
    const status =
      msg.includes('not found') ? 404
      : msg.includes('disabled') ? 409
      : 500
    throw createError({ statusCode: status, statusMessage: msg })
  }
})
