/**
 * MCP report registry helpers (track K / Rpt-4).
 * Mirrors server reportRegistry table access for list / get / run.
 * Suggest ≠ execute — never approve, Loft, or FOB.
 */
import { getDb, getMcpActorUserId, requireWorkspaceId } from '../context.mjs'
import { isSubscriptionDue } from '../../../core/reports/schedule.mjs'
import { runStubSections } from '../../../core/reports/sections.mjs'

function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

async function lastRunMap(db, workspaceId, subIds) {
  const map = new Map()
  if (!subIds.length) return map
  const { data: runs, error } = await db
    .from('report_runs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('subscription_id', subIds)
    .order('created_at', { ascending: false })
    .limit(Math.min(subIds.length * 5, 100))
  if (error) throw new Error(error.message)
  for (const r of runs || []) {
    if (!map.has(r.subscription_id)) map.set(r.subscription_id, r)
  }
  return map
}

/**
 * List packs for the workspace (enabled first).
 */
export async function listReports(args = {}) {
  const db = getDb()
  const workspaceId = requireWorkspaceId()
  const enabledOnly = Boolean(args.enabled_only)

  const { data: subs, error } = await db
    .from('report_subscriptions')
    .select('*, report_templates(*)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  let rows = subs || []
  if (enabledOnly) rows = rows.filter((s) => s.enabled)

  const last = await lastRunMap(
    db,
    workspaceId,
    rows.map((s) => s.id),
  )

  const packs = rows.map((s) => {
    const tmpl = s.report_templates || null
    const lastRun = last.get(s.id) || null
    return {
      subscription_id: s.id,
      enabled: s.enabled,
      schedule: s.schedule,
      timezone: s.timezone,
      channels: s.channels,
      audience: s.audience || tmpl?.audience_hint || null,
      template: tmpl
        ? {
            id: tmpl.id,
            slug: tmpl.slug,
            title: tmpl.title,
            description: tmpl.description,
            default_sections: tmpl.default_sections,
          }
        : null,
      last_run: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            trigger_source: lastRun.trigger_source,
            finished_at: lastRun.finished_at,
            created_at: lastRun.created_at,
          }
        : null,
      due_for_cron: isSubscriptionDue(
        s,
        lastRun?.finished_at || lastRun?.created_at || null,
      ),
    }
  })

  packs.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    const ta = a.template?.title || ''
    const tb = b.template?.title || ''
    return ta.localeCompare(tb)
  })

  return {
    workspace_id: workspaceId,
    count: packs.length,
    packs,
    agent_hint:
      'Toggle packs in /reports UI. reports_run only works when enabled (or force with reports:write). Suggest-only digests.',
  }
}

/**
 * Get one pack or one run.
 */
export async function getReport(args = {}) {
  const db = getDb()
  const workspaceId = requireWorkspaceId()
  const runId = trimString(args.run_id)
  const subscriptionId = trimString(args.subscription_id)
  const slug = trimString(args.template_slug)

  if (runId) {
    const { data, error } = await db
      .from('report_runs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', runId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Report run not found')
    return {
      kind: 'run',
      run: data,
      deep_link: `/reports?run=${data.id}`,
      note: 'suggest_only',
    }
  }

  let subQuery = db
    .from('report_subscriptions')
    .select('*, report_templates(*)')
    .eq('workspace_id', workspaceId)

  if (subscriptionId) {
    subQuery = subQuery.eq('id', subscriptionId)
  } else if (slug) {
    const { data: tmpl, error: tErr } = await db
      .from('report_templates')
      .select('id')
      .eq('slug', slug)
      .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
      .limit(1)
      .maybeSingle()
    if (tErr) throw new Error(tErr.message)
    if (!tmpl) throw new Error(`Template not found: ${slug}`)
    subQuery = subQuery.eq('template_id', tmpl.id)
  } else {
    throw new Error('Provide run_id, subscription_id, or template_slug')
  }

  const { data: sub, error } = await subQuery.maybeSingle()
  if (error) throw new Error(error.message)
  if (!sub) throw new Error('Subscription not found')

  const last = await lastRunMap(db, workspaceId, [sub.id])
  const lastRun = last.get(sub.id) || null

  return {
    kind: 'subscription',
    subscription_id: sub.id,
    enabled: sub.enabled,
    schedule: sub.schedule,
    timezone: sub.timezone,
    channels: sub.channels,
    template: sub.report_templates
      ? {
          slug: sub.report_templates.slug,
          title: sub.report_templates.title,
          description: sub.report_templates.description,
          default_sections: sub.report_templates.default_sections,
        }
      : null,
    last_run: lastRun,
    due_for_cron: isSubscriptionDue(
      sub,
      lastRun?.finished_at || lastRun?.created_at || null,
    ),
    deep_link: '/reports',
  }
}

/**
 * Run a pack now (stub sections until Rpt-6). Delivers Phase N if server-side;
 * MCP path writes run + best-effort does not emit Nuxt notifications (same tables).
 * For full delivery use UI/API/cron; MCP still creates the run row + markdown.
 */
export async function runReport(args = {}) {
  const db = getDb()
  const workspaceId = requireWorkspaceId()
  const subscriptionId = trimString(args.subscription_id)
  const slug = trimString(args.template_slug)
  const force = Boolean(args.force)

  let subId = subscriptionId
  let sub = null

  if (subId) {
    const { data, error } = await db
      .from('report_subscriptions')
      .select('*, report_templates(*)')
      .eq('workspace_id', workspaceId)
      .eq('id', subId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    sub = data
  } else if (slug) {
    const { data: tmpl, error: tErr } = await db
      .from('report_templates')
      .select('id')
      .eq('slug', slug)
      .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
      .limit(1)
      .maybeSingle()
    if (tErr) throw new Error(tErr.message)
    if (!tmpl) throw new Error(`Template not found: ${slug}`)
    const { data, error } = await db
      .from('report_subscriptions')
      .select('*, report_templates(*)')
      .eq('workspace_id', workspaceId)
      .eq('template_id', tmpl.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    sub = data
  } else {
    throw new Error('Provide subscription_id or template_slug')
  }

  if (!sub) throw new Error('Subscription not found')
  if (!sub.enabled && !force) {
    throw new Error('Subscription is disabled — enable the pack toggle first (or force with reports:write)')
  }

  const template = sub.report_templates || null
  const sections =
    Array.isArray(sub.sections_override) && sub.sections_override.length
      ? sub.sections_override
      : template?.default_sections || []

  const stub = runStubSections(sections)
  const started = new Date().toISOString()
  const actor = getMcpActorUserId()
  const { data: pending, error: pErr } = await db
    .from('report_runs')
    .insert({
      workspace_id: workspaceId,
      subscription_id: sub.id,
      status: 'running',
      trigger_source: 'mcp',
      started_at: started,
      created_by: actor || null,
      payload_json: {},
    })
    .select('*')
    .single()
  if (pErr) throw new Error(pErr.message)

  const finished = new Date().toISOString()
  const payload = {
    template_slug: template?.slug || null,
    template_title: template?.title || null,
    sections: stub.sections,
    suggest_only: true,
    note: 'Stub sections until Rpt-6 real handlers',
    via: 'mcp',
  }

  const { data: done, error: uErr } = await db
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

  return {
    run: done,
    deep_link: `/reports?run=${done.id}`,
    markdown_summary: stub.markdown,
    agent_hint:
      'Suggest-only. Share summary with human; do not invent stock actions. Full Phase N deliver happens on UI/API/cron path.',
  }
}
