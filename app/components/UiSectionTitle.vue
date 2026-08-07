<template>
  <div class="mb-3 mt-8 flex items-end justify-between">
    <div>
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h2 class="font-display text-[22px] font-bold leading-7 text-ink">{{ title }}</h2>
      <p v-if="subtitle" class="mt-0.5 text-[13px] text-muted">{{ subtitle }}</p>
    </div>
    <slot name="action" />
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; eyebrow?: string; subtitle?: string }>()
</script>
