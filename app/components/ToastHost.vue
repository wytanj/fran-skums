<script setup lang="ts">
/**
 * Fixed-position host for action feedback.
 *
 * Teleported to <body> and fixed, so it stays visible no matter where the user
 * is scrolled inside `<main>` — the failure mode of the old per-page banners.
 */
const { toasts, dismiss } = useActionFeedback()

const styles: Record<string, { wrap: string; icon: string; label: string }> = {
  success: {
    wrap: 'border-emerald-500/30 bg-emerald-500/10',
    icon: 'text-emerald-400',
    label: 'Success',
  },
  error: {
    wrap: 'border-red-500/30 bg-red-500/10',
    icon: 'text-red-400',
    label: 'Error',
  },
  info: {
    wrap: 'border-sky-500/30 bg-sky-500/10',
    icon: 'text-sky-400',
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
            'pointer-events-auto w-full max-w-md rounded-lg border px-4 py-3 shadow-lg backdrop-blur',
            (styles[toast.kind] || styles.info).wrap,
          ]"
        >
          <div class="flex items-start gap-3">
            <span :class="['mt-0.5 text-sm font-semibold', (styles[toast.kind] || styles.info).icon]">
              {{ (styles[toast.kind] || styles.info).label }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm text-white">{{ toast.message }}</p>
              <p v-if="toast.detail" class="mt-1 break-words text-xs text-gray-400">
                {{ toast.detail }}
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded p-1 text-gray-400 transition hover:bg-white/10 hover:text-white"
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
