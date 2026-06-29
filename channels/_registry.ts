/**
 * Channel registry.
 *
 * Registers every adapter under channels/ so the rest of the platform
 * can look one up by id. Adapters are added to this registry by
 * importing them in `_imports.ts` (separate file so static analyzers
 * don't get confused by side-effect-only imports here).
 *
 * Usage:
 *
 *   import { getChannelAdapter, listChannelAdapters } from '@/channels/_registry'
 *
 *   const shopee = getChannelAdapter('shopee_sg')
 *   if (shopee?.push?.create) await shopee.push.create(sku, creds)
 *
 * Once an adapter is implemented, it self-registers via:
 *
 *   import { registerChannelAdapter } from '@/channels/_registry'
 *   import adapter from './adapter'
 *   registerChannelAdapter(adapter)
 *
 * NOTE: this is the contract scaffold only. No adapters are
 * implemented yet. The first one (Shopee) lands in Phase E.
 */

import type { ChannelAdapter } from './_types'

const adapters = new Map<string, ChannelAdapter>()

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  if (adapters.has(adapter.id)) {
    throw new Error(`Channel adapter "${adapter.id}" is already registered`)
  }
  adapters.set(adapter.id, adapter)
}

export function getChannelAdapter(id: string): ChannelAdapter | undefined {
  return adapters.get(id)
}

export function listChannelAdapters(): ChannelAdapter[] {
  return Array.from(adapters.values())
}

export function listChannelAdapterIds(): string[] {
  return Array.from(adapters.keys())
}

/**
 * For testing: clear the registry. Should not be called in production code.
 */
export function _resetChannelRegistry(): void {
  adapters.clear()
}
