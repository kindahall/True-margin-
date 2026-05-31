# Owner Website License Bridge

Use this plugin when True Margin Tracker is sold from your own WordPress/WooCommerce website.

The bridge is not the merchant store connector. It runs on the owner website checkout, listens for paid WooCommerce orders, calls the True Margin Tracker API, and stores the issued license on the order.

## Release Package

```txt
release/true-margin-tracker-license-bridge.zip
```

The same ZIP is copied to:

```txt
apps/dashboard/public/downloads/true-margin-tracker-license-bridge.zip
```

## API Configuration

Set the same sales webhook secret on the API and in the plugin settings:

```bash
TMT_SALES_WEBHOOK_SECRET=server-only-sales-secret
TMT_REQUIRE_LICENSE=true
```

The plugin signs the raw JSON body with HMAC SHA-256 and sends the signature in:

```txt
X-TMT-Signature
```

The API endpoint is:

```http
POST /licenses/sales/webhook
```

## WordPress Setup

1. Install `true-margin-tracker-license-bridge.zip` on the owner website.
2. Activate WooCommerce first.
3. Open WooCommerce > TMT Licenses.
4. Enter the public API URL and the sales webhook secret.
5. Map product IDs for Starter, Growth, and Pro.

You can also open a product edit screen and set the True Margin Tracker plan directly on that product.

## Paid Order Payload

For a paid mapped product, the bridge sends:

```json
{
  "plan": "Growth",
  "billingEmail": "buyer@example.com",
  "externalOrderId": "woocommerce_5001",
  "externalCustomerId": "wordpress_7001",
  "provider": "woocommerce-owner-site"
}
```

The API returns the real license key. The bridge stores:

- `_tmtlb_license_id`
- `_tmtlb_license_key`
- `_tmtlb_license_plan`

The customer can see the license key in their WooCommerce order details and order email.

## Behavior

- Only paid orders issue a license.
- Unmapped products do nothing.
- The same order is idempotent and will not issue multiple licenses.
- If the API is not configured or rejects the signed request, the error is stored on the order and an order note is added.
- No sample orders, products, prices, or license keys are generated.

## Test

```bash
pnpm --filter @tmt/license-bridge-plugin test
pnpm release:plugins
pnpm verify:production
```
