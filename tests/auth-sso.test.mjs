import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const loginPage = readFileSync(new URL('../app/pages/auth/login.vue', import.meta.url), 'utf8')
const confirmPage = readFileSync(new URL('../app/pages/auth/confirm.vue', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../core/db/038_auth_identity.sql', import.meta.url), 'utf8')
const migrationsDoc = readFileSync(new URL('../core/db/MIGRATIONS.md', import.meta.url), 'utf8')

test('login preserves safe local redirects through email and Google auth', () => {
  assert.match(loginPage, /function getSafeRedirect\(\): string/)
  assert.match(loginPage, /!redirect\.startsWith\('\/'\)/)
  assert.match(loginPage, /redirect\.startsWith\('\/\/'\)/)
  assert.match(loginPage, /redirect\.startsWith\('\/auth\/'\)/)
  assert.match(loginPage, /emailRedirectTo: getAuthCallbackUrl\(\)/)
  assert.match(loginPage, /redirectTo: getAuthCallbackUrl\(\)/)
  assert.match(loginPage, /router\.push\(getSafeRedirect\(\)\)/)
})

test('auth confirm waits for Supabase session hydration before redirecting', () => {
  assert.match(confirmPage, /const user = useSupabaseUser\(\)/)
  assert.match(confirmPage, /watch\(user/)
  assert.match(confirmPage, /setTimeout\(\(\) => \{ unwatch\(\); resolve\(\) \}, 3000\)/)
  assert.match(confirmPage, /router\.replace\(getSafeRedirect\(\)\)/)
})

test('Google SSO profile metadata is normalized by migration 038', () => {
  assert.match(migrationsDoc, /\|\s*038\s*\|\s*auth_identity\.sql\s*\|/)
  assert.match(migration, /create or replace function public\.handle_new_user\(\)/i)
  assert.match(migration, /new\.raw_user_meta_data ->> 'full_name'/)
  assert.match(migration, /new\.raw_user_meta_data ->> 'name'/)
  assert.match(migration, /new\.raw_user_meta_data ->> 'user_name'/)
  assert.match(migration, /new\.raw_user_meta_data ->> 'avatar_url'/)
  assert.match(migration, /new\.raw_user_meta_data ->> 'picture'/)
  assert.match(migration, /new\.email/)
})
