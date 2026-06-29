# WorldSyntech OFS Fulfillment Adapter

WorldSyntech OFS is modeled as a fulfillment adapter, not a sales channel.

For LISE, the first mode is:

```text
Korea/Hong Kong suppliers -> Loft Logistics warehouse -> LISE physical stores
```

Primary API areas:

- `ship_to_warehouse/*` for inbound shipment notices and receiving status.
- `inventory/*` for Loft warehouse availability.
- `order/*` for store replenishment when OFS models outbound store movement as orders.
- `product/*` for SKU onboarding and new launches.
- address, country, zone, and delivery method endpoints as cached reference data.

Ecommerce fulfillment stays optional. Store replenishment should be named
`store_replenishment` or `warehouse_outbound` inside SKUMS so other 3PL apps
can reuse the same fulfillment boundary.
