/**
 * Research notebooks = study_sessions + study_artifacts.
 * Notebook-first: open/park ideas without Shopee crawl.
 */
export function useResearch() {
  const client = useSupabaseClient()
  const { currentWorkspace, memberRole } = useWorkspace()
  const user = useSupabaseUser()

  const loading = ref(false)
  const error = ref('')
  const sessions = ref<any[]>([])
  const session = ref<any | null>(null)
  const artifacts = ref<any[]>([])
  const pipeline = ref<any[]>([])

  const canWrite = computed(() => {
    const r = (memberRole.value || '').toLowerCase()
    return r === 'owner' || r === 'admin' || r === 'member' || !r
  })

  function statusClass(status: string) {
    const s = (status || '').toLowerCase()
    if (s === 'open') return 'bg-sky-500/10 text-sky-300 ring-sky-500/30'
    if (s === 'briefed') return 'bg-violet-500/10 text-violet-300 ring-violet-500/30'
    if (s === 'proposed') return 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
    if (s === 'closed') return 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
    if (s === 'cancelled') return 'bg-gray-500/10 text-gray-400 ring-gray-500/30'
    return 'bg-gray-500/10 text-gray-400 ring-gray-500/30'
  }

  function artifactBadge(type: string) {
    const t = (type || '').toLowerCase()
    if (t === 'note') return 'bg-indigo-500/10 text-indigo-300 ring-indigo-500/30'
    if (t === 'brief') return 'bg-violet-500/10 text-violet-300 ring-violet-500/30'
    if (t === 'match') return 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
    if (t === 'serp_table') return 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
    return 'bg-gray-500/10 text-gray-400 ring-gray-500/30'
  }

  function relativeTime(iso: string | null | undefined) {
    if (!iso) return '—'
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) return '—'
    const diff = Date.now() - t
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 48) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
  }

  function metaOf(s: any) {
    return (s?.metadata && typeof s.metadata === 'object' ? s.metadata : {}) as Record<string, any>
  }

  function subjectLabel(s: any) {
    const m = metaOf(s)
    if (m.subject_kind === 'brand') return 'Brand'
    if (m.subject_kind === 'product') return 'Product'
    if (m.subject_kind === 'other') return 'Other'
    return 'Notebook'
  }

  function crawlIntent(s: any) {
    const c = metaOf(s).crawl_intent
    return c === 'later' || c === 'active' ? c : 'none'
  }

  async function loadSessions(filters: { status?: string; limit?: number } = {}) {
    if (!currentWorkspace.value?.id) return
    loading.value = true
    error.value = ''
    try {
      let q = client
        .from('study_sessions')
        .select('*')
        .eq('workspace_id', currentWorkspace.value.id)
        .order('created_at', { ascending: false })
        .limit(filters.limit ?? 80)
      if (filters.status) q = q.eq('status', filters.status)
      const { data, error: err } = await q
      if (err) throw err
      sessions.value = data || []
    } catch (e: any) {
      error.value = e?.message || 'Failed to load notebooks'
      sessions.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadNotebook(id: string) {
    if (!currentWorkspace.value?.id) return null
    loading.value = true
    error.value = ''
    try {
      const ws = currentWorkspace.value.id
      const [sessRes, artRes, pipeRes] = await Promise.all([
        client
          .from('study_sessions')
          .select('*')
          .eq('workspace_id', ws)
          .eq('id', id)
          .single(),
        client
          .from('study_artifacts')
          .select('*')
          .eq('workspace_id', ws)
          .eq('session_id', id)
          .order('created_at', { ascending: false }),
        client
          .from('pipeline_candidates')
          .select('*')
          .eq('workspace_id', ws)
          .eq('source_study_id', id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (sessRes.error || !sessRes.data) {
        throw new Error(sessRes.error?.message || 'Notebook not found')
      }
      session.value = sessRes.data
      artifacts.value = artRes.data || []
      pipeline.value = pipeRes.data || []
      return { session: sessRes.data, artifacts: artRes.data || [], pipeline: pipeRes.data || [] }
    } catch (e: any) {
      error.value = e?.message || 'Failed to load notebook'
      session.value = null
      artifacts.value = []
      pipeline.value = []
      return null
    } finally {
      loading.value = false
    }
  }

  async function createNotebook(input: {
    hypothesis: string
    query?: string | null
    subject_kind?: string
    brand_key?: string
    crawl_intent?: string
    discovery_url?: string
    discovery_channel?: string
    note_body?: string
  }) {
    if (!currentWorkspace.value?.id) throw new Error('No workspace')
    if (!canWrite.value) throw new Error('No write permission')

    const hypothesis = String(input.hypothesis || '').trim()
    if (!hypothesis) throw new Error('hypothesis is required')

    const metadata: Record<string, any> = {
      subject_kind: input.subject_kind || 'product',
      crawl_intent: input.crawl_intent || 'none',
      source: 'ui',
    }
    if (input.brand_key) {
      metadata.brand_key = String(input.brand_key)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    }
    if (input.discovery_url) {
      metadata.discovery_url = input.discovery_url.trim()
      metadata.discovery_channel = input.discovery_channel || 'external'
      metadata.discovery = [
        {
          channel: metadata.discovery_channel,
          url: metadata.discovery_url,
        },
      ]
    }

    const { data, error: err } = await client
      .from('study_sessions')
      .insert({
        workspace_id: currentWorkspace.value.id,
        status: 'open',
        hypothesis,
        marketplace: 'shopee',
        country: 'sg',
        query: input.query?.trim() || null,
        opened_by: user.value?.id || null,
        metadata,
      })
      .select('*')
      .single()
    if (err) throw err

    // Discovery note page
    if (input.discovery_url || input.note_body) {
      const bodyParts: string[] = []
      if (input.discovery_url) {
        const ch = metadata.discovery_channel ? `[${metadata.discovery_channel}] ` : ''
        bodyParts.push(`${ch}${input.discovery_url}`)
      }
      if (input.note_body?.trim()) bodyParts.push(input.note_body.trim())
      await client.from('study_artifacts').insert({
        workspace_id: currentWorkspace.value.id,
        session_id: data.id,
        artifact_type: 'note',
        title: input.discovery_url ? 'Discovery sources' : 'Opening note',
        payload: {
          body: bodyParts.join('\n\n'),
          url: input.discovery_url || null,
          channel: metadata.discovery_channel || null,
          source: 'ui',
        },
        evidence_refs: input.discovery_url ? [`discovery:${input.discovery_url}`] : [],
      })
    }

    return data
  }

  async function addNote(
    sessionId: string,
    input: { body: string; title?: string; url?: string; channel?: string },
  ) {
    if (!currentWorkspace.value?.id) throw new Error('No workspace')
    if (!canWrite.value) throw new Error('No write permission')
    const body = String(input.body || '').trim()
    if (!body) throw new Error('Note body is required')

    const payload: Record<string, any> = { body, source: 'ui' }
    if (input.url?.trim()) payload.url = input.url.trim()
    if (input.channel) payload.channel = input.channel

    const { data, error: err } = await client
      .from('study_artifacts')
      .insert({
        workspace_id: currentWorkspace.value.id,
        session_id: sessionId,
        artifact_type: 'note',
        title: (input.title || 'Note').slice(0, 200),
        payload,
        evidence_refs: payload.url ? [`discovery:${payload.url}`] : [],
      })
      .select('*')
      .single()
    if (err) throw err
    return data
  }

  async function updateNotebook(
    sessionId: string,
    patch: {
      hypothesis?: string
      query?: string | null
      status?: string
      crawl_intent?: string
      subject_kind?: string
      brand_key?: string
    },
  ) {
    if (!currentWorkspace.value?.id) throw new Error('No workspace')
    if (!canWrite.value) throw new Error('No write permission')

    const update: Record<string, any> = {}
    if (patch.hypothesis != null) update.hypothesis = String(patch.hypothesis).trim()
    if (patch.query !== undefined) {
      update.query = patch.query != null && String(patch.query).trim() ? String(patch.query).trim() : null
    }
    if (patch.status) {
      update.status = patch.status
      if (patch.status === 'closed' || patch.status === 'cancelled') {
        update.closed_at = new Date().toISOString()
      }
    }

    if (patch.crawl_intent || patch.subject_kind || patch.brand_key) {
      const cur = session.value?.id === sessionId ? metaOf(session.value) : {}
      if (!session.value || session.value.id !== sessionId) {
        const { data: s } = await client
          .from('study_sessions')
          .select('metadata')
          .eq('id', sessionId)
          .eq('workspace_id', currentWorkspace.value.id)
          .single()
        Object.assign(cur, (s?.metadata as any) || {})
      }
      const next = { ...cur }
      if (patch.crawl_intent) next.crawl_intent = patch.crawl_intent
      if (patch.subject_kind) next.subject_kind = patch.subject_kind
      if (patch.brand_key) {
        next.brand_key = String(patch.brand_key)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      }
      update.metadata = next
    }

    const { data, error: err } = await client
      .from('study_sessions')
      .update(update)
      .eq('id', sessionId)
      .eq('workspace_id', currentWorkspace.value.id)
      .select('*')
      .single()
    if (err) throw err
    session.value = data
    return data
  }

  return {
    loading,
    error,
    sessions,
    session,
    artifacts,
    pipeline,
    canWrite,
    statusClass,
    artifactBadge,
    relativeTime,
    metaOf,
    subjectLabel,
    crawlIntent,
    loadSessions,
    loadNotebook,
    createNotebook,
    addNote,
    updateNotebook,
  }
}
