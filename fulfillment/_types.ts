/**
 * Fulfillment adapter local re-export.
 *
 * The contract lives in `@skums/types`. This mirrors `channels/_types.ts` so
 * 3PL adapters can import from a short relative path.
 */

export type {
  FulfillmentAdapter,
  FulfillmentAddress,
  FulfillmentAuth,
  FulfillmentAuthFlow,
  FulfillmentCredentials,
  FulfillmentDirection,
  FulfillmentError,
  FulfillmentInventoryRecord,
  FulfillmentMode,
  FulfillmentMutationResult,
  FulfillmentOrderLine,
  FulfillmentPage,
  FulfillmentProductRecord,
  InboundShipmentLine,
  InboundShipmentRequest,
  StoreReplenishmentOrder,
} from '../packages/@skums-types/fulfillment-adapter'
