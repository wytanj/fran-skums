<script setup lang="ts">
const user = useSupabaseUser()
const client = useSupabaseClient()

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

const isAuthed = computed(() => !!getUid(user.value))

definePageMeta({ layout: false })

// ---- Dashboard state (only used when authed) ----
const { currentWorkspace } = useWorkspace()

const stats = ref({
  totalProducts: 0,
  activeProducts: 0,
  draftProducts: 0,
  lowStock: 0,
  totalValue: 0,
})
const recentProducts = ref<any[]>([])
const loading = ref(true)

async function loadDashboard() {
  if (!currentWorkspace.value) return
  loading.value = true
  const wsId = currentWorkspace.value.id

  const [totalRes, activeRes, draftRes, lowStockRes, recentRes] = await Promise.all([
    client.from('products').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId),
    client.from('products').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'active'),
    client.from('products').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('status', 'draft'),
    client.from('products').select('*', { count: 'exact', head: true }).eq('workspace_id', wsId).lt('stock_quantity', 10).eq('track_inventory', true),
    client.from('products').select('id, title, sku, status, stock_quantity, retail_price, currency, updated_at').eq('workspace_id', wsId).order('updated_at', { ascending: false }).limit(5),
  ])

  stats.value = {
    totalProducts: totalRes.count || 0,
    activeProducts: activeRes.count || 0,
    draftProducts: draftRes.count || 0,
    lowStock: lowStockRes.count || 0,
    totalValue: 0,
  }
  recentProducts.value = recentRes.data || []
  loading.value = false
}

function formatPrice(price: number | null, currency: string) {
  if (price == null) return '-'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(price)
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
  <!-- ========== LANDING PAGE (unauthenticated) ========== -->
  <div v-if="!isAuthed" class="min-h-screen bg-gray-950 text-white">

    <!-- Navbar -->
    <nav class="fixed top-0 inset-x-0 z-50 border-b border-white/5 bg-gray-950/80 backdrop-blur-xl">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold">FR</div>
          <span class="text-lg font-bold tracking-tight">
            Fran <span class="text-indigo-400">SKUMS</span>
          </span>
        </div>
        <div class="flex items-center gap-3">
          <NuxtLink to="/auth/login" class="rounded-lg px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:text-white">
            Sign in
          </NuxtLink>
          <NuxtLink to="/auth/login" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-indigo-500">
            Get Started
          </NuxtLink>
        </div>
      </div>
    </nav>

    <!-- Hero -->
    <section class="relative overflow-hidden pt-32 pb-20">
      <!-- Background glow -->
      <div class="pointer-events-none absolute inset-0">
        <div class="absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[900px] rounded-full bg-indigo-600/8 blur-[120px]" />
      </div>

      <div class="relative mx-auto max-w-4xl px-6 text-center">
        <div class="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-4 py-1.5 text-sm text-indigo-300">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
          </svg>
          Product, inventory, fulfillment, and store ops for Fran
        </div>

        <h1 class="text-5xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
          <span class="bg-gradient-to-r from-white via-white to-gray-400 bg-clip-text text-transparent">Fran Product</span>
          <br />
          <span class="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Operations</span>
        </h1>

        <p class="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-400 sm:text-xl">
          Keep catalogue truth, SKU and barcode identity, inventory movements,
          fulfillment handoff, and store reconciliation in one operational backend.
        </p>

        <div class="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <NuxtLink
            to="/auth/login"
            class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-500 hover:shadow-indigo-600/40"
          >
            Start for free
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </NuxtLink>
          <a
            href="#features"
            class="inline-flex items-center gap-2 rounded-xl border border-gray-700 px-8 py-3.5 text-sm font-semibold text-gray-300 transition-all hover:border-gray-600 hover:text-white"
          >
            See how it works
          </a>
        </div>
      </div>
    </section>

    <!-- Trust bar -->
    <section class="border-y border-white/5 bg-white/[0.02] py-8">
      <div class="mx-auto max-w-4xl px-6">
        <div class="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm text-gray-500">
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            Multi-tenant workspaces
          </span>
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            REST &amp; GraphQL APIs
          </span>
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            Dynamic schemas
          </span>
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            CSV &amp; bulk import
          </span>
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            Role-based access
          </span>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section id="features" class="py-24">
      <div class="mx-auto max-w-6xl px-6">
        <div class="mb-16 text-center">
          <h2 class="text-3xl font-bold sm:text-4xl">Everything you need to manage products</h2>
          <p class="mx-auto mt-4 max-w-2xl text-gray-400">
            From a single SKU to millions of products across multiple channels -
            Fran SKUMS scales with your product and store operations.
          </p>
        </div>

        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <!-- Feature 1 -->
          <div class="group rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-all hover:border-indigo-500/30 hover:bg-gray-900">
            <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/10 text-indigo-400 transition-colors group-hover:bg-indigo-600/20">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
              </svg>
            </div>
            <h3 class="mb-2 text-lg font-semibold">Canonical Products</h3>
            <p class="text-sm leading-relaxed text-gray-400">
              Maintain product truth. Fork products into renditions for
              different channels - Shopify, Amazon, your own store - without duplicating data.
            </p>
          </div>

          <!-- Feature 2 -->
          <div class="group rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-all hover:border-emerald-500/30 hover:bg-gray-900">
            <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-400 transition-colors group-hover:bg-emerald-600/20">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
            </div>
            <h3 class="mb-2 text-lg font-semibold">Integrations</h3>
            <p class="text-sm leading-relaxed text-gray-400">
              Connect to WooCommerce, marketplace, POS, 3PL, and workflow systems.
              Push and pull product and operational data automatically.
            </p>
          </div>

          <!-- Feature 3 -->
          <div class="group rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-all hover:border-purple-500/30 hover:bg-gray-900">
            <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-600/10 text-purple-400 transition-colors group-hover:bg-purple-600/20">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
              </svg>
            </div>
            <h3 class="mb-2 text-lg font-semibold">Dynamic Schemas</h3>
            <p class="text-sm leading-relaxed text-gray-400">
              Every business is different. Define custom product schemas with the
              fields you need - legal, compliance, marketing, SEO - on top of a shared base.
            </p>
          </div>

          <!-- Feature 4 -->
          <div class="group rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-all hover:border-orange-500/30 hover:bg-gray-900">
            <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-600/10 text-orange-400 transition-colors group-hover:bg-orange-600/20">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <h3 class="mb-2 text-lg font-semibold">Expiry &amp; LIFO</h3>
            <p class="text-sm leading-relaxed text-gray-400">
              Track batch expiry dates, plan LIFO sell-through, and create public
              transparency pages for your customers. Never waste stock again.
            </p>
          </div>

          <!-- Feature 5 -->
          <div class="group rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-all hover:border-sky-500/30 hover:bg-gray-900">
            <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-600/10 text-sky-400 transition-colors group-hover:bg-sky-600/20">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
              </svg>
            </div>
            <h3 class="mb-2 text-lg font-semibold">REST &amp; GraphQL API</h3>
            <p class="text-sm leading-relaxed text-gray-400">
              Full API with scoped API keys. Build automation workflows,
              connect agents, or use the CLI. OpenAPI spec included.
            </p>
          </div>

          <!-- Feature 6 -->
          <div class="group rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-all hover:border-pink-500/30 hover:bg-gray-900">
            <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-pink-600/10 text-pink-400 transition-colors group-hover:bg-pink-600/20">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
            </div>
            <h3 class="mb-2 text-lg font-semibold">Team &amp; Permissions</h3>
            <p class="text-sm leading-relaxed text-gray-400">
              Invite your team with granular role-based permissions. Control who
              can read, write, import, or manage integrations across your workspace.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- How it works -->
    <section class="border-t border-white/5 bg-white/[0.01] py-24">
      <div class="mx-auto max-w-4xl px-6">
        <div class="mb-16 text-center">
          <h2 class="text-3xl font-bold sm:text-4xl">Up and running in minutes</h2>
          <p class="mx-auto mt-4 max-w-xl text-gray-400">No complicated setup. No vendor lock-in.</p>
        </div>

        <div class="grid gap-8 sm:grid-cols-3">
          <div class="text-center">
            <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/10 text-2xl font-bold text-indigo-400">1</div>
            <h3 class="mb-2 font-semibold">Create a workspace</h3>
            <p class="text-sm text-gray-400">Sign up and name your workspace. Invite your team or go solo.</p>
          </div>
          <div class="text-center">
            <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/10 text-2xl font-bold text-indigo-400">2</div>
            <h3 class="mb-2 font-semibold">Import your products</h3>
            <p class="text-sm text-gray-400">Upload a CSV, use the API, or add products manually. Smart column mapping does the rest.</p>
          </div>
          <div class="text-center">
            <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/10 text-2xl font-bold text-indigo-400">3</div>
            <h3 class="mb-2 font-semibold">Connect &amp; automate</h3>
            <p class="text-sm text-gray-400">Link Fran channels, POS, and operations workflows.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="py-24">
      <div class="mx-auto max-w-3xl px-6 text-center">
        <h2 class="text-3xl font-bold sm:text-4xl">
          Ready to take control of your product data?
        </h2>
        <p class="mx-auto mt-4 max-w-lg text-gray-400">
          Keep every SKU, barcode, product fact, and store operation aligned.
        </p>
        <div class="mt-10">
          <NuxtLink
            to="/auth/login"
            class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-10 py-4 text-base font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-500 hover:shadow-indigo-600/40"
          >
            Get started - it's free
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </NuxtLink>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-white/5 py-8">
      <div class="mx-auto max-w-6xl px-6 flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div class="flex items-center gap-2 text-sm text-gray-500">
          <span class="font-bold text-white">Fran <span class="text-indigo-400">SKUMS</span></span>
          <span>&middot; Product Operations</span>
        </div>
        <div class="flex gap-6 text-sm text-gray-500">
          <NuxtLink to="/auth/login" class="hover:text-white transition-colors">Sign in</NuxtLink>
        </div>
      </div>
    </footer>
  </div>

  <!-- ========== DASHBOARD (authenticated) ========== -->
  <NuxtLayout v-else name="default">
  <div>
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-white">Dashboard</h1>
      <p class="mt-1 text-sm text-gray-400">Overview of your product catalog</p>
    </div>

    <!-- Stats -->
    <div class="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="card p-5">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-gray-400">Total Products</p>
            <p class="mt-1 text-3xl font-bold text-white">{{ loading ? '-' : stats.totalProducts }}</p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/10">
            <svg class="h-6 w-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
            </svg>
          </div>
        </div>
      </div>

      <div class="card p-5">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-gray-400">Active</p>
            <p class="mt-1 text-3xl font-bold text-emerald-400">{{ loading ? '-' : stats.activeProducts }}</p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600/10">
            <svg class="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
        </div>
      </div>

      <div class="card p-5">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-gray-400">Drafts</p>
            <p class="mt-1 text-3xl font-bold text-yellow-400">{{ loading ? '-' : stats.draftProducts }}</p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-600/10">
            <svg class="h-6 w-6 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
            </svg>
          </div>
        </div>
      </div>

      <div class="card p-5">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-gray-400">Low Stock</p>
            <p class="mt-1 text-3xl font-bold" :class="stats.lowStock > 0 ? 'text-red-400' : 'text-white'">
              {{ loading ? '-' : stats.lowStock }}
            </p>
          </div>
          <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-red-600/10">
            <svg class="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Recent products -->
      <div class="card">
        <div class="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <h2 class="font-semibold text-white">Recent Products</h2>
          <NuxtLink to="/products" class="text-sm text-indigo-400 hover:text-indigo-300">View all</NuxtLink>
        </div>
        <div v-if="loading" class="divide-y divide-gray-800/50">
          <div v-for="i in 5" :key="i" class="flex items-center gap-4 px-5 py-3">
            <div class="h-9 w-9 animate-pulse rounded-lg bg-gray-800" />
            <div class="flex-1 space-y-2">
              <div class="h-4 w-32 animate-pulse rounded bg-gray-800" />
              <div class="h-3 w-20 animate-pulse rounded bg-gray-800" />
            </div>
          </div>
        </div>
        <div v-else-if="recentProducts.length === 0" class="px-5 py-8 text-center text-sm text-gray-500">
          No products yet
        </div>
        <div v-else class="divide-y divide-gray-800/50">
          <NuxtLink
            v-for="p in recentProducts"
            :key="p.id"
            :to="`/products/${p.id}`"
            class="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-gray-800/30"
          >
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-xs font-medium text-gray-400">
              {{ p.title.charAt(0).toUpperCase() }}
            </div>
            <div class="flex-1 min-w-0">
              <p class="truncate font-medium text-white">{{ p.title }}</p>
              <p class="text-xs text-gray-500">{{ p.sku || 'No SKU' }}</p>
            </div>
            <div class="text-right">
              <StatusBadge :status="p.status" />
              <p class="mt-1 text-xs text-gray-500">{{ formatDate(p.updated_at) }}</p>
            </div>
          </NuxtLink>
        </div>
      </div>

      <!-- Quick actions -->
      <div class="card">
        <div class="border-b border-gray-800 px-5 py-4">
          <h2 class="font-semibold text-white">Quick Actions</h2>
        </div>
        <div class="p-5 space-y-3">
          <NuxtLink to="/products/new" class="flex items-center gap-4 rounded-lg border border-gray-800 p-4 transition-all hover:border-indigo-500/30 hover:bg-indigo-600/5">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/10">
              <svg class="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <div>
              <p class="font-medium text-white">Add Product</p>
              <p class="text-xs text-gray-400">Create a new product entry</p>
            </div>
          </NuxtLink>

          <NuxtLink to="/import-export" class="flex items-center gap-4 rounded-lg border border-gray-800 p-4 transition-all hover:border-emerald-500/30 hover:bg-emerald-600/5">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/10">
              <svg class="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div>
              <p class="font-medium text-white">Import Products</p>
              <p class="text-xs text-gray-400">Bulk import from CSV</p>
            </div>
          </NuxtLink>

          <NuxtLink to="/expiry" class="flex items-center gap-4 rounded-lg border border-gray-800 p-4 transition-all hover:border-orange-500/30 hover:bg-orange-600/5">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-600/10">
              <svg class="h-5 w-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <p class="font-medium text-white">Expiry Tracker</p>
              <p class="text-xs text-gray-400">Manage batch expiries and LIFO</p>
            </div>
          </NuxtLink>

          <NuxtLink to="/integrations" class="flex items-center gap-4 rounded-lg border border-gray-800 p-4 transition-all hover:border-purple-500/30 hover:bg-purple-600/5">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600/10">
              <svg class="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
            </div>
            <div>
              <p class="font-medium text-white">Connect Integration</p>
              <p class="text-xs text-gray-400">Link Fran POS, CRM, or 3PL</p>
            </div>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
  </NuxtLayout>
</template>
