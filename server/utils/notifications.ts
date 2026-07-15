/**
 * Phase N — stakeholder notification bus.
 *
 * Principles (N0):
 * - Notify on lifecycle events, not every field edit
 * - Never auto-email on MCP draft create
 * - Deep link or no external channel
 * - Idempotent per (workspace, event, entity, channel, recipient)
 * - Agent does not send email; system does after policy
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAudit } from './audit'
import { hasScope } from './scopes'
import { resolveScopesForUser } from './scopeAuth'

export type NotificationChannel = 'in_app' | 'email' | 'slack' | 'webhook'
export type NotificationPriority = 'low' | 'normal' | 'urgent' | 'critical'
export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export interface RecipientRules {
  roles?: string[]
  scopes?: string[]
  dynamic?: string[]
  user_ids?: string[]
}

export interface EmitNotificationInput {
  workspaceId: string
  eventType: string
  entityType: string
  entityId: string
  title: string
  body?: string | null
  priority?: NotificationPriority
  deepLink?: string | null
  /** Extra context for templates + dynamic recipients */
  payload?: Record<string, unknown>
  actorUserId?: string | null
  /** Override policy channels (tests / manual trigger) */
  channels?: NotificationChannel[]
  /** Force idempotency root (default: eventType:entityId) */
  idempotencyRoot?: string
  /** Skip external channels even if policy allows (e.g. dry-run) */
  dryRun?: boolean
}

export interface DeliveryResult {
  channel: NotificationChannel
  recipient: string
  status: DeliveryStatus
  delivery_id?: string | null
  provider_ref?: string | null
  error?: string | null
  deduped?: boolean
  in_app_notification_id?: string | null
}

export interface EmitNotificationResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  event_type: string
  policy_id?: string | null
  deliveries: DeliveryResult[]
}

/** Build stable idempotency key for one delivery attempt. */
export function deliveryIdempotencyKey(
  root: string,
  channel: NotificationChannel,
  recipient: string,
): string {
  const safeRoot = String(root || '').replace(/\s+/g, '')
  const safeRecipient = String(recipient || '').replace(/\s+/g, '')
  return `${safeRoot}:${channel}:${safeRecipient}`.slice(0, 240)
}

/** Render deep link from policy template or explicit value. */
export function renderDeepLink(
  template: string | null | undefined,
  entityId: string,
  explicit?: string | null,
): string | null {
  if (explicit) return explicit
  if (!template) return null
  return template.replace(/\{entity_id\}/g, entityId)
}

/** Pure template helper for subjects/bodies. */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key]
    return v == null ? '' : String(v)
  })
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v || '').trim()).filter(Boolean)
}

async function resolvePolicy(
  client: SupabaseClient,
  workspaceId: string,
  eventType: string,
) {
  const { data: workspacePolicy } = await client
    .from('notification_policies')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('event_type', eventType)
    .maybeSingle()

  if (workspacePolicy) return workspacePolicy

  const { data: platformPolicy } = await client
    .from('notification_policies')
    .select('*')
    .is('workspace_id', null)
    .eq('event_type', eventType)
    .maybeSingle()

  return platformPolicy || null
}

async function getWorkspaceSettings(client: SupabaseClient, workspaceId: string) {
  const { data } = await client
    .from('workspace_notification_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  return (
    data || {
      workspace_id: workspaceId,
      email_enabled: false,
      slack_enabled: true,
      slack_webhook_url: null,
      email_from: null,
      email_reply_to: null,
      quiet_hours: {},
      metadata: {},
    }
  )
}

async function resolveSlackWebhook(
  client: SupabaseClient,
  workspaceId: string,
  settings: { slack_webhook_url?: string | null },
): Promise<string | null> {
  if (settings.slack_webhook_url) return String(settings.slack_webhook_url)

  const { data } = await client
    .from('assistant_context_profiles')
    .select('slack_webhook_url')
    .eq('workspace_id', workspaceId)
    .not('slack_webhook_url', 'is', null)
    .limit(1)
    .maybeSingle()

  return data?.slack_webhook_url ? String(data.slack_webhook_url) : null
}

/**
 * Expand recipient_rules into concrete targets.
 * Returns user ids + synthetic scope recipients for in_app broadcast.
 */
export async function expandRecipients(
  client: SupabaseClient,
  workspaceId: string,
  rules: RecipientRules | null | undefined,
  payload: Record<string, unknown> = {},
): Promise<{
  userIds: string[]
  scopeTargets: string[]
  roleTargets: string[]
}> {
  const userIds = new Set<string>()
  const scopeTargets = new Set<string>()
  const roleTargets = new Set<string>()

  const r = rules || {}
  for (const id of asStringArray(r.user_ids)) userIds.add(id)

  for (const key of asStringArray(r.dynamic)) {
    const val = payload[key]
    if (typeof val === 'string' && val.trim()) userIds.add(val.trim())
  }

  const roles = asStringArray(r.roles)
  const scopes = asStringArray(r.scopes)

  if (roles.length || scopes.length) {
    const { data: members } = await client
      .from('workspace_members')
      .select('user_id, role, permission_schema_id')
      .eq('workspace_id', workspaceId)

    for (const m of members || []) {
      const uid = String(m.user_id || '')
      if (!uid) continue
      const role = String(m.role || '')
      if (roles.includes(role)) {
        userIds.add(uid)
        roleTargets.add(role)
      }
    }

    // Scope expansion: check each member (small teams; MVP ok)
    if (scopes.length) {
      for (const scope of scopes) scopeTargets.add(scope)
      for (const m of members || []) {
        const uid = String(m.user_id || '')
        if (!uid) continue
        try {
          const { scopes: memberScopes } = await resolveScopesForUser(client, workspaceId, uid)
          if (scopes.some((s) => hasScope(memberScopes, s, { emptyMeansFull: false }))) {
            userIds.add(uid)
          }
        } catch {
          // ignore per-member failures
        }
      }

      // Always include owner via workspaces.owner_id as safety net for approve/verify
      const { data: ws } = await client
        .from('workspaces')
        .select('owner_id')
        .eq('id', workspaceId)
        .maybeSingle()
      if (ws?.owner_id) userIds.add(String(ws.owner_id))
    }
  }

  return {
    userIds: [...userIds],
    scopeTargets: [...scopeTargets],
    roleTargets: [...roleTargets],
  }
}

async function insertDelivery(
  client: SupabaseClient,
  row: {
    workspace_id: string
    event_type: string
    entity_type: string
    entity_id: string
    channel: NotificationChannel
    recipient: string
    recipient_user_id?: string | null
    status: DeliveryStatus
    provider_ref?: string | null
    payload_snapshot?: Record<string, unknown>
    error?: string | null
    idempotency_key: string
    sent_at?: string | null
  },
): Promise<{ id: string | null; deduped: boolean }> {
  const { data, error } = await client
    .from('notification_deliveries')
    .insert({
      ...row,
      payload_snapshot: row.payload_snapshot || {},
      sent_at: row.sent_at || (row.status === 'sent' ? new Date().toISOString() : null),
    })
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
      return { id: null, deduped: true }
    }
    console.error('[notifications] delivery insert failed', error.message)
    return { id: null, deduped: false }
  }
  return { id: data?.id || null, deduped: false }
}

async function deliverInApp(
  client: SupabaseClient,
  params: {
    workspaceId: string
    eventType: string
    entityType: string
    entityId: string
    title: string
    body: string | null
    priority: NotificationPriority
    deepLink: string | null
    payload: Record<string, unknown>
    targetScope: string
    idempotencyRoot: string
  },
): Promise<DeliveryResult> {
  const recipient = `scope:${params.targetScope}`
  const key = deliveryIdempotencyKey(params.idempotencyRoot, 'in_app', recipient)

  const { data: notification, error } = await client
    .from('store_ops_notifications')
    .insert({
      workspace_id: params.workspaceId,
      notification_type: params.eventType.replace(/\./g, '_'),
      title: params.title,
      body: params.body,
      priority: params.priority,
      status: 'unread',
      target_scope: params.targetScope,
      entity_type: params.entityType,
      entity_id: params.entityId,
      deep_link: params.deepLink,
      payload: {
        ...params.payload,
        event_type: params.eventType,
      },
    })
    .select('id')
    .maybeSingle()

  if (error) {
    // Unique conflicts unlikely on notifications; still record failed delivery
    const del = await insertDelivery(client, {
      workspace_id: params.workspaceId,
      event_type: params.eventType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      channel: 'in_app',
      recipient,
      status: 'failed',
      error: error.message,
      idempotency_key: key,
      payload_snapshot: { title: params.title, deep_link: params.deepLink },
    })
    return {
      channel: 'in_app',
      recipient,
      status: 'failed',
      delivery_id: del.id,
      error: error.message,
    }
  }

  const del = await insertDelivery(client, {
    workspace_id: params.workspaceId,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    channel: 'in_app',
    recipient,
    status: 'sent',
    provider_ref: notification?.id || null,
    idempotency_key: key,
    payload_snapshot: {
      title: params.title,
      body: params.body,
      deep_link: params.deepLink,
      in_app_notification_id: notification?.id || null,
    },
  })

  return {
    channel: 'in_app',
    recipient,
    status: del.deduped ? 'sent' : 'sent',
    delivery_id: del.id,
    provider_ref: notification?.id || null,
    deduped: del.deduped,
    in_app_notification_id: notification?.id || null,
  }
}

async function deliverInAppToUser(
  client: SupabaseClient,
  params: {
    workspaceId: string
    eventType: string
    entityType: string
    entityId: string
    title: string
    body: string | null
    priority: NotificationPriority
    deepLink: string | null
    payload: Record<string, unknown>
    userId: string
    idempotencyRoot: string
  },
): Promise<DeliveryResult> {
  const recipient = `user:${params.userId}`
  const key = deliveryIdempotencyKey(params.idempotencyRoot, 'in_app', recipient)

  // Personal in-app: still use store_ops_notifications with target_scope user:{id}
  // so inbox can filter; HQ broadcast remains scope-based.
  const { data: notification, error } = await client
    .from('store_ops_notifications')
    .insert({
      workspace_id: params.workspaceId,
      notification_type: params.eventType.replace(/\./g, '_'),
      title: params.title,
      body: params.body,
      priority: params.priority,
      status: 'unread',
      target_scope: `user:${params.userId}`,
      entity_type: params.entityType,
      entity_id: params.entityId,
      deep_link: params.deepLink,
      payload: {
        ...params.payload,
        event_type: params.eventType,
        recipient_user_id: params.userId,
      },
    })
    .select('id')
    .maybeSingle()

  if (error) {
    const del = await insertDelivery(client, {
      workspace_id: params.workspaceId,
      event_type: params.eventType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      channel: 'in_app',
      recipient,
      recipient_user_id: params.userId,
      status: 'failed',
      error: error.message,
      idempotency_key: key,
    })
    return { channel: 'in_app', recipient, status: 'failed', delivery_id: del.id, error: error.message }
  }

  const del = await insertDelivery(client, {
    workspace_id: params.workspaceId,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    channel: 'in_app',
    recipient,
    recipient_user_id: params.userId,
    status: 'sent',
    provider_ref: notification?.id || null,
    idempotency_key: key,
    payload_snapshot: {
      title: params.title,
      deep_link: params.deepLink,
      in_app_notification_id: notification?.id || null,
    },
  })

  return {
    channel: 'in_app',
    recipient,
    status: 'sent',
    delivery_id: del.id,
    provider_ref: notification?.id || null,
    deduped: del.deduped,
    in_app_notification_id: notification?.id || null,
  }
}

async function deliverSlack(
  client: SupabaseClient,
  params: {
    workspaceId: string
    eventType: string
    entityType: string
    entityId: string
    title: string
    body: string | null
    deepLink: string | null
    webhookUrl: string | null
    idempotencyRoot: string
    dryRun?: boolean
  },
): Promise<DeliveryResult> {
  const recipient = 'workspace_slack'
  const key = deliveryIdempotencyKey(params.idempotencyRoot, 'slack', recipient)

  if (!params.webhookUrl) {
    const del = await insertDelivery(client, {
      workspace_id: params.workspaceId,
      event_type: params.eventType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      channel: 'slack',
      recipient,
      status: 'skipped',
      error: 'no_slack_webhook_configured',
      idempotency_key: key,
      payload_snapshot: { title: params.title },
    })
    return {
      channel: 'slack',
      recipient,
      status: 'skipped',
      delivery_id: del.id,
      error: 'no_slack_webhook_configured',
      deduped: del.deduped,
    }
  }

  if (params.dryRun) {
    const del = await insertDelivery(client, {
      workspace_id: params.workspaceId,
      event_type: params.eventType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      channel: 'slack',
      recipient,
      status: 'skipped',
      error: 'dry_run',
      idempotency_key: key,
    })
    return { channel: 'slack', recipient, status: 'skipped', delivery_id: del.id, error: 'dry_run' }
  }

  const text = [
    `*${params.title}*`,
    params.body || '',
    params.deepLink ? `<${absoluteAppUrl(params.deepLink)}|Open in SKUMS>` : '',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const res = await fetch(params.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      const del = await insertDelivery(client, {
        workspace_id: params.workspaceId,
        event_type: params.eventType,
        entity_type: params.entityType,
        entity_id: params.entityId,
        channel: 'slack',
        recipient,
        status: 'failed',
        error: `slack_http_${res.status}: ${errText.slice(0, 200)}`,
        idempotency_key: key,
        payload_snapshot: { title: params.title, deep_link: params.deepLink },
      })
      return {
        channel: 'slack',
        recipient,
        status: 'failed',
        delivery_id: del.id,
        error: errText.slice(0, 200),
      }
    }

    const del = await insertDelivery(client, {
      workspace_id: params.workspaceId,
      event_type: params.eventType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      channel: 'slack',
      recipient,
      status: 'sent',
      provider_ref: 'slack_webhook',
      idempotency_key: key,
      payload_snapshot: { title: params.title, deep_link: params.deepLink, text },
    })
    return {
      channel: 'slack',
      recipient,
      status: 'sent',
      delivery_id: del.id,
      provider_ref: 'slack_webhook',
      deduped: del.deduped,
    }
  } catch (err: any) {
    const del = await insertDelivery(client, {
      workspace_id: params.workspaceId,
      event_type: params.eventType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      channel: 'slack',
      recipient,
      status: 'failed',
      error: err?.message || 'slack_send_failed',
      idempotency_key: key,
    })
    return {
      channel: 'slack',
      recipient,
      status: 'failed',
      delivery_id: del.id,
      error: err?.message || 'slack_send_failed',
    }
  }
}

function absoluteAppUrl(path: string): string {
  const base =
    process.env.NUXT_PUBLIC_SITE_URL
    || process.env.SITE_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || 'https://fran-skums.vercel.app'
  const origin = base.startsWith('http') ? base : `https://${base}`
  if (path.startsWith('http')) return path
  return `${origin.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

async function deliverEmailSkipped(
  client: SupabaseClient,
  params: {
    workspaceId: string
    eventType: string
    entityType: string
    entityId: string
    userId: string
    title: string
    deepLink: string | null
    idempotencyRoot: string
    reason: string
  },
): Promise<DeliveryResult> {
  const recipient = `user:${params.userId}`
  const key = deliveryIdempotencyKey(params.idempotencyRoot, 'email', recipient)
  const del = await insertDelivery(client, {
    workspace_id: params.workspaceId,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    channel: 'email',
    recipient,
    recipient_user_id: params.userId,
    status: 'skipped',
    error: params.reason,
    idempotency_key: key,
    payload_snapshot: { title: params.title, deep_link: params.deepLink },
  })
  return {
    channel: 'email',
    recipient,
    status: 'skipped',
    delivery_id: del.id,
    error: params.reason,
    deduped: del.deduped,
  }
}

/**
 * Core emit: resolve policy → expand recipients → deliver channels → audit.
 * Failures on individual channels do not throw (lifecycle must not roll back).
 */
export async function emitLifecycleNotification(
  client: SupabaseClient,
  input: EmitNotificationInput,
): Promise<EmitNotificationResult> {
  const eventType = String(input.eventType || '').trim()
  const workspaceId = String(input.workspaceId || '').trim()
  const entityId = String(input.entityId || '').trim()
  const entityType = String(input.entityType || '').trim()

  if (!workspaceId || !eventType || !entityId || !entityType) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_required_fields',
      event_type: eventType,
      deliveries: [],
    }
  }

  const policy = await resolvePolicy(client, workspaceId, eventType)
  if (!policy || policy.enabled === false) {
    return {
      ok: true,
      skipped: true,
      reason: policy ? 'policy_disabled' : 'no_policy',
      event_type: eventType,
      policy_id: policy?.id || null,
      deliveries: [],
    }
  }

  const settings = await getWorkspaceSettings(client, workspaceId)
  const payload = {
    ...(input.payload || {}),
    actor: input.actorUserId || (input.payload as any)?.actor || null,
  }

  const deepLink = renderDeepLink(
    policy.metadata?.deep_link_template,
    entityId,
    input.deepLink,
  )

  const priority = (input.priority || policy.priority_default || 'normal') as NotificationPriority
  const channels = (input.channels
    || (Array.isArray(policy.channels) ? policy.channels : ['in_app'])) as NotificationChannel[]

  const rules = (policy.recipient_rules || {}) as RecipientRules
  const expanded = await expandRecipients(client, workspaceId, rules, payload)
  const idempotencyRoot =
    input.idempotencyRoot || `${eventType}:${entityId}`

  const deliveries: DeliveryResult[] = []
  const body = input.body || null
  const title = input.title

  // Audit: notification requested
  await recordAudit(client, {
    workspace_id: workspaceId,
    entity_type: entityType,
    entity_id: entityId,
    event_type: 'notification.requested',
    operation: 'INSERT',
    channel: 'system',
    actor_user_id: input.actorUserId || null,
    actor_kind: 'system',
    idempotency_key: `notif.req.${idempotencyRoot}`,
    metadata: {
      notification_event: eventType,
      channels,
      user_count: expanded.userIds.length,
      scope_targets: expanded.scopeTargets,
    },
  })

  for (const channel of channels) {
    if (channel === 'in_app') {
      // HQ-style: one inbox row per target scope when scopes configured
      if (expanded.scopeTargets.length) {
        for (const scope of expanded.scopeTargets) {
          const r = await deliverInApp(client, {
            workspaceId,
            eventType,
            entityType,
            entityId,
            title,
            body,
            priority,
            deepLink,
            payload,
            targetScope: scope,
            idempotencyRoot,
          })
          deliveries.push(r)
        }
      } else if (expanded.userIds.length) {
        for (const userId of expanded.userIds) {
          const r = await deliverInAppToUser(client, {
            workspaceId,
            eventType,
            entityType,
            entityId,
            title,
            body,
            priority,
            deepLink,
            payload,
            userId,
            idempotencyRoot,
          })
          deliveries.push(r)
        }
      } else if (asStringArray(rules.roles).length || asStringArray(rules.scopes).length) {
        // Role/scope policy but no members resolved → still open HQ approve inbox
        const r = await deliverInApp(client, {
          workspaceId,
          eventType,
          entityType,
          entityId,
          title,
          body,
          priority,
          deepLink,
          payload,
          targetScope: asStringArray(rules.scopes)[0] || 'store_ops:approve',
          idempotencyRoot,
        })
        deliveries.push(r)
      } else {
        // Dynamic-only policy with no resolvable users (e.g. POS request without requested_by)
        deliveries.push({
          channel: 'in_app',
          recipient: 'none',
          status: 'skipped',
          error: 'no_in_app_recipients',
        })
      }
    } else if (channel === 'slack') {
      if (!settings.slack_enabled) {
        const key = deliveryIdempotencyKey(idempotencyRoot, 'slack', 'workspace_slack')
        const del = await insertDelivery(client, {
          workspace_id: workspaceId,
          event_type: eventType,
          entity_type: entityType,
          entity_id: entityId,
          channel: 'slack',
          recipient: 'workspace_slack',
          status: 'skipped',
          error: 'slack_disabled',
          idempotency_key: key,
        })
        deliveries.push({
          channel: 'slack',
          recipient: 'workspace_slack',
          status: 'skipped',
          delivery_id: del.id,
          error: 'slack_disabled',
        })
        continue
      }
      const webhook = await resolveSlackWebhook(client, workspaceId, settings)
      const r = await deliverSlack(client, {
        workspaceId,
        eventType,
        entityType,
        entityId,
        title,
        body,
        deepLink,
        webhookUrl: webhook,
        idempotencyRoot,
        dryRun: input.dryRun,
      })
      deliveries.push(r)
    } else if (channel === 'email') {
      // N3 email provider optional — mark skipped until RESEND_API_KEY + email_enabled
      const emailReady =
        Boolean(settings.email_enabled)
        && Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_PROVIDER_API_KEY)
      const targets = expanded.userIds.length ? expanded.userIds : []
      if (!targets.length) {
        deliveries.push({
          channel: 'email',
          recipient: 'none',
          status: 'skipped',
          error: 'no_email_recipients',
        })
        continue
      }
      for (const userId of targets) {
        if (!emailReady || !deepLink) {
          deliveries.push(
            await deliverEmailSkipped(client, {
              workspaceId,
              eventType,
              entityType,
              entityId,
              userId,
              title,
              deepLink,
              idempotencyRoot,
              reason: !deepLink
                ? 'no_deep_link'
                : !settings.email_enabled
                  ? 'email_disabled'
                  : 'email_provider_not_configured',
            }),
          )
          continue
        }
        // Provider hook reserved for N3 — still skip with reason until wired
        deliveries.push(
          await deliverEmailSkipped(client, {
            workspaceId,
            eventType,
            entityType,
            entityId,
            userId,
            title,
            deepLink,
            idempotencyRoot,
            reason: 'email_provider_not_wired',
          }),
        )
      }
    }
  }

  // Audit summary of delivery outcomes
  await recordAudit(client, {
    workspace_id: workspaceId,
    entity_type: entityType,
    entity_id: entityId,
    event_type: 'notification.delivered',
    operation: 'INSERT',
    channel: 'system',
    actor_user_id: input.actorUserId || null,
    actor_kind: 'system',
    idempotency_key: `notif.del.${idempotencyRoot}`,
    metadata: {
      notification_event: eventType,
      outcomes: deliveries.map((d) => ({
        channel: d.channel,
        recipient: d.recipient,
        status: d.status,
        error: d.error || null,
      })),
    },
  })

  return {
    ok: true,
    event_type: eventType,
    policy_id: policy.id,
    deliveries,
  }
}
