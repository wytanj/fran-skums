<script setup lang="ts">
defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const route = useRoute()
const { currentWorkspace, workspaces, selectWorkspace } = useWorkspace()
const { currentOrganization, organizations, selectOrganization } = useOrganization()
const { open: openAssistant } = useAssistant()
const { isNavigatingTo } = useNavigating()
const user = useSupabaseUser()

// Workspaces filtered by current org (if any)
const filteredWorkspaces = computed(() => {
  if (!currentOrganization.value) return workspaces.value
  return workspaces.value.filter(
    ws => ws.organization_id === currentOrganization.value!.id || !ws.organization_id,
  )
})

/** Grouped nav — API / MCP elevated; catalogue + ops secondary. */
const groups = computed(() => [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: 'home' },
      { to: '/actions', label: 'Actions', icon: 'check' },
    ],
  },
  {
    label: 'API & agents',
    items: [
      { to: '/api-explorer', label: 'API Explorer', icon: 'api' },
      { to: '/settings#claude-connector', label: 'Connect Claude / MCP', icon: 'sparkle' },
      { to: '/integrations', label: 'Integrations', icon: 'puzzle' },
      { to: '/help', label: 'Help centre', icon: 'help' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { to: '/products', label: 'Products', icon: 'cube' },
      { to: '/brands', label: 'Brands', icon: 'tag' },
      { to: '/categories', label: 'Categories', icon: 'folder' },
      { to: '/schema', label: 'Schema Builder', icon: 'schema' },
      { to: '/import-export', label: 'Import / Export', icon: 'arrows' },
      { to: '/research', label: 'Research', icon: 'notebook' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/inventory', label: 'Inventory', icon: 'warehouse' },
      { to: '/store-ops', label: 'Store Ops', icon: 'arrows' },
      { to: '/roster', label: 'Roster', icon: 'users' },
      { to: '/expiry', label: 'Expiry', icon: 'clock' },
      { to: '/forecasting', label: 'Forecasting', icon: 'chart' },
      { to: '/reports', label: 'Reports', icon: 'chart' },
    ],
  },
])

const initials = computed(() => {
  const email = user.value?.email || ''
  return (email.charAt(0) || '?').toUpperCase()
})

function isActive(to: string) {
  const path = to.split('#')[0].split('?')[0]
  if (path === '/') return route.path === '/'
  if (to.includes('#')) {
    // Settings MCP section: active when on settings
    return route.path === path || route.path.startsWith(`${path}/`)
  }
  return route.path === path || route.path.startsWith(`${path}/`)
}
</script>

<template>
  <!-- Desktop: fixed rail. Mobile: slide-over drawer. -->
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-line bg-white transition-transform lg:translate-x-0"
    :class="open ? 'translate-x-0' : '-translate-x-full'"
  >
    <!-- Brand -->
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line-soft px-4">
      <span class="flex h-7 w-7 items-center justify-center rounded-md bg-yellow text-[12px] font-bold text-brown">FR</span>
      <span class="font-display text-[19px] font-bold tracking-tight text-ink">
        Fran <span class="text-brown">SKUMS</span>
      </span>
      <button class="press ml-auto text-muted lg:hidden" aria-label="Close menu" @click="$emit('close')">✕</button>
    </div>

    <!-- Org + workspace -->
    <div class="space-y-2 border-b border-line-soft p-3">
      <select
        v-if="organizations.length > 0"
        :value="currentOrganization?.id || ''"
        class="input-field h-9 text-[12px]"
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

      <select
        v-if="filteredWorkspaces.length > 0"
        :value="currentWorkspace?.id"
        class="input-field h-9 text-[12px]"
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

    <!-- Navigation groups -->
    <nav class="flex-1 overflow-y-auto px-2.5 py-3">
      <template v-for="group in groups" :key="group.label">
        <p class="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[1px] text-muted first:pt-0">
          {{ group.label }}
        </p>
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="press mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium"
          :class="isActive(item.to) || isNavigatingTo(item.to.split('#')[0])
            ? 'bg-yellow-soft font-semibold text-brown'
            : 'text-ink-soft hover:bg-surface-sunken'"
          @click="$emit('close')"
        >
          <span class="flex h-5 w-5 shrink-0 items-center justify-center text-current">
            <UiSpinner v-if="isNavigatingTo(item.to.split('#')[0])" size="xs" />
            <SidebarIcon v-else :name="item.icon" class="h-4 w-4" />
          </span>
          <span class="flex-1 truncate">{{ item.label }}</span>
        </NuxtLink>
      </template>
    </nav>

    <!-- Footer: assistant + account -->
    <div class="shrink-0 space-y-1 border-t border-line-soft p-2.5">
      <button
        type="button"
        class="press flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium text-ink-soft hover:bg-surface-sunken"
        @click="openAssistant(); $emit('close')"
      >
        <SidebarIcon name="sparkle" class="h-4 w-4 shrink-0" />
        <span>Catalog AI</span>
      </button>

      <NuxtLink
        to="/settings"
        class="press flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-surface-sunken"
        @click="$emit('close')"
      >
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-peach-soft text-[11px] font-bold text-brown">
          {{ initials }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-semibold text-ink">{{ user?.email || 'Account' }}</span>
          <span class="block truncate text-[11px] text-muted">{{ currentWorkspace?.name || 'Settings' }}</span>
        </span>
      </NuxtLink>
    </div>
  </aside>
</template>
