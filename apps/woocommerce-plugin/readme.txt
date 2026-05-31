=== True Margin Tracker ===
Contributors: artisaul
Tags: woocommerce, margin, analytics, profit, costs
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect WooCommerce to True Margin Tracker and sync product costs, orders, refunds, and return assumptions.

== Description ==

True Margin Tracker helps merchants understand real product margin after COGS, shipping, payment fees, advertising, refunds, and returns.

== Installation ==

1. Upload the `true-margin-tracker` folder to `/wp-content/plugins/`.
2. Activate the plugin in WordPress.
3. Open WooCommerce > True Margin Tracker.
4. Enter API URL, connection token, and signing secret.
5. Add COGS and packaging costs to products or variations.

== Privacy ==

The plugin sends product, order, refund, and cost fields to the True Margin Tracker API only after an administrator saves an API URL and connection token.

== Security ==

Payloads sent to the SaaS API can be signed with HMAC SHA-256. Heavy margin calculations run in the SaaS backend, not during checkout.
