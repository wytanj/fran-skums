<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="press inline-flex items-center justify-center rounded-full px-5 font-display font-medium tracking-wide whitespace-nowrap disabled:bg-line disabled:text-muted disabled:shadow-none"
    :class="[sizeClass, variantClass]"
  >
    <span v-if="loading" class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
    <slot />
  </button>
</template>

<script setup lang="ts">
// Pill button, fran-mobile Button port: brown label on yellow, glow on
// primary only, heights 40/52/56.
const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit'
}>(), { variant: 'primary', size: 'md', type: 'button' })

const sizeClass = computed(() => ({
  sm: 'h-10 text-[15px]',
  md: 'h-[52px] text-[17px]',
  lg: 'h-14 text-lg',
}[props.size]))

const variantClass = computed(() => ({
  primary: 'bg-yellow text-brown shadow-glow',
  secondary: 'bg-white text-brown border-[1.5px] border-brown',
  tonal: 'bg-yellow-soft text-brown',
  ghost: 'bg-transparent text-brown',
  danger: 'bg-danger text-white',
}[props.variant]))
</script>
