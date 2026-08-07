<script setup lang="ts">
const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()
const userMenuOpen = ref(false)
const { resetWorkspaceState } = useWorkspace()

async function logout() {
  await client.auth.signOut()
  resetWorkspaceState()
  router.push('/auth/login')
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="press flex items-center gap-2 rounded-full p-1 text-sm text-ink-soft transition-all hover:bg-surface-sunken"
      @click="userMenuOpen = !userMenuOpen"
    >
      <div class="flex h-8 w-8 items-center justify-center rounded-full bg-peach-soft text-xs font-semibold text-brown">
        {{ user?.email?.charAt(0).toUpperCase() || '?' }}
      </div>
      <svg class="hidden h-4 w-4 text-muted sm:block" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
      </svg>
    </button>

    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="scale-95 opacity-0"
      enter-to-class="scale-100 opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="scale-100 opacity-100"
      leave-to-class="scale-95 opacity-0"
    >
      <div
        v-if="userMenuOpen"
        class="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right rounded-xl border border-line bg-white p-1 shadow-warm-md"
        @mouseleave="userMenuOpen = false"
      >
        <div class="border-b border-line-soft px-3 py-2">
          <p class="truncate text-sm font-medium text-ink">{{ user?.email }}</p>
        </div>
        <NuxtLink
          to="/settings"
          class="press flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-surface-sunken hover:text-ink"
          @click="userMenuOpen = false"
        >
          Settings
        </NuxtLink>
        <NuxtLink
          to="/api-explorer"
          class="press flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-surface-sunken hover:text-ink"
          @click="userMenuOpen = false"
        >
          API Explorer
        </NuxtLink>
        <button
          type="button"
          class="press flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger-soft"
          @click="logout"
        >
          Sign out
        </button>
      </div>
    </Transition>
  </div>
</template>
