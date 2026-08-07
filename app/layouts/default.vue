<script setup lang="ts">
const drawerOpen = ref(false)
const route = useRoute()

// Close mobile drawer on navigation
watch(() => route.fullPath, () => { drawerOpen.value = false })
</script>

<template>
  <div class="min-h-screen bg-cream">
    <!-- Mobile scrim -->
    <div
      v-if="drawerOpen"
      class="fixed inset-0 z-30 bg-brown/40 lg:hidden"
      @click="drawerOpen = false"
    />

    <AppSidebar :open="drawerOpen" @close="drawerOpen = false" />

    <div class="lg:pl-[248px]">
      <!-- Sticky topbar: mobile menu, context, API quick link -->
      <header class="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-cream/95 px-4 backdrop-blur sm:px-6">
        <button
          class="press text-[18px] text-brown lg:hidden"
          aria-label="Open menu"
          @click="drawerOpen = true"
        >☰</button>

        <div class="min-w-0 flex-1">
          <div class="relative hidden max-w-md lg:block">
            <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="search"
              placeholder="Search products, SKUs, barcodes…"
              class="input-field h-9 pl-10 text-[13px]"
            >
          </div>
        </div>

        <NuxtLink
          to="/api-explorer"
          class="press hidden rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-soft shadow-warm-xs hover:border-line-strong sm:block"
        >
          API
        </NuxtLink>
        <NuxtLink
          to="/settings#claude-connector"
          class="press rounded-full bg-yellow px-3.5 py-1.5 text-[12px] font-semibold text-brown shadow-glow"
        >
          MCP
        </NuxtLink>

        <AppTopbar />
      </header>

      <main class="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <slot />
      </main>
    </div>

    <AssistantDrawer />
    <ToastHost />
  </div>
</template>
