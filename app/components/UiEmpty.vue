<template>
  <div class="flex flex-col items-center py-10 text-center">
    <div class="mb-3 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-surface-sunken text-2xl">
      {{ icon }}
    </div>
    <p class="text-[16px] font-semibold text-ink">{{ title }}</p>
    <p v-if="subtitle" class="mt-1 max-w-[260px] text-[13px] text-muted">{{ subtitle }}</p>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ title: string; subtitle?: string; icon?: string }>(), { icon: '🌤️' })
</script>
