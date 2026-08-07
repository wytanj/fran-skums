<script setup lang="ts" generic="T extends Record<string, any>">
export interface Column<T> {
  key: string
  label: string
  sortable?: boolean
  class?: string
}

const props = defineProps<{
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  selectable?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}>()

const emit = defineEmits<{
  sort: [key: string]
  rowClick: [row: T]
}>()

const selectedIds = defineModel<string[]>('selected', { default: () => [] })

const allSelected = computed(() =>
  props.rows.length > 0 && selectedIds.value.length === props.rows.length,
)

function toggleAll() {
  if (allSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = props.rows.map((r) => r.id)
  }
}

function toggleRow(id: string) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) {
    selectedIds.value = selectedIds.value.filter((i) => i !== id)
  } else {
    selectedIds.value = [...selectedIds.value, id]
  }
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
    <div class="overflow-x-auto">
      <table class="w-full text-left text-[13px]">
        <thead>
          <tr class="border-b border-line bg-surface-sunken/60">
            <th v-if="selectable" class="w-12 px-3.5 py-2.5">
              <input
                type="checkbox"
                :checked="allSelected"
                class="rounded border-line-strong text-brown focus:ring-yellow-deep focus:ring-offset-cream"
                @change="toggleAll"
              >
            </th>
            <th
              v-for="col in columns"
              :key="col.key"
              :class="[
                'whitespace-nowrap px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-muted',
                col.class,
                col.sortable ? 'cursor-pointer select-none hover:text-ink' : '',
              ]"
              @click="col.sortable ? emit('sort', col.key) : undefined"
            >
              <span class="flex items-center gap-1">
                {{ col.label }}
                <svg
                  v-if="col.sortable && sortBy === col.key"
                  class="h-3.5 w-3.5 transition-transform"
                  :class="{ 'rotate-180': sortDir === 'desc' }"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
                </svg>
              </span>
            </th>
          </tr>
        </thead>

        <tbody v-if="loading">
          <tr v-for="i in 5" :key="i" class="border-b border-line-soft last:border-0">
            <td v-if="selectable" class="px-3.5 py-3">
              <div class="skeleton h-4 w-4 rounded" />
            </td>
            <td v-for="col in columns" :key="col.key" class="px-3.5 py-3">
              <div class="skeleton h-4 rounded" :class="col.key === 'title' ? 'w-48' : 'w-20'" />
            </td>
          </tr>
        </tbody>

        <tbody v-else-if="rows.length === 0">
          <tr>
            <td :colspan="columns.length + (selectable ? 1 : 0)" class="px-3.5 py-12 text-center text-muted">
              No data found
            </td>
          </tr>
        </tbody>

        <tbody v-else>
          <tr
            v-for="row in rows"
            :key="row.id"
            class="cursor-pointer border-b border-line-soft transition-colors last:border-0 hover:bg-surface-sunken/60"
            @click="emit('rowClick', row)"
          >
            <td v-if="selectable" class="px-3.5 py-3" @click.stop>
              <input
                type="checkbox"
                :checked="selectedIds.includes(row.id)"
                class="rounded border-line-strong text-brown focus:ring-yellow-deep focus:ring-offset-cream"
                @change="toggleRow(row.id)"
              >
            </td>
            <td v-for="col in columns" :key="col.key" :class="['px-3.5 py-3 text-ink', col.class]">
              <slot :name="`cell-${col.key}`" :row="row" :value="row[col.key]">
                {{ row[col.key] ?? '—' }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
