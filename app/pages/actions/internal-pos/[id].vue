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
// Shared fixed-position feedback (ToastHost) — see useActionFeedback.
const { notify } = useActionFeedback()

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
    notify.success('Draft saved')
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
    notify.success('Submitted for approval')
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
  if (ok) notify.success('Link copied')
  else notify.error(new Error('Could not copy the link'))
  setTimeout(() => { copyOk.value = false }, 2000)
}

function money(n: any, c = 'SGD') {
  return `${c} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <button type="button" class="btn-ghost mb-4 text-xs text-muted" @click="router.push('/actions')">
      ← Actions
    </button>

    <div v-if="loading" class="card p-8 text-center text-sm text-muted">Loading…</div>
    <div v-else-if="error && !po" class="card p-6 text-danger">{{ error }}</div>

    <template v-else-if="po">
      <div
        v-if="po.status === 'draft'"
        class="mb-4 rounded-lg border border-amber-500/30 bg-warning-soft px-4 py-3 text-sm text-amber-200"
      >
        <strong>DRAFT</strong> — not submitted. Safe to edit. Agents must not treat this as ordered.
      </div>

      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="font-mono text-2xl font-bold text-ink">{{ po.po_number }}</h1>
          <p class="mt-1 text-sm text-muted">
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

      <div v-if="error" class="mb-4 text-sm text-danger">{{ error }}</div>

      <div class="mb-6 grid gap-4 sm:grid-cols-3">
        <div class="card p-4">
          <p class="text-xs text-muted">Subtotal</p>
          <p class="mt-1 text-lg font-semibold text-ink">{{ money(po.subtotal, po.currency) }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-muted">Lines</p>
          <p class="mt-1 text-lg font-semibold text-ink">{{ po.line_count }}</p>
        </div>
        <div class="card p-4">
          <p class="text-xs text-muted">Needed by</p>
          <p class="mt-1 text-lg font-semibold text-ink">{{ po.needed_by || '—' }}</p>
        </div>
      </div>

      <div v-if="dropped.length" class="card mb-6 p-4">
        <h2 class="mb-2 text-sm font-semibold text-warning">Excluded on clone</h2>
        <ul class="space-y-1 text-xs text-muted">
          <li v-for="(d, i) in dropped" :key="i">
            {{ d.title }} <span class="text-muted">({{ d.drop_reason || d.sku }})</span>
          </li>
        </ul>
      </div>

      <div class="card mb-6 overflow-hidden">
        <div class="border-b border-line px-4 py-3 text-sm font-medium text-ink">Lines</div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-line text-left text-xs text-muted">
                <th class="px-4 py-2">#</th>
                <th class="px-4 py-2">Title</th>
                <th class="px-4 py-2">SKU</th>
                <th class="px-4 py-2 text-right">Qty</th>
                <th class="px-4 py-2 text-right">Unit</th>
                <th class="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line/60">
              <tr v-for="line in lines" :key="line.id || line.line_number">
                <td class="px-4 py-2 text-muted">{{ line.line_number }}</td>
                <td class="px-4 py-2 text-ink-soft">{{ line.title }}</td>
                <td class="px-4 py-2 font-mono text-xs text-muted">{{ line.sku || '—' }}</td>
                <td class="px-4 py-2 text-right">
                  <input
                    v-if="po.status === 'draft' && canEditDraft && line.id && lineEdits[line.id]"
                    v-model.number="lineEdits[line.id].quantity"
                    type="number"
                    min="0"
                    step="1"
                    class="input-field !w-20 !py-1 text-right text-sm"
                  >
                  <span v-else class="text-ink-soft">{{ line.quantity }}</span>
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
                  <span v-else class="text-ink-soft">{{ money(line.unit_cost, line.currency || po.currency) }}</span>
                </td>
                <td class="px-4 py-2 text-right text-ink">{{ money(line.line_total, line.currency || po.currency) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card mb-6 p-4">
        <h2 class="mb-2 text-xs font-medium uppercase text-muted">Notes</h2>
        <textarea
          v-if="po.status === 'draft' && canEditDraft"
          v-model="editNotes"
          rows="4"
          class="input-field text-sm"
        />
        <pre v-else class="whitespace-pre-wrap text-sm text-ink-soft">{{ po.notes || '—' }}</pre>
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
        <p v-if="po.status === 'draft' && !canSubmit" class="text-xs text-warning">
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
            class="btn-secondary text-danger"
            :disabled="busy || !canApprove"
            @click="onDecide('rejected')"
          >
            Reject
          </button>
          <p v-if="!canApprove" class="w-full text-xs text-warning">
            Only workspace owners/admins can approve or reject (your role: {{ memberRole }}).
          </p>
        </template>
      </div>

      <div class="card p-4">
        <h2 class="mb-3 text-sm font-semibold text-ink">History</h2>
        <div v-if="!audit.length" class="text-xs text-muted">No audit events yet.</div>
        <ul class="space-y-2">
          <li
            v-for="ev in audit"
            :key="ev.id"
            class="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft pb-2 text-xs"
          >
            <span class="text-ink-soft">
              <span class="font-medium text-ink">{{ ev.event_type }}</span>
              · {{ ev.source_type }}
              <span v-if="ev.metadata?.tool_name" class="text-violet-300">· {{ ev.metadata.tool_name }}</span>
            </span>
            <span class="text-muted">{{ new Date(ev.created_at).toLocaleString() }}</span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
