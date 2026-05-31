# WooCommerce Extension

The WooCommerce extension lives in `apps/woocommerce-plugin`.

## Implemented

- WordPress plugin header.
- WooCommerce admin settings page.
- API URL, connection token, signing secret settings.
- Product and variation COGS fields.
- Packaging and return cost fields.
- Signed API client.
- Order, refund, and product sync hooks.
- Static plugin validation.

## Install Locally

Copy `apps/woocommerce-plugin` into a WordPress installation:

```txt
wp-content/plugins/true-margin-tracker/
```

Then activate **True Margin Tracker** in WordPress and open WooCommerce > True Margin Tracker.

## Validation

```bash
pnpm --filter @tmt/woocommerce-plugin test
```

PHPUnit and PHPCS should be added once a WordPress test environment is installed.
