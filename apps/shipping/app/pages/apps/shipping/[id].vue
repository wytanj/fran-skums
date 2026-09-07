<script setup lang="ts">
const route = useRoute()
const { currentWorkspace } = useWorkspace()
const client = useSupabaseClient()
const { notify } = useActionFeedback()

const loading = ref(false)
const error = ref<string | null>(null)
const shipment = ref<any | null>(null)
const events = ref<any[]>([])
const notes = ref<any[]>([])
const files = ref<any[]>([])
const lines = ref<any[]>([])
const noteBody = ref("")
const noteBusy = ref(false)

const id = computed(() => String(route.params.id || ""))

const fsm = ["intake","quote","booked","pickup_scheduled","in_transit","arrived_sg","delivered","closed"]

async function load() {
  if (!currentWorkspace.value?.id || !id.value) return
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<any>(`/api/apps/shipping/${id.value}`, {
      query: { workspace_id: currentWorkspace.value.id },
    })
    shipment.value = res.data.shipment
    events.value = res.data.events || []
    notes.value = res.data.notes || []
    files.value = res.data.files || []
    lines.value = res.data.lines || []
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || "Failed to load"
    // Direct client fallback
    const wid = currentWorkspace.value.id
    const { data: s } = await client.from("shipping_shipments").select("*").eq("id", id.value).eq("workspace_id", wid).maybeSingle()
    shipment.value = s
    if (!s) return
    const [ev, nt, fl, ln] = await Promise.all([
      client.from("shipping_events").select("*").eq("shipment_id", id.value).order("occurred_at", { ascending: true }),
      client.from("shipping_notes").select("*").eq("shipment_id", id.value).order("occurred_at", { ascending: false }),
      client.from("shipping_files").select("*").eq("shipment_id", id.value).order("sort_order", { ascending: true }),
      client.from("shipping_lines").select("*").eq("shipment_id", id.value).order("line_number", { ascending: true }),
    ])
    events.value = ev.data || []
    notes.value = nt.data || []
    files.value = fl.data || []
    lines.value = ln.data || []
    if (s) error.value = null
  } finally {
    loading.value = false
  }
}

watch([id, () => currentWorkspace.value?.id], () => { void load() }, { immediate: true })

async function addNote() {
  if (!noteBody.value.trim() || !currentWorkspace.value?.id) return
  noteBusy.value = true
  try {
    await $fetch(`/api/apps/shipping/${id.value}/notes`, {
      method: "POST",
      body: { workspace_id: currentWorkspace.value.id, body: noteBody.value.trim(), note_type: "staff" },
    })
    noteBody.value = ""
    notify.success("Note added")
    await load()
  } catch (e: any) {
    notify.error(e?.data?.statusMessage || e?.message || "Could not add note")
  } finally {
    noteBusy.value = false
  }
}

function badgeClass(severity: string) {
  if (severity === "danger") return "bg-danger-soft text-danger"
  if (severity === "warning") return "bg-warning-soft text-warning"
  return "bg-blue-soft text-brown"
}

function stepDone(status: string, step: string) {
  const i = fsm.indexOf(status)
  const j = fsm.indexOf(step)
  if (i < 0 || j < 0) return false
  return j <= i
}

function stepCurrent(status: string, step: string) {
  return status === step
}

function stepClass(status: string, step: string) {
  if (stepCurrent(status, step)) return "bg-yellow text-brown ring-2 ring-brown/30"
  if (stepDone(status, step)) return "bg-success-soft text-success"
  return "bg-surface-sunken text-muted"
}
</script>

<template>
  <div class="w-full max-w-none px-1">
    <div class="mb-4">
      <NuxtLink to="/apps/shipping" class="text-[12px] font-medium text-muted hover:text-ink">← All shipments</NuxtLink>
    </div>

    <UiBusy v-if="loading && !shipment" />
    <p v-else-if="error && !shipment" class="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ error }}</p>

    <template v-else-if="shipment">
      <UiPageHeader
        eyebrow="Shipment detail"
        :title="shipment.title"
        :subtitle="`${shipment.forwarder_name || "—"} · ${shipment.mode} · ${shipment.origin_name || "?"} → ${shipment.destination_name || "?"}`"
      >
        <template #actions>
          <a
            v-if="shipment.drive_folder_url"
            :href="shipment.drive_folder_url"
            target="_blank"
            rel="noopener"
            class="press inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-[12px] font-semibold text-ink"
          >Open Drive folder</a>
        </template>
      </UiPageHeader>

      <!-- Badges -->
      <div class="mb-5 flex flex-wrap gap-2">
        <span class="inline-flex rounded-full bg-yellow-soft px-2.5 py-1 text-[11px] font-bold uppercase text-brown">{{ shipment.status?.replaceAll("_", " ") }}</span>
        <span
          v-for="b in (shipment.badges || [])"
          :key="b.key"
          class="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold"
          :class="badgeClass(b.severity)"
        >{{ b.label }}</span>
      </div>

      <!-- FSM strip -->
      <div class="mb-6 overflow-x-auto rounded-xl border border-line bg-white p-4">
        <div class="flex min-w-[900px] items-center gap-1">
          <div v-for="(step, idx) in fsm" :key="step" class="flex flex-1 items-center gap-1">
            <div
              class="flex h-9 flex-1 items-center justify-center rounded-md px-2 text-center text-[10px] font-bold uppercase tracking-wide"
              :class="stepClass(shipment.status, step)"
            >{{ step.replaceAll("_", " ") }}</div>
            <div v-if="idx < fsm.length - 1" class="h-0.5 w-3 shrink-0 bg-line" />
          </div>
        </div>
        <p class="mt-3 text-[13px] text-ink-soft">
          <span class="font-semibold text-ink">Where:</span> {{ shipment.current_location_label || "—" }}
          <span class="mx-2 text-muted">·</span>
          Flight {{ shipment.flight_number || "—" }} on {{ shipment.flight_date || "—" }}
          <span class="mx-2 text-muted">·</span>
          Pickup ETA {{ shipment.pickup_eta ? new Date(shipment.pickup_eta).toLocaleString() : "—" }}
        </p>
      </div>

      <div class="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <!-- Timeline -->
        <section class="xl:col-span-5 rounded-xl border border-line bg-white p-4">
          <h2 class="mb-3 font-display text-[18px] font-bold text-ink">Timeline</h2>
          <ol class="space-y-3">
            <li v-for="ev in events" :key="ev.id" class="relative border-l-2 border-line-soft pl-4">
              <div class="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-yellow" />
              <p class="text-[13px] font-semibold text-ink">{{ ev.title }}</p>
              <p v-if="ev.body" class="mt-0.5 text-[12px] text-ink-soft">{{ ev.body }}</p>
              <p class="mt-1 text-[11px] text-muted">
                {{ new Date(ev.occurred_at).toLocaleString() }}
                · {{ ev.event_type }}
                <span v-if="ev.from_status || ev.to_status"> · {{ ev.from_status || "—" }} → {{ ev.to_status || "—" }}</span>
              </p>
            </li>
          </ol>
        </section>

        <!-- Facts + packages -->
        <section class="xl:col-span-4 space-y-5">
          <div class="rounded-xl border border-line bg-white p-4">
            <h2 class="mb-3 font-display text-[18px] font-bold text-ink">Facts</h2>
            <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
              <dt class="text-muted">Quote</dt><dd class="font-medium text-ink">{{ shipment.quote_number || "—" }}</dd>
              <dt class="text-muted">Batch</dt><dd class="font-medium text-ink">{{ shipment.batch_number || "—" }}</dd>
              <dt class="text-muted">MAWB</dt><dd class="font-medium text-ink">{{ shipment.mawb || "—" }}</dd>
              <dt class="text-muted">HAWB</dt><dd class="font-medium text-ink">{{ shipment.hawb || "—" }}</dd>
              <dt class="text-muted">Carrier IDs</dt><dd class="font-medium text-ink">{{ (shipment.carrier_shipment_ids || []).join(", ") || "—" }}</dd>
              <dt class="text-muted">Contact</dt><dd class="font-medium text-ink">{{ shipment.contact_email || "—" }}</dd>
              <dt class="text-muted">Driver</dt><dd class="font-medium text-ink">{{ shipment.driver_name || "Missing" }}</dd>
              <dt class="text-muted">Pickup confirmed</dt><dd class="font-medium text-ink">{{ shipment.pickup_confirmed_at ? new Date(shipment.pickup_confirmed_at).toLocaleString() : "Missing" }}</dd>
              <dt class="text-muted">Pkgs / kg</dt><dd class="font-medium text-ink">{{ shipment.package_count }} / {{ shipment.weight_kg }}</dd>
            </dl>
            <div v-if="(shipment.missing_fields || []).length" class="mt-4 rounded-md bg-warning-soft px-3 py-2">
              <p class="text-[11px] font-bold uppercase text-warning">Missing</p>
              <ul class="mt-1 list-disc pl-4 text-[12px] text-ink">
                <li v-for="m in shipment.missing_fields" :key="m">{{ m.replaceAll("_", " ") }}</li>
              </ul>
            </div>
          </div>

          <div class="rounded-xl border border-line bg-white p-4">
            <h2 class="mb-3 font-display text-[18px] font-bold text-ink">Packages</h2>
            <ul class="divide-y divide-line-soft text-[12px]">
              <li v-for="line in lines" :key="line.id" class="flex items-center justify-between py-2">
                <span class="font-medium text-ink">{{ line.package_ref || ("Line " + line.line_number) }}</span>
                <span class="text-muted">{{ line.description }}</span>
                <span class="tabular-nums text-ink-soft">{{ line.weight_kg }} kg</span>
              </li>
            </ul>
          </div>
        </section>

        <!-- Files + notes -->
        <section class="xl:col-span-3 space-y-5">
          <div class="rounded-xl border border-line bg-white p-4">
            <h2 class="mb-3 font-display text-[18px] font-bold text-ink">Files (Drive)</h2>
            <ul class="space-y-2">
              <li v-for="f in files" :key="f.id" class="rounded-md border border-line-soft px-3 py-2 text-[12px]"
                :class="f.is_missing ? 'bg-danger-soft/40' : 'bg-surface-sunken/40'">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <p class="font-semibold text-ink">{{ f.label }}</p>
                    <p class="text-[11px] uppercase text-muted">{{ f.file_kind }}</p>
                  </div>
                  <span v-if="f.is_missing" class="text-[10px] font-bold uppercase text-danger">Missing</span>
                  <a v-else-if="f.drive_url" :href="f.drive_url" target="_blank" rel="noopener" class="text-[11px] font-semibold text-brown hover:underline">Open</a>
                </div>
              </li>
            </ul>
          </div>

          <div class="rounded-xl border border-line bg-white p-4">
            <h2 class="mb-3 font-display text-[18px] font-bold text-ink">Notes</h2>
            <div class="mb-3 space-y-2">
              <textarea v-model="noteBody" rows="3" class="input-field w-full text-[12px]" placeholder="Staff note…" />
              <UiButton size="sm" :disabled="noteBusy || !noteBody.trim()" @click="addNote">Add note</UiButton>
            </div>
            <ul class="space-y-3">
              <li v-for="n in notes" :key="n.id" class="rounded-md border border-line-soft px-3 py-2">
                <p class="text-[11px] font-bold uppercase tracking-wide text-muted">
                  {{ n.note_type === "whatsapp_excerpt" ? "WhatsApp (curated)" : "Staff" }}
                  <span v-if="n.author_label"> · {{ n.author_label }}</span>
                </p>
                <p class="mt-1 whitespace-pre-wrap text-[12px] text-ink">{{ n.body }}</p>
                <p class="mt-1 text-[10px] text-muted">{{ new Date(n.occurred_at).toLocaleString() }}</p>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
