<script setup lang="ts">
const user = useSupabaseUser()
const client = useSupabaseClient()

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

const isAuthed = computed(() => !!getUid(user.value))

definePageMeta({ layout: false })

const { currentWorkspace } = useWorkspace()

const stats = ref({
  totalProducts: 0,
  activeProducts: 0,
  draftProducts: 0,
  lowStock: 0,
  totalValue: 0,
  actionDraftPos: 0,
  actionPendingPos: 0,
})
const recentProducts = ref<any[]>([])
const loading = ref(true)

async function loadDashboard() {
  if (!currentWorkspace.value) return
  loading.value = true
  const wsId = currentWorkspace.value.id

  const [totalRes, activeRes, draftRes, lowStockRes, recentRes, draftPoRes, pendingPoRes] = await Promise.all([
    client.from('products').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId),
    client.from('products').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'active'),
    client.from('products').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'draft'),
    client.from('products').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId).lt('stock_quantity', 10).eq('track_inventory', true),
    client.from('products').select('id, title, sku, status, stock_quantity, retail_price, currency, updated_at').eq('workspace_id', wsId).order('updated_at', { ascending: false }).limit(5),
    client.from('internal_purchase_orders').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'draft'),
    client.from('internal_purchase_orders').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'pending_approval'),
  ])

  stats.value = {
    totalProducts: totalRes.count || 0,
    activeProducts: activeRes.count || 0,
    draftProducts: draftRes.count || 0,
    lowStock: lowStockRes.count || 0,
    totalValue: 0,
    actionDraftPos: draftPoRes.count || 0,
    actionPendingPos: pendingPoRes.count || 0,
  }
  recentProducts.value = recentRes.data || []
  loading.value = false
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

onMounted(() => {
  if (isAuthed.value) loadDashboard()
})

watch(isAuthed, (v) => {
  if (v) loadDashboard()
})
</script>

<template>
  <!-- ========== LANDING (unauthenticated) ========== -->
  <div v-if="!isAuthed" class="min-h-screen bg-cream text-ink">
    <nav class="no-print sticky top-0 z-50 border-b border-line bg-cream/95 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-md bg-yellow text-[12px] font-bold text-brown">FR</div>
          <span class="font-display text-[20px] font-bold tracking-tight">
            Fran <span class="text-brown">SKUMS</span>
          </span>
        </div>
        <div class="flex items-center gap-2">
          <NuxtLink to="/auth/login" class="press hidden rounded-full px-4 py-2 text-[13px] font-semibold text-ink-soft hover:bg-surface-sunken sm:block">
            Sign in
          </NuxtLink>
          <NuxtLink to="/auth/login" class="press rounded-full bg-yellow px-4 py-2 text-[13px] font-semibold text-brown shadow-glow">
            Get started
          </NuxtLink>
        </div>
      </div>
    </nav>

    <section class="relative overflow-hidden px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
      <div class="pointer-events-none absolute inset-0">
        <div class="absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-yellow/20 blur-[100px]" />
      </div>

      <div class="relative mx-auto max-w-3xl text-center">
        <p class="eyebrow mb-3">Product · inventory · API · MCP</p>
        <h1 class="font-display text-[40px] font-bold leading-[1.05] tracking-tight sm:text-[52px] lg:text-[60px]">
          Fran product operations
        </h1>
        <p class="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted sm:text-[17px]">
          Catalogue truth, SKU identity, inventory movements, store ops —
          with REST APIs and Claude MCP for agents.
        </p>
        <div class="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <NuxtLink to="/auth/login" class="btn-primary px-8">
            Start for free
          </NuxtLink>
          <a href="#features" class="btn-secondary px-8">
            See how it works
          </a>
        </div>
      </div>
    </section>

    <section class="border-y border-line bg-white/60 py-6">
      <div class="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 text-[13px] text-muted">
        <span>Multi-tenant workspaces</span>
        <span>REST API + OpenAPI</span>
        <span>Claude MCP connector</span>
        <span>Dynamic schemas</span>
        <span>Role-based access</span>
      </div>
    </section>

    <section id="features" class="px-4 py-16 sm:px-6 sm:py-20">
      <div class="mx-auto max-w-6xl">
        <div class="mb-10 text-center">
          <h2 class="font-display text-[28px] font-bold sm:text-[32px]">Built for web ops &amp; agents</h2>
          <p class="mx-auto mt-3 max-w-xl text-[14px] text-muted">
            Mobile-friendly desk UI. Heavy lifting over API and MCP.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <UiCard v-for="f in [
            { title: 'Canonical products', body: 'One source of truth. Channel renditions without duplicating data.' },
            { title: 'API explorer', body: 'Scoped keys, OpenAPI, and live request tooling for automation.' },
            { title: 'Claude MCP', body: 'Connect Claude Desktop with OAuth — tools scoped to your role.' },
            { title: 'Inventory & store ops', body: 'Movements, receive exceptions, floor damage, and ATS.' },
            { title: 'Dynamic schemas', body: 'Custom fields for compliance, marketing, and channel-specific facts.' },
            { title: 'Team permissions', body: 'Invite teammates with granular read / write / import scopes.' },
          ]" :key="f.title" class="!p-5">
            <h3 class="mb-1.5 font-display text-[18px] font-bold text-ink">{{ f.title }}</h3>
            <p class="text-[13px] leading-relaxed text-muted">{{ f.body }}</p>
          </UiCard>
        </div>
      </div>
    </section>

    <section class="border-t border-line bg-surface-sunken/50 px-4 py-16 sm:px-6">
      <div class="mx-auto max-w-3xl text-center">
        <h2 class="font-display text-[28px] font-bold">Ready when you are</h2>
        <p class="mx-auto mt-3 max-w-md text-[14px] text-muted">
          Keep every SKU, barcode, product fact, and store operation aligned.
        </p>
        <div class="mt-8">
          <NuxtLink to="/auth/login" class="btn-primary px-10">Get started — free</NuxtLink>
        </div>
      </div>
    </section>

    <footer class="border-t border-line py-6">
      <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-[13px] text-muted sm:flex-row sm:px-6">
        <span class="font-display text-[15px] font-bold text-ink">Fran SKUMS</span>
        <NuxtLink to="/auth/login" class="hover:text-ink">Sign in</NuxtLink>
      </div>
    </footer>
  </div>

  <!-- ========== DASHBOARD (authenticated) ========== -->
  <NuxtLayout v-else name="default">
    <div>
      <UiPageHeader
        eyebrow="Overview"
        title="Dashboard"
        subtitle="Catalogue health, actions queue, and quick paths to API / MCP."
      >
        <template #actions>
          <NuxtLink to="/api-explorer"><UiButton size="sm" variant="secondary">API Explorer</UiButton></NuxtLink>
          <NuxtLink to="/settings#claude-connector"><UiButton size="sm">Connect MCP</UiButton></NuxtLink>
        </template>
      </UiPageHeader>

      <div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UiStat label="Total products" :value="loading ? '—' : stats.totalProducts" />
        <UiStat label="Active" :value="loading ? '—' : stats.activeProducts" tone="success" />
        <UiStat label="Drafts" :value="loading ? '—' : stats.draftProducts" tone="warning" />
        <UiStat
          label="Low stock"
          :value="loading ? '—' : stats.lowStock"
          :tone="stats.lowStock > 0 ? 'danger' : 'ink'"
          hint="Tracked SKUs under 10"
        />
      </div>

      <NuxtLink
        to="/actions"
        class="press mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line-soft bg-white p-5 shadow-warm-sm hover:border-line"
      >
        <div>
          <p class="font-display text-[18px] font-bold text-ink">Actions queue</p>
          <p class="mt-0.5 text-[12px] text-muted">
            Decision POs and pipeline items from agents — not warehouse inventory POs.
          </p>
        </div>
        <div class="flex items-center gap-5 text-center">
          <div>
            <p class="font-display text-[24px] font-bold text-warning">{{ loading ? '—' : stats.actionDraftPos }}</p>
            <p class="text-[10px] font-semibold uppercase tracking-wide text-muted">Draft POs</p>
          </div>
          <div>
            <p class="font-display text-[24px] font-bold text-brown">{{ loading ? '—' : stats.actionPendingPos }}</p>
            <p class="text-[10px] font-semibold uppercase tracking-wide text-muted">Pending</p>
          </div>
          <span class="text-[12px] font-semibold text-brown">Open →</span>
        </div>
      </NuxtLink>

      <div class="grid gap-6 lg:grid-cols-2">
        <div class="overflow-hidden rounded-xl border border-line-soft bg-white shadow-warm-sm">
          <div class="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 class="font-display text-[18px] font-bold text-ink">Recent products</h2>
            <NuxtLink to="/products" class="text-[12.5px] font-semibold text-brown">View all →</NuxtLink>
          </div>
          <div v-if="loading" class="space-y-3 p-5">
            <UiSkeleton v-for="i in 4" :key="i" height="md" />
          </div>
          <div v-else-if="recentProducts.length === 0" class="px-5 py-10 text-center text-[13px] text-muted">
            No products yet
          </div>
          <div v-else>
            <NuxtLink
              v-for="(p, i) in recentProducts"
              :key="p.id"
              :to="`/products/${p.id}`"
              class="press flex items-center gap-3 px-5 py-3"
              :class="i > 0 ? 'border-t border-line-soft' : ''"
            >
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-[12px] font-semibold text-muted">
                {{ p.title.charAt(0).toUpperCase() }}
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13px] font-semibold text-ink">{{ p.title }}</p>
                <p class="text-[11px] text-muted">{{ p.sku || 'No SKU' }}</p>
              </div>
              <div class="text-right">
                <StatusBadge :status="p.status" />
                <p class="mt-1 text-[11px] text-muted">{{ formatDate(p.updated_at) }}</p>
              </div>
            </NuxtLink>
          </div>
        </div>

        <div class="overflow-hidden rounded-xl border border-line-soft bg-white shadow-warm-sm">
          <div class="border-b border-line px-5 py-3.5">
            <h2 class="font-display text-[18px] font-bold text-ink">Quick actions</h2>
          </div>
          <div>
            <NuxtLink
              v-for="(l, i) in [
                { to: '/products/new', label: 'Add product', hint: 'Create a new product entry', icon: '+' },
                { to: '/import-export', label: 'Import products', hint: 'Bulk import from CSV', icon: '↑' },
                { to: '/api-explorer', label: 'API Explorer', hint: 'Try REST endpoints live', icon: '⟨⟩' },
                { to: '/settings#claude-connector', label: 'Connect Claude / MCP', hint: 'Agent tools for this workspace', icon: '✦' },
                { to: '/integrations', label: 'Integrations', hint: 'POS, CRM, 3PL channels', icon: '⇄' },
              ]"
              :key="l.to"
              :to="l.to"
              class="press flex items-center gap-3 px-5 py-3.5"
              :class="i > 0 ? 'border-t border-line-soft' : ''"
            >
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-yellow-soft text-[13px] font-bold text-brown">
                {{ l.icon }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-[13px] font-semibold text-ink">{{ l.label }}</span>
                <span class="block text-[11.5px] text-muted">{{ l.hint }}</span>
              </span>
              <span class="text-line-strong">›</span>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>
