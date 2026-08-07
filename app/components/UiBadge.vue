<template>
  <span
    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
    :class="toneClass"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  tone?: 'primary' | 'muted' | 'success' | 'warning' | 'danger' | 'accent' | 'ink'
}>(), { tone: 'muted' })

const toneClass = computed(() => ({
  primary: 'bg-yellow-soft text-brown',
  muted: 'bg-surface-sunken text-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-blue-soft text-brown',
  ink: 'bg-brown text-yellow',
}[props.tone]))
</script>
