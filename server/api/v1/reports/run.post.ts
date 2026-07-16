/**
 * Rpt-5 — headless / n8n run API.
 *
 * POST /api/v1/reports/run
 * Auth: API key with reports:run
 * Body: {
 *   subscription_id?: string,
 *   template_slug?: string,
 *   force?: boolean,
 *   deliver?: boolean
 * }
 *
 * Suggest-only: never auto-approve / Loft / FOB.
 */
import {
  getSubscriptionBySlugOrId,
  runSubscriptionNow,
} from '../../../utils/reportRegistry'
import { hasScope } from '../../../utils/scopes'

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKeyScope(event, 'reports:run')
  const body = await readBody(event).catch(() => ({} as Record<string, unknown>))

  const subscriptionId =
    typeof body?.subscription_id === 'string' ? body.subscription_id.trim() : ''
  const templateSlug =
    typeof body?.template_slug === 'string' ? body.template_slug.trim() : ''

  if (!subscriptionId && !templateSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'subscription_id or template_slug is required',
    })
  }

  const client = getServiceClient()
  const workspaceId = ctx.workspaceId

  try {
    let subId = subscriptionId
    if (!subId) {
      const found = await getSubscriptionBySlugOrId(client, workspaceId, {
        templateSlug,
      })
      if (!found) {
        throw createError({
          statusCode: 404,
          statusMessage: `No subscription for template_slug=${templateSlug}`,
        })
      }
      subId = found.subscription.id
    }

    const force = Boolean(body?.force)
    if (force) {
      // force disabled packs needs write
      if (!hasScope(ctx.scopes, 'reports:write', { emptyMeansFull: false })) {
        throw createError({
          statusCode: 403,
          statusMessage: 'force requires reports:write on the API key',
        })
      }
    }

    const deliver = body?.deliver === false ? false : true
    const data = await runSubscriptionNow(client, {
      workspaceId,
      subscriptionId: subId,
      triggerSource: 'api',
      force,
      deliver,
    })

    return {
      data,
      note: 'suggest_only — report digests never approve, send Loft, or mark FOB',
    }
  } catch (e: any) {
    if (e?.statusCode) throw e
    const msg = e?.message || 'Failed to run report'
    const status =
      msg.includes('not found') ? 404
      : msg.includes('disabled') ? 409
      : 500
    throw createError({ statusCode: status, statusMessage: msg })
  }
})
