# API

Base URL in development: `http://localhost:4001`.

## Implemented Endpoints

```txt
GET  /health
GET  /me
POST /auth/register
POST /auth/login
POST /auth/logout
GET  /team/members
POST /team/members
DELETE /team/members/:id
GET  /api-keys
POST /api-keys
DELETE /api-keys/:id
GET  /stores
DELETE /stores/:platform
POST /stores/connect/woocommerce
POST /stores/connect/wordpress
POST /stores/connect/shopify/callback
POST /stores/:id/sync-now
GET  /analytics/overview
GET  /products
DELETE /products/:id
GET  /products/:id/margin
PATCH /products/:id/costs
POST /price-scout/analyze
POST /costs/import
GET  /cost-rules
POST /cost-rules
GET  /workspace/settings
POST /workspace/settings
GET  /billing
POST /billing
POST /billing/checkout
POST /billing/stripe/webhook
GET  /license/status
POST /license/activate
POST /licenses/issue
POST /licenses/sales/webhook
POST /licenses/:id/revoke
GET  /alerts/events
GET  /integrations
POST /integrations/validate
POST /webhooks/shopify
POST /webhooks/woocommerce
POST /webhooks/wordpress
```

When `TMT_REQUIRE_AUTH=true`, every merchant-facing endpoint requires `Authorization: Bearer <session token>`. Public server-to-server endpoints remain available for account creation/login, health checks, license issuing with the issuer token, and store webhooks with plugin tokens.

Pro API keys use the same bearer header and are read-only:

```http
Authorization: Bearer tmt_live_...
```

## Price Scout Market Search

`POST /price-scout/analyze` reads the submitted product URL, extracts product data from JSON-LD/meta/HTML, and optionally asks a configured price-search provider for real market matches.

Provider configuration:

```bash
TMT_PRICE_SEARCH_URL=https://your-search-provider.example.com/search
TMT_PRICE_SEARCH_PROVIDER=Provider Name
TMT_PRICE_SEARCH_TOKEN=server-token
TMT_PRICE_SEARCH_TIMEOUT_MS=8000
```

The provider must return JSON in either shape:

```json
{
  "matches": [
    {
      "title": "Product name",
      "url": "https://merchant.example/products/item",
      "priceMinor": 1599,
      "currency": "USD",
      "imageUrl": "https://merchant.example/image.jpg",
      "source": "merchant"
    }
  ]
}
```

or as a raw array of the same match objects. If no provider is configured, the API returns `market.status = "not_configured"` and does not invent competitors.

## Owner-Site Sales Webhook

Use `POST /licenses/sales/webhook` when checkout happens on your own website. The request body must be signed with `TMT_SALES_WEBHOOK_SECRET` using HMAC SHA-256 over the raw JSON body and sent in `X-TMT-Signature`.

```json
{
  "plan": "Growth",
  "billingEmail": "buyer@example.com",
  "externalOrderId": "paid_order_123",
  "externalCustomerId": "customer_123",
  "provider": "owner-site"
}
```

The endpoint returns a real `licenseKey` to the trusted caller. If `TMT_LICENSE_DELIVERY_URL` is configured, the API also delivers the license server-to-server before saving it.

## Next API Work

- Move webhook work into Redis/BullMQ jobs.
- Move in-memory rate limits to Redis before running multiple API instances.
- Add database-backed tenant isolation tests against PostgreSQL.
