<script setup lang="ts">
defineProps<{
  collapsed: boolean
  mobileOpen: boolean
}>()

const emit = defineEmits<{
  toggle: []
  closeMobile: []
}>()

const route = useRoute()
const { currentWorkspace, workspaces, selectWorkspace } = useWorkspace()
const { currentOrganization, organizations, selectOrganization, fetchOrganizations } = useOrganization()
const { open: openAssistant } = useAssistant()

// Workspaces filtered by current org (if any)
const filteredWorkspaces = computed(() => {
  if (!currentOrganization.value) return workspaces.value
  return workspaces.value.filter(
    ws => ws.organization_id === currentOrganization.value!.id || !ws.organization_id
  )
})

const navigation = [
  { name: 'Fran Ops', href: '/fran', icon: 'sparkle' },
  { name: 'Dashboard', href: '/', icon: 'home' },
  { name: 'Actions', href: '/actions', icon: 'check' },
  { name: 'Products', href: '/products', icon: 'cube' },
  { name: 'Inventory', href: '/inventory', icon: 'warehouse' },
  { name: 'Store Ops', href: '/store-ops', icon: 'arrows' },
  { name: 'Expiry', href: '/expiry', icon: 'clock' },
  { name: 'Forecasting', href: '/forecasting', icon: 'chart' },
  { name: 'Reports', href: '/reports', icon: 'chart' },
  { name: 'Product Quality', href: '/product-quality', icon: 'star' },
  { name: 'Brands', href: '/brands', icon: 'tag' },
  { name: 'Categories', href: '/categories', icon: 'folder' },
  { name: 'Import / Export', href: '/import-export', icon: 'arrows' },
  { name: 'Schema Builder', href: '/schema', icon: 'schema' },
  { name: 'Help', href: '/help', icon: 'help' },
]

const bottomNav = [
  { name: 'API Explorer', href: '/api-explorer', icon: 'api' },
  { name: 'Integrations', href: '/integrations', icon: 'puzzle' },
  { name: 'Settings', href: '/settings', icon: 'cog' },
]

function isActive(href: string) {
  if (href === '/') return route.path === '/'
  return route.path.startsWith(href)
}
</script>

<template>
  <aside
    :class="[
      'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-gray-800 bg-gray-900 transition-all duration-300 lg:relative lg:z-auto',
      collapsed ? 'w-[68px]' : 'w-64',
      mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
    ]"
  >
    <!-- Logo -->
    <div class="flex h-16 shrink-0 items-center gap-3 border-b border-gray-800 px-4">
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white text-sm">
        FR
      </div>
      <Transition
        enter-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-100"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <span v-if="!collapsed" class="text-lg font-bold tracking-tight text-white">
          Fran <span class="text-indigo-400">SKUMS</span>
        </span>
      </Transition>
    </div>

    <!-- Org + Workspace selector -->
    <div v-if="!collapsed" class="border-b border-gray-800 p-3 space-y-2">
      <!-- Organization selector (only if user belongs to orgs) -->
      <select
        v-if="organizations.length > 0"
        :value="currentOrganization?.id || ''"
        class="input-field text-xs"
        @change="(e: Event) => {
          const val = (e.target as HTMLSelectElement).value
          if (!val) return
          const org = organizations.find(o => o.id === val)
          if (org) selectOrganization(org)
        }"
      >
        <option v-for="org in organizations" :key="org.id" :value="org.id">
          {{ org.name }}
        </option>
      </select>

      <!-- Workspace selector -->
      <select
        v-if="filteredWorkspaces.length > 0"
        :value="currentWorkspace?.id"
        class="input-field text-xs"
        @change="(e: Event) => {
          const ws = filteredWorkspaces.find(w => w.id === (e.target as HTMLSelectElement).value)
          if (ws) selectWorkspace(ws)
        }"
      >
        <option v-for="ws in filteredWorkspaces" :key="ws.id" :value="ws.id">
          {{ ws.name }}
        </option>
      </select>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 space-y-1 overflow-y-auto p-3">
      <NuxtLink
        v-for="item in navigation"
        :key="item.name"
        :to="item.href"
        :class="[
          'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
          isActive(item.href)
            ? 'bg-indigo-600/10 text-indigo-400'
            : 'text-gray-400 hover:bg-gray-800 hover:text-white',
        ]"
        @click="emit('closeMobile')"
      >
        <SidebarIcon :name="item.icon" class="h-5 w-5 shrink-0" />
        <span v-if="!collapsed" class="truncate">{{ item.name }}</span>
      </NuxtLink>
    </nav>

    <!-- Bottom nav -->
    <div class="space-y-1 border-t border-gray-800 p-3">
      <NuxtLink
        v-for="item in bottomNav"
        :key="item.name"
        :to="item.href"
        :class="[
          'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
          isActive(item.href)
            ? 'bg-indigo-600/10 text-indigo-400'
            : 'text-gray-400 hover:bg-gray-800 hover:text-white',
        ]"
        @click="emit('closeMobile')"
      >
        <SidebarIcon :name="item.icon" class="h-5 w-5 shrink-0" />
        <span v-if="!collapsed" class="truncate">{{ item.name }}</span>
      </NuxtLink>

      <!-- AI Assistant button -->
      <button
        :class="[
          'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-all hover:bg-gray-800 hover:text-white',
        ]"
        @click="openAssistant"
      >
        <SidebarIcon name="sparkle" class="h-5 w-5 shrink-0" />
        <span v-if="!collapsed">Catalog AI</span>
      </button>

      <!-- Collapse toggle (desktop) -->
      <button
        class="hidden w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-all hover:bg-gray-800 hover:text-white lg:flex"
        @click="emit('toggle')"
      >
        <svg class="h-5 w-5 shrink-0 transition-transform" :class="{ 'rotate-180': collapsed }" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
        </svg>
        <span v-if="!collapsed">Collapse</span>
      </button>
    </div>
  </aside>
</template>
