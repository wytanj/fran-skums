import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  importFormatSpec,
  importFormatCsv,
  SKUMS_IMPORT_HEADERS,
} from '../core/import/format.mjs'

describe('catalog import format contract', () => {
  test('planogram headers are the official MCP sheet', () => {
    const spec = importFormatSpec('planogram')
    assert.equal(spec.format, 'skums_catalog_import_v1')
    assert.deepEqual(spec.headers, ['title', 'title_ko', 'upc', 'brand', 'shelf', 'priority'])
    assert.ok(spec.headers.every((h) => SKUMS_IMPORT_HEADERS.includes(h)))
    assert.ok(spec.rules.some((r) => /upc/i.test(r)))
    assert.equal(spec.example_rows[0].upc, '8800256108053')
    assert.match(importFormatCsv(spec), /^title,title_ko,upc,brand,shelf,priority/)
  })

  test('MCP registers catalog_import_format as a safe read tool', () => {
    const tools = readFileSync(new URL('../mcp/src/tools.mjs', import.meta.url), 'utf8')
    const scopes = readFileSync(new URL('../mcp/src/toolScopes.mjs', import.meta.url), 'utf8')
    assert.match(tools, /name: 'catalog_import_format'/)
    assert.match(tools, /case 'catalog_import_format'/)
    assert.match(scopes, /catalog_import_format:/)
  })
})
