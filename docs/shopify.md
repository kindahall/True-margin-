# Shopify App

The Shopify app lives in `apps/shopify-app`.

## Implemented

- Install URL builder.
- Shop domain validation.
- OAuth callback HMAC verification.
- Signed install links for connecting the Shopify install to the correct True Margin Tracker tenant.
- Authorization code exchange against Shopify's access token endpoint.
- Granted scope checks after token exchange.
- Encrypted offline access token storage.
- Webhook registration for orders, products, refunds, app uninstall, shop update, and privacy topics.
- Webhook HMAC verification.
- Raw request body verification for Shopify webhook signatures.
- Order webhook forwarding to the main True Margin Tracker API with tenant context.
- Configurable scopes and API version through environment variables.

## Default Config

```env
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=https://shopify-app.your-domain.com
DASHBOARD_URL=https://app.your-domain.com
TMT_API_URL=https://api.your-domain.com
TMT_SHOPIFY_INSTALL_SECRET=shared-server-secret
SHOPIFY_INSTALLATION_FILE=/var/lib/true-margin-tracker/shopify-installations.json
SHOPIFY_API_VERSION=2026-04
SHOPIFY_SCOPES=read_orders,read_products,read_inventory
```

## Production Notes

- Use Shopify GraphQL Admin API for new data sync work when it covers the required resource.
- Respond to webhooks quickly and process sync in async jobs.
- Configure `TMT_SHOPIFY_INSTALL_SECRET` with the same value in `apps/api` and `apps/shopify-app`.
- Add `https://shopify-app.your-domain.com/api/shopify/callback` as an allowed redirect URL in the Shopify Dev Dashboard.
- App Store submission still needs final Partner Dashboard metadata, screenshots, app icon, privacy policy URL, and review test credentials.
