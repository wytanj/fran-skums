/**
 * Track K — agentic report registry helpers.
 * Subscribe/toggle packs; runs are suggest-only (no auto approve/Loft/FOB).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

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
  let lastBySub = new Map<string, ReportRun>()

  if (subIds.length) {
    // Latest run per subscription (fetch recent, pick first per sub)
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

  // Sort: enabled first, then title
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

/**
 * Stub section runner — Rpt-6 will replace with real handlers.
 * Always suggest-only; never mutates stock or approves.
 */
export function runStubSections(sections: string[]): {
  sections: Array<{ id: string; status: string; summary: string; data: Record<string, unknown> }>
  markdown: string
} {
  const out = sections.map((id) => ({
    id,
    status: 'stub',
    summary: `Section \`${id}\` is registered but not yet implemented (Rpt-6).`,
    data: { stub: true },
  }))
  const lines = [
    '## Report run (stub sections)',
    '',
    '_Suggest ≠ execute. No stock, approve, Loft, or FOB side effects._',
    '',
    ...out.map((s) => `- **${s.id}**: ${s.summary}`),
  ]
  return { sections: out, markdown: lines.join('\n') }
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
  },
): Promise<ReportRun> {
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
    return done as ReportRun
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
