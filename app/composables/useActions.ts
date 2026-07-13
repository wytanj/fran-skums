/**
 * Actions inbox: internal POs + pipeline candidates (M3 / M3.5 / M4).
 */
export function useActions() {
  const client = useSupabaseClient()
  const { currentWorkspace, memberRole } = useWorkspace()
  const user = useSupabaseUser()

  const loading = ref(false)
  const error = ref('')
  const draftPos = ref<any[]>([])
  const pendingPos = ref<any[]>([])
  const decidedPos = ref<any[]>([])
  const proposedPipeline = ref<any[]>([])
  const acceptedPipeline = ref<any[]>([])
  const recentPipeline = ref<any[]>([])
  /** entity_id → { channel, tool_name } from latest create audit */
  const channelByEntity = ref<Record<string, { channel: string, tool_name?: string }>>({})

  const counts = computed(() => ({
    draftPos: draftPos.value.length,
    pendingPos: pendingPos.value.length,
    proposedPipeline: proposedPipeline.value.length,
    acceptedPipeline: acceptedPipeline.value.length,
    openActions:
      draftPos.value.length +
      pendingPos.value.length +
      proposedPipeline.value.length +
      acceptedPipeline.value.length,
  }))

  /** M4: owner/admin can approve/reject POs and pipeline; members draft/submit */
  const canApprove = computed(() => {
    const r = (memberRole.value || '').toLowerCase()
    return r === 'owner' || r === 'admin'
  })
  const canSubmit = computed(() => {
    const r = (memberRole.value || '').toLowerCase()
    return r === 'owner' || r === 'admin' || r === 'member' || !r
  })
  const canEditDraft = computed(() => canSubmit.value)

  async function enrichChannelsFromAudit(entityIds: string[]) {
    if (!currentWorkspace.value?.id || !entityIds.length) return
    const unique = [...new Set(entityIds)].slice(0, 100)
    const { data } = await client
      .from('audit_events')
      .select('entity_id, source_type, metadata, created_at')
      .eq('workspace_id', currentWorkspace.value.id)
      .in('entity_id', unique)
      .in('source_type', ['mcp', 'ui', 'api', 'assistant'])
      .order('created_at', { ascending: true })
      .limit(200)

    const map: Record<string, { channel: string, tool_name?: string }> = {
      ...channelByEntity.value,
    }
    for (const ev of data || []) {
      const ch = ev.source_type || ev.metadata?.channel || 'ui'
      map[ev.entity_id] = {
        channel: ch,
        tool_name: ev.metadata?.tool_name || map[ev.entity_id]?.tool_name,
      }
    }
    channelByEntity.value = map
  }

  async function loadInbox() {
    if (!currentWorkspace.value?.id) return
    loading.value = true
    error.value = ''
    const ws = currentWorkspace.value.id
    try {
      const [drafts, pending, decided, proposed, accepted, recent] = await Promise.all([
        client
          .from('internal_purchase_orders')
          .select('*')
          .eq('workspace_id', ws)
          .eq('status', 'draft')
          .order('created_at', { ascending: false })
          .limit(50),
        client
          .from('internal_purchase_orders')
          .select('*')
          .eq('workspace_id', ws)
          .eq('status', 'pending_approval')
          .order('created_at', { ascending: false })
          .limit(50),
        client
          .from('internal_purchase_orders')
          .select('*')
          .eq('workspace_id', ws)
          .in('status', ['approved', 'rejected', 'ordered', 'cancelled'])
          .order('updated_at', { ascending: false })
          .limit(30),
        client
          .from('pipeline_candidates')
          .select('*')
          .eq('workspace_id', ws)
          .in('status', ['proposed', 'deferred'])
          .order('created_at', { ascending: false })
          .limit(50),
        client
          .from('pipeline_candidates')
          .select('*')
          .eq('workspace_id', ws)
          .eq('status', 'accepted')
          .order('created_at', { ascending: false })
          .limit(50),
        client
          .from('pipeline_candidates')
          .select('*')
          .eq('workspace_id', ws)
          .in('status', ['executed', 'rejected', 'failed'])
          .order('updated_at', { ascending: false })
          .limit(30),
      ])

      draftPos.value = drafts.data || []
      pendingPos.value = pending.data || []
      decidedPos.value = decided.data || []
      proposedPipeline.value = proposed.data || []
      acceptedPipeline.value = accepted.data || []
      recentPipeline.value = recent.data || []

      const ids = [
        ...draftPos.value,
        ...pendingPos.value,
        ...decidedPos.value,
        ...proposedPipeline.value,
        ...acceptedPipeline.value,
        ...recentPipeline.value,
      ].map((r) => r.id)
      await enrichChannelsFromAudit(ids)

      const firstErr =
        drafts.error ||
        pending.error ||
        decided.error ||
        proposed.error ||
        accepted.error ||
        recent.error
      if (firstErr) error.value = firstErr.message
    } catch (e: any) {
      error.value = e?.message || 'Failed to load actions'
    } finally {
      loading.value = false
    }
  }

  async function loadInternalPo(id: string) {
    if (!currentWorkspace.value?.id) return null
    const { data: po, error: poErr } = await client
      .from('internal_purchase_orders')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', currentWorkspace.value.id)
      .single()
    if (poErr) throw poErr
    const { data: lines, error: lineErr } = await client
      .from('internal_purchase_order_lines')
      .select('*')
      .eq('po_id', id)
      .order('line_number', { ascending: true })
    if (lineErr) throw lineErr

    let sourcePo = null
    const sourceId = po.metadata?.source_po_id
    if (sourceId) {
      const { data } = await client
        .from('internal_purchase_orders')
        .select('id, po_number, status, subtotal, line_count')
        .eq('id', sourceId)
        .maybeSingle()
      sourcePo = data
    }

    const { data: audit } = await client
      .from('audit_events')
      .select('id, event_type, operation, source_type, actor_user_id, metadata, created_at')
      .eq('entity_id', id)
      .eq('workspace_id', currentWorkspace.value.id)
      .order('created_at', { ascending: false })
      .limit(40)

    // Prefer earliest mcp/ui/api audit for channel badge
    if (audit?.length) {
      const creates = [...audit].reverse().filter((e) =>
        ['mcp', 'ui', 'api', 'assistant'].includes(e.source_type),
      )
      const pick = creates[0] || audit[audit.length - 1]
      if (pick) {
        channelByEntity.value = {
          ...channelByEntity.value,
          [id]: {
            channel: pick.source_type,
            tool_name: pick.metadata?.tool_name,
          },
        }
      }
    }

    return { po, lines: lines || [], sourcePo, audit: audit || [] }
  }

  async function updateDraftPo(
    id: string,
    patch: { notes?: string, lines?: Array<{ id: string, quantity?: number, unit_cost?: number }> },
  ) {
    if (!currentWorkspace.value?.id) throw new Error('No workspace')
    const pack = await loadInternalPo(id)
    if (!pack?.po) throw new Error('PO not found')
    if (pack.po.status !== 'draft') throw new Error('Only draft POs can be edited')

    if (patch.notes !== undefined) {
      const { error: nErr } = await client
        .from('internal_purchase_orders')
        .update({ notes: patch.notes })
        .eq('id', id)
        .eq('status', 'draft')
      if (nErr) throw nErr
    }

    if (patch.lines?.length) {
      for (const line of patch.lines) {
        const qty = line.quantity != null ? Math.max(0, Number(line.quantity) || 0) : undefined
        const cost = line.unit_cost != null ? Math.max(0, Number(line.unit_cost) || 0) : undefined
        const update: Record<string, any> = {}
        if (qty !== undefined) update.quantity = qty
        if (cost !== undefined) update.unit_cost = cost
        if (qty !== undefined && cost !== undefined) {
          update.line_total = Math.round(qty * cost * 100) / 100
        } else if (qty !== undefined || cost !== undefined) {
          const existing = pack.lines.find((l: any) => l.id === line.id)
          if (existing) {
            const q = qty ?? (Number(existing.quantity) || 0)
            const c = cost ?? (Number(existing.unit_cost) || 0)
            update.line_total = Math.round(q * c * 100) / 100
          }
        }
        if (Object.keys(update).length) {
          const { error: lErr } = await client
            .from('internal_purchase_order_lines')
            .update(update)
            .eq('id', line.id)
            .eq('po_id', id)
          if (lErr) throw lErr
        }
      }
      // recompute header totals
      const { data: refreshed } = await client
        .from('internal_purchase_order_lines')
        .select('line_total')
        .eq('po_id', id)
      const subtotal = (refreshed || []).reduce((s, r) => s + (Number(r.line_total) || 0), 0)
      await client
        .from('internal_purchase_orders')
        .update({
          subtotal: Math.round(subtotal * 100) / 100,
          line_count: refreshed?.length || 0,
        })
        .eq('id', id)
    }

    try {
      await client.from('audit_events').insert({
        workspace_id: currentWorkspace.value.id,
        entity_type: 'internal_purchase_orders',
        entity_id: id,
        event_type: 'po.draft_updated',
        operation: 'UPDATE',
        actor_user_id: user.value?.id || null,
        source_type: 'ui',
        metadata: { channel: 'ui', client_name: 'fran-web' },
      } as any)
    } catch {
      /* ignore */
    }

    return loadInternalPo(id)
  }

  async function loadPipelineCandidate(id: string) {
    if (!currentWorkspace.value?.id) return null
    const { data, error: err } = await client
      .from('pipeline_candidates')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', currentWorkspace.value.id)
      .single()
    if (err) throw err

    const { data: audit } = await client
      .from('audit_events')
      .select('id, event_type, operation, source_type, actor_user_id, metadata, created_at')
      .eq('entity_id', id)
      .eq('workspace_id', currentWorkspace.value.id)
      .order('created_at', { ascending: false })
      .limit(40)

    return { candidate: data, audit: audit || [] }
  }

  async function submitPo(id: string) {
    if (!canSubmit.value) throw new Error('You do not have permission to submit POs')
    const { data, error: err } = await client
      .from('internal_purchase_orders')
      .update({
        status: 'pending_approval',
        submitted_at: new Date().toISOString(),
        submitted_by: user.value?.id || null,
      })
      .eq('id', id)
      .eq('status', 'draft')
      .select()
      .single()
    if (err) throw err

    try {
      await client.from('audit_events').insert({
        workspace_id: currentWorkspace.value!.id,
        entity_type: 'internal_purchase_orders',
        entity_id: id,
        event_type: 'po.submitted',
        operation: 'UPDATE',
        actor_user_id: user.value?.id || null,
        source_type: 'ui',
        after_data: data,
        metadata: {
          channel: 'ui',
          actor_kind: 'user',
          client_name: 'fran-web',
          lifecycle_event: 'po.submitted',
        },
      } as any)
    } catch {
      /* ignore */
    }
    return data
  }

  async function decidePo(id: string, decision: 'approved' | 'rejected', decision_note?: string) {
    if (!canApprove.value) {
      throw new Error('Only workspace owners/admins can approve or reject POs')
    }
    const { data, error: err } = await client
      .from('internal_purchase_orders')
      .update({
        status: decision,
        approved_at: new Date().toISOString(),
        approved_by: user.value?.id || null,
        decision_note: decision_note || null,
      })
      .eq('id', id)
      .eq('status', 'pending_approval')
      .select()
      .single()
    if (err) throw err

    const lifecycle = decision === 'approved' ? 'po.approved' : 'po.rejected'
    try {
      await client.from('audit_events').insert({
        workspace_id: currentWorkspace.value!.id,
        entity_type: 'internal_purchase_orders',
        entity_id: id,
        event_type: lifecycle,
        operation: 'UPDATE',
        actor_user_id: user.value?.id || null,
        source_type: 'ui',
        after_data: data,
        metadata: {
          channel: 'ui',
          actor_kind: 'user',
          client_name: 'fran-web',
          lifecycle_event: lifecycle,
        },
      } as any)
    } catch {
      /* ignore */
    }
    return data
  }

  async function decidePipeline(
    id: string,
    decision: 'accepted' | 'rejected' | 'deferred',
    decision_note?: string,
  ) {
    if (!canApprove.value) {
      throw new Error('Only workspace owners/admins can decide pipeline candidates')
    }
    const { data, error: err } = await client
      .from('pipeline_candidates')
      .update({
        status: decision,
        decided_at: new Date().toISOString(),
        decided_by: user.value?.id || null,
        decision_note: decision_note || null,
      })
      .eq('id', id)
      .in('status', ['proposed', 'deferred'])
      .select()
      .single()
    if (err) throw err

    try {
      await client.from('audit_events').insert({
        workspace_id: currentWorkspace.value!.id,
        entity_type: 'pipeline_candidates',
        entity_id: id,
        event_type: `pipeline.${decision}`,
        operation: 'UPDATE',
        actor_user_id: user.value?.id || null,
        source_type: 'ui',
        after_data: data,
        metadata: {
          channel: 'ui',
          lifecycle_event: `pipeline.${decision}`,
        },
      } as any)
    } catch {
      /* ignore */
    }
    return data
  }

  function channelFromMeta(row: any): string {
    if (!row) return 'ui'
    const fromAudit = channelByEntity.value[row.id]
    if (fromAudit?.channel) return fromAudit.channel
    const m = row?.metadata
    if (m?.cloned_via === 'mcp' || m?.channel === 'mcp') return 'mcp'
    if (m?.source === 'pipeline_execute' || m?.source === 'pipeline') return 'mcp'
    if (m?.channel === 'api') return 'api'
    return 'ui'
  }

  function toolNameFor(row: any): string | undefined {
    if (!row) return undefined
    return channelByEntity.value[row.id]?.tool_name || row.metadata?.tool_name
  }

  function statusClass(status: string) {
    const map: Record<string, string> = {
      draft: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
      pending_approval: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
      approved: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
      accepted: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
      rejected: 'bg-red-500/15 text-red-300 ring-red-500/30',
      proposed: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
      deferred: 'bg-gray-500/15 text-gray-300 ring-gray-500/30',
      executed: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30',
      failed: 'bg-red-500/15 text-red-300 ring-red-500/30',
      ordered: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
      cancelled: 'bg-gray-600/20 text-gray-400 ring-gray-600/30',
    }
    return map[status] || 'bg-gray-800 text-gray-300 ring-gray-700'
  }

  function channelClass(ch: string) {
    if (ch === 'mcp') return 'bg-violet-500/15 text-violet-300'
    if (ch === 'api') return 'bg-indigo-500/15 text-indigo-300'
    return 'bg-slate-500/15 text-slate-300'
  }

  function relativeTime(iso: string) {
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return iso
    const diff = Date.now() - t
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 48) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  }

  async function copyDeepLink(path: string) {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
      return true
    } catch {
      return false
    }
  }

  return {
    loading,
    error,
    draftPos,
    pendingPos,
    decidedPos,
    proposedPipeline,
    acceptedPipeline,
    recentPipeline,
    counts,
    channelByEntity,
    canApprove,
    canSubmit,
    canEditDraft,
    memberRole,
    loadInbox,
    loadInternalPo,
    loadPipelineCandidate,
    updateDraftPo,
    submitPo,
    decidePo,
    decidePipeline,
    channelFromMeta,
    toolNameFor,
    statusClass,
    channelClass,
    relativeTime,
    copyDeepLink,
  }
}
