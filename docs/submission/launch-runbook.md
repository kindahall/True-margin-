# Launch Runbook

This runbook covers the remaining steps that require real external accounts, stores, domains, or marketplace dashboards.

## Local Release Gate

Run before every submission:

```bash
pnpm lint
pnpm test
pnpm build
pnpm release:plugins
pnpm verify:production
```

Expected release outputs:

- `release/true-margin-tracker-woocommerce.zip`
- `release/true-margin-tracker-wordpress.zip`
- `release/true-margin-tracker-license-bridge.zip`
- `release/plugin-manifest.json`
- `release/marketplace-assets/`
- `release/wordpress-org/true-margin-tracker/`
- `release/wordpress-org/true-margin-tracker-wordpress/`
- `release/wordpress-org/true-margin-tracker-license-bridge/`

## Production Deployment

Use `docs/deployment.md` as the deployment source of truth. The production compose template includes API, dashboard, Shopify app, PostgreSQL, and Redis services.

## Owner Website Checkout

1. Publish the pricing page on the owner website.
2. If the owner website uses WooCommerce, install `release/true-margin-tracker-license-bridge.zip`.
3. Map plan products in WooCommerce > TMT Licenses.
4. For custom websites, send paid orders from the backend to `POST /licenses/sales/webhook`.
5. Sign the raw JSON body with `TMT_SALES_WEBHOOK_SECRET` and send the value in `X-TMT-Signature`.
6. Email or display the returned `licenseKey`, or configure `TMT_LICENSE_DELIVERY_URL` for server-side delivery.
7. Activate the key in the dashboard License page.

## Shopify

1. Create the Shopify Partner app.
2. Configure app URL, redirect URL, webhook URL, app icon, privacy policy, terms URL, support email, and review credentials.
3. Configure environment variables in production:

```bash
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=
DASHBOARD_URL=
TMT_API_URL=
TMT_SHOPIFY_INSTALL_SECRET=
```

4. Install on a development store.
5. Confirm OAuth, webhook delivery, product/order sync, license-gated limits, and uninstall behavior.
6. Record the app-review screencast from a real development store.
7. Submit with `docs/submission/shopify.md` and `docs/submission/listing-copy.md` as the source copy.

## WordPress.org

1. Submit each plugin slug for review.
2. After approval, check out the WordPress.org SVN repo.
3. Copy the generated `release/wordpress-org/<slug>/trunk`, `tags/0.1.0`, and `assets` contents into SVN.
4. Replace or keep generated banner/icon assets as desired.
5. Commit the approved release.

## Woo Marketplace

1. Create a vendor profile.
2. Upload `release/true-margin-tracker-woocommerce.zip`.
3. Run required QIT checks from the vendor dashboard.
4. Use `docs/submission/woo-marketplace.md` for review flow and product copy.
5. Test against a real WooCommerce store with HTTPS API endpoint and signed payloads.

## Owner Bridge Smoke Test

Use a private WooCommerce site that sells the app license:

1. Install `release/true-margin-tracker-license-bridge.zip`.
2. Configure the API URL and `TMT_SALES_WEBHOOK_SECRET`.
3. Map one test product to each plan.
4. Complete one paid test order per plan.
5. Confirm each order receives exactly one real license key.
6. Activate each key in the dashboard License page and verify the plan limits.

## Real Store Smoke Test

Use a non-production store with real test products and test orders:

1. Connect one channel.
2. Confirm the dashboard starts empty before sync.
3. Sync at least one real product.
4. Set COGS, packaging, return cost, and shipping rule.
5. Create one test order and one refund.
6. Verify Products, Orders, Costs, Alerts, Settings, License, and Price Scout.
7. Delete the product/order and confirm removal.

## Production Environment Checklist

- HTTPS domains for dashboard, API, Shopify app, and owner website.
- PostgreSQL persistence with migrations applied.
- Stable `APP_SECRET` and `TMT_SECRET_ENCRYPTION_KEY`.
- `TMT_REQUIRE_AUTH=true`.
- `TMT_REQUIRE_LICENSE=true`.
- Backups and restore test.
- Error monitoring and uptime checks.
- Support inbox and documented refund/cancellation process.
