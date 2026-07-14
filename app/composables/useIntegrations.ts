import type {
  IntegrationNodeDefinition,
  IntegrationCredential,
  IntegrationConnection,
  IntegrationExecution,
  IntegrationWebhook,
  ConnectionStatus,
  SyncDirection,
  SyncFrequency,
} from '~/types'

export function useIntegrations() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()
  const user = useSupabaseUser()

  const nodeDefinitions = ref<IntegrationNodeDefinition[]>([])
  const credentials = ref<IntegrationCredential[]>([])
  const connections = ref<IntegrationConnection[]>([])
  const executions = ref<IntegrationExecution[]>([])
  const loading = ref(false)

  function getUid(): string | undefined {
    const u = user.value as any
    return u?.id || u?.sub
  }

  // ── Node Definitions ──

  async function fetchNodeDefinitions() {
    loading.value = true
    try {
      const promises = [
        client.from('integration_node_definitions').select('*').is('workspace_id', null).order('name'),
      ]
      if (currentWorkspace.value) {
        promises.push(
          client.from('integration_node_definitions').select('*').eq('workspace_id', currentWorkspace.value.id).order('name'),
        )
      }
      const results = await Promise.all(promises)
      const global = (results[0].data || []) as IntegrationNodeDefinition[]
      const ws = results.length > 1 ? (results[1].data || []) as IntegrationNodeDefinition[] : []
      nodeDefinitions.value = [...global, ...ws]
    } finally {
      loading.value = false
    }
  }

  function getNodeDef(id: string): IntegrationNodeDefinition | undefined {
    return nodeDefinitions.value.find(n => n.id === id)
  }

  function getNodeDefBySlug(slug: string): IntegrationNodeDefinition | undefined {
    return nodeDefinitions.value.find(n => n.slug === slug)
  }

  const nodesByCategory = computed(() => {
    const map: Record<string, IntegrationNodeDefinition[]> = {}
    for (const node of nodeDefinitions.value) {
      if (!map[node.category]) map[node.category] = []
      map[node.category].push(node)
    }
    return map
  })

  // ── Credentials ──

  async function fetchCredentials() {
    if (!currentWorkspace.value) return
    const { data } = await client
      .from('integration_credentials')
      .select('*, node_definition:integration_node_definitions(*)')
      .eq('workspace_id', currentWorkspace.value.id)
      .order('created_at', { ascending: false })
    credentials.value = (data || []) as IntegrationCredential[]
  }

  async function createCredential(nodeDefId: string, name: string, data: Record<string, any>): Promise<IntegrationCredential> {
    if (!currentWorkspace.value) throw new Error('No workspace selected')
    const { data: result, error } = await client
      .from('integration_credentials')
      .insert({
        workspace_id: currentWorkspace.value.id,
        node_def_id: nodeDefId,
        name,
        credential_data: data,
        created_by: getUid(),
      })
      .select()
      .single()
    if (error) throw error
    await fetchCredentials()
    return result as IntegrationCredential
  }

  async function updateCredential(id: string, updates: { name?: string; credential_data?: Record<string, any> }) {
    const { error } = await client
      .from('integration_credentials')
      .update(updates)
      .eq('id', id)
    if (error) throw error
    await fetchCredentials()
  }

  async function deleteCredential(id: string) {
    const { error } = await client
      .from('integration_credentials')
      .delete()
      .eq('id', id)
    if (error) throw error
    await fetchCredentials()
  }

  async function testCredential(id: string): Promise<{ valid: boolean; error?: string }> {
    const credential = credentials.value.find(c => c.id === id)
    const nodeDef = credential?.node_definition || (credential ? getNodeDef(credential.node_def_id) : undefined)

    if (nodeDef?.slug === 'woocommerce') {
      try {
        await $fetch('/api/integrations/woocommerce/test', {
          method: 'POST',
          body: { credential_id: id },
        })
        await fetchCredentials()
        return { valid: true }
      } catch (error: any) {
        await fetchCredentials()
        return {
          valid: false,
          error: error?.data?.statusMessage || error?.data?.message || error?.message || 'WooCommerce credential test failed',
        }
      }
    }

    if (nodeDef?.slug === 'worldsyntech-ofs') {
      try {
        await $fetch('/api/integrations/worldsyntech-ofs/test', {
          method: 'POST',
          body: { credential_id: id },
        })
        await fetchCredentials()
        return { valid: true }
      } catch (error: any) {
        await fetchCredentials()
        return {
          valid: false,
          error: error?.data?.statusMessage || error?.data?.message || error?.message || 'WorldSyntech/OFS credential test failed',
        }
      }
    }

    const { error } = await client
      .from('integration_credentials')
      .update({ is_valid: true, last_tested_at: new Date().toISOString(), test_error: null })
      .eq('id', id)
    if (error) return { valid: false, error: error.message }
    await fetchCredentials()
    return { valid: true }
  }

  function getCredentialsForNode(nodeDefId: string): IntegrationCredential[] {
    return credentials.value.filter(c => c.node_def_id === nodeDefId)
  }

  // ── Connections ──

  async function fetchConnections() {
    if (!currentWorkspace.value) return
    const { data } = await client
      .from('integration_connections')
      .select('*, node_definition:integration_node_definitions(*), credential:integration_credentials(*)')
      .eq('workspace_id', currentWorkspace.value.id)
      .order('created_at', { ascending: false })
    connections.value = (data || []) as IntegrationConnection[]
  }

  async function createConnection(opts: {
    nodeDefId: string
    credentialId?: string
    name: string
    config?: Record<string, any>
    fieldMapping?: Record<string, string>
    syncDirection?: SyncDirection
    syncFrequency?: SyncFrequency
  }): Promise<IntegrationConnection> {
    if (!currentWorkspace.value) throw new Error('No workspace selected')
    const { data, error } = await client
      .from('integration_connections')
      .insert({
        workspace_id: currentWorkspace.value.id,
        node_def_id: opts.nodeDefId,
        credential_id: opts.credentialId || null,
        name: opts.name,
        config: opts.config || {},
        field_mapping: opts.fieldMapping || {},
        sync_direction: opts.syncDirection || 'push',
        sync_frequency: opts.syncFrequency || 'manual',
        created_by: getUid(),
      })
      .select()
      .single()
    if (error) throw error
    await fetchConnections()
    return data as IntegrationConnection
  }

  async function updateConnection(id: string, updates: Partial<Pick<IntegrationConnection,
    'name' | 'status' | 'config' | 'field_mapping' | 'sync_direction' | 'sync_frequency' | 'credential_id'
  >>) {
    const { error } = await client
      .from('integration_connections')
      .update(updates)
      .eq('id', id)
    if (error) throw error
    await fetchConnections()
  }

  async function deleteConnection(id: string) {
    const { error } = await client
      .from('integration_connections')
      .delete()
      .eq('id', id)
    if (error) throw error
    await fetchConnections()
  }

  async function activateConnection(id: string) {
    await updateConnection(id, { status: 'active' as ConnectionStatus })
  }

  async function pauseConnection(id: string) {
    await updateConnection(id, { status: 'paused' as ConnectionStatus })
  }

  async function pullWooCommerceProducts(connectionId: string, opts: {
    reset?: boolean
    page?: number
    perPage?: number
    maxPages?: number
    status?: string
    includeVariations?: boolean
  } = {}) {
    const result = await $fetch('/api/integrations/woocommerce/pull-products', {
      method: 'POST',
      body: {
        connection_id: connectionId,
        reset: opts.reset,
        page: opts.page,
        per_page: opts.perPage,
        max_pages: opts.maxPages,
        status: opts.status,
        include_variations: opts.includeVariations,
      },
    })
    await fetchConnections()
    return result as any
  }

  async function syncWorldsyntechReferenceData(connectionId: string, opts: {
    maxPages?: number
  } = {}) {
    const result = await $fetch('/api/integrations/worldsyntech-ofs/sync-reference-data', {
      method: 'POST',
      body: {
        connection_id: connectionId,
        max_pages: opts.maxPages,
      },
    })
    await fetchConnections()
    return result as any
  }

  async function pullWorldsyntechInventory(connectionId: string, opts: {
    reset?: boolean
    offset?: number
    limit?: number
    languageId?: number
  } = {}) {
    const result = await $fetch('/api/integrations/worldsyntech-ofs/pull-inventory', {
      method: 'POST',
      body: {
        connection_id: connectionId,
        reset: opts.reset,
        offset: opts.offset,
        limit: opts.limit,
        language_id: opts.languageId,
      },
    })
    await fetchConnections()
    return result as any
  }

  async function pullWorldsyntechProducts(connectionId: string, opts: {
    reset?: boolean
    offset?: number
    limit?: number
    languageId?: number
  } = {}) {
    const result = await $fetch('/api/integrations/worldsyntech-ofs/pull-products', {
      method: 'POST',
      body: {
        connection_id: connectionId,
        reset: opts.reset,
        offset: opts.offset,
        limit: opts.limit,
        language_id: opts.languageId,
      },
    })
    await fetchConnections()
    return result as any
  }

  // ── Executions ──

  async function fetchExecutions(connectionId?: string, limit = 50) {
    if (!currentWorkspace.value) return
    let query = client
      .from('integration_executions')
      .select('*')
      .eq('workspace_id', currentWorkspace.value.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (connectionId) {
      query = query.eq('connection_id', connectionId)
    }

    const { data } = await query
    executions.value = (data || []) as IntegrationExecution[]
  }

  async function createExecution(connectionId: string, opts: {
    executionType: 'action' | 'trigger' | 'test' | 'webhook'
    actionKey?: string
    triggerKey?: string
    inputData?: Record<string, any>
  }): Promise<IntegrationExecution> {
    if (!currentWorkspace.value) throw new Error('No workspace selected')
    const { data, error } = await client
      .from('integration_executions')
      .insert({
        connection_id: connectionId,
        workspace_id: currentWorkspace.value.id,
        execution_type: opts.executionType,
        action_key: opts.actionKey || null,
        trigger_key: opts.triggerKey || null,
        input_data: opts.inputData || {},
        triggered_by: getUid(),
      })
      .select()
      .single()
    if (error) throw error
    return data as IntegrationExecution
  }

  async function completeExecution(id: string, result: {
    status: 'success' | 'error' | 'cancelled' | 'timeout'
    outputData?: Record<string, any>
    errorMessage?: string
    itemsProcessed?: number
    itemsCreated?: number
    itemsUpdated?: number
    itemsFailed?: number
  }) {
    const now = new Date()
    const { error } = await client
      .from('integration_executions')
      .update({
        status: result.status,
        output_data: result.outputData || {},
        error_message: result.errorMessage || null,
        items_processed: result.itemsProcessed || 0,
        items_created: result.itemsCreated || 0,
        items_updated: result.itemsUpdated || 0,
        items_failed: result.itemsFailed || 0,
        finished_at: now.toISOString(),
      })
      .eq('id', id)
    if (error) throw error
  }

  // ── Load All ──

  async function loadAll() {
    loading.value = true
    try {
      await Promise.all([
        fetchNodeDefinitions(),
        fetchCredentials(),
        fetchConnections(),
      ])
    } finally {
      loading.value = false
    }
  }

  return {
    nodeDefinitions,
    credentials,
    connections,
    executions,
    loading,
    nodesByCategory,

    fetchNodeDefinitions,
    getNodeDef,
    getNodeDefBySlug,

    fetchCredentials,
    createCredential,
    updateCredential,
    deleteCredential,
    testCredential,
    getCredentialsForNode,

    fetchConnections,
    createConnection,
    updateConnection,
    deleteConnection,
    activateConnection,
    pauseConnection,
    pullWooCommerceProducts,
    syncWorldsyntechReferenceData,
    pullWorldsyntechInventory,
    pullWorldsyntechProducts,

    fetchExecutions,
    createExecution,
    completeExecution,

    loadAll,
  }
}
