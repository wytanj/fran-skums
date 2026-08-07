<template>
  <!-- Wide tables scroll inside their own container so the page body never
       scrolls horizontally. -->
  <div class="overflow-x-auto rounded-lg border border-line-soft bg-white shadow-warm-sm">
    <table class="w-full text-left text-[13px]">
      <thead>
        <tr class="border-b border-line bg-surface-sunken/60">
          <th
            v-for="col in columns"
            :key="col.key"
            class="whitespace-nowrap px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-muted"
            :class="col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''"
            :style="col.width ? { width: col.width } : undefined"
          >
            {{ col.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <slot />
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
export interface Column {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  width?: string
}
defineProps<{ columns: Column[] }>()
</script>
