# @skums/types

Shared TypeScript type contracts for the SKUMS platform.

## Contracts

| Type | Defines |
|------|---------|
| `Perspective` | Multi-dimensional context (locale × market × currency × role × channels × industries) that determines what a user sees when looking at a SKU. |
| `Grant` | Authorization passed from one entity to another in the brand → distributor → retailer → channel-seller chain. |
| `AppManifest` | Declaration a vertical app makes about itself: industries, fields it adds, routes it provides, requirements it has. |
| `ChannelAdapter` | Contract every channel integration (Shopee, Shopify, etc.) implements: auth, push, pull, feed, validate. |

## Why these four

These are the only "load-bearing" abstractions in SKUMS. Everything else
in the codebase is a consumer of one or more of them.

- **Perspective** is the spine — every API call carries one, every UI is rendered against one.
- **Grant** is the trust chain — every action is checked against the grant chain back to a verified brand.
- **AppManifest** is the extension point — vertical apps (Skincare, Healthy Food, etc.) declare themselves via this.
- **ChannelAdapter** is the cascade — every channel integration plugs in via this contract.

## Usage

```typescript
import type {
  Perspective,
  Grant,
  AppManifest,
  ChannelAdapter,
  ProjectedSku,
} from '@skums/types'
```

## Stability

These contracts are evolving. Until v1.0, expect breaking changes.
After v1.0, breaking changes follow semver.
