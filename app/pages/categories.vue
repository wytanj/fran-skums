<script setup lang="ts">
import type { Category } from '~/types'

const client = useSupabaseClient()
const { currentWorkspace } = useWorkspace()

const categories = ref<Category[]>([])
const loading = ref(true)
const showForm = ref(false)
const editingCategory = ref<Category | null>(null)
const form = reactive({ name: '', parent_id: '' })
const saving = ref(false)
const errorMsg = ref('')

async function loadCategories() {
  if (!currentWorkspace.value) return
  loading.value = true
  const { data } = await client
    .from('categories')
    .select('*')
    .eq('workspace_id', currentWorkspace.value.id)
    .order('sort_order')
  categories.value = (data || []) as Category[]
  loading.value = false
}

const topLevel = computed(() => categories.value.filter(c => !c.parent_id))

function getChildren(parentId: string) {
  return categories.value.filter(c => c.parent_id === parentId)
}

function openCreate() {
  editingCategory.value = null
  form.name = ''
  form.parent_id = ''
  showForm.value = true
}

function openEdit(cat: Category) {
  editingCategory.value = cat
  form.name = cat.name
  form.parent_id = cat.parent_id || ''
  showForm.value = true
}

async function handleSave() {
  errorMsg.value = ''

  if (!form.name.trim()) {
    errorMsg.value = 'Category name is required.'
    return
  }
  if (!currentWorkspace.value) {
    errorMsg.value = 'No workspace selected — go to Settings or refresh.'
    return
  }

  saving.value = true
  const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  try {
    if (editingCategory.value) {
      const { error: err } = await client.from('categories').update({
        name: form.name,
        slug,
        parent_id: form.parent_id || null,
      }).eq('id', editingCategory.value.id)
      if (err) throw err
    } else {
      const { error: err } = await client.from('categories').insert({
        name: form.name,
        slug,
        parent_id: form.parent_id || null,
        workspace_id: currentWorkspace.value.id,
      })
      if (err) throw err
    }
    showForm.value = false
    await loadCategories()
  } catch (e: any) {
    errorMsg.value = e.message || 'Failed to save category'
    console.error('[SKUMS] Category save error:', e)
  } finally {
    saving.value = false
  }
}

async function handleDelete(id: string) {
  if (!confirm('Delete this category? Sub-categories will become top-level.')) return
  await client.from('categories').delete().eq('id', id)
  await loadCategories()
}

onMounted(loadCategories)
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-white">Categories</h1>
        <p class="mt-1 text-sm text-gray-400">Organize products into categories</p>
      </div>
      <button class="btn-primary" @click="openCreate">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add category
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
              {{ editingCategory ? 'Edit Category' : 'New Category' }}
            </h2>
            <form class="space-y-4" @submit.prevent="handleSave">
              <div v-if="errorMsg" class="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{{ errorMsg }}</div>
              <div>
                <label class="label-field">Name *</label>
                <input v-model="form.name" type="text" required class="input-field" placeholder="Category name" />
              </div>
              <div>
                <label class="label-field">Parent Category</label>
                <select v-model="form.parent_id" class="input-field">
                  <option value="">None (Top Level)</option>
                  <option v-for="cat in categories.filter(c => c.id !== editingCategory?.id)" :key="cat.id" :value="cat.id">
                    {{ cat.name }}
                  </option>
                </select>
              </div>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" class="btn-secondary" @click="showForm = false">Cancel</button>
                <button type="submit" class="btn-primary" :disabled="saving">
                  {{ saving ? 'Saving...' : editingCategory ? 'Update' : 'Create' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Categories tree -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="card animate-pulse p-4">
        <div class="h-5 w-40 rounded bg-gray-800" />
      </div>
    </div>

    <div v-else-if="categories.length === 0">
      <EmptyState
        title="No categories yet"
        description="Create categories to organize your products."
        action-label="Add category"
        @action="openCreate"
      />
    </div>

    <div v-else class="space-y-2">
      <div v-for="cat in topLevel" :key="cat.id">
        <div class="card flex items-center justify-between p-4 transition-all hover:border-gray-700">
          <div class="flex items-center gap-3">
            <svg class="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
            </svg>
            <span class="font-medium text-white">{{ cat.name }}</span>
          </div>
          <div class="flex items-center gap-1">
            <button class="btn-ghost !p-1.5" @click="openEdit(cat)">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </button>
            <button class="btn-ghost !p-1.5 text-red-400" @click="handleDelete(cat.id)">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          </div>
        </div>
        <!-- Children -->
        <div v-for="child in getChildren(cat.id)" :key="child.id" class="ml-8 mt-2">
          <div class="card flex items-center justify-between p-3 transition-all hover:border-gray-700">
            <div class="flex items-center gap-3">
              <svg class="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
              </svg>
              <span class="text-sm font-medium text-gray-300">{{ child.name }}</span>
            </div>
            <div class="flex items-center gap-1">
              <button class="btn-ghost !p-1" @click="openEdit(child)">
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                </svg>
              </button>
              <button class="btn-ghost !p-1 text-red-400" @click="handleDelete(child.id)">
                <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
