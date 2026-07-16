export interface ReportTemplate {
  id: string
  workspace_id: string | null
  slug: string
  title: string
  description: string | null
  audience_hint: string
  default_sections: string[]
  default_schedule: string
  default_timezone: string
  default_channels: string[]
  is_active: boolean
  metadata?: Record<string, unknown>
}

export interface ReportSubscription {
  id: string
  workspace_id: string
  template_id: string
  enabled: boolean
  schedule: string
  timezone: string
  channels: string[]
  audience: string | null
  sections_override: string[] | null
  metadata?: Record<string, unknown>
  updated_at?: string
}

export interface ReportRun {
  id: string
  workspace_id: string
  subscription_id: string
  status: string
  trigger_source: string
  started_at: string | null
  finished_at: string | null
  payload_json?: Record<string, unknown>
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

export function useReports() {
  const { currentWorkspace } = useWorkspace()
  const packs = ref<ReportPackCard[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const togglingId = ref<string | null>(null)
  const runningId = ref<string | null>(null)

  async function loadPacks() {
    const ws = currentWorkspace.value?.id
    if (!ws) {
      packs.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<{ data: ReportPackCard[] }>('/api/reports/subscriptions', {
        query: { workspace_id: ws },
      })
      packs.value = res.data || []
    } catch (e: any) {
      error.value = e?.data?.statusMessage || e?.message || 'Failed to load reports'
      packs.value = []
    } finally {
      loading.value = false
    }
  }

  async function setEnabled(subscriptionId: string, enabled: boolean) {
    const ws = currentWorkspace.value?.id
    if (!ws) return
    togglingId.value = subscriptionId
    error.value = null
    try {
      await $fetch(`/api/reports/subscriptions/${subscriptionId}`, {
        method: 'PATCH',
        body: { workspace_id: ws, enabled },
      })
      const card = packs.value.find((p) => p.subscription.id === subscriptionId)
      if (card) card.subscription.enabled = enabled
    } catch (e: any) {
      error.value = e?.data?.statusMessage || e?.message || 'Failed to update toggle'
      throw e
    } finally {
      togglingId.value = null
    }
  }

  async function runNow(subscriptionId: string) {
    const ws = currentWorkspace.value?.id
    if (!ws) return null
    runningId.value = subscriptionId
    error.value = null
    try {
      const res = await $fetch<{ data: ReportRun }>(
        `/api/reports/subscriptions/${subscriptionId}/run`,
        {
          method: 'POST',
          body: { workspace_id: ws },
        },
      )
      const card = packs.value.find((p) => p.subscription.id === subscriptionId)
      if (card && res.data) card.last_run = res.data
      return res.data
    } catch (e: any) {
      error.value = e?.data?.statusMessage || e?.message || 'Failed to run report'
      throw e
    } finally {
      runningId.value = null
    }
  }

  return {
    packs,
    loading,
    error,
    togglingId,
    runningId,
    loadPacks,
    setEnabled,
    runNow,
  }
}
