export default defineEventHandler(() => {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SKUMS API',
      version: '1.0.0',
      description:
        'SKUMS — Global Product Database API. Manage products, brands, categories, and schemas programmatically. Designed for n8n workflows, CLI tools, and AI agents.',
      contact: { name: 'SKUMS' },
    },
    servers: [{ url: '/api/v1', description: 'API v1' }],
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Pass your API key as a Bearer token: Authorization: Bearer sk_live_…',
        },
        apiKeyHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Pass your API key in the X-API-Key header',
        },
      },
      schemas: {
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            workspace_id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            sku: { type: 'string', nullable: true },
            ean: { type: 'string', nullable: true },
            upc: { type: 'string', nullable: true },
            gtin: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['draft', 'active', 'archived'] },
            product_data: { type: 'object', description: 'Dynamic schema-driven data' },
            description: { type: 'string', nullable: true },
            cost_price: { type: 'number', nullable: true },
            retail_price: { type: 'number', nullable: true },
            sale_price: { type: 'number', nullable: true },
            currency: { type: 'string' },
            stock_quantity: { type: 'integer' },
            tags: { type: 'array', items: { type: 'string' } },
            schema_id: { type: 'string', format: 'uuid', nullable: true },
            brand_id: { type: 'string', format: 'uuid', nullable: true },
            category_id: { type: 'string', format: 'uuid', nullable: true },
            is_canonical: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        PosCatalogItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            product_id: { type: 'string', format: 'uuid' },
            revision: { type: 'string' },
            updated_at: { type: 'string', format: 'date-time', nullable: true },
            product_identity_id: { type: 'string', format: 'uuid', nullable: true },
            trade_unit_id: { type: 'string', format: 'uuid', nullable: true },
            sku_assignment_id: { type: 'string', format: 'uuid', nullable: true },
            sku: { type: 'string' },
            title: { type: 'string' },
            display_name: { type: 'string' },
            brand_name: { type: 'string', nullable: true },
            category_name: { type: 'string', nullable: true },
            unit_price: { type: 'number' },
            list_price: { type: 'number' },
            currency: { type: 'string' },
            storage_location_code: { type: 'string', nullable: true },
            stock_quantity: { type: 'integer' },
            track_inventory: { type: 'boolean' },
            status: { type: 'string', enum: ['draft', 'active', 'archived'] },
            pos_enabled: { type: 'boolean' },
            identifiers: { type: 'object' },
            metadata: { type: 'object' },
          },
        },
        PosInventoryEvent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            workspace_id: { type: 'string', format: 'uuid' },
            event_type: {
              type: 'string',
              enum: ['inventory.damage.reported', 'inventory.found_stock.reported', 'inventory.transfer_receive.reported'],
            },
            status: { type: 'string', enum: ['received', 'pending_approval', 'applied', 'rejected', 'failed'] },
            source: { type: 'string' },
            idempotency_key: { type: 'string', nullable: true },
            pos_location_id: { type: 'string', format: 'uuid', nullable: true },
            inventory_location_id: { type: 'string', format: 'uuid', nullable: true },
            transfer_id: { type: 'string', format: 'uuid', nullable: true },
            product_id: { type: 'string', format: 'uuid', nullable: true },
            sku: { type: 'string', nullable: true },
            quantity: { type: 'integer', nullable: true },
            storage_location_code: { type: 'string', nullable: true },
            reason_code: { type: 'string', nullable: true },
            reference: { type: 'string', nullable: true },
            adjustment_id: { type: 'string', format: 'uuid', nullable: true },
            payload: { type: 'object' },
            result: { type: 'object' },
            error_message: { type: 'string', nullable: true },
            occurred_at: { type: 'string', format: 'date-time' },
            processed_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        DomainEvent: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            workspace_id: { type: 'string', format: 'uuid' },
            event_type: { type: 'string' },
            event_version: { type: 'integer' },
            source_type: { type: 'string' },
            source_app_key: { type: 'string', nullable: true },
            aggregate_type: { type: 'string', nullable: true },
            aggregate_id: { type: 'string', format: 'uuid', nullable: true },
            idempotency_key: { type: 'string', nullable: true },
            payload: { type: 'object' },
            metadata: { type: 'object' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        ProductAttentionItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            workspace_id: { type: 'string', format: 'uuid' },
            attention_type: { type: 'string' },
            risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            status: { type: 'string', enum: ['open', 'in_review', 'proposed', 'resolved', 'dismissed', 'cancelled'] },
            source_type: { type: 'string' },
            source_app_key: { type: 'string', nullable: true },
            source_event_id: { type: 'string', format: 'uuid', nullable: true },
            proposal_id: { type: 'string', format: 'uuid', nullable: true },
            product_identity_id: { type: 'string', format: 'uuid', nullable: true },
            trade_unit_id: { type: 'string', format: 'uuid', nullable: true },
            listing_id: { type: 'string', format: 'uuid', nullable: true },
            channel_id: { type: 'string', format: 'uuid', nullable: true },
            sku_assignment_id: { type: 'string', format: 'uuid', nullable: true },
            identifier_id: { type: 'string', format: 'uuid', nullable: true },
            product_id: { type: 'string', format: 'uuid', nullable: true },
            variant_id: { type: 'string', format: 'uuid', nullable: true },
            title: { type: 'string' },
            summary: { type: 'string', nullable: true },
            recommended_action: { type: 'string', nullable: true },
            evidence: { type: 'object' },
            metadata: { type: 'object' },
            assigned_to: { type: 'string', format: 'uuid', nullable: true },
            resolved_by: { type: 'string', format: 'uuid', nullable: true },
            resolved_at: { type: 'string', format: 'date-time', nullable: true },
            idempotency_key: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        AgentProposal: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            workspace_id: { type: 'string', format: 'uuid' },
            source_event_id: { type: 'string', format: 'uuid', nullable: true },
            app_key: { type: 'string', nullable: true },
            agent_type: { type: 'string' },
            intent_summary: { type: 'string' },
            affected_objects: { type: 'array', items: { type: 'object' } },
            proposed_steps: { type: 'array', items: { type: 'object' } },
            data_diff: { type: 'object' },
            risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            policy_result: { type: 'object' },
            approval_required: { type: 'boolean' },
            status: { type: 'string', enum: ['draft', 'pending_approval', 'approved', 'rejected', 'executing', 'executed', 'failed', 'cancelled'] },
            created_by_agent: { type: 'string', nullable: true },
            executed_at: { type: 'string', format: 'date-time', nullable: true },
            rollback_metadata: { type: 'object' },
            metadata: { type: 'object' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        AgentProposalDryRun: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['dry_run'] },
            proposal_id: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
            approval_required: { type: 'boolean' },
            would_execute: { type: 'boolean' },
            proposed_steps: { type: 'array', items: { type: 'object' } },
            affected_objects: { type: 'array', items: { type: 'object' } },
            data_diff: { type: 'object' },
          },
        },
        Brand: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            logo_url: { type: 'string', nullable: true },
            website: { type: 'string', nullable: true },
          },
        },
        Category: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
            parent_id: { type: 'string', format: 'uuid', nullable: true },
            sort_order: { type: 'integer' },
          },
        },
        ProductSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string', nullable: true },
            version: { type: 'integer' },
            schema: { type: 'object', description: 'JSON Schema definition' },
            is_active: { type: 'boolean' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            statusMessage: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/pos/catalog': {
        get: {
          operationId: 'listPosCatalog',
          summary: 'List POS-enabled catalog items',
          description: 'Returns active products that are sellable in POS, with SKUMS graph references for scan and sale flows.',
          tags: ['POS'],
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'include_disabled', in: 'query', schema: { type: 'boolean', default: false } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 250 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': {
              description: 'POS catalog item list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/PosCatalogItem' } },
                      total: { type: 'integer' },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                      has_more: { type: 'boolean' },
                      next_offset: { type: 'integer', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/pos/inventory-events': {
        post: {
          operationId: 'createPosInventoryEvent',
          summary: 'Create a POS-initiated inventory event',
          description:
            'Accepts store-floor damage, found stock, and transfer receipt events. Damage and found stock create pending inventory adjustments; resolvable transfer receipts are applied to the inventory ledger.',
          tags: ['POS'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['event_type'],
                  properties: {
                    event_type: {
                      type: 'string',
                      enum: ['inventory.damage.reported', 'inventory.found_stock.reported', 'inventory.transfer_receive.reported'],
                    },
                    idempotency_key: { type: 'string' },
                    pos_location_code: { type: 'string' },
                    inventory_location_id: { type: 'string', format: 'uuid' },
                    sku: { type: 'string' },
                    product_id: { type: 'string', format: 'uuid' },
                    quantity: { type: 'integer', minimum: 1 },
                    storage_location_code: { type: 'string' },
                    reason_code: { type: 'string' },
                    reference: { type: 'string' },
                    transfer_id: { type: 'string', format: 'uuid' },
                    transfer_number: { type: 'string' },
                    receipts: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          line_id: { type: 'string', format: 'uuid' },
                          qty: { type: 'integer', minimum: 1 },
                        },
                      },
                    },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          sku: { type: 'string' },
                          product_id: { type: 'string', format: 'uuid' },
                          quantity: { type: 'integer', minimum: 1 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Event applied immediately',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/PosInventoryEvent' },
                      event: { $ref: '#/components/schemas/DomainEvent' },
                      attention_item: { $ref: '#/components/schemas/ProductAttentionItem', nullable: true },
                    },
                  },
                },
              },
            },
            '202': {
              description: 'Event accepted for approval or manual resolution',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/PosInventoryEvent' },
                      event: { $ref: '#/components/schemas/DomainEvent' },
                      attention_item: { $ref: '#/components/schemas/ProductAttentionItem', nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/pos/sales': {
        post: {
          operationId: 'createPosSale',
          summary: 'Create an idempotent POS sale or return',
          description: 'Records a POS sale with line items and payments, then emits a pos_sale.completed or pos_return.completed domain event. Duplicate idempotency keys return the existing sale.',
          tags: ['POS'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['receipt_number', 'items'],
                  properties: {
                    receipt_number: { type: 'string' },
                    sale_type: { type: 'string', enum: ['sale', 'return', 'exchange', 'sample_issue', 'tester_conversion', 'writeoff'] },
                    idempotency_key: { type: 'string' },
                    currency: { type: 'string', default: 'USD' },
                    total: { type: 'number' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['display_name', 'quantity', 'unit_price', 'line_total'],
                        properties: {
                          display_name: { type: 'string' },
                          sku_assignment_id: { type: 'string', format: 'uuid' },
                          product_id: { type: 'string', format: 'uuid' },
                          quantity: { type: 'number' },
                          unit_price: { type: 'number' },
                          line_total: { type: 'number' },
                          line_type: { type: 'string' },
                        },
                      },
                    },
                    payments: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'POS sale created' }, '200': { description: 'Duplicate sale returned' } },
        },
      },
      '/attention-items': {
        get: {
          operationId: 'listAttentionItems',
          summary: 'List product attention items',
          description: 'Returns human/agent-resolvable work items generated by POS, channel, import, connector, and agent workflows.',
          tags: ['Agents'],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'attention_type', in: 'query', schema: { type: 'string' } },
            { name: 'risk_level', in: 'query', schema: { type: 'string' } },
            { name: 'source_app_key', in: 'query', schema: { type: 'string' } },
            { name: 'proposal_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': {
              description: 'Attention item list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/ProductAttentionItem' } },
                      total: { type: 'integer' },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createAttentionItem',
          summary: 'Create a product attention item',
          tags: ['Agents'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['attention_type', 'title'],
                  properties: {
                    attention_type: { type: 'string' },
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                    recommended_action: { type: 'string' },
                    source_app_key: { type: 'string' },
                    source_event_id: { type: 'string', format: 'uuid' },
                    product_identity_id: { type: 'string', format: 'uuid' },
                    trade_unit_id: { type: 'string', format: 'uuid' },
                    listing_id: { type: 'string', format: 'uuid' },
                    product_id: { type: 'string', format: 'uuid' },
                    evidence: { type: 'object' },
                    metadata: { type: 'object' },
                    idempotency_key: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Attention item created',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/ProductAttentionItem' } } } } },
            },
          },
        },
      },
      '/attention-items/{id}/resolve': {
        post: {
          operationId: 'resolveAttentionItem',
          summary: 'Resolve, dismiss, or cancel an attention item',
          tags: ['Agents'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['resolved', 'dismissed', 'cancelled'], default: 'resolved' },
                    resolution_notes: { type: 'string' },
                    metadata: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Attention item updated',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/ProductAttentionItem' } } } } },
            },
          },
        },
      },
      '/attention-items/{id}/proposals': {
        post: {
          operationId: 'createAttentionItemProposal',
          summary: 'Create an agent proposal from an attention item',
          tags: ['Agents'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '201': {
              description: 'Agent proposal created',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/AgentProposal' } } } } },
            },
          },
        },
      },
      '/agent-proposals': {
        get: {
          operationId: 'listAgentProposals',
          summary: 'List agent proposals',
          tags: ['Agents'],
          responses: { '200': { description: 'Agent proposal list' } },
        },
        post: {
          operationId: 'createAgentProposal',
          summary: 'Create an agent proposal',
          tags: ['Agents'],
          responses: {
            '201': {
              description: 'Agent proposal created',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/AgentProposal' } } } } },
            },
          },
        },
      },
      '/agent-proposals/from-attention-item': {
        post: {
          operationId: 'createAgentProposalFromAttentionItem',
          summary: 'Create an agent proposal from an attention item',
          tags: ['Agents'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['attention_item_id'],
                  properties: {
                    attention_item_id: { type: 'string', format: 'uuid' },
                    agent_type: { type: 'string' },
                    approval_required: { type: 'boolean' },
                    proposed_steps: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Agent proposal created',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/AgentProposal' } } } } },
            },
          },
        },
      },
      '/agent-proposals/{id}/dry-run': {
        post: {
          operationId: 'dryRunAgentProposal',
          summary: 'Dry-run an agent proposal without applying writes',
          tags: ['Agents'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': {
              description: 'Dry-run result',
              content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/AgentProposalDryRun' } } } } },
            },
          },
        },
      },
      '/agent-proposals/{id}/execute': {
        post: {
          operationId: 'executeAgentProposal',
          summary: 'Execute an approved agent proposal',
          description: 'Execution is approved-only and emits an agent_proposal.executed domain event.',
          tags: ['Agents'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Agent proposal executed' }, '409': { description: 'Proposal is not approved' } },
        },
      },
      '/products': {
        get: {
          operationId: 'listProducts',
          summary: 'List products',
          description: 'Retrieve products for the workspace associated with the API key.',
          tags: ['Products'],
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search title or SKU' },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'active', 'archived'] } },
            { name: 'sku', in: 'query', schema: { type: 'string' }, description: 'Filter by exact SKU' },
            { name: 'ean', in: 'query', schema: { type: 'string' }, description: 'Filter by exact EAN' },
            { name: 'schema_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': {
              description: 'Product list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
                      total: { type: 'integer' },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createProduct',
          summary: 'Create a product',
          tags: ['Products'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    sku: { type: 'string' },
                    ean: { type: 'string' },
                    upc: { type: 'string' },
                    status: { type: 'string', enum: ['draft', 'active', 'archived'], default: 'draft' },
                    product_data: { type: 'object' },
                    cost_price: { type: 'number' },
                    retail_price: { type: 'number' },
                    sale_price: { type: 'number' },
                    stock_quantity: { type: 'integer' },
                    tags: { type: 'array', items: { type: 'string' } },
                    schema_id: { type: 'string', format: 'uuid' },
                    brand_id: { type: 'string', format: 'uuid' },
                    category_id: { type: 'string', format: 'uuid' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Product created',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Product' } } },
                },
              },
            },
          },
        },
      },
      '/products/{id}': {
        get: {
          operationId: 'getProduct',
          summary: 'Get a product by ID',
          tags: ['Products'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': {
              description: 'Product details',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Product' } } },
                },
              },
            },
            '404': { description: 'Product not found' },
          },
        },
        put: {
          operationId: 'updateProduct',
          summary: 'Update a product',
          tags: ['Products'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    sku: { type: 'string' },
                    status: { type: 'string' },
                    product_data: { type: 'object' },
                    retail_price: { type: 'number' },
                    stock_quantity: { type: 'integer' },
                    tags: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Product updated' },
            '404': { description: 'Product not found' },
          },
        },
        delete: {
          operationId: 'deleteProduct',
          summary: 'Delete a product',
          tags: ['Products'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: 'Product deleted' },
          },
        },
      },
      '/brands': {
        get: {
          operationId: 'listBrands',
          summary: 'List brands',
          tags: ['Brands'],
          responses: {
            '200': {
              description: 'Brand list',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Brand' } } } },
                },
              },
            },
          },
        },
      },
      '/categories': {
        get: {
          operationId: 'listCategories',
          summary: 'List categories',
          tags: ['Categories'],
          responses: {
            '200': {
              description: 'Category list',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Category' } } } },
                },
              },
            },
          },
        },
      },
      '/schemas': {
        get: {
          operationId: 'listSchemas',
          summary: 'List product schemas',
          description: 'Returns both global and workspace-specific schemas.',
          tags: ['Schemas'],
          responses: {
            '200': {
              description: 'Schema list',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/ProductSchema' } } } },
                },
              },
            },
          },
        },
      },
      '/webhooks/{path}': {
        post: {
          operationId: 'receiveWebhook',
          summary: 'Inbound webhook receiver',
          description: 'Receives data from external systems (n8n, Zapier, etc.) via registered webhook paths. Does not require API key — uses the webhook secret instead.',
          tags: ['Webhooks'],
          security: [],
          parameters: [
            { name: 'path', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'X-Webhook-Secret', in: 'header', schema: { type: 'string' }, description: 'Webhook secret for authentication' },
          ],
          requestBody: {
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '200': { description: 'Webhook received' },
            '401': { description: 'Invalid webhook secret' },
            '404': { description: 'Webhook not found' },
          },
        },
      },
      '/expiry/batches': {
        get: {
          operationId: 'listExpiryBatches',
          summary: 'List expiry batches',
          tags: ['Expiry'],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { '200': { description: 'Batch list' } },
        },
        post: {
          operationId: 'createExpiryBatch',
          summary: 'Create a batch with items',
          description: 'Create an expiry batch and optionally its items in one call. SKU resolution happens automatically.',
          tags: ['Expiry'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['batch_code'],
                  properties: {
                    batch_code: { type: 'string' },
                    received_at: { type: 'string', format: 'date' },
                    notes: { type: 'string' },
                    source: { type: 'string', default: 'api' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['sku', 'expiry_month', 'expiry_year'],
                        properties: {
                          sku: { type: 'string', description: 'Raw SKU / code (auto-resolved to product_id)' },
                          quantity: { type: 'integer', default: 1 },
                          expiry_month: { type: 'integer', minimum: 1, maximum: 12 },
                          expiry_year: { type: 'integer' },
                          expiry_day: { type: 'integer', minimum: 1, maximum: 31 },
                          unit_cost: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Batch created with items' } },
        },
      },
      '/expiry/lifo': {
        get: {
          operationId: 'getExpiryLifo',
          summary: 'LIFO query — items sorted by soonest expiry',
          tags: ['Expiry'],
          parameters: [
            { name: 'product_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'sku', in: 'query', schema: { type: 'string' } },
            { name: 'days_until', in: 'query', schema: { type: 'integer' }, description: 'Max days until expiry' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'LIFO item list' } },
        },
      },
      '/expiry/summary': {
        get: {
          operationId: 'getExpirySummary',
          summary: 'Expiry summary statistics',
          tags: ['Expiry'],
          responses: { '200': { description: 'Summary with counts of expired, expiring, unresolved items' } },
        },
      },
      '/expiry/aliases': {
        get: {
          operationId: 'listSkuAliases',
          summary: 'List SKU aliases',
          tags: ['Expiry'],
          parameters: [
            { name: 'product_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'alias_value', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Alias list' } },
        },
        post: {
          operationId: 'createSkuAliases',
          summary: 'Register SKU aliases',
          description: 'Map arbitrary SKU/code strings to SKUMS product IDs. Supports single or bulk.',
          tags: ['Expiry'],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    aliases: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['product_id', 'alias_value'],
                        properties: {
                          product_id: { type: 'string', format: 'uuid' },
                          alias_value: { type: 'string' },
                          alias_type: { type: 'string', default: 'sku' },
                          label: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Aliases created' } },
        },
      },
    },
  }
})
