<script setup lang="ts">
const props = defineProps<{
  currentPage: number
  totalItems: number
  perPage: number
}>()

const emit = defineEmits<{
  'update:currentPage': [page: number]
}>()

const totalPages = computed(() => Math.ceil(props.totalItems / props.perPage))

const displayRange = computed(() => {
  const start = (props.currentPage - 1) * props.perPage + 1
  const end = Math.min(props.currentPage * props.perPage, props.totalItems)
  return { start, end }
})
</script>

<template>
  <div class="flex items-center justify-between px-2 py-3">
    <p class="text-sm text-gray-400">
      Showing <span class="font-medium text-white">{{ displayRange.start }}</span>
      to <span class="font-medium text-white">{{ displayRange.end }}</span>
      of <span class="font-medium text-white">{{ totalItems }}</span> results
    </p>

    <div class="flex items-center gap-1">
      <button
        class="btn-ghost !px-2 !py-1.5"
        :disabled="currentPage <= 1"
        @click="emit('update:currentPage', currentPage - 1)"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </button>

      <span class="px-3 text-sm text-gray-400">
        {{ currentPage }} / {{ totalPages }}
      </span>

      <button
        class="btn-ghost !px-2 !py-1.5"
        :disabled="currentPage >= totalPages"
        @click="emit('update:currentPage', currentPage + 1)"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  </div>
</template>
