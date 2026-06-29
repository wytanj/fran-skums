<script setup lang="ts">
const emit = defineEmits<{ openSidebar: [] }>()

const client = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const userMenuOpen = ref(false)

async function logout() {
  await client.auth.signOut()
  router.push('/auth/login')
}
</script>

<template>
  <header class="flex h-16 shrink-0 items-center justify-between border-b border-gray-800 bg-gray-900/50 px-4 backdrop-blur-sm lg:px-6">
    <!-- Mobile menu button -->
    <button
      class="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white lg:hidden"
      @click="emit('openSidebar')"
    >
      <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      </svg>
    </button>

    <!-- Search -->
    <div class="hidden flex-1 lg:block lg:max-w-lg">
      <div class="relative">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="text"
          placeholder="Search products, SKUs, barcodes..."
          class="input-field pl-10"
        />
      </div>
    </div>

    <!-- Right side -->
    <div class="flex items-center gap-3">
      <!-- User menu -->
      <div class="relative">
        <button
          class="flex items-center gap-2 rounded-lg p-1.5 text-sm text-gray-400 transition-all hover:bg-gray-800 hover:text-white"
          @click="userMenuOpen = !userMenuOpen"
        >
          <div class="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
            {{ user?.email?.charAt(0).toUpperCase() || '?' }}
          </div>
          <span class="hidden lg:inline">{{ user?.email }}</span>
          <svg class="hidden h-4 w-4 lg:block" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        <!-- Dropdown -->
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
            class="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right rounded-xl border border-gray-700 bg-gray-800 p-1 shadow-xl"
            @mouseleave="userMenuOpen = false"
          >
            <div class="border-b border-gray-700 px-3 py-2">
              <p class="text-sm font-medium text-white">{{ user?.email }}</p>
            </div>
            <NuxtLink
              to="/settings"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              @click="userMenuOpen = false"
            >
              Settings
            </NuxtLink>
            <button
              class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-gray-700 hover:text-red-300"
              @click="logout"
            >
              Sign out
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>
