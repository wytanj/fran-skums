<script setup lang="ts">
/**
 * Fixed-position host for action feedback.
 * Teleported to <body> so it stays visible regardless of <main> scroll.
 */
const { toasts, dismiss } = useActionFeedback()

const styles: Record<string, { wrap: string; icon: string; label: string }> = {
  success: {
    wrap: 'border-success/25 bg-success-soft',
    icon: 'text-success',
    label: 'Success',
  },
  error: {
    wrap: 'border-danger/25 bg-danger-soft',
    icon: 'text-danger',
    label: 'Error',
  },
  info: {
    wrap: 'border-blue/40 bg-blue-soft',
    icon: 'text-brown',
    label: 'Info',
  },
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      role="status"
      aria-live="polite"
    >
      <TransitionGroup
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="-translate-y-2 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-150 ease-in absolute"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-for="toast in toasts"
          :key="toast.id"
          :class="[
            'pointer-events-auto w-full max-w-md rounded-lg border px-4 py-3 shadow-warm-md bg-white',
            (styles[toast.kind] || styles.info).wrap,
          ]"
        >
          <div class="flex items-start gap-3">
            <span :class="['mt-0.5 text-[12px] font-semibold uppercase tracking-wide', (styles[toast.kind] || styles.info).icon]">
              {{ (styles[toast.kind] || styles.info).label }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm text-ink">{{ toast.message }}</p>
              <p v-if="toast.detail" class="mt-1 break-words text-xs text-muted">
                {{ toast.detail }}
              </p>
            </div>
            <button
              type="button"
              class="press shrink-0 rounded p-1 text-muted transition hover:bg-surface-sunken hover:text-ink"
              aria-label="Dismiss"
              @click="dismiss(toast.id)"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
