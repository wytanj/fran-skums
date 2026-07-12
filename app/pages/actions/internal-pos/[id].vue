<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const {
  loadInternalPo,
  updateDraftPo,
  submitPo,
  decidePo,
  channelFromMeta,
  toolNameFor,
  statusClass,
  channelClass,
  copyDeepLink,
  canApprove,
  canSubmit,
  canEditDraft,
  memberRole,
} = useActions()

const loading = ref(true)
const error = ref('')
const busy = ref(false)
const pack = ref<any>(null)
const decisionNote = ref('')
const editNotes = ref('')
const lineEdits = ref<Record<string, { quantity: number, unit_cost: number }>>({})
const copyOk = ref(false)
const toast = ref('')

async function reload() {
  loading.value = true
  error.value = ''
  try {
    pack.value = await loadInternalPo(String(route.params.id))
    if (pack.value?.po) {
      editNotes.value = pack.value.po.notes || ''
      const edits: Record<string, { quantity: number, unit_cost: number }> = {}
      for (const l of pack.value.lines || []) {
        if (l.id) edits[l.id] = { quantity: Number(l.quantity) || 0, unit_cost: Number(l.unit_cost) || 0 }
      }
      lineEdits.value = edits
    }
  } catch (e: any) {
    error.value = e?.message || 'Failed to load PO'
    pack.value = null
  } finally {
    loading.value = false
  }
}

onMounted(reload)

const po = computed(() => pack.value?.po)
const lines = computed(() => pack.value?.lines || [])
const audit = computed(() => pack.value?.audit || [])
const sourcePo = computed(() => pack.value?.sourcePo)
const channel = computed(() => (po.value ? channelFromMeta(po.value) : 'ui'))
const dropped = computed(() => po.value?.metadata?.dropped_lines_summary || [])
const tool = computed(() => (po.value ? toolNameFor(po.value) : undefined))

async function onSaveDraft() {
  if (!po.value || !canEditDraft.value) return
  busy.value = true
  error.value = ''
  try {
    const linePatches = Object.entries(lineEdits.value).map(([id, v]) => ({
      id,
      quantity: v.quantity,
      unit_cost: v.unit_cost,
    }))
    pack.value = await updateDraftPo(po.value.id, {
      notes: editNotes.value,
      lines: linePatches,
    })
    toast.value = 'Draft saved'
    setTimeout(() => { toast.value = '' }, 2000)
  } catch (e: any) {
    error.value = e?.message || 'Save failed'
  } finally {
    busy.value = false
  }
}

async function onSubmit() {
  if (!po.value || !canSubmit.value) return
  if (!confirm('Submit this draft for approval?\n\nStatus will change: DRAFT → pending_approval')) return
  busy.value = true
  try {
    await submitPo(po.value.id)
    await reload()
    toast.value = 'Submitted for approval'
    setTimeout(() => { toast.value = '' }, 2500)
  } catch (e: any) {
    error.value = e?.message || 'Submit failed'
  } finally {
    busy.value = false
  }
}

async function onDecide(decision: 'approved' | 'rejected') {
  if (!po.value || !canApprove.value) return
  if (!confirm(`${decision === 'approved' ? 'Approve' : 'Reject'} this PO?\n\npending_approval → ${decision}`)) return
  busy.value = true
  try {
    await decidePo(po.value.id, decision, decisionNote.value || undefined)
    await reload()
  } catch (e: any) {
    error.value = e?.message || 'Decision failed'
  } finally {
    busy.value = false
  }
}

async function onCopyLink() {
  if (!po.value) return
  const ok = await copyDeepLink(`/actions/internal-pos/${po.value.id}`)
  copyOk.value = ok
  toast.value = ok ? 'Link copied' : 'Could not copy'
  setTimeout(() => { toast.value = ''; copyOk.value = false }, 2000)
}

function money(n: any, c = 'SGD') {
  return `${c} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <button type="button" class="btn-ghost mb-4 text-xs text-gray-400" @click="router.push('/actions')">
      ← Actions
    </button>

    <div v-if="toast" class="mb-3 rounded-lg bg-indigo-500/15 px-3 py-2 text-xs text-indigo-200">{{ toast }}</div>
    <div v-if="loading" class="card p-8 text-center text-sm text-gray-500">Loading…</div>
    <div v-else-if="error && !po" class="card p-6 text-red-300">{{ error }}</div>

    <template v-else-if="po">
      <div
        v-if="po.status === 'draft'"
        class="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
      >
        <strong>DRAFT</strong> — not submitted. Safe to edit. Agents must not treat this as ordered.
      </div>

      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="font-mono text-2xl font-bold text-white">{{ po.po_number }}</h1>
          <p class="mt-1 text-sm text-gray-400">
            Internal decision PO · {{ po.supplier_name || 'No supplier' }}
          </p>
          <p v-if="sourcePo" class="mt-1 text-xs text-violet-300">
            Cloned from
            <NuxtLink :to="`/actions/internal-pos/${sourcePo.id}`" class="underline">
              {{ sourcePo.po_number }}
            </NuxtLink>
          </p>
          <p v-if="tool" class="mt-1 text-xs text-violet-400/80">via {{ tool }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span :class="['rounded-full px-2.5 py-1 text-xs font-medium ring-1', statusClass(po.status)]">
            {{ po.status }}
          </span>
          <span :class="['rounded-full px-2.5 py-1 text-xs font-medium', channelClass(channel)]">
            {{ channel.toUpperCase() }}
          </span>
          <button type="button" class="btn-ghost text-xs" @click="onCopyLink">
            {{ copyOk ? 'Copied' : 'Copy link' }}
          </button>
        </div>
      </div>

      <div v-if="error" class="mb-4 text-sm text-red-300">{{ error }}</div>

      <div class="mb-6 grid gap-4 sm:grid-cols-3">
        <div class="card p-4">
          <p class="text-xs text-gray-500">Subtotal</p>
          <p class="mt-1 text-lg font-semibold text-white">{{ money(po.subtotal, po.currency) }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-gray-500">Lines</p>
          <p class="mt-1 text-lg font-semibold text-white">{{ po.line_count }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-gray-500">Needed by</p>
          <p class="mt-1 text-lg font-semibold text-white">{{ po.needed_by || '—' }}</p>
        </div>
      </div>

      <div v-if="dropped.length" class="card mb-6 p-4">
        <h2 class="mb-2 text-sm font-semibold text-amber-300">Excluded on clone</h2>
        <ul class="space-y-1 text-xs text-gray-400">
          <li v-for="(d, i) in dropped" :key="i">
            {{ d.title }} <span class="text-gray-600">({{ d.drop_reason || d.sku }})</span>
          </li>
        </ul>
      </div>

      <div class="card mb-6 overflow-hidden">
        <div class="border-b border-gray-800 px-4 py-3 text-sm font-medium text-white">Lines</div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 text-left text-xs text-gray-500">
                <th class="px-4 py-2">#</th>
                <th class="px-4 py-2">Title</th>
                <th class="px-4 py-2">SKU</th>
                <th class="px-4 py-2 text-right">Qty</th>
                <th class="px-4 py-2 text-right">Unit</th>
                <th class="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-800/60">
              <tr v-for="line in lines" :key="line.id || line.line_number">
                <td class="px-4 py-2 text-gray-600">{{ line.line_number }}</td>
                <td class="px-4 py-2 text-gray-200">{{ line.title }}</td>
                <td class="px-4 py-2 font-mono text-xs text-gray-400">{{ line.sku || '—' }}</td>
                <td class="px-4 py-2 text-right">
                  <input
                    v-if="po.status === 'draft' && canEditDraft && line.id && lineEdits[line.id]"
                    v-model.number="lineEdits[line.id].quantity"
                    type="number"
                    min="0"
                    step="1"
                    class="input-field !w-20 !py-1 text-right text-sm"
                  >
                  <span v-else class="text-gray-300">{{ line.quantity }}</span>
                </td>
                <td class="px-4 py-2 text-right">
                  <input
                    v-if="po.status === 'draft' && canEditDraft && line.id && lineEdits[line.id]"
                    v-model.number="lineEdits[line.id].unit_cost"
                    type="number"
                    min="0"
                    step="0.01"
                    class="input-field !w-24 !py-1 text-right text-sm"
                  >
                  <span v-else class="text-gray-300">{{ money(line.unit_cost, line.currency || po.currency) }}</span>
                </td>
                <td class="px-4 py-2 text-right text-white">{{ money(line.line_total, line.currency || po.currency) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card mb-6 p-4">
        <h2 class="mb-2 text-xs font-medium uppercase text-gray-500">Notes</h2>
        <textarea
          v-if="po.status === 'draft' && canEditDraft"
          v-model="editNotes"
          rows="4"
          class="input-field text-sm"
        />
        <pre v-else class="whitespace-pre-wrap text-sm text-gray-300">{{ po.notes || '—' }}</pre>
      </div>

      <div class="card mb-6 flex flex-wrap items-center gap-3 p-4">
        <button
          v-if="po.status === 'draft' && canEditDraft"
          type="button"
          class="btn-secondary"
          :disabled="busy"
          @click="onSaveDraft"
        >
          Save draft
        </button>
        <button
          v-if="po.status === 'draft' && canSubmit"
          type="button"
          class="btn-primary"
          :disabled="busy"
          @click="onSubmit"
        >
          Submit for approval
        </button>
        <p v-if="po.status === 'draft' && !canSubmit" class="text-xs text-amber-400">
          You cannot submit (role: {{ memberRole }}).
        </p>
        <template v-if="po.status === 'pending_approval'">
          <input
            v-model="decisionNote"
            class="input-field min-w-[200px] flex-1 text-sm"
            placeholder="Decision note (optional)"
            :disabled="!canApprove"
          >
          <button
            type="button"
            class="btn-primary"
            :disabled="busy || !canApprove"
            @click="onDecide('approved')"
          >
            Approve
          </button>
          <button
            type="button"
            class="btn-secondary text-red-300"
            :disabled="busy || !canApprove"
            @click="onDecide('rejected')"
          >
            Reject
          </button>
          <p v-if="!canApprove" class="w-full text-xs text-amber-400">
            Only workspace owners/admins can approve or reject (your role: {{ memberRole }}).
          </p>
        </template>
      </div>

      <div class="card p-4">
        <h2 class="mb-3 text-sm font-semibold text-white">History</h2>
        <div v-if="!audit.length" class="text-xs text-gray-500">No audit events yet.</div>
        <ul class="space-y-2">
          <li
            v-for="ev in audit"
            :key="ev.id"
            class="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-800/50 pb-2 text-xs"
          >
            <span class="text-gray-300">
              <span class="font-medium text-white">{{ ev.event_type }}</span>
              · {{ ev.source_type }}
              <span v-if="ev.metadata?.tool_name" class="text-violet-300">· {{ ev.metadata.tool_name }}</span>
            </span>
            <span class="text-gray-600">{{ new Date(ev.created_at).toLocaleString() }}</span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
