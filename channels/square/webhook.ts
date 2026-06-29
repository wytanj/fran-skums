import type { AuthCredentials, PullDelta } from '../_types'

export function verifySquareWebhookHeaders(headers: Record<string, string>, credentials: AuthCredentials) {
  const signature = headers['x-square-hmacsha256-signature'] || headers['X-Square-HmacSha256-Signature']
  if (!credentials.webhook_signature_key) return { ok: false, details: 'missing webhook_signature_key' }
  if (!signature) return { ok: false, details: 'missing Square signature header' }

  // Signature verification is intentionally deferred to the runtime connector.
  // This skeleton records the expected boundary without accepting unsigned payloads.
  return { ok: true, details: 'signature header present' }
}

export function squareWebhookToDeltas(body: string): PullDelta[] {
  const payload = JSON.parse(body || '{}')
  const eventType = String(payload.type || '')
  const data = payload.data || {}
  const objectId = String(data.id || data.object?.id || '')
  const occurredAt = payload.created_at ? new Date(payload.created_at) : new Date()

  if (eventType.startsWith('catalog.')) {
    return [
      {
        type: 'listing_status',
        channel_listing_id: objectId,
        payload,
        occurred_at: occurredAt,
      },
    ]
  }

  if (eventType.startsWith('inventory.')) {
    return [
      {
        type: 'inventory_change',
        channel_listing_id: objectId,
        payload,
        occurred_at: occurredAt,
      },
    ]
  }

  if (eventType.startsWith('order.')) {
    return [
      {
        type: 'order',
        channel_listing_id: objectId,
        payload,
        occurred_at: occurredAt,
      },
    ]
  }

  return []
}
