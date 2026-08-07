<template>
  <div class="rounded-lg border border-line-soft bg-white p-4 shadow-warm-xs">
    <p class="text-[10.5px] font-semibold uppercase tracking-[0.5px] text-muted">{{ label }}</p>
    <p class="mt-1 font-display text-[27px] font-bold leading-8 tracking-tight" :class="toneClass">
      {{ value }}<span v-if="unit" class="ml-0.5 text-[14px] font-medium text-muted">{{ unit }}</span>
    </p>
    <p v-if="hint" class="mt-0.5 text-[11.5px] text-muted">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  value: string | number
  unit?: string
  hint?: string
  tone?: 'ink' | 'warning' | 'danger' | 'success'
}>(), { tone: 'ink' })

const toneClass = computed(() => ({
  ink: 'text-ink',
  warning: 'text-warning',
  danger: 'text-danger',
  success: 'text-success',
}[props.tone]))
</script>
