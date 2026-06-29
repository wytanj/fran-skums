# WooCommerce Channel

This adapter connects SKUMS to WooCommerce through the official WordPress REST API path:

```text
/wp-json/wc/v3/products
```

The first supported runtime operation is inbound catalog pull:

- validate a WooCommerce store URL plus consumer key/secret
- fetch products in bounded pages
- normalize product, price, inventory, category, tag, image, and attribute data into SKUMS products
- write `integration_sync_mappings` keyed by WooCommerce product id so later pulls update the same SKUMS products

Write operations are intentionally scaffolded only. They should be enabled separately once product publishing rules, media upload behavior, and inventory ownership are explicit.
