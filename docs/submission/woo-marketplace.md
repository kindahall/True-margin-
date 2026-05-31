# Woo Marketplace Submission Checklist

Official references:

- Submit to Woo Marketplace: https://developer.woocommerce.com/docs/woo-marketplace/submitting-your-product/
- Extension developer guide: https://developer.woocommerce.com/extension-developer-guide/getting-started/

## Current Package Evidence

- Installable WooCommerce ZIP: `release/true-margin-tracker-woocommerce.zip`.
- Downloadable dashboard copy: `apps/dashboard/public/downloads/true-margin-tracker-woocommerce.zip`.
- Release manifest with SHA-256 checksum: `release/plugin-manifest.json`.
- Static checks cover required files, plugin headers, readme metadata, nonce/capability checks, signed API payloads, English UI copy, and PHP syntax.

## Woo Marketplace Requirements To Complete Externally

- Create or access a WooCommerce.com vendor profile.
- Submit the ZIP through the vendor dashboard.
- Run and pass required QIT checks: API, end-to-end, activation, security, PHPCompatibility, malware, and validation.
- Provide testing instructions for the critical merchant flow.
- Provide business details, support contact, product rationale, and revenue-share information.
- Confirm compatibility with current WooCommerce, WordPress, PHP, Cart/Checkout blocks where applicable, and commonly used Woo extensions.

## Critical Flow For Review

1. Install and activate WooCommerce.
2. Install `true-margin-tracker-woocommerce.zip`.
3. Open WooCommerce > True Margin Tracker.
4. Save API URL, connection token, and signing secret.
5. Test connection.
6. Edit a product and save COGS, packaging cost, and return cost.
7. Create or update an order.
8. Confirm the SaaS dashboard receives real order/product data.
9. Confirm uninstall removes saved plugin options.

## Product Page Draft

True Margin Tracker connects WooCommerce order, refund, and product cost data to a focused margin dashboard. Merchants can see product-level profitability after COGS, shipping, payment fees, ad spend, refunds, and returns.
