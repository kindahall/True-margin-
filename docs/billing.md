# License And Sales

True Margin Tracker is sold from the owner website first. Shopify, WooCommerce, and WordPress are installation channels for connected stores, not the primary checkout inside the dashboard.

## Plans

- Starter: one store, core margin tracking, manual/rule-based costs, CSV ad imports, in-app alerts.
- Growth: multiple stores, exact payment fees when connected, exports, advanced cost rules.
- Pro: higher order volume, API access, team members, advanced alerting.

## Primary Flow

1. The customer buys a plan on the owner website.
2. The owner website issues a license key.
3. The customer opens True Margin Tracker and activates the license.
4. The customer installs the Shopify app, WooCommerce plugin, or WordPress plugin.
5. Plan limits are enforced by the backend after license validation.

If the owner website runs WooCommerce, install the True Margin Tracker License Bridge on that website. It turns paid plan orders into signed license webhooks automatically and stores the returned license on the WooCommerce order.

## Team Access

Team members are available only on an active Pro license when `TMT_REQUIRE_LICENSE=true`.

```http
GET /team/members
POST /team/members
DELETE /team/members/:id
```

Owners and admins can add admins or members. Removed members lose active sessions.

## API Access

API keys are available only on an active Pro license when `TMT_REQUIRE_LICENSE=true`.

```http
GET /api-keys
POST /api-keys
DELETE /api-keys/:id
```

Generated API keys are shown once, stored as hashes, and limited to read-only requests.

## Dashboard License Activation

The dashboard opens `VITE_PURCHASE_URL` for plan purchases. It activates real licenses through:

```http
POST /license/activate
```

Required API environment:

- `TMT_LICENSE_ACTIVATE_URL`: HTTPS endpoint on the owner website or license service.

Optional API environment:

- `TMT_LICENSE_API_TOKEN`: bearer token used by the app API when it calls the license service.
- `TMT_LICENSE_ISSUER_TOKEN`: bearer token your owner website can use to issue a license directly through this API after payment.
- `TMT_REQUIRE_LICENSE`: when `true`, store connections are blocked until a license is active and plan limits are enforced.

Expected activation response:

```json
{
  "active": true,
  "plan": "Growth",
  "licenseId": "lic_123"
}
```

If `TMT_LICENSE_ACTIVATE_URL` is missing and no local license has been issued, the API returns `License activation is not configured` and the dashboard does not invent a plan.

## Local License Issuing

After a successful payment on the owner website, call:

```http
POST /licenses/issue
Authorization: Bearer <TMT_LICENSE_ISSUER_TOKEN>
```

with:

```json
{
  "plan": "Growth",
  "billingEmail": "buyer@example.com",
  "externalOrderId": "order_123"
}
```

The returned `licenseKey` is shown once and can be emailed to the customer. The dashboard activates the key on the License page and stores the active plan in the app state.

## WooCommerce Owner Website Bridge

Use `release/true-margin-tracker-license-bridge.zip` when your own sales website uses WooCommerce.

1. Configure `TMT_SALES_WEBHOOK_SECRET` on the API.
2. Install the bridge on the owner website.
3. Open WooCommerce > TMT Licenses.
4. Enter the API URL and the same sales webhook secret.
5. Map the Starter, Growth, and Pro WooCommerce products.

After payment, the bridge calls `POST /licenses/sales/webhook`, stores the returned license key on the order, and includes it in customer order details.

## Optional Direct Checkout

`POST /billing/checkout` still exists for a future direct SaaS checkout path. It can create a Stripe Billing Checkout Session when Stripe price IDs are configured, or open `TMT_CHECKOUT_URL` as an external fallback. It is not the primary customer path when sales happen on the owner website.
