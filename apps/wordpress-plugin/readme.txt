=== True Margin Tracker for WordPress ===
Contributors: artisaul
Tags: margin, analytics, catalog, profit, costs
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Sync WordPress catalog pages to True Margin Tracker without requiring WooCommerce.

== Description ==

True Margin Tracker for WordPress adds catalog product fields to public posts and pages, then syncs selected product pages to the True Margin Tracker API.

== Installation ==

1. Upload the `true-margin-tracker-wordpress` folder to `/wp-content/plugins/`.
2. Activate the plugin in WordPress.
3. Open True Margin Tracker.
4. Enter API URL, connection token, and signing secret.
5. Mark product pages as tracked and add SKU, price, and costs.

== Privacy ==

The plugin sends selected catalog product fields to the True Margin Tracker API only after an administrator saves an API URL and connection token.

== Security ==

Payloads sent to the SaaS API can be signed with HMAC SHA-256. Order-level margin requires a checkout integration such as WooCommerce or Shopify.
