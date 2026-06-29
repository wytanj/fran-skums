<script setup lang="ts">
defineProps<{
  status: 'draft' | 'active' | 'archived' | string
}>()

const classes: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  draft: 'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20',
  archived: 'bg-gray-500/10 text-gray-400 ring-gray-500/20',
}
</script>

<template>
  <span
    :class="[
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize',
      classes[status] || classes.draft,
    ]"
  >
    {{ status }}
  </span>
</template>
