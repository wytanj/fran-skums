/**
 * Track K — agentic report registry helpers.
 * Subscribe/toggle packs; runs are suggest-only (no auto approve/Loft/FOB).
 * Rpt-3: cron due + Phase N deliver · Rpt-5: n8n webhook out.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSubscriptionDue } from '../../core/reports/schedule.mjs'
import { runStubSections } from '../../core/reports/sections.mjs'
import { emitLifecycleNotification } from './notifications'

export type ReportSchedule = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual'
export type ReportRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type ReportTriggerSource = 'manual' | 'cron' | 'mcp' | 'webhook' | 'api'

export interface ReportTemplate {
  id: string
  workspace_id: string | null
  slug: string
  title: string
  description: string | null
  audience_hint: string
  default_sections: string[]
  default_schedule: ReportSchedule
  default_timezone: string
  default_channels: string[]
  is_active: boolean
  metadata: Record<string, unknown>
}

export interface ReportSubscription {
  id: string
  workspace_id: string
  template_id: string
  enabled: boolean
  schedule: ReportSchedule
  timezone: string
  channels: string[]
  audience: string | null
  sections_override: string[] | null
  metadata: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface ReportRun {
  id: string
  workspace_id: string
  subscription_id: string
  status: ReportRunStatus
  trigger_source: ReportTriggerSource
  started_at: string | null
  finished_at: string | null
  payload_json: Record<string, unknown>
  markdown_summary: string | null
  error: string | null
  created_at?: string
}

export interface ReportPackCard {
  template: ReportTemplate
  subscription: ReportSubscription
  last_run: ReportRun | null
  sections: string[]
}

const SEED_SLUGS = [
  'marketing-weekly',
  'warehouse-weekly-baseline',
  'finance-stock-rewards',
] as const

export { isSubscriptionDue }

/** Platform + workspace templates visible to a workspace. */
export async function listReportTemplates(
  client: SupabaseClient,
  workspaceId: string,
): Promise<ReportTemplate[]> {
  const { data, error } = await client
    .from('report_templates')
    .select('*')
    .eq('is_active', true)
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .order('title', { ascending: true })

  if (error) throw new Error(error.message)
  return (data || []) as ReportTemplate[]
}

/**
 * Ensure default (disabled) subscriptions exist for platform seed packs.
 * Idempotent — safe on every list.
 */
export async function ensureDefaultSubscriptions(
  client: SupabaseClient,
  workspaceId: string,
  createdBy?: string | null,
): Promise<void> {
  const { data: templates, error: tErr } = await client
    .from('report_templates')
    .select('id, slug, default_schedule, default_timezone, default_channels, audience_hint')
    .is('workspace_id', null)
    .eq('is_active', true)
    .in('slug', [...SEED_SLUGS])

  if (tErr) throw new Error(tErr.message)
  if (!templates?.length) return

  const { data: existing, error: eErr } = await client
    .from('report_subscriptions')
    .select('template_id')
    .eq('workspace_id', workspaceId)

  if (eErr) throw new Error(eErr.message)
  const have = new Set((existing || []).map((r: any) => r.template_id))

  const rows = templates
    .filter((t: any) => !have.has(t.id))
    .map((t: any) => ({
      workspace_id: workspaceId,
      template_id: t.id,
      enabled: false,
      schedule: t.default_schedule || 'weekly',
      timezone: t.default_timezone || 'Asia/Singapore',
      channels: t.default_channels || ['in_app'],
      audience: t.audience_hint || null,
      metadata: { seed: true },
      created_by: createdBy || null,
    }))

  if (!rows.length) return
  const { error: iErr } = await client.from('report_subscriptions').insert(rows)
  if (iErr) throw new Error(iErr.message)
}

export async function listSubscriptionsWithLastRun(
  client: SupabaseClient,
  workspaceId: string,
): Promise<ReportPackCard[]> {
  await ensureDefaultSubscriptions(client, workspaceId)

  const templates = await listReportTemplates(client, workspaceId)
  const byId = new Map(templates.map((t) => [t.id, t]))

  const { data: subs, error: sErr } = await client
    .from('report_subscriptions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (sErr) throw new Error(sErr.message)

  const subIds = (subs || []).map((s: any) => s.id)
  const lastBySub = new Map<string, ReportRun>()

  if (subIds.length) {
    const { data: runs, error: rErr } = await client
      .from('report_runs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('subscription_id', subIds)
      .order('created_at', { ascending: false })
      .limit(Math.min(subIds.length * 5, 100))

    if (rErr) throw new Error(rErr.message)
    for (const run of runs || []) {
      if (!lastBySub.has(run.subscription_id)) {
        lastBySub.set(run.subscription_id, run as ReportRun)
      }
    }
  }

  const cards: ReportPackCard[] = []
  for (const sub of subs || []) {
    const template = byId.get(sub.template_id)
    if (!template) continue
    const sections =
      Array.isArray(sub.sections_override) && sub.sections_override.length
        ? sub.sections_override
        : template.default_sections || []
    cards.push({
      template,
      subscription: sub as ReportSubscription,
      last_run: lastBySub.get(sub.id) || null,
      sections,
    })
  }

  cards.sort((a, b) => {
    if (a.subscription.enabled !== b.subscription.enabled) {
      return a.subscription.enabled ? -1 : 1
    }
    return a.template.title.localeCompare(b.template.title)
  })
  return cards
}

export async function setSubscriptionEnabled(
  client: SupabaseClient,
  workspaceId: string,
  subscriptionId: string,
  enabled: boolean,
): Promise<ReportSubscription> {
  const { data, error } = await client
    .from('report_subscriptions')
    .update({ enabled: Boolean(enabled), updated_at: new Date().toISOString() })
    .eq('id', subscriptionId)
    .eq('workspace_id', workspaceId)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Subscription not found')
  return data as ReportSubscription
}

export async function getReportRun(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
): Promise<ReportRun | null> {
  const { data, error } = await client
    .from('report_runs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ReportRun) || null
}

export async function getSubscriptionBySlugOrId(
  client: SupabaseClient,
  workspaceId: string,
  opts: { subscriptionId?: string; templateSlug?: string },
): Promise<{ subscription: ReportSubscription; template: ReportTemplate | null } | null> {
  if (opts.subscriptionId) {
    const { data, error } = await client
      .from('report_subscriptions')
      .select('*, report_templates(*)')
      .eq('workspace_id', workspaceId)
      .eq('id', opts.subscriptionId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return {
      subscription: data as ReportSubscription,
      template: ((data as any).report_templates as ReportTemplate) || null,
    }
  }
  if (opts.templateSlug) {
    await ensureDefaultSubscriptions(client, workspaceId)
    const { data: tmpl, error: tErr } = await client
      .from('report_templates')
      .select('id')
      .eq('slug', opts.templateSlug)
      .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
      .limit(1)
      .maybeSingle()
    if (tErr) throw new Error(tErr.message)
    if (!tmpl) return null
    const { data, error } = await client
      .from('report_subscriptions')
      .select('*, report_templates(*)')
      .eq('workspace_id', workspaceId)
      .eq('template_id', tmpl.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return {
      subscription: data as ReportSubscription,
      template: ((data as any).report_templates as ReportTemplate) || null,
    }
  }
  return null
}

export { runStubSections }

/**
 * Resolve n8n/outbound automation webhook URL for a subscription.
 * Order: subscription.metadata.webhook_url → workspace settings metadata.
 */
export async function resolveAutomationsWebhookUrl(
  client: SupabaseClient,
  workspaceId: string,
  subscription: ReportSubscription,
): Promise<string | null> {
  const meta = (subscription.metadata || {}) as Record<string, unknown>
  const fromSub = meta.webhook_url || meta.automations_webhook_url
  if (typeof fromSub === 'string' && fromSub.startsWith('http')) return fromSub.trim()

  const { data } = await client
    .from('workspace_notification_settings')
    .select('metadata')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const wmeta = (data?.metadata || {}) as Record<string, unknown>
  const fromWs = wmeta.report_webhook_url || wmeta.automations_webhook_url
  if (typeof fromWs === 'string' && fromWs.startsWith('http')) return fromWs.trim()
  return null
}

/** Phase N in_app/slack + optional n8n webhook out (Rpt-3 / Rpt-5). */
export async function deliverReportRun(
  client: SupabaseClient,
  opts: {
    run: ReportRun
    subscription: ReportSubscription
    template: ReportTemplate | null
    actorUserId?: string | null
  },
): Promise<{ phase_n: unknown; webhook: { status: string; error?: string | null } | null }> {
  const { run, subscription, template } = opts
  const title = `Report ready: ${template?.title || 'Agentic pack'}`
  const body = (run.markdown_summary || '').slice(0, 1500)
  const deepLink = `/reports?run=${run.id}`

  const channels = (subscription.channels || ['in_app']).filter(
    (c) => c === 'in_app' || c === 'slack',
  ) as Array<'in_app' | 'slack'>

  const phase_n = await emitLifecycleNotification(client, {
    workspaceId: run.workspace_id,
    eventType: 'report.run.completed',
    entityType: 'report_run',
    entityId: run.id,
    title,
    body: body || null,
    deepLink,
    priority: 'normal',
    actorUserId: opts.actorUserId || null,
    channels: channels.length ? channels : ['in_app'],
    payload: {
      subscription_id: subscription.id,
      template_slug: template?.slug || null,
      template_title: template?.title || null,
      trigger_source: run.trigger_source,
      status: run.status,
    },
    idempotencyRoot: `report.run.completed:${run.id}`,
  })

  let webhook: { status: string; error?: string | null } | null = null
  const channelsAll = subscription.channels || []
  const meta = (subscription.metadata || {}) as Record<string, unknown>
  const wantsWebhook =
    channelsAll.includes('webhook')
    || typeof meta.webhook_url === 'string'
    || typeof meta.automations_webhook_url === 'string'

  if (wantsWebhook) {
    const url = await resolveAutomationsWebhookUrl(client, run.workspace_id, subscription)
    if (!url) {
      webhook = { status: 'skipped', error: 'no_webhook_url' }
    } else {
      webhook = await postAutomationsWebhook(url, {
        event: 'report.run.completed',
        workspace_id: run.workspace_id,
        run_id: run.id,
        subscription_id: subscription.id,
        template_slug: template?.slug || null,
        template_title: template?.title || null,
        status: run.status,
        markdown_summary: run.markdown_summary,
        payload_json: run.payload_json,
        deep_link: deepLink,
        suggest_only: true,
        finished_at: run.finished_at,
      })
    }
  }

  return { phase_n, webhook }
}

async function postAutomationsWebhook(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: string; error?: string | null }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'fran-skums-reports/1.0',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return { status: 'failed', error: `HTTP ${res.status}` }
    }
    return { status: 'sent', error: null }
  } catch (e: any) {
    return { status: 'failed', error: e?.message || String(e) }
  }
}

export async function runSubscriptionNow(
  client: SupabaseClient,
  opts: {
    workspaceId: string
    subscriptionId: string
    triggerSource?: ReportTriggerSource
    createdBy?: string | null
    /** Allow run when subscription disabled (admin force) */
    force?: boolean
    /** Deliver Phase N + webhook after complete (default true) */
    deliver?: boolean
  },
): Promise<ReportRun & { delivery?: unknown }> {
  const { data: sub, error: sErr } = await client
    .from('report_subscriptions')
    .select('*, report_templates(*)')
    .eq('id', opts.subscriptionId)
    .eq('workspace_id', opts.workspaceId)
    .maybeSingle()

  if (sErr) throw new Error(sErr.message)
  if (!sub) throw new Error('Subscription not found')
  if (!sub.enabled && !opts.force) {
    throw new Error('Subscription is disabled — enable the pack toggle first')
  }

  const template = (sub as any).report_templates as ReportTemplate | null
  const sections =
    Array.isArray(sub.sections_override) && sub.sections_override.length
      ? sub.sections_override
      : template?.default_sections || []

  const started = new Date().toISOString()
  const { data: pending, error: pErr } = await client
    .from('report_runs')
    .insert({
      workspace_id: opts.workspaceId,
      subscription_id: opts.subscriptionId,
      status: 'running',
      trigger_source: opts.triggerSource || 'manual',
      started_at: started,
      created_by: opts.createdBy || null,
      payload_json: {},
    })
    .select('*')
    .single()

  if (pErr) throw new Error(pErr.message)

  try {
    const stub = runStubSections(sections)
    const finished = new Date().toISOString()
    const payload = {
      template_slug: template?.slug || null,
      template_title: template?.title || null,
      sections: stub.sections,
      suggest_only: true,
      note: 'Stub sections until Rpt-6 real handlers',
    }
    const { data: done, error: uErr } = await client
      .from('report_runs')
      .update({
        status: 'completed',
        finished_at: finished,
        payload_json: payload,
        markdown_summary: stub.markdown,
      })
      .eq('id', pending.id)
      .select('*')
      .single()

    if (uErr) throw new Error(uErr.message)

    const run = done as ReportRun
    let delivery: unknown = null
    if (opts.deliver !== false) {
      try {
        delivery = await deliverReportRun(client, {
          run,
          subscription: sub as ReportSubscription,
          template,
          actorUserId: opts.createdBy || null,
        })
      } catch (e: any) {
        // Delivery must not fail the run
        delivery = { error: e?.message || String(e) }
      }
    }
    return Object.assign(run, { delivery })
  } catch (e: any) {
    const msg = e?.message || String(e)
    await client
      .from('report_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: msg,
      })
      .eq('id', pending.id)
    throw e
  }
}

/**
 * Rpt-3: find enabled due subscriptions and run them.
 */
export async function runReportCronTick(
  client: SupabaseClient,
  opts: {
    limit?: number
    workspaceId?: string
    now?: Date
  } = {},
): Promise<{
  scanned: number
  due: number
  ran: number
  skipped: number
  failed: number
  results: Array<{
    subscription_id: string
    workspace_id: string
    status: string
    run_id?: string
    error?: string
  }>
}> {
  const limit = Math.min(Math.max(opts.limit || 50, 1), 200)
  const now = opts.now || new Date()

  let q = client
    .from('report_subscriptions')
    .select('*, report_templates(*)')
    .eq('enabled', true)
    .neq('schedule', 'manual')
    .limit(500)

  if (opts.workspaceId) {
    q = q.eq('workspace_id', opts.workspaceId)
  }

  const { data: subs, error } = await q
  if (error) throw new Error(error.message)

  const list = subs || []
  const results: Array<{
    subscription_id: string
    workspace_id: string
    status: string
    run_id?: string
    error?: string
  }> = []

  let due = 0
  let ran = 0
  let skipped = 0
  let failed = 0

  // Prefetch last completed run per subscription
  const subIds = list.map((s: any) => s.id)
  const lastBySub = new Map<string, string | null>()
  if (subIds.length) {
    const { data: runs } = await client
      .from('report_runs')
      .select('subscription_id, finished_at, status, created_at')
      .in('subscription_id', subIds)
      .in('status', ['completed', 'failed', 'skipped'])
      .order('created_at', { ascending: false })
      .limit(Math.min(subIds.length * 3, 600))

    for (const r of runs || []) {
      if (!lastBySub.has(r.subscription_id)) {
        lastBySub.set(r.subscription_id, r.finished_at || r.created_at || null)
      }
    }
  }

  for (const sub of list) {
    if (results.filter((r) => r.status === 'completed').length >= limit) break

    const last = lastBySub.get(sub.id) || null
    if (!isSubscriptionDue(sub, last, now)) {
      skipped++
      continue
    }
    due++
    try {
      const run = await runSubscriptionNow(client, {
        workspaceId: sub.workspace_id,
        subscriptionId: sub.id,
        triggerSource: 'cron',
        deliver: true,
      })
      ran++
      results.push({
        subscription_id: sub.id,
        workspace_id: sub.workspace_id,
        status: 'completed',
        run_id: run.id,
      })
    } catch (e: any) {
      failed++
      results.push({
        subscription_id: sub.id,
        workspace_id: sub.workspace_id,
        status: 'failed',
        error: e?.message || String(e),
      })
    }
  }

  return {
    scanned: list.length,
    due,
    ran,
    skipped,
    failed,
    results,
  }
}
