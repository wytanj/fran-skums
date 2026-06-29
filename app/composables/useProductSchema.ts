import type { ProductSchema, ProductSchemaDefinition, SchemaProperty } from '~/types'

const GLOBAL_BASE_SCHEMA_ID = '00000000-0000-0000-0000-000000000001'

export function useProductSchema() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()

  const schemas = ref<ProductSchema[]>([])
  const globalSchema = ref<ProductSchema | null>(null)
  const loading = ref(false)

  async function fetchSchemas() {
    loading.value = true
    try {
      const promises = [
        client.from('product_schemas').select('*').is('workspace_id', null).order('created_at'),
      ]

      if (currentWorkspace.value) {
        promises.push(
          client.from('product_schemas').select('*').eq('workspace_id', currentWorkspace.value.id).order('created_at'),
        )
      }

      const results = await Promise.all(promises)

      const globalSchemas = (results[0].data || []) as ProductSchema[]
      const wsSchemas = results.length > 1 ? (results[1].data || []) as ProductSchema[] : []

      globalSchema.value = globalSchemas.find(s => s.id === GLOBAL_BASE_SCHEMA_ID) || globalSchemas[0] || null
      schemas.value = [...globalSchemas, ...wsSchemas]
    } finally {
      loading.value = false
    }
  }

  async function getSchema(id: string): Promise<ProductSchema | null> {
    const { data, error } = await client
      .from('product_schemas')
      .select('*')
      .eq('id', id)
      .single()

    if (error) return null
    return data as ProductSchema
  }

  async function getResolvedSchema(schemaId: string): Promise<ProductSchemaDefinition> {
    const { data, error } = await client.rpc('resolve_product_schema', { p_schema_id: schemaId })
    if (error) throw error
    return data as ProductSchemaDefinition
  }

  async function createSchema(schema: {
    name: string
    slug: string
    description?: string
    schema: ProductSchemaDefinition
    extends_schema_id?: string
  }): Promise<ProductSchema> {
    if (!currentWorkspace.value) throw new Error('No workspace selected')
    const user = useSupabaseUser()

    const { data, error } = await client
      .from('product_schemas')
      .insert({
        ...schema,
        workspace_id: currentWorkspace.value.id,
        extends_schema_id: schema.extends_schema_id || GLOBAL_BASE_SCHEMA_ID,
        created_by: user.value?.id,
      })
      .select()
      .single()

    if (error) throw error
    return data as ProductSchema
  }

  async function updateSchema(id: string, updates: Partial<Pick<ProductSchema, 'name' | 'description' | 'schema' | 'is_active'>>): Promise<ProductSchema> {
    const { data, error } = await client
      .from('product_schemas')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as ProductSchema
  }

  async function deleteSchema(id: string) {
    const { error } = await client
      .from('product_schemas')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  function resolveSchemaLocally(schema: ProductSchema, allSchemas: ProductSchema[]): ProductSchemaDefinition {
    const result: ProductSchemaDefinition = { type: 'object', properties: {} }

    if (schema.extends_schema_id) {
      const parent = allSchemas.find(s => s.id === schema.extends_schema_id)
      if (parent) {
        const parentResolved = resolveSchemaLocally(parent, allSchemas)
        Object.assign(result.properties, parentResolved.properties)
      }
    }

    if (schema.schema?.properties) {
      for (const [key, value] of Object.entries(schema.schema.properties)) {
        if (result.properties[key] && value.type === 'object' && value.properties) {
          const existing = result.properties[key]
          result.properties[key] = {
            ...existing,
            ...value,
            properties: {
              ...(existing.properties || {}),
              ...value.properties,
            },
          }
        } else {
          result.properties[key] = value
        }
      }
    }

    return result
  }

  function flattenSchemaProperties(schema: ProductSchemaDefinition, prefix = ''): Array<{
    path: string
    key: string
    property: SchemaProperty
    group: string
  }> {
    const result: Array<{ path: string; key: string; property: SchemaProperty; group: string }> = []
    if (!schema.properties) return result

    for (const [key, prop] of Object.entries(schema.properties)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (prop.type === 'object' && prop.properties) {
        result.push(...flattenSchemaProperties(
          { type: 'object', properties: prop.properties } as ProductSchemaDefinition,
          path,
        ))
      } else {
        result.push({ path, key, property: prop, group: prefix || 'root' })
      }
    }

    return result
  }

  return {
    schemas,
    globalSchema,
    loading,
    GLOBAL_BASE_SCHEMA_ID,
    fetchSchemas,
    getSchema,
    getResolvedSchema,
    createSchema,
    updateSchema,
    deleteSchema,
    resolveSchemaLocally,
    flattenSchemaProperties,
  }
}
