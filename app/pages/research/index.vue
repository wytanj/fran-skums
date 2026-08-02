<script setup lang="ts">
const {
  loading,
  error,
  sessions,
  canWrite,
  statusClass,
  relativeTime,
  metaOf,
  subjectLabel,
  crawlIntent,
  loadSessions,
  createNotebook,
} = useResearch()

const { currentWorkspace } = useWorkspace()
const { setContext, clearContext } = useAssistant()
const router = useRouter()
const { notify } = useActionFeedback()

const statusFilter = ref<'all' | 'open' | 'briefed' | 'proposed' | 'closed'>('open')
const showForm = ref(false)
const saving = ref(false)
const form = reactive({
  hypothesis: '',
  query: '',
  subject_kind: 'product' as 'product' | 'brand' | 'other',
  brand_key: '',
  discovery_url: '',
  discovery_channel: 'sephora',
  note_body: '',
  crawl_intent: 'none' as 'none' | 'later' | 'active',
})

const filtered = computed(() => {
  if (statusFilter.value === 'all') return sessions.value
  return sessions.value.filter((s) => s.status === statusFilter.value)
})

const counts = computed(() => {
  const c = { open: 0, briefed: 0, proposed: 0, closed: 0, all: sessions.value.length }
  for (const s of sessions.value) {
    if (s.status === 'open') c.open++
    else if (s.status === 'briefed') c.briefed++
    else if (s.status === 'proposed') c.proposed++
    else if (s.status === 'closed' || s.status === 'cancelled') c.closed++
  }
  return c
})

async function refresh() {
  // Load a wide set then filter client-side so tab counts work
  await loadSessions({ limit: 100 })
  setContext(
    'research',
    'inbox',
    { open: counts.value.open, total: counts.value.all },
    'Research notebooks',
  )
}

watch(
  () => currentWorkspace.value?.id,
  () => {
    void refresh()
  },
  { immediate: true },
)

onUnmounted(() => clearContext())

function openCreate() {
  form.hypothesis = ''
  form.query = ''
  form.subject_kind = 'product'
  form.brand_key = ''
  form.discovery_url = ''
  form.discovery_channel = 'sephora'
  form.note_body = ''
  form.crawl_intent = 'none'
  showForm.value = true
}

async function onCreate() {
  if (!canWrite.value) return
  saving.value = true
  try {
    const row = await createNotebook({
      hypothesis: form.hypothesis,
      query: form.query || null,
      subject_kind: form.subject_kind,
      brand_key: form.brand_key || undefined,
      discovery_url: form.discovery_url || undefined,
      discovery_channel: form.discovery_channel || undefined,
      note_body: form.note_body || undefined,
      crawl_intent: form.crawl_intent,
    })
    showForm.value = false
    notify.success('Notebook opened')
    await router.push(`/research/${row.id}`)
  } catch (e: any) {
    notify.error(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-white">Research</h1>
        <p class="mt-1 text-sm text-gray-400">
          Product & brand notebooks — park discoveries (Sephora, buyer notes) without starting a Shopee crawl.
          Harvest is opt-in later via Actions pipeline.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-ghost text-xs" :disabled="loading" @click="refresh">
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
        <button
          v-if="canWrite"
          type="button"
          class="btn-primary text-sm"
          @click="openCreate"
        >
          New notebook
        </button>
      </div>
    </div>

    <div
      class="mb-4 rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs text-gray-400"
    >
      <strong class="text-gray-300">Notebook ≠ crawl.</strong>
      Opening a notebook never enqueues Shopee. When ready to watch Mall prices, propose a
      <code class="text-violet-300">watchlist_seed</code> from MCP and accept it under
      <NuxtLink to="/actions" class="text-indigo-400 hover:underline">Actions</NuxtLink>.
      Agents use <code class="text-violet-300">study_start</code> / <code class="text-violet-300">study_add_note</code>.
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="t in [
          { key: 'open', label: 'Open', count: counts.open },
          { key: 'briefed', label: 'Briefed', count: counts.briefed },
          { key: 'proposed', label: 'Proposed', count: counts.proposed },
          { key: 'closed', label: 'Closed', count: counts.closed },
          { key: 'all', label: 'All', count: counts.all },
        ]"
        :key="t.key"
        type="button"
        :class="[
          'rounded-full px-3 py-1.5 text-xs font-medium transition-colors ring-1',
          statusFilter === t.key
            ? 'bg-indigo-500/20 text-indigo-300 ring-indigo-500/40'
            : 'bg-gray-900 text-gray-400 ring-gray-800 hover:text-white',
        ]"
        @click="statusFilter = t.key as typeof statusFilter"
      >
        {{ t.label }}
        <span class="ml-1 opacity-70">{{ t.count }}</span>
      </button>
    </div>

    <div v-if="error" class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {{ error }}
    </div>

    <!-- Create form -->
    <div v-if="showForm" class="card mb-6 p-5">
      <h2 class="mb-4 text-sm font-semibold text-white">New research notebook</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label class="label-field">Hypothesis / why we care *</label>
          <textarea
            v-model="form.hypothesis"
            rows="2"
            class="input-field"
            placeholder="e.g. Olaplex Volumizing Blow Dry Mist 150ml — popular on Sephora; benchmark vs catalog later"
          />
        </div>
        <div>
          <label class="label-field">Subject</label>
          <select v-model="form.subject_kind" class="input-field">
            <option value="product">Product</option>
            <option value="brand">Brand</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label class="label-field">Brand key (optional)</label>
          <input v-model="form.brand_key" class="input-field" placeholder="olaplex" />
        </div>
        <div>
          <label class="label-field">Discovery URL</label>
          <input
            v-model="form.discovery_url"
            class="input-field"
            placeholder="https://www.sephora.sg/products/…"
          />
        </div>
        <div>
          <label class="label-field">Channel</label>
          <input v-model="form.discovery_channel" class="input-field" placeholder="sephora" />
        </div>
        <div>
          <label class="label-field">Shopee query (optional, later)</label>
          <input
            v-model="form.query"
            class="input-field"
            placeholder="olaplex volumizing blow dry mist"
          />
        </div>
        <div>
          <label class="label-field">Crawl intent</label>
          <select v-model="form.crawl_intent" class="input-field">
            <option value="none">none — park only</option>
            <option value="later">later — may seed</option>
            <option value="active">active — already watching</option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label class="label-field">Opening note (optional)</label>
          <textarea
            v-model="form.note_body"
            rows="2"
            class="input-field"
            placeholder="Buyer notes, size, price seen, why popular…"
          />
        </div>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn-primary"
          :disabled="saving || !form.hypothesis.trim()"
          @click="onCreate"
        >
          {{ saving ? 'Opening…' : 'Open notebook' }}
        </button>
        <button type="button" class="btn-ghost" :disabled="saving" @click="showForm = false">
          Cancel
        </button>
      </div>
    </div>

    <div v-if="loading && !sessions.length" class="space-y-3">
      <div v-for="i in 3" :key="i" class="card h-20 animate-pulse bg-gray-900/80" />
    </div>

    <div v-else-if="filtered.length === 0" class="card p-10 text-center text-sm text-gray-500">
      No notebooks{{ statusFilter !== 'all' ? ` with status “${statusFilter}”` : '' }}.
      <button
        v-if="canWrite"
        type="button"
        class="mt-3 block mx-auto text-indigo-400 hover:underline"
        @click="openCreate"
      >
        Open one from a product or brand idea
      </button>
    </div>

    <div v-else class="space-y-3">
      <NuxtLink
        v-for="s in filtered"
        :key="s.id"
        :to="`/research/${s.id}`"
        class="card block p-4 transition-colors hover:border-indigo-500/40"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-white line-clamp-2">{{ s.hypothesis }}</p>
            <p class="mt-1 text-xs text-gray-500">
              {{ subjectLabel(s) }}
              <span v-if="metaOf(s).brand_key"> · {{ metaOf(s).brand_key }}</span>
              <span v-if="s.query"> · query “{{ s.query }}”</span>
              · {{ relativeTime(s.created_at) }}
            </p>
            <p
              v-if="metaOf(s).discovery?.length || metaOf(s).discovery_url"
              class="mt-1 truncate text-xs text-sky-400/80"
            >
              {{ metaOf(s).discovery?.[0]?.url || metaOf(s).discovery_url }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span :class="['rounded-full px-2 py-0.5 text-xs font-medium ring-1', statusClass(s.status)]">
              {{ s.status }}
            </span>
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-gray-700 text-gray-400"
            >
              crawl: {{ crawlIntent(s) }}
            </span>
          </div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
