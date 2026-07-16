<script setup lang="ts">
const { currentWorkspace } = useWorkspace()
const {
  packs,
  loading,
  error,
  togglingId,
  runningId,
  loadPacks,
  setEnabled,
  runNow,
} = useReports()

const lastMarkdown = ref<string | null>(null)
const lastTitle = ref<string | null>(null)
const toast = ref<string | null>(null)

const route = useRoute()

watch(
  () => currentWorkspace.value?.id,
  async () => {
    await loadPacks()
    // Deep link from Phase N: /reports?run=<id>
    const runId = typeof route.query.run === 'string' ? route.query.run : ''
    if (runId && currentWorkspace.value?.id) {
      try {
        const res = await $fetch<{ data: any }>(`/api/reports/runs/${runId}`, {
          query: { workspace_id: currentWorkspace.value.id },
        })
        if (res.data) {
          lastTitle.value = res.data.payload_json?.template_title || 'Report run'
          lastMarkdown.value = res.data.markdown_summary || 'No summary.'
        }
      } catch {
        /* soft-fail */
      }
    }
  },
  { immediate: true },
)

async function onToggle(card: any, enabled: boolean) {
  try {
    await setEnabled(card.subscription.id, enabled)
    toast.value = enabled
      ? `Enabled “${card.template.title}”`
      : `Disabled “${card.template.title}”`
    setTimeout(() => {
      toast.value = null
    }, 2500)
  } catch {
    /* error set in composable */
  }
}

async function onRun(card: any) {
  lastMarkdown.value = null
  lastTitle.value = null
  try {
    const run = await runNow(card.subscription.id)
    if (run) {
      lastTitle.value = card.template.title
      lastMarkdown.value = run.markdown_summary || 'Run completed (no summary).'
      toast.value = `Ran “${card.template.title}”`
      setTimeout(() => {
        toast.value = null
      }, 2500)
    }
  } catch {
    /* error set in composable */
  }
}

function audienceLabel(hint: string) {
  const map: Record<string, string> = {
    marketing: 'Marketing',
    warehouse: 'Warehouse',
    ops: 'Ops',
    finance: 'Finance',
    hq: 'HQ',
    buyer: 'Buyer',
    all: 'All',
  }
  return map[hint] || hint
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function statusClass(status: string | undefined) {
  if (status === 'completed') return 'badge-active'
  if (status === 'failed') return 'badge bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/20'
  if (status === 'running' || status === 'pending') return 'badge-draft'
  return 'badge-archived'
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 p-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-white">
          Agentic reports
        </h1>
        <p class="mt-1 max-w-2xl text-sm text-gray-400">
          Subscribe to sectionized packs (marketing, warehouse, finance).
          Toggle on/off per workspace. Reports
          <strong class="font-medium text-gray-300">suggest only</strong>
          — they never auto-approve, send to Loft, or mark FOB.
        </p>
      </div>
      <button
        type="button"
        class="btn-secondary"
        :disabled="loading"
        @click="loadPacks"
      >
        Refresh
      </button>
    </div>

    <div
      v-if="toast"
      class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300"
    >
      {{ toast }}
    </div>

    <div
      v-if="error"
      class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
    >
      {{ error }}
    </div>

    <div v-if="loading && !packs.length" class="card p-8 text-center text-sm text-gray-400">
      Loading packs…
    </div>

    <div v-else-if="!packs.length" class="card p-8 text-center text-sm text-gray-400">
      No report packs yet. Apply migration
      <code class="text-indigo-300">066</code>
      and refresh.
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
      <article
        v-for="card in packs"
        :key="card.subscription.id"
        class="card flex flex-col p-5"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="truncate text-base font-semibold text-white">
                {{ card.template.title }}
              </h2>
              <span class="badge-archived">
                {{ audienceLabel(card.template.audience_hint) }}
              </span>
              <span class="badge-draft">
                {{ card.subscription.schedule }}
              </span>
            </div>
            <p class="mt-1 text-xs text-gray-500">
              {{ card.template.slug }}
            </p>
          </div>

          <!-- Toggle -->
          <button
            type="button"
            role="switch"
            :aria-checked="card.subscription.enabled"
            :disabled="togglingId === card.subscription.id"
            class="relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
            :class="card.subscription.enabled ? 'bg-indigo-600' : 'bg-gray-700'"
            @click="onToggle(card, !card.subscription.enabled)"
          >
            <span
              class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition"
              :class="card.subscription.enabled ? 'translate-x-5' : 'translate-x-0'"
            />
          </button>
        </div>

        <p class="mt-3 flex-1 text-sm text-gray-400">
          {{ card.template.description || 'No description.' }}
        </p>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <span
            v-for="sec in card.sections"
            :key="sec"
            class="rounded bg-gray-800 px-2 py-0.5 font-mono text-[11px] text-gray-400"
          >
            {{ sec }}
          </span>
        </div>

        <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 pt-4">
          <div class="text-xs text-gray-500">
            <span v-if="card.last_run">
              Last run:
              <span :class="statusClass(card.last_run.status)">
                {{ card.last_run.status }}
              </span>
              · {{ formatWhen(card.last_run.finished_at || card.last_run.created_at) }}
            </span>
            <span v-else>Never run</span>
          </div>
          <button
            type="button"
            class="btn-primary text-xs !px-3 !py-1.5"
            :disabled="!card.subscription.enabled || runningId === card.subscription.id"
            @click="onRun(card)"
          >
            {{ runningId === card.subscription.id ? 'Running…' : 'Run now' }}
          </button>
        </div>
      </article>
    </div>

    <div v-if="lastMarkdown" class="card p-5">
      <div class="mb-2 flex items-center justify-between">
        <h3 class="text-sm font-semibold text-white">
          Last run summary
          <span v-if="lastTitle" class="font-normal text-gray-400">— {{ lastTitle }}</span>
        </h3>
        <button type="button" class="btn-ghost text-xs" @click="lastMarkdown = null">
          Dismiss
        </button>
      </div>
      <pre class="overflow-x-auto whitespace-pre-wrap rounded-lg bg-gray-950 p-4 text-xs text-gray-300">{{ lastMarkdown }}</pre>
    </div>

    <p class="text-xs text-gray-600">
      Scopes: <code class="text-gray-500">reports:read</code> list ·
      <code class="text-gray-500">reports:write</code> toggle ·
      <code class="text-gray-500">reports:run</code> run now.
      Cron / Slack / MCP tools come in later slices (Rpt-3+).
    </p>
  </div>
</template>
