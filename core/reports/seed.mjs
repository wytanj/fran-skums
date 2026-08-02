/**
 * Platform seed report packs (shared by Nitro + MCP).
 * ensureDefaultSubscriptions is idempotent — safe on every list/run.
 */

/** Slugs that get a default (disabled) subscription per workspace. */
export const REPORT_SEED_SLUGS = [
  'marketing-weekly',
  'warehouse-weekly-baseline',
  'finance-stock-rewards',
  'daily-stockout',
]

/**
 * Ensure default (disabled) subscriptions exist for platform seed packs.
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} workspaceId
 * @param {string | null} [createdBy]
 */
export async function ensureDefaultSubscriptions(client, workspaceId, createdBy = null) {
  const { data: templates, error: tErr } = await client
    .from('report_templates')
    .select('id, slug, default_schedule, default_timezone, default_channels, audience_hint')
    .is('workspace_id', null)
    .eq('is_active', true)
    .in('slug', [...REPORT_SEED_SLUGS])

  if (tErr) throw new Error(tErr.message)
  if (!templates?.length) return

  const { data: existing, error: eErr } = await client
    .from('report_subscriptions')
    .select('template_id')
    .eq('workspace_id', workspaceId)

  if (eErr) throw new Error(eErr.message)
  const have = new Set((existing || []).map((r) => r.template_id))

  const rows = templates
    .filter((t) => !have.has(t.id))
    .map((t) => ({
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
