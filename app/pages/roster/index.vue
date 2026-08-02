<script setup lang="ts">
const {
  loading,
  error,
  zones,
  employees,
  boardDate,
  boardByZone,
  canWrite,
  loadAll,
  createEmployee,
  createShift,
  formatHour,
} = useRoster()

const { currentWorkspace } = useWorkspace()
const { setContext, clearContext } = useAssistant()
const { notify } = useActionFeedback()

const showEmployeeForm = ref(false)
const showShiftForm = ref(false)
const saving = ref(false)

const empForm = reactive({
  display_name: '',
  email: '',
  role_label: 'associate',
  source_provider: 'manual' as 'manual' | 'rippling',
  pos_staff_ref: '',
  default_zone_id: '',
})

const shiftForm = reactive({
  employee_id: '',
  zone_id: '',
  start_hour: '10',
  duration_hours: '4',
  notes: '',
})

watch(
  () => [currentWorkspace.value?.id, boardDate.value],
  () => {
    void loadAll()
    setContext('roster', 'board', { date: boardDate.value }, 'Store roster')
  },
  { immediate: true },
)

onUnmounted(() => clearContext())

async function onCreateEmployee() {
  if (!canWrite.value) return
  saving.value = true
  try {
    await createEmployee({
      display_name: empForm.display_name,
      email: empForm.email || undefined,
      role_label: empForm.role_label,
      source_provider: empForm.source_provider,
      pos_staff_ref: empForm.pos_staff_ref || undefined,
      default_zone_id: empForm.default_zone_id || undefined,
    })
    showEmployeeForm.value = false
    empForm.display_name = ''
    empForm.email = ''
    empForm.pos_staff_ref = ''
    notify.success('Employee added')
    await loadAll()
  } catch (e: any) {
    notify.error(e)
  } finally {
    saving.value = false
  }
}

async function onCreateShift() {
  if (!canWrite.value) return
  saving.value = true
  try {
    const h = Number(shiftForm.start_hour)
    const dur = Math.max(1, Number(shiftForm.duration_hours) || 4)
    const start = new Date(
      `${boardDate.value}T${String(h).padStart(2, '0')}:00:00+08:00`,
    )
    const end = new Date(start.getTime() + dur * 3600 * 1000)
    await createShift({
      employee_id: shiftForm.employee_id,
      zone_id: shiftForm.zone_id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      notes: shiftForm.notes || undefined,
    })
    showShiftForm.value = false
    notify.success('Shift scheduled')
    await loadAll()
  } catch (e: any) {
    notify.error(e)
  } finally {
    saving.value = false
  }
}

function sourceBadge(p: string) {
  if (p === 'rippling') return 'bg-violet-500/10 text-violet-300 ring-violet-500/30'
  return 'bg-gray-500/10 text-gray-400 ring-gray-600/40'
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-white">Roster</h1>
        <p class="mt-1 text-sm text-gray-400">
          Hourly floor assignments by zone. Employees can be manual or imported from Rippling.
          POS shows the zone for the logged-in staff member.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input v-model="boardDate" type="date" class="input-field !w-auto text-sm" />
        <button type="button" class="btn-ghost text-xs" :disabled="loading" @click="loadAll()">
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
        <button
          v-if="canWrite"
          type="button"
          class="btn-secondary text-sm"
          @click="showEmployeeForm = !showEmployeeForm"
        >
          Add employee
        </button>
        <button
          v-if="canWrite"
          type="button"
          class="btn-primary text-sm"
          @click="showShiftForm = !showShiftForm"
        >
          Schedule shift
        </button>
      </div>
    </div>

    <div
      class="mb-4 rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs text-gray-400"
    >
      Zones: <strong class="text-gray-300">Zone 1 · Zone 2 · Zone 3 · Cashier · Back of House</strong>.
      MCP: <code class="text-violet-300">roster_board</code>,
      <code class="text-violet-300">roster_upsert_shift</code>,
      <code class="text-violet-300">roster_import_rippling</code>,
      <code class="text-violet-300">roster_my_assignment</code>.
      Seed: <code class="text-gray-500">node scripts/_seed_roster_sample.mjs</code>
    </div>

    <div v-if="error" class="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {{ error }}
    </div>

    <!-- Employee form -->
    <div v-if="showEmployeeForm" class="card mb-6 p-5">
      <h2 class="mb-3 text-sm font-semibold text-white">Add employee</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label-field">Name *</label>
          <input v-model="empForm.display_name" class="input-field" placeholder="Display name" />
        </div>
        <div>
          <label class="label-field">Email</label>
          <input v-model="empForm.email" class="input-field" type="email" />
        </div>
        <div>
          <label class="label-field">Role</label>
          <input v-model="empForm.role_label" class="input-field" placeholder="associate" />
        </div>
        <div>
          <label class="label-field">Source</label>
          <select v-model="empForm.source_provider" class="input-field">
            <option value="manual">Manual</option>
            <option value="rippling">Rippling</option>
          </select>
        </div>
        <div>
          <label class="label-field">POS staff ref</label>
          <input
            v-model="empForm.pos_staff_ref"
            class="input-field"
            placeholder="fran-pos staff member id"
          />
        </div>
        <div>
          <label class="label-field">Default zone</label>
          <select v-model="empForm.default_zone_id" class="input-field">
            <option value="">—</option>
            <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
          </select>
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <button
          type="button"
          class="btn-primary text-sm"
          :disabled="saving || !empForm.display_name.trim()"
          @click="onCreateEmployee"
        >
          Save employee
        </button>
        <button type="button" class="btn-ghost text-sm" @click="showEmployeeForm = false">Cancel</button>
      </div>
    </div>

    <!-- Shift form -->
    <div v-if="showShiftForm" class="card mb-6 p-5">
      <h2 class="mb-3 text-sm font-semibold text-white">Schedule shift ({{ boardDate }} SGT)</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="label-field">Employee *</label>
          <select v-model="shiftForm.employee_id" class="input-field">
            <option value="">Select…</option>
            <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.display_name }}</option>
          </select>
        </div>
        <div>
          <label class="label-field">Zone *</label>
          <select v-model="shiftForm.zone_id" class="input-field">
            <option value="">Select…</option>
            <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
          </select>
        </div>
        <div>
          <label class="label-field">Start hour (SGT)</label>
          <input v-model="shiftForm.start_hour" type="number" min="0" max="23" class="input-field" />
        </div>
        <div>
          <label class="label-field">Duration (hours)</label>
          <input v-model="shiftForm.duration_hours" type="number" min="1" max="16" class="input-field" />
        </div>
        <div class="sm:col-span-2">
          <label class="label-field">Notes</label>
          <input v-model="shiftForm.notes" class="input-field" />
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <button
          type="button"
          class="btn-primary text-sm"
          :disabled="saving || !shiftForm.employee_id || !shiftForm.zone_id"
          @click="onCreateShift"
        >
          Save shift
        </button>
        <button type="button" class="btn-ghost text-sm" @click="showShiftForm = false">Cancel</button>
      </div>
    </div>

    <!-- Board -->
    <h2 class="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
      Board · {{ boardDate }}
    </h2>
    <div v-if="loading && !zones.length" class="space-y-3">
      <div v-for="i in 3" :key="i" class="card h-24 animate-pulse bg-gray-900/80" />
    </div>
    <div v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="col in boardByZone" :key="col.zone.id" class="card p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-white">{{ col.zone.name }}</h3>
          <span class="text-xs text-gray-500">{{ col.shifts.length }}</span>
        </div>
        <div v-if="!col.shifts.length" class="text-xs text-gray-600">No shifts</div>
        <ul class="space-y-2">
          <li
            v-for="s in col.shifts"
            :key="s.id"
            class="rounded-lg bg-gray-950/70 px-3 py-2 text-sm"
          >
            <p class="font-medium text-white">{{ s.employee?.display_name || '—' }}</p>
            <p class="text-xs text-gray-400">
              {{ formatHour(s.starts_at) }}–{{ formatHour(s.ends_at) }}
              <span class="text-gray-600"> · {{ s.status }}</span>
            </p>
          </li>
        </ul>
      </div>
    </div>

    <!-- People -->
    <h2 class="mb-3 mt-8 text-xs font-medium uppercase tracking-wide text-gray-500">
      People ({{ employees.length }})
    </h2>
    <div class="card overflow-hidden">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-gray-800 text-xs uppercase text-gray-500">
          <tr>
            <th class="px-4 py-2 font-medium">Name</th>
            <th class="px-4 py-2 font-medium">Role</th>
            <th class="px-4 py-2 font-medium">Source</th>
            <th class="px-4 py-2 font-medium">POS ref</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in employees"
            :key="e.id"
            class="border-b border-gray-800/60 text-gray-300"
          >
            <td class="px-4 py-2.5 text-white">{{ e.display_name }}</td>
            <td class="px-4 py-2.5">{{ e.role_label }}</td>
            <td class="px-4 py-2.5">
              <span :class="['rounded-full px-2 py-0.5 text-xs ring-1', sourceBadge(e.source_provider)]">
                {{ e.source_provider }}
              </span>
            </td>
            <td class="px-4 py-2.5 font-mono text-xs text-gray-500">
              {{ e.pos_staff_ref || '—' }}
            </td>
          </tr>
          <tr v-if="!employees.length">
            <td colspan="4" class="px-4 py-8 text-center text-gray-600">
              No employees yet. Add manually or import via MCP
              <code class="text-violet-400">roster_import_rippling</code>.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
