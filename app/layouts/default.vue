<script setup lang="ts">
const sidebarOpen = ref(true)
const mobileSidebarOpen = ref(false)
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-gray-950">
    <!-- Mobile sidebar backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-300"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="mobileSidebarOpen"
        class="fixed inset-0 z-40 bg-black/60 lg:hidden"
        @click="mobileSidebarOpen = false"
      />
    </Transition>

    <!-- Sidebar -->
    <AppSidebar
      :collapsed="!sidebarOpen"
      :mobile-open="mobileSidebarOpen"
      @toggle="sidebarOpen = !sidebarOpen"
      @close-mobile="mobileSidebarOpen = false"
    />

    <!-- Main content -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <!-- Top bar -->
      <AppTopbar @open-sidebar="mobileSidebarOpen = true" />

      <!-- Page content -->
      <main class="flex-1 overflow-y-auto p-6">
        <slot />
      </main>
    </div>

    <!-- AI Assistant drawer (teleports to body) -->
    <AssistantDrawer />
  </div>
</template>
