<template>
  <!-- Placeholder bars that match the shape of what's coming, so the layout
       doesn't jump when real content lands. -->
  <div v-if="rows === 1" class="skeleton rounded" :class="heightClass" :style="{ width }" />
  <div v-else class="space-y-2">
    <div v-for="i in rows" :key="i" class="skeleton rounded" :class="heightClass"
      :style="{ width: i === rows ? lastWidth : width }" />
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  rows?: number
  width?: string
  lastWidth?: string
  height?: 'sm' | 'md' | 'lg'
}>(), { rows: 1, width: '100%', lastWidth: '60%', height: 'md' })

const heightClass = computed(() => ({
  sm: 'h-3',
  md: 'h-4',
  lg: 'h-6',
}[props.height]))
</script>
