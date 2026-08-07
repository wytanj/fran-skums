<template>
  <div class="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
    <div>
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h1 class="font-display text-[26px] font-bold leading-8 tracking-tight text-ink">{{ title }}</h1>
      <p v-if="subtitle" class="mt-1 max-w-2xl text-[13px] text-muted">{{ subtitle }}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; eyebrow?: string; subtitle?: string }>()
</script>
