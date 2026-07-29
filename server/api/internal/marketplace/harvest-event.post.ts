/**
 * MH-9 — out-of-band ping for the unattended Mall harvest.
 *
 * The harvest CLI runs locally against a warm Chrome and cannot import the
 * Nitro notification bus, so it posts here and this route emits through the
 * normal Phase N path (policy → recipients → in_app/Slack → audit). Keeping
 * emission server-side means one delivery ledger, one idempotency rule, and
 * no duplicated Slack logic in a .mjs script.
 *
 * POST /api/internal/marketplace/harvest-event
 * Authorization: Bearer <MARKETPLACE_CRON_SECRET or QUEUE_PROCESSOR_KEY>
 * Body: {
 *   workspace_id: string
 *   event: 'blocked' | 'recovered'
 *   brand_key: string
 *   shop_username?: string
 *   shelf?: string
 *   page?: number
 *   health?: string
 *   recovered?: boolean
 *   waited_ms?: number
 *   run_id?: string
 * }
 */
import { emitLifecycleNotification } from '../../../utils/notifications'
import { getServiceClient } from '../../../utils/supabase'

const EVENT_TYPES: Record<string, string> = {
  blocked: 'marketplace.harvest.blocked',
  recovered: 'marketplace.harvest.recovered',
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '')

  const expected =
    config.marketplaceCronSecret ||
    config.queueProcessorKey ||
    process.env.MARKETPLACE_CRON_SECRET ||
    process.env.QUEUE_PROCESSOR_KEY ||
    ''

  if (!expected || token !== expected) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid or missing cron secret' })
  }

  const body = await readBody(event).catch(() => ({} as Record<string, any>))

  const workspaceId = String(body?.workspace_id || '').trim()
  const kind = String(body?.event || '').trim()
  const brandKey = String(body?.brand_key || '').trim()
  const eventType = EVENT_TYPES[kind]

  if (!workspaceId || !eventType || !brandKey) {
    throw createError({
      statusCode: 400,
      statusMessage: 'workspace_id, event (blocked|recovered) and brand_key are required',
    })
  }

  const shop = String(body?.shop_username || '').trim()
  const shelf = String(body?.shelf || '').trim()
  const health = String(body?.health || '').trim()
  const pageIdx = Number.isFinite(Number(body?.page)) ? Number(body.page) : null
  const waitedMs = Number.isFinite(Number(body?.waited_ms)) ? Number(body.waited_ms) : null
  const recovered = body?.recovered === true

  const where = [shop ? `@${shop}` : null, shelf || null, pageIdx != null ? `p${pageIdx}` : null]
    .filter(Boolean)
    .join(' · ')

  const title =
    kind === 'blocked'
      ? `Mall harvest blocked — ${brandKey}`
      : recovered
        ? `Mall harvest resumed — ${brandKey}`
        : `Mall harvest skipped ${brandKey} (recovery timed out)`

  const bodyText =
    kind === 'blocked'
      ? [
          where || brandKey,
          health ? `Session: ${health}.` : null,
          'Solve the captcha in the warm Chrome window — the run keeps polling and moves on to the next brand if it times out.',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          where || brandKey,
          recovered
            ? `Cleared after ${waitedMs != null ? Math.round(waitedMs / 1000) : '?'}s — harvest continued.`
            : `No recovery after ${waitedMs != null ? Math.round(waitedMs / 1000) : '?'}s — brand cooled down and skipped.`,
        ]
          .filter(Boolean)
          .join('\n')

  // Per brand per run, so a shelf that flaps does not spam the channel.
  const runId = String(body?.run_id || '').trim()
  const idempotencyRoot = `${eventType}:${brandKey}${runId ? `:${runId}` : ''}`

  try {
    const client = getServiceClient()
    const result = await emitLifecycleNotification(client, {
      workspaceId,
      eventType,
      entityType: 'marketplace_brand',
      entityId: brandKey,
      title,
      body: bodyText,
      priority: kind === 'blocked' ? 'urgent' : 'low',
      idempotencyRoot,
      payload: {
        brand_key: brandKey,
        shop_username: shop || null,
        shelf: shelf || null,
        page: pageIdx,
        health: health || null,
        recovered,
        waited_ms: waitedMs,
        run_id: runId || null,
      },
    })

    return { ok: true, event_type: eventType, ...result, at: new Date().toISOString() }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err?.message?.slice(0, 400) || 'harvest-event emit failed',
    })
  }
})
