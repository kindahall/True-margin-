# Security

## Required Controls

- Tenant isolation for every store, product, order, cost, alert, and sync job.
- HMAC verification for Shopify webhooks.
- HMAC signing for WooCommerce plugin payloads.
- Webhook idempotency using provider and external event ID.
- Encrypted credentials at rest.
- No secrets in logs.
- Rate limiting on public endpoints.
- Shopify privacy compliance webhooks before production submission.

## Current State

- Optional production auth is implemented with `TMT_REQUIRE_AUTH=true`, account registration/login/logout, bearer sessions, password hashing, and tenant-aware runtime state.
- Team management is Pro-gated, role-gated to owners/admins, and removes active sessions when a member is deleted.
- Pro API keys are shown once, stored as hashes, and limited to read-only requests.
- Tenant runtime data is separated per workspace for stores, products, orders, costs, settings, plugin credentials, and billing/license activation.
- Saved WooCommerce/WordPress plugin tokens and signing secrets are encrypted at rest when `TMT_SECRET_ENCRYPTION_KEY` or `APP_SECRET` is configured.
- Auth, billing/license, and webhook endpoints have configurable in-memory rate limits.
- Stripe checkout webhooks are verified with the raw request body and `Stripe-Signature` before a license can be issued.
- Shopify OAuth now uses signed install links, signed callback state, access token exchange, granted scope checks, encrypted token storage, webhook registration, and raw-body webhook HMAC verification.
- WooCommerce and WordPress plugin payloads are signed by the plugins and verified by the API when a plugin token/signing secret is configured.
- Plugin webhooks are routed to the workspace that owns the saved plugin token.
- WooCommerce and Shopify order webhooks are idempotent by order ID, so repeated deliveries update the same order instead of duplicating revenue.
- API validation is implemented for product cost updates.
- Prisma schema includes tenant IDs and webhook uniqueness.
- Runtime app state can persist to `TMT_DATA_FILE` for self-hosted/dev deployments or to PostgreSQL when `TMT_PERSISTENCE_DRIVER=prisma`.

## Remaining Controls

- Move rate limits to a shared store before running multiple API instances.
- Replace local Shopify installation file storage with database storage before running multiple Shopify app instances.
