<template>
  <div class="flex rounded-full bg-surface-sunken p-1">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="press flex-1 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors"
      :class="item.key === modelValue ? 'bg-white text-ink shadow-warm-xs' : 'text-muted'"
      @click="$emit('update:modelValue', item.key)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ items: Array<{ key: string; label: string }>; modelValue: string }>()
defineEmits(['update:modelValue'])
</script>
