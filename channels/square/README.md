# Square Channel Adapter

Phase 1 status: scaffolded contract only.

This adapter establishes the SKUMS-to-Square boundary for a headless POS channel:

- Map `ProjectedSku` into Square Catalog `ITEM` and `ITEM_VARIATION` objects.
- Normalize Square catalog, inventory, and order webhooks into SKUMS pull deltas.
- Validate required Square publish fields before any live push attempt.
- Keep live OAuth/API execution behind explicit connector work in later phases.

The initial implementation is intentionally non-networked. Push methods return a
`square_connector_not_configured` error until a Square API client, OAuth callback,
token storage, and idempotent catalog upsert flow are wired.

## Square Objects

- Catalog item: SKUMS product identity or listing content.
- Catalog item variation: SKUMS trade unit and seller SKU.
- Inventory count: SKUMS inventory level by location.
- Order: SKUMS POS sale or domain event, depending on direction.

## Follow-Up Implementation

1. Add OAuth start/callback routes and store credentials in `integration_credentials`.
2. Implement idempotent catalog object upserts using deterministic client object IDs.
3. Resolve Square location IDs to SKUMS `inventory_locations` and `pos_locations`.
4. Turn Square order webhooks into `pos_sales` plus `domain_events`.
5. Turn rejected catalog pushes into `listing_quality_findings` and attention items.
