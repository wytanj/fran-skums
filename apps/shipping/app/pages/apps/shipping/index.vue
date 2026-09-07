<script setup lang="ts">
const { currentWorkspace } = useWorkspace()
const client = useSupabaseClient()
const loading = ref(false)
const error = ref<string | null>(null)
const shipments = ref<any[]>([])
const statusFilter = ref("all")

const statuses = ["all","intake","quote","booked","pickup_scheduled","in_transit","arrived_sg","delivered","closed","on_hold","exception"]

async function load() {
  if (!currentWorkspace.value?.id) return
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ data: any[] }>("/api/apps/shipping", {
      query: {
        workspace_id: currentWorkspace.value.id,
        ...(statusFilter.value !== "all" ? { status: statusFilter.value } : {}),
      },
    })
    shipments.value = res.data || []
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || "Failed to load shipments"
    // Fallback: direct Supabase if API route not yet migrated
    try {
      let q = client.from("shipping_shipments").select("*").eq("workspace_id", currentWorkspace.value.id).order("updated_at", { ascending: false })
      if (statusFilter.value !== "all") q = q.eq("status", statusFilter.value)
      const { data } = await q
      shipments.value = data || []
      if (shipments.value.length) error.value = null
    } catch { /* keep error */ }
  } finally {
    loading.value = false
  }
}

watch([() => currentWorkspace.value?.id, statusFilter], () => { void load() }, { immediate: true })

function badgeClass(severity: string) {
  if (severity === "danger") return "bg-danger-soft text-danger"
  if (severity === "warning") return "bg-warning-soft text-warning"
  return "bg-blue-soft text-brown"
}

function statusClass(status: string) {
  const map: Record<string, string> = {
    booked: "bg-blue-soft text-brown",
    in_transit: "bg-yellow-soft text-brown",
    arrived_sg: "bg-success-soft text-success",
    delivered: "bg-success-soft text-success",
    closed: "bg-surface-sunken text-muted",
    exception: "bg-danger-soft text-danger",
    on_hold: "bg-warning-soft text-warning",
  }
  return map[status] || "bg-yellow-soft text-brown"
}
</script>

<template>
  <div class="w-full max-w-none px-1">
    <UiPageHeader
      eyebrow="Ops observation"
      title="Shipping"
      subtitle="Where is it, what is missing — timeline, Drive files, curated WhatsApp excerpts."
    >
      <template #actions>
        <select v-model="statusFilter" class="input-field h-9 w-44 text-[12px]">
          <option v-for="s in statuses" :key="s" :value="s">{{ s === "all" ? "All statuses" : s.replaceAll("_", " ") }}</option>
        </select>
        <UiButton size="sm" variant="secondary" :disabled="loading" @click="load">Refresh</UiButton>
      </template>
    </UiPageHeader>

    <p v-if="error" class="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{{ error }}</p>
    <UiBusy v-if="loading && !shipments.length" />
    <UiEmpty v-else-if="!shipments.length" title="No shipments" description="Seed the M&P x Fran test air shipment or ingest via API." />

    <div v-else class="overflow-hidden rounded-xl border border-line bg-white">
      <table class="w-full text-left text-[13px]">
        <thead class="border-b border-line-soft bg-surface-sunken text-[11px] uppercase tracking-wide text-muted">
          <tr>
            <th class="px-4 py-3 font-semibold">Shipment</th>
            <th class="px-4 py-3 font-semibold">Status</th>
            <th class="px-4 py-3 font-semibold">Where</th>
            <th class="px-4 py-3 font-semibold">Pkgs / kg</th>
            <th class="px-4 py-3 font-semibold">Badges</th>
            <th class="px-4 py-3 font-semibold">Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in shipments" :key="row.id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/60">
            <td class="px-4 py-3">
              <NuxtLink :to="`/apps/shipping/${row.id}`" class="font-semibold text-ink hover:underline">
                {{ row.title }}
              </NuxtLink>
              <div class="mt-0.5 text-[11px] text-muted">
                batch {{ row.batch_number || "—" }} · quote {{ row.quote_number || "—" }}
              </div>
            </td>
            <td class="px-4 py-3">
              <span class="inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase" :class="statusClass(row.status)">{{ row.status?.replaceAll("_", " ") }}</span>
            </td>
            <td class="px-4 py-3 text-ink-soft">{{ row.current_location_label || row.origin_name || "—" }}</td>
            <td class="px-4 py-3 tabular-nums">{{ row.package_count ?? "—" }} / {{ row.weight_kg ?? "—" }}</td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="b in (row.badges || []).slice(0, 4)"
                  :key="b.key"
                  class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  :class="badgeClass(b.severity)"
                >{{ b.label }}</span>
                <span v-if="!(row.badges || []).length && (row.missing_fields || []).length" class="text-[11px] text-warning">{{ row.missing_fields.length }} missing</span>
              </div>
            </td>
            <td class="px-4 py-3 text-[12px] text-muted">{{ row.updated_at ? new Date(row.updated_at).toLocaleString() : "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
