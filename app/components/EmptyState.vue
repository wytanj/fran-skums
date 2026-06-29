<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  actionLabel?: string
  actionTo?: string
}>()

const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-800 px-6 py-16 text-center">
    <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-800">
      <slot name="icon">
        <svg class="h-7 w-7 text-gray-500" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125 2.25 2.25m0 0 2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
        </svg>
      </slot>
    </div>
    <h3 class="text-lg font-semibold text-white">{{ title }}</h3>
    <p v-if="description" class="mt-1.5 max-w-sm text-sm text-gray-400">{{ description }}</p>
    <div v-if="actionLabel" class="mt-6">
      <NuxtLink v-if="actionTo" :to="actionTo" class="btn-primary">
        {{ actionLabel }}
      </NuxtLink>
      <button v-else class="btn-primary" @click="emit('action')">
        {{ actionLabel }}
      </button>
    </div>
  </div>
</template>
