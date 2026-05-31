# Testing

## Commands

```bash
pnpm test
pnpm lint
pnpm build
```

Focused checks:

```bash
pnpm --filter @tmt/margin-engine test
pnpm --filter @tmt/api test
pnpm --filter @tmt/shopify-app test
pnpm --filter @tmt/woocommerce-plugin test
pnpm --filter @tmt/dashboard lint
```

## Browser Verification

Run the API and dashboard:

```bash
pnpm --filter @tmt/api dev
pnpm --filter @tmt/dashboard dev
```

Open `http://localhost:3000` and verify:

- Dashboard loads without console errors.
- App copy is English.
- Data loads from the API contract and remains English-only.
- WooCommerce/WordPress plugin setup can save a connection token and signing secret.
- Repeated order webhooks do not duplicate orders or product revenue.
- CSV cost import applies to matching SKUs.
- Tables do not overlap on desktop or mobile widths.
- Product statuses show profit, warning, loss, or missing costs clearly.

If `4001` is already occupied, use:

```bash
PORT=4011 pnpm --filter @tmt/api dev
VITE_API_URL=http://localhost:4011 pnpm --filter @tmt/dashboard dev
```
