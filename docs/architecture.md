# Architecture

True Margin Tracker is a global, English-first SaaS for Shopify and WooCommerce merchants who need a cheaper and simpler way to understand real product profitability.

## Apps

- `apps/api`: Fastify API for stores, products, analytics, alerts, webhooks, and sync entry points.
- `apps/dashboard`: React/Vite merchant dashboard.
- `apps/shopify-app`: Shopify OAuth and webhook security skeleton.
- `apps/woocommerce-plugin`: Installable WordPress/WooCommerce extension.
- `apps/wordpress-plugin`: Installable WordPress catalog extension for non-WooCommerce sites.

## Packages

- `packages/margin-engine`: Pure deterministic margin calculations.
- `packages/shared`: Shared schemas and integration metadata.
- `packages/integrations`: Payment fee providers and integration helpers.

## Data

PostgreSQL is modeled in `prisma/schema.prisma`. Redis is reserved for sync jobs and webhook retry queues. Runtime state can persist through `TMT_DATA_FILE` for development/self-hosted installs or through Prisma/PostgreSQL with `TMT_PERSISTENCE_DRIVER=prisma`.

When `TMT_REQUIRE_AUTH=true`, dashboard requests use bearer sessions and resolve to a tenant workspace. Runtime tenant state is stored separately for each account, and WooCommerce/WordPress plugin webhooks are routed to the tenant that owns the saved connection token. External event IDs are stored for idempotency.
