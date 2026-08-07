<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const {
  loadPipelineCandidate,
  decidePipeline,
  statusClass,
  channelFromMeta,
  channelClass,
  toolNameFor,
  copyDeepLink,
  canApprove,
  memberRole,
} = useActions()

const loading = ref(true)
const error = ref('')
const busy = ref(false)
const pack = ref<any>(null)
const note = ref('')
// Shared fixed-position feedback (ToastHost) — see useActionFeedback.
const { notify } = useActionFeedback()

async function reload() {
  loading.value = true
  error.value = ''
  try {
    pack.value = await loadPipelineCandidate(String(route.params.id))
  } catch (e: any) {
    error.value = e?.message || 'Failed to load'
    pack.value = null
  } finally {
    loading.value = false
  }
}

onMounted(reload)

const c = computed(() => pack.value?.candidate)
const audit = computed(() => pack.value?.audit || [])
const channel = computed(() => (c.value ? channelFromMeta(c.value) : 'ui'))

async function onDecide(decision: 'accepted' | 'rejected' | 'deferred') {
  if (!c.value || !canApprove.value) return
  if (!confirm(`${decision} this candidate?`)) return
  busy.value = true
  try {
    await decidePipeline(c.value.id, decision, note.value || undefined)
    await reload()
  } catch (e: any) {
    error.value = e?.message || 'Failed'
  } finally {
    busy.value = false
  }
}

async function onCopyLink() {
  if (!c.value) return
  const ok = await copyDeepLink(`/actions/pipeline/${c.value.id}`)
  if (ok) notify.success('Link copied')
  else notify.error(new Error('Could not copy the link'))
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <button type="button" class="btn-ghost mb-4 text-xs text-muted" @click="router.push('/actions')">
      ← Actions
    </button>

    <div v-if="loading" class="card p-8 text-center text-sm text-muted">Loading…</div>
    <div v-else-if="error && !c" class="card p-6 text-danger">{{ error }}</div>

    <template v-else-if="c">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-bold text-ink">{{ c.title }}</h1>
          <p class="mt-1 text-sm text-muted">{{ c.kind }} · pipeline candidate</p>
          <p v-if="c.summary" class="mt-2 text-sm text-ink-soft">{{ c.summary }}</p>
          <p v-if="toolNameFor(c)" class="mt-1 text-xs text-violet-400">via {{ toolNameFor(c) }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span :class="['rounded-full px-2.5 py-1 text-xs font-medium ring-1', statusClass(c.status)]">
            {{ c.status }}
          </span>
          <span :class="['rounded-full px-2.5 py-1 text-xs font-medium', channelClass(channel)]">
            {{ channel.toUpperCase() }}
          </span>
          <button type="button" class="btn-ghost text-xs" @click="onCopyLink">Copy link</button>
        </div>
      </div>

      <div v-if="error" class="mb-4 text-sm text-danger">{{ error }}</div>

      <div class="card mb-6 p-4">
        <h2 class="mb-2 text-xs font-medium uppercase text-muted">Payload</h2>
        <pre class="max-h-80 overflow-auto rounded bg-cream p-3 text-xs text-ink-soft">{{ JSON.stringify(c.payload || {}, null, 2) }}</pre>
      </div>

      <div v-if="c.evidence_refs?.length" class="card mb-6 p-4">
        <h2 class="mb-2 text-xs font-medium uppercase text-muted">Evidence</h2>
        <ul class="list-disc space-y-1 pl-5 text-xs text-muted">
          <li v-for="(e, i) in c.evidence_refs" :key="i">{{ e }}</li>
        </ul>
      </div>

      <div
        v-if="c.status === 'proposed' || c.status === 'deferred'"
        class="card mb-6 flex flex-wrap gap-3 p-4"
      >
        <input
          v-model="note"
          class="input-field min-w-[200px] flex-1 text-sm"
          placeholder="Decision note"
          :disabled="!canApprove"
        >
        <button type="button" class="btn-primary" :disabled="busy || !canApprove" @click="onDecide('accepted')">
          Accept
        </button>
        <button type="button" class="btn-secondary" :disabled="busy || !canApprove" @click="onDecide('deferred')">
          Defer
        </button>
        <button
          type="button"
          class="btn-secondary text-danger"
          :disabled="busy || !canApprove"
          @click="onDecide('rejected')"
        >
          Reject
        </button>
        <p v-if="!canApprove" class="w-full text-xs text-warning">
          Only owners/admins can decide (your role: {{ memberRole }}).
        </p>
      </div>

      <div
        v-if="c.status === 'accepted'"
        class="mb-6 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-emerald-200"
      >
        <p class="font-medium">Accepted — next step is execute (privileged).</p>
        <p class="mt-1 text-xs text-emerald-200/80">
          Preview first with MCP <code class="rounded bg-black/30 px-1">pipeline_preview_execute</code>, then
          <code class="rounded bg-black/30 px-1">pipeline_execute</code> on a full-profile machine.
          UI execute is intentionally not available yet.
        </p>
      </div>

      <div v-if="c.execution_result" class="card mb-6 p-4">
        <h2 class="mb-2 text-xs font-medium uppercase text-muted">Execution result</h2>
        <div
          v-if="c.execution_result?.type === 'catalog_product' && (c.product_id || c.execution_result?.product?.id)"
          class="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/90"
        >
          <p class="font-medium text-amber-200">Product created as draft (POS off)</p>
          <p class="mt-1 text-amber-200/70">
            Open the product and use <strong>Activate for POS</strong> when you want it on the register catalog.
          </p>
          <NuxtLink
            :to="`/products/${c.product_id || c.execution_result.product.id}`"
            class="mt-2 inline-block text-brown hover:underline"
          >
            Open product →
          </NuxtLink>
        </div>
        <pre class="overflow-auto text-xs text-ink-soft">{{ JSON.stringify(c.execution_result, null, 2) }}</pre>
      </div>

      <div class="card p-4">
        <h2 class="mb-3 text-sm font-semibold text-ink">History</h2>
        <ul class="space-y-2">
          <li
            v-for="ev in audit"
            :key="ev.id"
            class="flex justify-between gap-2 border-b border-line-soft pb-2 text-xs text-muted"
          >
            <span>{{ ev.event_type }} · {{ ev.source_type }}</span>
            <span class="text-muted">{{ new Date(ev.created_at).toLocaleString() }}</span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
