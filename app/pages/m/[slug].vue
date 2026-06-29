<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const slug = route.params.slug as string

const site = ref<any>(null)
const items = ref<any[]>([])
const loading = ref(true)
const error = ref('')

async function loadMicrosite() {
  try {
    const result = await $fetch(`/api/v1/microsite/${slug}`)
    site.value = (result as any).site
    items.value = (result as any).items
  } catch (e: any) {
    error.value = e.data?.statusMessage || 'Microsite not found'
  } finally {
    loading.value = false
  }
}

function expiryLabel(year: number, month: number, day?: number | null) {
  const m = String(month).padStart(2, '0')
  if (day) return `${String(day).padStart(2, '0')}/${m}/${year}`
  return `${m}/${year}`
}

function daysUntil(year: number, month: number, day?: number | null) {
  const d = new Date(year, month - 1, day || 1)
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000)
}

function urgencyColor(days: number) {
  if (days < 0) return 'text-red-500'
  if (days <= 30) return 'text-orange-500'
  if (days <= 90) return 'text-yellow-500'
  return 'text-emerald-500'
}

function urgencyBg(days: number) {
  if (days < 0) return 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
  if (days <= 30) return 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20'
  if (days <= 90) return 'bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20'
  return 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
}

onMounted(loadMicrosite)
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950">
    <!-- Loading -->
    <div v-if="loading" class="flex min-h-screen items-center justify-center">
      <div class="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex min-h-screen flex-col items-center justify-center gap-4">
      <p class="text-lg text-gray-500 dark:text-gray-400">{{ error }}</p>
      <NuxtLink to="/" class="text-sm text-indigo-500 hover:underline">Go to SKUMS</NuxtLink>
    </div>

    <!-- Microsite content -->
    <div v-else-if="site" class="mx-auto max-w-4xl px-4 py-12">
      <!-- Header -->
      <div class="mb-8 text-center">
        <img v-if="site.logo_url" :src="site.logo_url" alt="" class="mx-auto mb-4 h-16 object-contain" />
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">{{ site.title }}</h1>
        <p v-if="site.description" class="mt-2 text-gray-600 dark:text-gray-400">{{ site.description }}</p>
        <p class="mt-4 text-xs text-gray-400">
          Last updated: {{ new Date().toLocaleDateString() }}
          · {{ items.length }} product{{ items.length === 1 ? '' : 's' }} tracked
        </p>
      </div>

      <!-- Items grid -->
      <div v-if="items.length > 0" class="space-y-3">
        <div
          v-for="item in items"
          :key="item.id"
          :class="['flex items-center justify-between rounded-xl border p-4 transition-colors', urgencyBg(daysUntil(item.expiry_year, item.expiry_month, item.expiry_day))]"
        >
          <div class="min-w-0">
            <p v-if="site.show_product_name && item.product_name" class="font-semibold text-gray-900 dark:text-white">
              {{ item.product_name }}
            </p>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
              <span v-if="site.show_sku" class="font-mono text-xs">{{ item.sku }}</span>
              <span v-if="site.show_batch_code && item.batch_code">Batch: {{ item.batch_code }}</span>
              <span v-if="site.show_quantity">{{ item.quantity }} unit{{ item.quantity === 1 ? '' : 's' }}</span>
            </div>
          </div>

          <div class="shrink-0 text-right">
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ expiryLabel(item.expiry_year, item.expiry_month, item.expiry_day) }}
            </p>
            <p v-if="site.show_days_remaining" :class="['text-xs font-medium', urgencyColor(daysUntil(item.expiry_year, item.expiry_month, item.expiry_day))]">
              <template v-if="daysUntil(item.expiry_year, item.expiry_month, item.expiry_day) < 0">
                Expired
              </template>
              <template v-else>
                {{ daysUntil(item.expiry_year, item.expiry_month, item.expiry_day) }} days remaining
              </template>
            </p>
          </div>
        </div>
      </div>

      <div v-else class="rounded-xl border border-gray-200 dark:border-gray-800 p-12 text-center">
        <p class="text-gray-500 dark:text-gray-400">No expiry data available.</p>
      </div>

      <!-- Footer -->
      <div class="mt-12 text-center text-xs text-gray-400">
        <p v-if="site.footer_text">{{ site.footer_text }}</p>
        <p class="mt-2">
          Powered by <NuxtLink to="/" class="text-indigo-500 hover:underline">SKUMS</NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>
