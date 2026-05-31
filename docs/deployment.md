# Deployment

True Margin Tracker ships as three deployable services:

- API: `apps/api`
- Dashboard: `apps/dashboard`
- Shopify OAuth/webhook service: `apps/shopify-app`

## Build Images

```bash
docker compose -f docker-compose.production.yml build
```

The production compose file expects secrets through environment variables and refuses to start when required values are missing.

## Required Production Variables

```bash
APP_URL=https://api.your-domain.com
DASHBOARD_URL=https://app.your-domain.com
TMT_API_URL=https://api.your-domain.com
VITE_API_URL=https://api.your-domain.com
VITE_PURCHASE_URL=https://your-domain.com/checkout
SHOPIFY_APP_URL=https://shopify-app.your-domain.com

POSTGRES_PASSWORD=
APP_SECRET=
TMT_SECRET_ENCRYPTION_KEY=
TMT_SALES_WEBHOOK_SECRET=
TMT_LICENSE_ISSUER_TOKEN=
TMT_SHOPIFY_INSTALL_SECRET=

SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
```

## Start

```bash
docker compose -f docker-compose.production.yml up -d
```

The API runs with:

- `TMT_PERSISTENCE_DRIVER=prisma`
- `TMT_REQUIRE_AUTH=true`
- `TMT_REQUIRE_LICENSE=true`

## Database

Run Prisma migrations before first production traffic:

```bash
DATABASE_URL=postgresql://true_margin_tracker:...@postgres:5432/true_margin_tracker pnpm --filter @tmt/api db:migrate
```

## Release Gate

Run locally and in CI:

```bash
pnpm lint
pnpm test
pnpm build
pnpm release:plugins
pnpm verify:production
```

## Notes

- Put HTTPS and routing in front of the containers through your host or reverse proxy.
- Keep dashboard `VITE_API_URL` pointed at the public API URL because it is baked into the static bundle at build time.
- Keep Shopify `SHOPIFY_APP_URL` stable; it must match the Partner Dashboard app URLs.
- Configure backups for PostgreSQL and the Shopify installation volume.
