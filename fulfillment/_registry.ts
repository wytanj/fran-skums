import type { FulfillmentAdapter } from './_types'

const adapters = new Map<string, FulfillmentAdapter>()

export function registerFulfillmentAdapter(adapter: FulfillmentAdapter): void {
  if (adapters.has(adapter.id)) {
    throw new Error(`Fulfillment adapter "${adapter.id}" is already registered`)
  }
  adapters.set(adapter.id, adapter)
}

export function getFulfillmentAdapter(id: string): FulfillmentAdapter | undefined {
  return adapters.get(id)
}

export function listFulfillmentAdapters(): FulfillmentAdapter[] {
  return Array.from(adapters.values())
}

export function listFulfillmentAdapterIds(): string[] {
  return Array.from(adapters.keys())
}

export function _resetFulfillmentRegistry(): void {
  adapters.clear()
}
