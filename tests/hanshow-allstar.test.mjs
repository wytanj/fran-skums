import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import test from 'node:test'

const client = readFileSync(new URL('../esl/hanshow-allstar/client.ts', import.meta.url), 'utf8')
const types = readFileSync(new URL('../esl/hanshow-allstar/types.ts', import.meta.url), 'utf8')
const testRoute = readFileSync(new URL('../server/api/integrations/hanshow-allstar/test.post.ts', import.meta.url), 'utf8')
const queryRoute = readFileSync(new URL('../server/api/integrations/hanshow-allstar/query-articles.post.ts', import.meta.url), 'utf8')
const bindRoute = readFileSync(new URL('../server/api/integrations/hanshow-allstar/bind-labels.post.ts', import.meta.url), 'utf8')
const flashRoute = readFileSync(new URL('../server/api/integrations/hanshow-allstar/flash-labels.post.ts', import.meta.url), 'utf8')
const composable = readFileSync(new URL('../app/composables/useIntegrations.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/pages/integrations.vue', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../core/db/087_hanshow_esl.sql', import.meta.url), 'utf8')
const todo = readFileSync(new URL('../TODO.md', import.meta.url), 'utf8')

test('Hanshow password hash matches HS-ALLSTAR-V220005 example', () => {
  const hashed = createHash('md5').update('000000AAA-admin', 'utf8').digest('hex').toUpperCase()
  assert.equal(hashed, '3236864BD3FA4A82D45FA98B82065938')
  assert.match(client, /hashHanshowPassword/)
  assert.match(client, /md5/)
  assert.match(client, /password\}\$\{username\}/)
})

test('Hanshow client uses documented All-Star routes', () => {
  assert.match(client, /\/proxy\/allstar\/oauth\/token/)
  assert.match(client, /grant_type/)
  assert.match(client, /Basic \$\{basicAuth/)
  assert.match(client, /\/proxy\/allstar\/v2\/pda\/articles\//)
  assert.match(client, /\/proxy\/openapi3\/store\/links/)
  assert.match(client, /\/proxy\/openapi3\/store\/labels\/control/)
  assert.match(client, /\/proxy\/openapi3\/store\/links\/articles\/control/)
  assert.match(client, /customerCode=/)
  assert.match(client, /hanshowPushArticlesBlockedMessage/)
  assert.match(types, /HanshowCredentials/)
})

test('Hanshow server routes require workspace access and log executions', () => {
  assert.match(testRoute, /hanshow-allstar/)
  assert.match(testRoute, /loadIntegrationCredential/)
  assert.match(queryRoute, /query_articles/)
  assert.match(queryRoute, /startIntegrationExecution/)
  assert.match(bindRoute, /bind_labels/)
  assert.match(flashRoute, /flash_labels/)
  assert.match(flashRoute, /store Hanshow AP/)
})

test('Hanshow is a featured WIP connector on Integrations', () => {
  assert.match(composable, /\/api\/integrations\/hanshow-allstar\/test/)
  assert.match(composable, /queryHanshowArticles/)
  assert.match(composable, /flashHanshowLabels/)
  assert.match(page, /hanshow-allstar/)
  assert.match(page, /Hanshow All-Star ESL/)
  assert.match(page, />WIP</)
  assert.match(page, /isHanshowConnection/)
  assert.match(page, /Query articles/)
  assert.match(page, /Flash SKU/)
})

test('migration seeds hanshow-allstar node and TODO tracks the wait', () => {
  assert.match(migration, /'hanshow-allstar'/)
  assert.match(migration, /push_articles/)
  assert.match(migration, /WIP/)
  assert.match(todo, /Track \*\*HS\*\*/)
  assert.match(todo, /article import/)
  assert.match(todo, /store AP/)
})
