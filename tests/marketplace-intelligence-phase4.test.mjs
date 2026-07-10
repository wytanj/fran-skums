import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { toolDefinitions, handleTool } from '../mcp/src/tools.mjs'

const indexSrc = readFileSync(new URL('../mcp/src/index.mjs', import.meta.url), 'utf8')
const toolsSrc = readFileSync(new URL('../mcp/src/tools.mjs', import.meta.url), 'utf8')
const contextSrc = readFileSync(new URL('../mcp/src/context.mjs', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../mcp/README.md', import.meta.url), 'utf8')
const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
const majorUpdate = readFileSync(new URL('../Major Update.md', import.meta.url), 'utf8')
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')

const EXPECTED_TOOLS = [
  'study_start',
  'study_get',
  'study_list',
  'study_brief',
  'study_match_catalog',
  'study_propose',
  'market_search',
  'market_seller_mix',
  'market_listing_history',
  'pipeline_propose',
  'pipeline_list',
  'pipeline_decide',
  'pipeline_execute',
  'bi_list_seeds',
  'bi_upsert_seed',
  'bi_set_cadence',
  'bi_run_seed_now',
  'bi_job_status',
  'bi_query_snapshots',
  'bi_export_table',
  'bi_list_metrics',
  'bi_latest_digest',
]

test('MCP exposes full Phase 4 tool surface', () => {
  const names = toolDefinitions.map((t) => t.name)
  for (const n of EXPECTED_TOOLS) {
    assert.ok(names.includes(n), `missing tool ${n}`)
  }
  // Phase 5+ may add tools; Phase 4 set must remain present
  assert.ok(names.length >= EXPECTED_TOOLS.length)
  for (const t of toolDefinitions) {
    assert.ok(t.description)
    assert.equal(t.inputSchema.type, 'object')
  }
})

test('MCP server entry uses SDK stdio transport', () => {
  assert.match(indexSrc, /StdioServerTransport/)
  assert.match(indexSrc, /ListToolsRequestSchema/)
  assert.match(indexSrc, /CallToolRequestSchema/)
  assert.match(indexSrc, /handleTool/)
  assert.match(pkg, /"mcp":\s*"node mcp\/src\/index\.mjs"/)
  assert.match(pkg, /@modelcontextprotocol\/sdk/)
})

test('MCP context loads workspace and scopes', () => {
  assert.match(contextSrc, /FRAN_MCP_WORKSPACE_ID/)
  assert.match(contextSrc, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(contextSrc, /requireScope/)
  assert.match(contextSrc, /XAI_API_KEY/)
})

test('unknown tool returns error result shape', async () => {
  const res = await handleTool('not_a_real_tool', {})
  assert.equal(res.isError, true)
  assert.ok(res.content?.[0]?.text)
  const body = JSON.parse(res.content[0].text)
  assert.match(body.error, /Unknown tool|FRAN_MCP_WORKSPACE|scope|SUPABASE/i)
})

test('tools wire study brief and pipeline execute scopes', () => {
  assert.match(toolsSrc, /study:write/)
  assert.match(toolsSrc, /pipeline:propose/)
  assert.match(toolsSrc, /pipeline:decide/)
  assert.match(toolsSrc, /pipeline:execute/)
  assert.match(toolsSrc, /intel:write/)
  assert.match(toolsSrc, /runStudyBrief/)
  assert.match(toolsSrc, /executePipelineCandidate/)
  assert.match(toolsSrc, /exportTable/)
})

test('docs and env example cover MCP Phase 4', () => {
  assert.match(readme, /FRAN_MCP_WORKSPACE_ID/)
  assert.match(readme, /study_brief/)
  assert.match(readme, /bi_export_table/)
  assert.match(envExample, /FRAN_MCP_WORKSPACE_ID/)
  assert.match(majorUpdate, /Phase 4/)
})
