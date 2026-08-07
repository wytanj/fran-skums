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
    <UiPageHeader
      eyebrow="API & agents"
      title="GraphQL API Explorer"
      subtitle="Query product data at /api/graphql — pair with MCP for agent workflows."
    >
      <template #actions>
        <NuxtLink to="/settings#claude-connector">
          <UiButton size="sm" variant="secondary">Connect Claude / MCP</UiButton>
        </NuxtLink>
      </template>
    </UiPageHeader>

    <!-- Sample queries -->
    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="sample in sampleQueries"
        :key="sample.name"
        type="button"
        class="press rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-muted transition-all hover:border-yellow-deep hover:text-brown"
        @click="loadSample(sample)"
      >
        {{ sample.name }}
      </button>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <!-- Editor Panel -->
      <div class="space-y-3">
        <div class="card overflow-hidden">
          <div class="flex items-center justify-between border-b border-line bg-surface-sunken/80 px-4 py-2.5">
            <span class="text-xs font-medium text-muted">Query</span>
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
            class="w-full bg-transparent p-4 font-mono text-sm text-ink-soft focus:outline-none resize-y"
            rows="18"
            spellcheck="false"
          />
        </div>

        <div class="card overflow-hidden">
          <div class="border-b border-line bg-surface-sunken/80 px-4 py-2.5">
            <span class="text-xs font-medium text-muted">Variables (JSON)</span>
          </div>
          <textarea
            v-model="variables"
            class="w-full bg-transparent p-4 font-mono text-sm text-ink-soft focus:outline-none resize-y"
            rows="5"
            spellcheck="false"
          />
        </div>
      </div>

      <!-- Result Panel -->
      <div class="card overflow-hidden flex flex-col">
        <div class="border-b border-line bg-surface-sunken/80 px-4 py-2.5">
          <span class="text-xs font-medium text-muted">Result</span>
        </div>

        <div v-if="errorMsg" class="border-b border-red-800/30 bg-red-500/5 px-4 py-3 text-xs text-danger font-mono whitespace-pre-wrap">
          {{ errorMsg }}
        </div>

        <JsonView v-if="result" :data="result" class="flex-1" />

        <div v-else class="flex flex-1 items-center justify-center p-8 text-muted">
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
