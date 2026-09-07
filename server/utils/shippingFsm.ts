export const SHIPPING_STATUSES = [
  'intake',
  'quote',
  'booked',
  'pickup_scheduled',
  'in_transit',
  'arrived_sg',
  'delivered',
  'closed',
  'on_hold',
  'exception',
] as const

export type ShippingStatus = (typeof SHIPPING_STATUSES)[number]

const MAIN_FLOW: ShippingStatus[] = [
  'intake', 'quote', 'booked', 'pickup_scheduled', 'in_transit', 'arrived_sg', 'delivered', 'closed',
]

const SIDE: ShippingStatus[] = ["on_hold", "exception"]

export function canTransition(from: ShippingStatus, to: ShippingStatus): boolean {
  if (from === to) return true
  if (SIDE.includes(to)) return true
  if (SIDE.includes(from)) return MAIN_FLOW.includes(to) || SIDE.includes(to)
  const fi = MAIN_FLOW.indexOf(from)
  const ti = MAIN_FLOW.indexOf(to)
  if (fi < 0 || ti < 0) return false
  return ti === fi + 1 || ti >= fi
}

export function statusLabel(status: string): string {
  return String(status || "").replace(/_/g, " ")
}
