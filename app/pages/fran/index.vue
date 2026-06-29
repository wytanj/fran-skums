<script setup lang="ts">
const operations = [
  { label: 'POS scan resolution', href: '/products', value: 'Catalogue' },
  { label: 'Inventory availability', href: '/inventory', value: 'Stock' },
  { label: 'Store-ops queue', href: '/store-ops', value: 'Approval' },
  { label: 'Fulfillment connectors', href: '/integrations', value: '3PL' },
]

const contracts = [
  { label: 'Fran POS writes stay idempotent', value: 'Sales, returns, inventory events' },
  { label: 'Fran CRM reads product facts only', value: 'Rewards and recommendations' },
  { label: 'SKUMS owns operational resolution', value: 'Approval, execution, reconciliation' },
]
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Fran Operations</h1>
        <p class="mt-1 text-sm text-gray-400">Product truth, stock movement, fulfillment handoff, and store reconciliation.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <NuxtLink to="/store-ops" class="btn-primary">Store Ops</NuxtLink>
        <NuxtLink to="/integrations" class="btn-secondary">Integrations</NuxtLink>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <NuxtLink
        v-for="item in operations"
        :key="item.label"
        :to="item.href"
        class="card p-5 transition-colors hover:border-indigo-500/40"
      >
        <p class="text-xs font-medium uppercase text-gray-500">{{ item.value }}</p>
        <p class="mt-3 text-base font-semibold text-white">{{ item.label }}</p>
      </NuxtLink>
    </div>

    <div class="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <section class="card p-5">
        <h2 class="text-base font-semibold text-white">Fran Product Context</h2>
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
            <p class="text-sm font-medium text-white">Reward eligibility</p>
            <p class="mt-1 text-sm text-gray-400">Product-level facts for CRM reward decisions.</p>
          </div>
          <div class="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
            <p class="text-sm font-medium text-white">Sample eligibility</p>
            <p class="mt-1 text-sm text-gray-400">Sample, return, and restricted-product flags.</p>
          </div>
          <div class="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
            <p class="text-sm font-medium text-white">Skin concern tags</p>
            <p class="mt-1 text-sm text-gray-400">Product metadata for recommendation context.</p>
          </div>
          <div class="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
            <p class="text-sm font-medium text-white">3PL profile</p>
            <p class="mt-1 text-sm text-gray-400">Fulfillment routing context for connectors.</p>
          </div>
        </div>
      </section>

      <section class="card p-5">
        <h2 class="text-base font-semibold text-white">Boundary Checks</h2>
        <div class="mt-4 space-y-3">
          <div v-for="item in contracts" :key="item.label" class="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
            <p class="text-sm font-medium text-white">{{ item.label }}</p>
            <p class="mt-1 text-xs text-gray-500">{{ item.value }}</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
