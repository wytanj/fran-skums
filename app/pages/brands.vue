<script setup lang="ts">
import type { Brand } from '~/types'

const client = useSupabaseClient()
const { currentWorkspace } = useWorkspace()

const brands = ref<Brand[]>([])
const loading = ref(true)
const showForm = ref(false)
const editingBrand = ref<Brand | null>(null)
const form = reactive({ name: '', website: '' })
const saving = ref(false)

async function loadBrands() {
  if (!currentWorkspace.value) return
  loading.value = true
  const { data } = await client
    .from('brands')
    .select('*')
    .eq('workspace_id', currentWorkspace.value.id)
    .order('name')
  brands.value = (data || []) as Brand[]
  loading.value = false
}

function openCreate() {
  editingBrand.value = null
  form.name = ''
  form.website = ''
  showForm.value = true
}

function openEdit(brand: Brand) {
  editingBrand.value = brand
  form.name = brand.name
  form.website = brand.website || ''
  showForm.value = true
}

async function handleSave() {
  if (!currentWorkspace.value || !form.name.trim()) return
  saving.value = true

  try {
    if (editingBrand.value) {
      await client.from('brands').update({ name: form.name, website: form.website || null }).eq('id', editingBrand.value.id)
    } else {
      await client.from('brands').insert({ name: form.name, website: form.website || null, workspace_id: currentWorkspace.value.id })
    }
    showForm.value = false
    await loadBrands()
  } finally {
    saving.value = false
  }
}

async function handleDelete(id: string) {
  if (!confirm('Delete this brand?')) return
  await client.from('brands').delete().eq('id', id)
  await loadBrands()
}

onMounted(loadBrands)
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Brands</h1>
        <p class="mt-1 text-sm text-gray-400">Organize products by brand</p>
      </div>
      <button class="btn-primary" @click="openCreate">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add brand
      </button>
    </div>

    <!-- Form modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-150"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div class="card w-full max-w-md p-6" @click.stop>
            <h2 class="mb-4 text-lg font-semibold text-white">
              {{ editingBrand ? 'Edit Brand' : 'New Brand' }}
            </h2>
            <form class="space-y-4" @submit.prevent="handleSave">
              <div>
                <label class="label-field">Name *</label>
                <input v-model="form.name" type="text" required class="input-field" placeholder="Brand name" />
              </div>
              <div>
                <label class="label-field">Website</label>
                <input v-model="form.website" type="url" class="input-field" placeholder="https://..." />
              </div>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" class="btn-secondary" @click="showForm = false">Cancel</button>
                <button type="submit" class="btn-primary" :disabled="saving">
                  {{ saving ? 'Saving...' : editingBrand ? 'Update' : 'Create' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Brands list -->
    <div v-if="loading" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 6" :key="i" class="card animate-pulse p-5">
        <div class="h-5 w-32 rounded bg-gray-800" />
        <div class="mt-2 h-4 w-48 rounded bg-gray-800" />
      </div>
    </div>

    <div v-else-if="brands.length === 0">
      <EmptyState
        title="No brands yet"
        description="Create brands to organize your product catalog."
        action-label="Add brand"
        @action="openCreate"
      />
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="brand in brands" :key="brand.id" class="card p-5 transition-all hover:border-gray-700">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/10 text-sm font-bold text-indigo-400">
              {{ brand.name.charAt(0).toUpperCase() }}
            </div>
            <div>
              <h3 class="font-semibold text-white">{{ brand.name }}</h3>
              <a v-if="brand.website" :href="brand.website" target="_blank" class="text-xs text-indigo-400 hover:underline">
                {{ brand.website }}
              </a>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button class="btn-ghost !p-1.5" @click="openEdit(brand)">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </button>
            <button class="btn-ghost !p-1.5 text-red-400 hover:text-red-300" @click="handleDelete(brand.id)">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
