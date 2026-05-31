# Setup

## Requirements

- Node.js 20+.
- pnpm 11.
- Docker for local PostgreSQL and Redis.
- PHP 8.1+ and WordPress/WooCommerce for installing the WooCommerce extension.

## Install

```bash
pnpm install
cp .env.example .env
docker compose up -d
```

## Development

```bash
pnpm --filter @tmt/api dev
pnpm --filter @tmt/dashboard dev
```

API: `http://localhost:4001`  
Dashboard: `http://localhost:3000`

If port `4001` is already used, run the API on another port and point the dashboard to it:

```bash
PORT=4011 pnpm --filter @tmt/api dev
VITE_API_URL=http://localhost:4011 pnpm --filter @tmt/dashboard dev
```

## Validation

```bash
pnpm test
pnpm lint
pnpm build
pnpm release:plugins
pnpm verify:production
```

For local development, run the API and dashboard together so the dashboard uses the API contract. In production, data comes from connected Shopify, WooCommerce, and WordPress stores through the sync and webhook entry points.

## Persistent State

The API supports two persistence drivers for synced products, orders, plugin credentials, workspace settings, cost rules, and license state:

- `file`: stores state in `TMT_DATA_FILE`, or `.data/true-margin-tracker-state.json` outside tests.
- `prisma`: stores state in PostgreSQL through Prisma.

Self-hosted/dev file mode:

```bash
TMT_PERSISTENCE_DRIVER=file
TMT_DATA_FILE=/var/lib/true-margin-tracker/state.json
```

Public SaaS PostgreSQL mode:

```bash
TMT_PERSISTENCE_DRIVER=prisma
TMT_TENANT_ID=production
DATABASE_URL=postgresql://...
pnpm --filter @tmt/api db:migrate
```

## Accounts

For a public SaaS install, require a merchant account before dashboard data can be read or changed:

```bash
TMT_REQUIRE_AUTH=true
```

The dashboard uses `POST /auth/register`, `POST /auth/login`, and bearer sessions automatically. Each account gets its own workspace state for stores, products, orders, costs, settings, and license activation. Plugin webhooks are routed back to the correct workspace by the connection token saved during Plugin Setup.

Set a stable secret before saving plugin connections so tokens and signing secrets are encrypted in persisted state:

```bash
TMT_SECRET_ENCRYPTION_KEY=generate-a-long-random-value
```

Public endpoints are rate limited in memory by default. Tune the limits per deployment:

```bash
TMT_RATE_LIMIT_WINDOW_MS=60000
TMT_AUTH_RATE_LIMIT=20
TMT_BILLING_RATE_LIMIT=40
TMT_WEBHOOK_RATE_LIMIT=600
```

## Shopify

Run the Shopify app service beside the API and dashboard when you want Shopify installs:

```bash
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=https://shopify-app.your-domain.com
DASHBOARD_URL=https://app.your-domain.com
TMT_API_URL=https://api.your-domain.com
TMT_SHOPIFY_INSTALL_SECRET=same-secret-as-api
SHOPIFY_INSTALLATION_FILE=/var/lib/true-margin-tracker/shopify-installations.json
pnpm --filter @tmt/shopify-app dev
```

Use the same `TMT_SHOPIFY_INSTALL_SECRET` in `apps/api`; it signs install links and allows the Shopify service to attach the store to the right merchant workspace.

## License Activation

For the main sales flow, sell True Margin Tracker from your own website and let the app activate the license after purchase.

Dashboard:

```bash
VITE_PURCHASE_URL=https://your-site.com/checkout
```

API:

```bash
TMT_LICENSE_ACTIVATE_URL=https://your-site.com/api/licenses/activate
TMT_LICENSE_API_TOKEN=server-to-server-token
```

Without `TMT_LICENSE_ACTIVATE_URL`, the License page stays honest and shows that activation is not configured.

You can also let this API issue licenses directly for your owner website checkout. Configure a private issuer token, then call `POST /licenses/issue` from your website backend after payment succeeds:

```bash
TMT_LICENSE_ISSUER_TOKEN=server-only-secret
TMT_REQUIRE_LICENSE=true
```

Request:

```json
{
  "plan": "Growth",
  "billingEmail": "buyer@example.com",
  "externalOrderId": "order_123"
}
```

The response contains the one-time visible `licenseKey` to send to the customer. The app activates it through `POST /license/activate`.

For webhook-style checkout integrations, sign the paid-order JSON body with HMAC SHA-256 and call `POST /licenses/sales/webhook`:

```bash
TMT_SALES_WEBHOOK_SECRET=another-server-only-secret
```

The signature goes in `X-TMT-Signature`. If `TMT_LICENSE_DELIVERY_URL` is configured, the API delivers the license to your website or email service before saving it.

If your owner website uses WooCommerce, install `release/true-margin-tracker-license-bridge.zip` instead of writing custom checkout code. The bridge maps paid products to Starter, Growth, or Pro, signs the webhook, and stores the returned license key on the WooCommerce order.

## Plugin Webhooks

WooCommerce and WordPress plugin settings include API URL, connection token, and signing secret. Once saved in Plugin Setup, the API expects incoming plugin webhooks to include `Authorization: Bearer <token>` and `X-TMT-Signature`, signed with HMAC SHA-256 over the JSON payload.

Shared production secrets can also be configured with:

```bash
TMT_WEBHOOK_TOKEN=
TMT_WEBHOOK_SIGNING_SECRET=
TMT_WOOCOMMERCE_WEBHOOK_TOKEN=
TMT_WOOCOMMERCE_WEBHOOK_SIGNING_SECRET=
TMT_WORDPRESS_WEBHOOK_TOKEN=
TMT_WORDPRESS_WEBHOOK_SIGNING_SECRET=
```

## Price Scout

Price Scout always reads the product URL directly. To compare against real market prices, connect a server-side price search provider:

```bash
TMT_PRICE_SEARCH_URL=https://your-search-provider.example.com/search
TMT_PRICE_SEARCH_PROVIDER=Provider Name
TMT_PRICE_SEARCH_TOKEN=server-token
TMT_PRICE_SEARCH_TIMEOUT_MS=8000
```

The app expects real provider results and shows no market matches when this is not configured.

## Optional Direct Checkout

The API still supports `POST /billing/checkout` for a future direct SaaS checkout path. Configure Stripe Billing only if you want the dashboard itself to open Stripe Checkout:

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_BILLING_PRICE_STARTER=price_...
STRIPE_BILLING_PRICE_GROWTH=price_...
STRIPE_BILLING_PRICE_PRO=price_...
APP_URL=https://your-app-domain.com
```

To issue licenses automatically after Stripe Checkout completes, add a Stripe webhook endpoint pointing to `/billing/stripe/webhook` and configure a delivery endpoint from your owner website or email service:

```bash
STRIPE_WEBHOOK_SECRET=whsec_...
TMT_LICENSE_DELIVERY_URL=https://your-site.com/api/licenses/deliver
TMT_LICENSE_DELIVERY_TOKEN=server-to-server-token
```

The Stripe Checkout session must include `metadata.plan` and `metadata.billing_email`. The API verifies the Stripe signature from the raw request body before it creates and delivers a license key.

## Deployment

Production Dockerfiles and a compose template are available:

- `apps/api/Dockerfile`
- `apps/dashboard/Dockerfile`
- `apps/shopify-app/Dockerfile`
- `docker-compose.production.yml`

See `docs/deployment.md` for required environment variables and deployment commands.
