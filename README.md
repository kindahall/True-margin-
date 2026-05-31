# True Margin Tracker

True Margin Tracker is a monorepo for a Shopify and WooCommerce margin-tracking product. It includes:

- Fastify API for tenants, billing, licensing, webhooks, integrations, and margin data.
- React/Vite dashboard.
- Shopify install and webhook bridge.
- WordPress, WooCommerce, and license bridge plugins.
- Shared margin engine, schemas, integration helpers, Docker configs, and production checks.

## Requirements

- Node.js 20+
- pnpm 11+
- PHP CLI for plugin smoke tests
- Docker for containerized production runs

## Quick Start

```bash
pnpm install
pnpm -r lint
pnpm test
pnpm build
pnpm verify:production
```

Copy `.env.example` to `.env` for local development and fill the required production secrets before deployment.

## Security Notes

Production mode is fail-closed for authentication and licensing unless explicitly overridden for an unsafe local test. Configure HTTPS URLs, signing secrets, webhook secrets, and encryption keys before exposing the services publicly.
