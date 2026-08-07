<template>
  <span
    class="inline-block animate-spin rounded-full border-current border-t-transparent align-[-0.125em]"
    :class="sizeClass"
    role="status"
    :aria-label="label"
  />
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  size?: 'xs' | 'sm' | 'md'
  label?: string
}>(), { size: 'sm', label: 'Loading' })

const sizeClass = computed(() => ({
  xs: 'h-3 w-3 border-[1.5px]',
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
}[props.size]))
</script>
