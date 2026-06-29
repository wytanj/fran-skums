<script setup lang="ts">
const { currentWorkspace } = useWorkspace()

const query = ref(`# SKUMS GraphQL API Explorer
# Try queries against your product data
#
# Example: List products in your workspace
query {
  products(workspace_id: "${'{workspace_id}'}") {
    totalCount
    nodes {
      id
      title
      sku
      status
      product_data
      schema {
        name
        slug
      }
    }
  }
}`)

const variables = ref('{}')
const result = ref<any>(null)
const loading = ref(false)
const errorMsg = ref('')
const activeResultTab = ref<'result' | 'schema'>('result')

const sampleQueries = [
  {
    name: 'List Products',
    query: `query ListProducts($wsId: ID!) {
  products(workspace_id: $wsId, limit: 10) {
    totalCount
    nodes {
      id
      title
      sku
      status
      product_data
      brand { name }
      category { name }
    }
  }
}`,
    variables: () => `{ "wsId": "${currentWorkspace.value?.id || ''}" }`,
  },
  {
    name: 'Get Product with Schema',
    query: `query GetProduct($id: ID!) {
  product(id: $id) {
    id
    title
    description
    sku
    ean
    upc
    status
    product_data
    schema {
      name
      slug
      schema
    }
    brand { name }
    category { name }
    images { url alt_text }
    variants { title sku retail_price }
    forks { id title rendition_name }
  }
}`,
    variables: () => '{ "id": "PRODUCT_ID_HERE" }',
  },
  {
    name: 'List Schemas',
    query: `query Schemas($wsId: ID) {
  productSchemas(workspace_id: $wsId) {
    id
    name
    slug
    description
    version
    workspace_id
    extends_schema_id
    schema
  }
}`,
    variables: () => `{ "wsId": "${currentWorkspace.value?.id || ''}" }`,
  },
  {
    name: 'Resolve Schema',
    query: `query ResolveSchema($schemaId: ID!) {
  resolvedSchema(schema_id: $schemaId)
}`,
    variables: () => '{ "schemaId": "00000000-0000-0000-0000-000000000001" }',
  },
  {
    name: 'Update Product Data',
    query: `mutation UpdateData($productId: ID!, $data: JSON!) {
  updateProductData(product_id: $productId, data: $data) {
    id
    title
    product_data
  }
}`,
    variables: () => `{
  "productId": "PRODUCT_ID_HERE",
  "data": {
    "identifiers": { "sku": "TEST-001" },
    "pricing": { "price": 29.99, "currency": "USD" }
  }
}`,
  },
]

function loadSample(sample: typeof sampleQueries[0]) {
  query.value = sample.query
  variables.value = sample.variables()
}

async function executeQuery() {
  loading.value = true
  errorMsg.value = ''
  result.value = null

  try {
    let parsedVars = {}
    try { parsedVars = JSON.parse(variables.value) } catch {}

    const response = await $fetch('/api/graphql', {
      method: 'POST',
      body: {
        query: query.value,
        variables: parsedVars,
      },
    })

    result.value = typeof response === 'string' ? JSON.parse(response) : response
    if (result.value?.errors) {
      errorMsg.value = result.value.errors.map((e: any) => e.message).join('\n')
    }
  } catch (e: any) {
    errorMsg.value = e.message || 'Request failed'
  } finally {
    loading.value = false
  }
}

function formatJSON(obj: any) {
  return JSON.stringify(obj, null, 2)
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <div class="mb-6">
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-pink-600/10">
          <svg class="h-5 w-5 text-pink-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
          </svg>
        </div>
        <div>
          <h1 class="text-2xl font-bold text-white">GraphQL API Explorer</h1>
          <p class="text-sm text-gray-400">
            Query your product data via the SKUMS GraphQL API at
            <code class="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-indigo-400">/api/graphql</code>
          </p>
        </div>
      </div>
    </div>

    <!-- Sample queries -->
    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="sample in sampleQueries"
        :key="sample.name"
        class="rounded-full border border-gray-800 bg-gray-900 px-3 py-1 text-xs text-gray-400 transition-all hover:border-indigo-500/50 hover:text-indigo-400"
        @click="loadSample(sample)"
      >
        {{ sample.name }}
      </button>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <!-- Editor Panel -->
      <div class="space-y-3">
        <div class="card overflow-hidden">
          <div class="flex items-center justify-between border-b border-gray-800 bg-gray-900/50 px-4 py-2.5">
            <span class="text-xs font-medium text-gray-400">Query</span>
            <button
              class="btn-primary !py-1 !px-3 text-xs"
              :disabled="loading"
              @click="executeQuery"
            >
              <svg v-if="!loading" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
              </svg>
              <svg v-else class="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {{ loading ? 'Running...' : 'Execute' }}
            </button>
          </div>
          <textarea
            v-model="query"
            class="w-full bg-transparent p-4 font-mono text-sm text-gray-300 focus:outline-none resize-y"
            rows="18"
            spellcheck="false"
          />
        </div>

        <div class="card overflow-hidden">
          <div class="border-b border-gray-800 bg-gray-900/50 px-4 py-2.5">
            <span class="text-xs font-medium text-gray-400">Variables (JSON)</span>
          </div>
          <textarea
            v-model="variables"
            class="w-full bg-transparent p-4 font-mono text-sm text-gray-300 focus:outline-none resize-y"
            rows="5"
            spellcheck="false"
          />
        </div>
      </div>

      <!-- Result Panel -->
      <div class="card overflow-hidden flex flex-col">
        <div class="border-b border-gray-800 bg-gray-900/50 px-4 py-2.5">
          <span class="text-xs font-medium text-gray-400">Result</span>
        </div>

        <div v-if="errorMsg" class="border-b border-red-800/30 bg-red-500/5 px-4 py-3 text-xs text-red-400 font-mono whitespace-pre-wrap">
          {{ errorMsg }}
        </div>

        <JsonView v-if="result" :data="result" class="flex-1" />

        <div v-else class="flex flex-1 items-center justify-center p-8 text-gray-600">
          <div class="text-center">
            <svg class="mx-auto h-8 w-8" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
            <p class="mt-2 text-xs">Execute a query to see results</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
