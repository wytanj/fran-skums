import { createYoga, createSchema as createGQLSchema } from 'graphql-yoga'
import { serverSupabaseClient } from '#supabase/server'

const typeDefs = /* GraphQL */ `
  scalar JSON
  scalar DateTime

  type Query {
    product(id: ID!): Product
    products(
      workspace_id: ID!
      search: String
      status: String
      limit: Int
      offset: Int
      schema_id: ID
    ): ProductConnection!

    productSchema(id: ID!): ProductSchema
    productSchemas(workspace_id: ID): [ProductSchema!]!
    resolvedSchema(schema_id: ID!): JSON

    brands(workspace_id: ID!): [Brand!]!
    categories(workspace_id: ID!): [Category!]!
  }

  type ProductConnection {
    nodes: [Product!]!
    totalCount: Int!
  }

  type Product {
    id: ID!
    workspace_id: ID!
    title: String!
    description: String
    short_description: String
    status: String!
    sku: String
    ean: String
    upc: String
    gtin: String
    isbn: String
    asin: String
    mpn: String
    cost_price: Float
    retail_price: Float
    sale_price: Float
    currency: String!
    weight: Float
    weight_unit: String
    length: Float
    width: Float
    height: Float
    dimension_unit: String
    stock_quantity: Int!
    low_stock_threshold: Int
    track_inventory: Boolean!
    seo_title: String
    seo_description: String
    seo_keywords: [String]
    canonical_url: String
    tags: [String]
    is_canonical: Boolean!
    canonical_product_id: ID
    rendition_name: String
    export_target: String
    schema_id: ID

    product_data: JSON!

    brand: Brand
    category: Category
    images: [ProductImage!]
    variants: [ProductVariant!]
    canonical_product: Product
    forks: [Product!]
    schema: ProductSchema

    created_at: DateTime!
    updated_at: DateTime!
  }

  type Brand {
    id: ID!
    workspace_id: ID!
    name: String!
    logo_url: String
    website: String
    created_at: DateTime!
  }

  type Category {
    id: ID!
    workspace_id: ID!
    parent_id: ID
    name: String!
    slug: String!
    sort_order: Int!
    children: [Category!]
    created_at: DateTime!
  }

  type ProductImage {
    id: ID!
    url: String!
    alt_text: String
    sort_order: Int!
    is_primary: Boolean!
  }

  type ProductVariant {
    id: ID!
    sku: String
    title: String!
    options: JSON
    retail_price: Float
    sale_price: Float
    stock_quantity: Int!
    is_active: Boolean!
  }

  type ProductSchema {
    id: ID!
    workspace_id: ID
    name: String!
    slug: String!
    description: String
    version: Int!
    schema: JSON!
    extends_schema_id: ID
    is_active: Boolean!
    created_at: DateTime!
    updated_at: DateTime!
  }

  type Mutation {
    updateProductData(
      product_id: ID!
      data: JSON!
    ): Product

    setProductSchema(
      product_id: ID!
      schema_id: ID!
    ): Product
  }
`

const resolvers = {
  Query: {
    async product(_: any, { id }: { id: string }, ctx: any) {
      const client = ctx.supabase
      const { data, error } = await client
        .from('products')
        .select('*, brand:brand_id(*), category:category_id(*), images:product_images(*), variants:product_variants(*)')
        .eq('id', id)
        .single()
      if (error) throw new Error(error.message)
      return data
    },

    async products(_: any, args: any, ctx: any) {
      const client = ctx.supabase
      let query = client
        .from('products')
        .select('*, brand:brand_id(id, name), category:category_id(id, name)', { count: 'exact' })
        .eq('workspace_id', args.workspace_id)

      if (args.search) {
        query = query.or(`title.ilike.%${args.search}%,sku.ilike.%${args.search}%`)
      }
      if (args.status) {
        query = query.eq('status', args.status)
      }
      if (args.schema_id) {
        query = query.eq('schema_id', args.schema_id)
      }
      query = query.order('created_at', { ascending: false })
      if (args.limit) query = query.limit(args.limit)
      if (args.offset) query = query.range(args.offset, args.offset + (args.limit || 25) - 1)

      const { data, count, error } = await query
      if (error) throw new Error(error.message)
      return { nodes: data || [], totalCount: count || 0 }
    },

    async productSchema(_: any, { id }: { id: string }, ctx: any) {
      const client = ctx.supabase
      const { data, error } = await client
        .from('product_schemas')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw new Error(error.message)
      return data
    },

    async productSchemas(_: any, { workspace_id }: { workspace_id?: string }, ctx: any) {
      const client = ctx.supabase
      let query = client.from('product_schemas').select('*')
      if (workspace_id) {
        query = query.or(`workspace_id.eq.${workspace_id},workspace_id.is.null`)
      }
      query = query.order('created_at')
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data || []
    },

    async resolvedSchema(_: any, { schema_id }: { schema_id: string }, ctx: any) {
      const client = ctx.supabase
      const { data, error } = await client.rpc('resolve_product_schema', { p_schema_id: schema_id })
      if (error) throw new Error(error.message)
      return data
    },

    async brands(_: any, { workspace_id }: { workspace_id: string }, ctx: any) {
      const client = ctx.supabase
      const { data, error } = await client
        .from('brands')
        .select('*')
        .eq('workspace_id', workspace_id)
        .order('name')
      if (error) throw new Error(error.message)
      return data || []
    },

    async categories(_: any, { workspace_id }: { workspace_id: string }, ctx: any) {
      const client = ctx.supabase
      const { data, error } = await client
        .from('categories')
        .select('*')
        .eq('workspace_id', workspace_id)
        .order('sort_order')
      if (error) throw new Error(error.message)
      return data || []
    },
  },

  Mutation: {
    async updateProductData(_: any, { product_id, data }: { product_id: string; data: any }, ctx: any) {
      const client = ctx.supabase
      const { data: product, error } = await client
        .from('products')
        .update({ product_data: data, updated_at: new Date().toISOString() })
        .eq('id', product_id)
        .select()
        .single()
      if (error) throw new Error(error.message)
      return product
    },

    async setProductSchema(_: any, { product_id, schema_id }: { product_id: string; schema_id: string }, ctx: any) {
      const client = ctx.supabase
      const { data: product, error } = await client
        .from('products')
        .update({ schema_id, updated_at: new Date().toISOString() })
        .eq('id', product_id)
        .select()
        .single()
      if (error) throw new Error(error.message)
      return product
    },
  },

  Product: {
    product_data: (parent: any) => parent.product_data || {},

    async schema(parent: any, _args: any, ctx: any) {
      if (!parent.schema_id) return null
      const client = ctx.supabase
      const { data } = await client
        .from('product_schemas')
        .select('*')
        .eq('id', parent.schema_id)
        .single()
      return data
    },

    brand: (parent: any) => parent.brand || null,
    category: (parent: any) => parent.category || null,

    async images(parent: any, _args: any, ctx: any) {
      if (parent.images) return parent.images
      const client = ctx.supabase
      const { data } = await client
        .from('product_images')
        .select('*')
        .eq('product_id', parent.id)
        .order('sort_order')
      return data || []
    },

    async variants(parent: any, _args: any, ctx: any) {
      if (parent.variants) return parent.variants
      const client = ctx.supabase
      const { data } = await client
        .from('product_variants')
        .select('*')
        .eq('product_id', parent.id)
      return data || []
    },

    async canonical_product(parent: any, _args: any, ctx: any) {
      if (!parent.canonical_product_id) return null
      const client = ctx.supabase
      const { data } = await client
        .from('products')
        .select('*')
        .eq('id', parent.canonical_product_id)
        .single()
      return data
    },

    async forks(parent: any, _args: any, ctx: any) {
      if (!parent.is_canonical) return []
      const client = ctx.supabase
      const { data } = await client
        .from('products')
        .select('*')
        .eq('canonical_product_id', parent.id)
        .order('created_at', { ascending: false })
      return data || []
    },
  },
}

const gqlSchema = createGQLSchema({ typeDefs, resolvers })

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)

  const yoga = createYoga({
    schema: gqlSchema,
    graphqlEndpoint: '/api/graphql',
    context: () => ({ supabase: client }),
  })

  const { req, res } = event.node
  const response = await yoga.handle(req, res)

  event.node.res.statusCode = response.status
  response.headers.forEach((value: string, key: string) => {
    event.node.res.setHeader(key, value)
  })

  return response.text()
})
