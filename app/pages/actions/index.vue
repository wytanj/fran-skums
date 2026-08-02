<script setup lang="ts">
const {
  loading,
  error,
  draftPos,
  pendingPos,
  decidedPos,
  proposedPipeline,
  acceptedPipeline,
  recentPipeline,
  pendingFloor,
  floorActing,
  counts,
  loadInbox,
  channelFromMeta,
  toolNameFor,
  statusClass,
  channelClass,
  relativeTime,
  canApprove,
  memberRole,
  applyFloorAdjustment,
  rejectFloorAdjustment,
  floorVariance,
  floorLineSummary,
} = useActions()

const { currentWorkspace } = useWorkspace()
const { setContext, clearContext } = useAssistant()
const { notify } = useActionFeedback()
const route = useRoute()

type TabKey =
  | 'floor'
  | 'draft_pos'
  | 'pending_pos'
  | 'pipeline_proposed'
  | 'pipeline_accepted'
  | 'recent'
const tab = ref<TabKey>('floor')
const channelFilter = ref<'all' | 'mcp' | 'ui' | 'api'>('all')

const tabs = computed(() => [
  { key: 'floor' as const, label: 'Floor / POS signals', count: counts.value.pendingFloor },
  { key: 'draft_pos' as const, label: 'Draft POs', count: counts.value.draftPos },
  { key: 'pending_pos' as const, label: 'Pending approval', count: counts.value.pendingPos },
  { key: 'pipeline_proposed' as const, label: 'Pipeline proposed', count: counts.value.proposedPipeline },
  { key: 'pipeline_accepted' as const, label: 'Ready to execute', count: counts.value.acceptedPipeline },
  {
    key: 'recent' as const,
    label: 'Recent',
    count: decidedPos.value.length + recentPipeline.value.length,
  },
])

function filterByChannel<T extends { id: string }>(rows: T[]) {
  if (channelFilter.value === 'all') return rows
  return rows.filter((r) => channelFromMeta(r) === channelFilter.value)
}

const filteredDrafts = computed(() => filterByChannel(draftPos.value))
const filteredPending = computed(() => filterByChannel(pendingPos.value))
const filteredProposed = computed(() => filterByChannel(proposedPipeline.value))
const filteredAccepted = computed(() => filterByChannel(acceptedPipeline.value))
const filteredFloor = computed(() => filterByChannel(pendingFloor.value))

watch(
  () => currentWorkspace.value?.id,
  async () => {
    await loadInbox()
    setContext(
      'actions',
      'inbox',
      {
        draftPos: counts.value.draftPos,
        pendingPos: counts.value.pendingPos,
        pendingFloor: counts.value.pendingFloor,
        pipelineProposed: counts.value.proposedPipeline,
      },
      'Actions queue',
    )
  },
  { immediate: true },
)

// Deep link: /actions?tab=floor
watch(
  () => route.query.tab,
  (t) => {
    const key = String(t || '')
    if (['floor', 'draft_pos', 'pending_pos', 'pipeline_proposed', 'pipeline_accepted', 'recent'].includes(key)) {
      tab.value = key as TabKey
    }
  },
  { immediate: true },
)

async function onApplyFloor(adj: any) {
  try {
    await applyFloorAdjustment(adj)
    notify.success(`Applied ${adj.adjustment_number} → inventory ledger`)
  } catch {
    /* error set on composable */
  }
}

async function onRejectFloor(adj: any) {
  if (!confirm(`Reject ${adj.adjustment_number}? Stock will not change.`)) return
  try {
    await rejectFloorAdjustment(adj)
    notify.success(`Rejected ${adj.adjustment_number}`)
  } catch {
    /* error set on composable */
  }
}

onUnmounted(() => clearContext())

function formatMoney(n: number | null | undefined, currency = 'SGD') {
  if (n == null) return '—'
  return `${currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-white">Actions</h1>
        <p class="mt-1 text-sm text-gray-400">
          Drafts and approvals for agent (MCP) and human work. Nothing here is “done” until status says so.
        </p>
        <p class="mt-2 text-xs text-gray-600">
          Your role: <span class="text-gray-400">{{ memberRole || 'member' }}</span>
          <span v-if="!canApprove" class="text-amber-500/80"> · approve/reject requires owner/admin</span>
        </p>
      </div>
      <div class="flex flex-wrap gap-2 text-center">
        <div class="rounded-lg bg-rose-500/10 px-3 py-2">
          <p class="text-lg font-bold text-rose-300">{{ counts.pendingFloor }}</p>
          <p class="text-[10px] uppercase text-rose-500/70">Floor</p>
        </div>
        <div class="rounded-lg bg-amber-500/10 px-3 py-2">
          <p class="text-lg font-bold text-amber-300">{{ counts.draftPos }}</p>
          <p class="text-[10px] uppercase text-amber-500/70">Drafts</p>
        </div>
        <div class="rounded-lg bg-sky-500/10 px-3 py-2">
          <p class="text-lg font-bold text-sky-300">{{ counts.pendingPos }}</p>
          <p class="text-[10px] uppercase text-sky-500/70">Pending</p>
        </div>
        <div class="rounded-lg bg-violet-500/10 px-3 py-2">
          <p class="text-lg font-bold text-violet-300">{{ counts.proposedPipeline }}</p>
          <p class="text-[10px] uppercase text-violet-500/70">Proposed</p>
        </div>
        <div class="rounded-lg bg-emerald-500/10 px-3 py-2">
          <p class="text-lg font-bold text-emerald-300">{{ counts.openActions }}</p>
          <p class="text-[10px] uppercase text-emerald-500/70">Open</p>
        </div>
      </div>
    </div>

    <div
      class="mb-4 rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs text-gray-400"
    >
      <p>
        <strong class="text-rose-300">Floor / POS signals</strong> (damage, found stock, cycle counts) from
        Fran POS or MCP land here as <strong class="text-white">pending</strong> —
        stock does <strong class="text-white">not</strong> change until HQ
        <strong class="text-white">Apply</strong> (or Reject).
      </p>
      <p class="mt-1">
        Agent PO drafts land as <strong class="text-amber-300">DRAFT</strong> until you
        <strong class="text-white">Submit</strong>. Also see
        <NuxtLink to="/store-ops?tab=floor" class="text-indigo-400 hover:underline">Store Ops → Floor</NuxtLink>.
      </p>
    </div>

    <div v-if="error" class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {{ error }}
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        :class="[
          'rounded-full px-3 py-1.5 text-xs font-medium transition-colors ring-1',
          tab === t.key
            ? 'bg-indigo-500/20 text-indigo-300 ring-indigo-500/40'
            : 'bg-gray-900 text-gray-400 ring-gray-800 hover:text-white',
        ]"
        @click="tab = t.key"
      >
        {{ t.label }}
        <span class="ml-1 opacity-70">{{ t.count }}</span>
      </button>
      <select v-model="channelFilter" class="input-field ml-auto !w-auto !py-1 text-xs">
        <option value="all">All channels</option>
        <option value="mcp">MCP only</option>
        <option value="ui">UI only</option>
        <option value="api">API only</option>
      </select>
      <button type="button" class="btn-ghost text-xs" :disabled="loading" @click="loadInbox">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
    </div>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="card h-20 animate-pulse bg-gray-900/80" />
    </div>

    <!-- Floor / POS signals (damage, found, count) -->
    <div v-show="!loading && tab === 'floor'" class="space-y-3">
      <div
        v-if="filteredFloor.length === 0"
        class="card p-10 text-center text-sm text-gray-500"
      >
        No pending floor signals{{ channelFilter !== 'all' ? ` for ${channelFilter}` : '' }}.
        POS “2 damaged” / MCP floor_adjustment_create_draft show up here for HQ Apply.
      </div>
      <div
        v-for="adj in filteredFloor"
        :key="adj.id"
        class="card p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-mono text-sm text-white">{{ adj.adjustment_number }}</p>
              <span class="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-300">
                {{ adj.adjustment_type }}
              </span>
              <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', channelClass(channelFromMeta(adj))]">
                {{ channelFromMeta(adj).toUpperCase() }}
              </span>
            </div>
            <p class="mt-1 text-xs text-gray-400">
              {{ adj.location?.name || adj.location_id }}
              <span v-if="adj.location?.code" class="font-mono text-gray-500">({{ adj.location.code }})</span>
              · {{ relativeTime(adj.created_at) }}
            </p>
            <p class="mt-1 text-sm text-gray-300">{{ floorLineSummary(adj) || 'No lines' }}</p>
            <p v-if="adj.notes" class="mt-1 text-xs text-gray-500">{{ adj.notes }}</p>
            <p class="mt-1 text-xs" :class="floorVariance(adj) < 0 ? 'text-red-300' : floorVariance(adj) > 0 ? 'text-emerald-300' : 'text-gray-400'">
              Variance {{ floorVariance(adj) > 0 ? '+' : '' }}{{ floorVariance(adj) }}
              · ledger pending until Apply
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn-primary !px-3 !py-1.5 text-xs"
              :disabled="floorActing === adj.id"
              title="Write variance to inventory ledger (requires inventory:write)"
              @click="onApplyFloor(adj)"
            >
              {{ floorActing === adj.id ? '…' : 'Apply' }}
            </button>
            <button
              type="button"
              class="btn-secondary !px-3 !py-1.5 text-xs"
              :disabled="floorActing === adj.id"
              @click="onRejectFloor(adj)"
            >
              Reject
            </button>
            <NuxtLink
              to="/store-ops?tab=floor"
              class="text-xs text-indigo-400 hover:underline"
            >
              Store Ops
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>

    <!-- Draft POs -->
    <div v-show="!loading && tab === 'draft_pos'" class="space-y-3">
      <div
        v-if="filteredDrafts.length === 0"
        class="card p-10 text-center text-sm text-gray-500"
      >
        No draft decision POs{{ channelFilter !== 'all' ? ` for ${channelFilter}` : '' }}.
        Ask MCP to create or clone a draft — they show up here, not under Inventory.
      </div>
      <NuxtLink
        v-for="po in filteredDrafts"
        :key="po.id"
        :to="`/actions/internal-pos/${po.id}`"
        class="card block p-4 transition-colors hover:border-indigo-500/40"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="font-mono text-sm text-white">{{ po.po_number }}</p>
            <p class="mt-0.5 text-xs text-gray-400">{{ po.supplier_name || 'No supplier' }} · {{ po.line_count }} lines</p>
            <p class="mt-1 text-xs text-gray-600">
              {{ relativeTime(po.created_at) }}
              <span v-if="toolNameFor(po)" class="text-violet-400/80"> · {{ toolNameFor(po) }}</span>
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span :class="['rounded-full px-2 py-0.5 text-xs font-medium ring-1', statusClass(po.status)]">
              {{ po.status }}
            </span>
            <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', channelClass(channelFromMeta(po))]">
              {{ channelFromMeta(po).toUpperCase() }}
            </span>
            <span class="text-sm font-semibold text-white">{{ formatMoney(po.subtotal, po.currency) }}</span>
          </div>
        </div>
      </NuxtLink>
    </div>

    <div v-show="!loading && tab === 'pending_pos'" class="space-y-3">
      <div v-if="filteredPending.length === 0" class="card p-10 text-center text-sm text-gray-500">
        No POs waiting for approval.
      </div>
      <NuxtLink
        v-for="po in filteredPending"
        :key="po.id"
        :to="`/actions/internal-pos/${po.id}`"
        class="card block p-4 transition-colors hover:border-sky-500/40"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="font-mono text-sm text-white">{{ po.po_number }}</p>
            <p class="mt-0.5 text-xs text-gray-400">{{ relativeTime(po.submitted_at || po.updated_at) }}</p>
          </div>
          <div class="flex items-center gap-2">
            <span :class="['rounded-full px-2 py-0.5 text-xs font-medium ring-1', statusClass(po.status)]">
              pending_approval
            </span>
            <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', channelClass(channelFromMeta(po))]">
              {{ channelFromMeta(po).toUpperCase() }}
            </span>
            <span class="text-sm font-semibold text-white">{{ formatMoney(po.subtotal, po.currency) }}</span>
          </div>
        </div>
      </NuxtLink>
    </div>

    <div v-show="!loading && tab === 'pipeline_proposed'" class="space-y-3">
      <div v-if="filteredProposed.length === 0" class="card p-10 text-center text-sm text-gray-500">
        No proposed pipeline candidates.
      </div>
      <NuxtLink
        v-for="c in filteredProposed"
        :key="c.id"
        :to="`/actions/pipeline/${c.id}`"
        class="card block p-4 transition-colors hover:border-violet-500/40"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-white">{{ c.title }}</p>
            <p class="mt-0.5 text-xs text-gray-400">{{ c.kind }} · {{ relativeTime(c.created_at) }}</p>
          </div>
          <div class="flex gap-2">
            <span :class="['rounded-full px-2 py-0.5 text-xs font-medium ring-1', statusClass(c.status)]">
              {{ c.status }}
            </span>
            <span :class="['rounded-full px-2 py-0.5 text-xs font-medium', channelClass(channelFromMeta(c))]">
              {{ channelFromMeta(c).toUpperCase() }}
            </span>
          </div>
        </div>
      </NuxtLink>
    </div>

    <div v-show="!loading && tab === 'pipeline_accepted'" class="space-y-3">
      <div v-if="filteredAccepted.length === 0" class="card p-10 text-center text-sm text-gray-500">
        Nothing accepted and waiting to execute.
      </div>
      <NuxtLink
        v-for="c in filteredAccepted"
        :key="c.id"
        :to="`/actions/pipeline/${c.id}`"
        class="card block p-4 transition-colors hover:border-emerald-500/40"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-white">{{ c.title }}</p>
            <p class="mt-0.5 text-xs text-gray-400">{{ c.kind }} · {{ relativeTime(c.decided_at || c.updated_at) }}</p>
          </div>
          <span :class="['rounded-full px-2 py-0.5 text-xs font-medium ring-1', statusClass(c.status)]">
            accepted
          </span>
        </div>
      </NuxtLink>
    </div>

    <div v-show="!loading && tab === 'recent'" class="space-y-3">
      <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Decision POs</p>
      <NuxtLink
        v-for="po in decidedPos"
        :key="po.id"
        :to="`/actions/internal-pos/${po.id}`"
        class="card block p-4 hover:border-gray-600"
      >
        <div class="flex justify-between gap-3">
          <p class="font-mono text-sm text-white">{{ po.po_number }}</p>
          <span :class="['rounded-full px-2 py-0.5 text-xs font-medium ring-1', statusClass(po.status)]">
            {{ po.status }}
          </span>
        </div>
      </NuxtLink>
      <p class="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">Pipeline</p>
      <NuxtLink
        v-for="c in recentPipeline"
        :key="c.id"
        :to="`/actions/pipeline/${c.id}`"
        class="card block p-4 hover:border-gray-600"
      >
        <div class="flex justify-between gap-3">
          <p class="text-sm text-white">{{ c.title }}</p>
          <span :class="['rounded-full px-2 py-0.5 text-xs font-medium ring-1', statusClass(c.status)]">
            {{ c.status }}
          </span>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
