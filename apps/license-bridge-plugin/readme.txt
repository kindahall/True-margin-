=== True Margin Tracker License Bridge ===
Contributors: artisaul
Tags: woocommerce, license, checkout, saas, subscriptions
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Issue True Margin Tracker licenses from a WooCommerce checkout on the owner website.

== Description ==

True Margin Tracker License Bridge connects the checkout on your own WooCommerce website to the True Margin Tracker license API. When a paid order contains a mapped plan product, the plugin signs a server-to-server request and stores the issued license on the order.

== Installation ==

1. Upload the `true-margin-tracker-license-bridge` folder to `/wp-content/plugins/`.
2. Activate the plugin in WordPress.
3. Open WooCommerce > TMT Licenses.
4. Enter the True Margin Tracker API URL and sales webhook secret.
5. Map Starter, Growth, and Pro products by product ID or set the plan on each product edit screen.

== Privacy ==

The plugin sends billing email, selected plan, WooCommerce order ID, and WordPress customer ID to the True Margin Tracker API only after a mapped plan order is paid.

== Security ==

License requests are signed with HMAC SHA-256 using the sales webhook secret. License keys are stored as protected WooCommerce order metadata.
