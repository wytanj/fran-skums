<template>
  <div class="rounded-xl border p-5" :class="toneClass">
    <slot />
  </div>
</template>

<script setup lang="ts">
// Card tones from fran-mobile: only white `surface` cards float; tinted
// cards sit flat.
const props = withDefaults(defineProps<{
  tone?: 'surface' | 'cream' | 'sunken' | 'yellow' | 'blue' | 'peach'
}>(), { tone: 'surface' })

const toneClass = computed(() => ({
  surface: 'bg-white border-line-soft shadow-warm-sm',
  cream: 'bg-cream border-line',
  sunken: 'bg-surface-sunken border-transparent',
  yellow: 'bg-yellow-soft border-transparent',
  blue: 'bg-blue-soft border-transparent',
  peach: 'bg-peach-soft border-transparent',
}[props.tone]))
</script>
