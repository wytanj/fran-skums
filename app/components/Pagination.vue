<script setup lang="ts">
const props = defineProps<{
  currentPage: number
  totalItems: number
  perPage: number
}>()

const emit = defineEmits<{
  'update:currentPage': [page: number]
}>()

const totalPages = computed(() => Math.ceil(props.totalItems / props.perPage) || 1)

const displayRange = computed(() => {
  const start = props.totalItems === 0 ? 0 : (props.currentPage - 1) * props.perPage + 1
  const end = Math.min(props.currentPage * props.perPage, props.totalItems)
  return { start, end }
})
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2 px-1 py-3">
    <p class="text-[13px] text-muted">
      Showing <span class="font-medium text-ink">{{ displayRange.start }}</span>
      to <span class="font-medium text-ink">{{ displayRange.end }}</span>
      of <span class="font-medium text-ink">{{ totalItems }}</span> results
    </p>

    <div class="flex items-center gap-1">
      <button
        type="button"
        class="btn-ghost !px-2 !py-1.5"
        :disabled="currentPage <= 1"
        @click="emit('update:currentPage', currentPage - 1)"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </button>

      <span class="px-3 text-[13px] text-muted">
        {{ currentPage }} / {{ totalPages }}
      </span>

      <button
        type="button"
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
