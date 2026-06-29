import posInventoryEventHandler from '../../../api/v1/pos/inventory-events.post'

export default defineEventHandler((event) => posInventoryEventHandler(event))
