/**
 * Append-only audit writer for UI / MCP / API provenance (M1).
 * Works with any Supabase-js client (service role or user session).
 */

/** @typedef {'ui'|'mcp'|'api'|'assistant'|'cron'|'worker'|'import'|'sync'|'app'|'system'|'db_trigger'} AuditChannel */

/** @typedef {'user'|'agent'|'system'|'service'} ActorKind */

/**
 * @typedef {object} RecordAuditInput
 * @property {string} workspace_id
 * @property {string} entity_type
 * @property {string} entity_id
 * @property {string} [event_type]
 * @property {'INSERT'|'UPDATE'|'DELETE'|'IMPORT'|'SYNC'|'VERIFY'|'ATTEST'} operation
 * @property {AuditChannel} channel
 * @property {string|null} [actor_user_id]
 * @property {ActorKind} [actor_kind]
 * @property {string|null} [client_name]
 * @property {string|null} [tool_name]
 * @property {string|null} [request_id]
 * @property {string|null} [idempotency_key]
 * @property {string|null} [source_id]
 * @property {unknown} [before_data]
 * @property {unknown} [after_data]
 * @property {Record<string, unknown>} [metadata]
 * @property {Record<string, unknown>} [diff]
 */

/**
 * Build envelope for MCP/API mutation responses.
 * @param {{
 *   object_type: string,
 *   id: string,
 *   status?: string|null,
 *   is_draft?: boolean,
 *   channel?: string,
 *   next_allowed_actions?: string[],
 *   [key: string]: unknown,
 * }} fields
 */
export function mutationEnvelope(fields) {
  const status = fields.status ?? null
  const is_draft =
    fields.is_draft != null
      ? Boolean(fields.is_draft)
      : status === 'draft' || status === 'proposed'
  return {
    object_type: fields.object_type,
    id: fields.id,
    status,
    is_draft,
    channel: fields.channel || 'mcp',
    next_allowed_actions: fields.next_allowed_actions || [],
    ...fields,
  }
}

/**
 * Suggest next actions from PO / pipeline status (safe-profile friendly).
 * @param {string} objectType
 * @param {string|null|undefined} status
 */
export function defaultNextActions(objectType, status) {
  const s = String(status || '')
  if (objectType === 'internal_purchase_order' || objectType === 'internal_purchase_orders') {
    if (s === 'draft') return ['po_update_draft', 'po_add_lines', 'po_get', 'po_submit']
    if (s === 'pending_approval') return ['po_get', 'po_decide']
    if (s === 'approved' || s === 'rejected') return ['po_get', 'po_export']
  }
  if (objectType === 'pipeline_candidate' || objectType === 'pipeline_candidates') {
    if (s === 'proposed' || s === 'deferred') return ['pipeline_list', 'pipeline_decide']
    if (s === 'accepted') return ['pipeline_execute', 'pipeline_list']
    if (s === 'executed' || s === 'rejected') return ['pipeline_list']
  }
  if (objectType === 'product' || objectType === 'products') {
    if (s === 'draft') return ['review_in_ui', 'activate_when_ready']
    return ['review_in_ui']
  }
  if (objectType === 'study_session' || objectType === 'study_sessions') {
    return ['study_get', 'study_brief', 'study_propose']
  }
  return []
}

/**
 * Map channel → audit_events.source_type (must match DB check).
 * @param {string} channel
 */
export function channelToSourceType(channel) {
  const c = String(channel || 'system')
  const allowed = new Set([
    'db_trigger',
    'api',
    'import',
    'sync',
    'app',
    'system',
    'ui',
    'mcp',
    'assistant',
    'cron',
    'worker',
  ])
  return allowed.has(c) ? c : 'system'
}

/**
 * Insert one audit_events row. Failures are logged but do not throw by default
 * (mutations should not roll back because audit insert failed — optional strict).
 *
 * @param {{ from: Function }} db Supabase client
 * @param {RecordAuditInput} input
 * @param {{ strict?: boolean }} [opts]
 */
export async function recordAudit(db, input, opts = {}) {
  if (!input?.workspace_id || !input?.entity_type || !input?.entity_id) {
    const err = new Error('recordAudit requires workspace_id, entity_type, entity_id')
    if (opts.strict) throw err
    console.error('[audit]', err.message)
    return { ok: false, error: err.message }
  }

  const source_type = channelToSourceType(input.channel)
  const metadata = {
    actor_kind: input.actor_kind || (source_type === 'mcp' || source_type === 'assistant' ? 'agent' : 'user'),
    client_name: input.client_name || null,
    tool_name: input.tool_name || null,
    request_id: input.request_id || null,
    channel: source_type,
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
  }

  const row = {
    workspace_id: input.workspace_id,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    event_type: input.event_type || String(input.operation || 'update').toLowerCase(),
    operation: input.operation || 'UPDATE',
    actor_user_id: input.actor_user_id || null,
    source_type,
    source_id: input.source_id || null,
    idempotency_key: input.idempotency_key || null,
    before_data: input.before_data ?? null,
    after_data: input.after_data ?? null,
    diff: input.diff ?? null,
    metadata,
  }

  const { data, error } = await db.from('audit_events').insert(row).select('id').maybeSingle()

  if (error) {
    // Unique idempotency conflict → treat as ok
    if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
      return { ok: true, deduped: true, error: null }
    }
    console.error('[audit] insert failed', error.message)
    if (opts.strict) throw new Error(error.message)
    return { ok: false, error: error.message }
  }

  return { ok: true, id: data?.id || null, error: null }
}

/**
 * Build a standard MCP mutation payload + fire audit.
 *
 * @param {{ from: Function }} db
 * @param {{
 *   workspace_id: string,
 *   tool_name: string,
 *   request_id: string,
 *   client_name?: string|null,
 *   actor_user_id?: string|null,
 *   object_type: string,
 *   entity_id: string,
 *   status?: string|null,
 *   is_draft?: boolean,
 *   operation?: RecordAuditInput['operation'],
 *   event_type?: string,
 *   after_data?: unknown,
 *   before_data?: unknown,
 *   metadata?: Record<string, unknown>,
 *   next_allowed_actions?: string[],
 *   result?: Record<string, unknown>,
 * }} ctx
 */
export async function auditMcpMutation(db, ctx) {
  const channel = 'mcp'
  const status = ctx.status ?? null
  const is_draft =
    ctx.is_draft != null
      ? ctx.is_draft
      : status === 'draft' || status === 'proposed'

  await recordAudit(db, {
    workspace_id: ctx.workspace_id,
    entity_type: ctx.object_type,
    entity_id: ctx.entity_id,
    event_type: ctx.event_type || `mcp.${ctx.tool_name}`,
    operation: ctx.operation || 'INSERT',
    channel,
    actor_user_id: ctx.actor_user_id || null,
    actor_kind: 'agent',
    client_name: ctx.client_name || null,
    tool_name: ctx.tool_name,
    request_id: ctx.request_id,
    before_data: ctx.before_data ?? null,
    after_data: ctx.after_data ?? null,
    metadata: ctx.metadata || {},
  })

  const envelope = mutationEnvelope({
    object_type: ctx.object_type,
    id: ctx.entity_id,
    status,
    is_draft,
    channel,
    next_allowed_actions:
      ctx.next_allowed_actions || defaultNextActions(ctx.object_type, status),
    tool_name: ctx.tool_name,
    request_id: ctx.request_id,
    ...(ctx.result || {}),
  })

  return envelope
}
