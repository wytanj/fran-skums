<script setup lang="ts">
defineProps<{
  status: 'draft' | 'active' | 'archived' | string
}>()

const classes: Record<string, string> = {
  active: 'bg-success-soft text-success',
  draft: 'bg-yellow-soft text-brown',
  archived: 'bg-surface-sunken text-muted',
  pending: 'bg-warning-soft text-warning',
  pending_approval: 'bg-warning-soft text-warning',
  error: 'bg-danger-soft text-danger',
  failed: 'bg-danger-soft text-danger',
}
</script>

<template>
  <span
    :class="[
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide capitalize',
      classes[status] || classes.draft,
    ]"
  >
    {{ status }}
  </span>
</template>
