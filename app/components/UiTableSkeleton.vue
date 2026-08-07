<template>
  <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
    <div class="flex gap-4 border-b border-line bg-surface-sunken/60 px-3.5 py-2.5">
      <UiSkeleton v-for="c in columns" :key="`h${c}`" height="sm" :width="c === 1 ? '28%' : '14%'" />
    </div>
    <div v-for="r in rows" :key="r" class="flex gap-4 border-b border-line-soft px-3.5 py-3 last:border-0">
      <UiSkeleton v-for="c in columns" :key="`${r}-${c}`" height="sm" :width="c === 1 ? '28%' : '14%'" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ rows?: number; columns?: number }>(), { rows: 5, columns: 5 })
</script>
