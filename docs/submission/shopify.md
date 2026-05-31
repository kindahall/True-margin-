# Shopify Submission Checklist

Official references:

- App Store requirements: https://shopify.dev/docs/apps/store/requirements
- Pass app review: https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review
- Submit app for review: https://shopify.dev/apps/launch/app-store-review/submit-app-for-review

## Current App Evidence

- Shopify OAuth service exists in `apps/shopify-app`.
- Dashboard install requests a signed install link from `/stores/connect/shopify/install-link`.
- Shopify callback attaches the store to the merchant workspace through `/stores/connect/shopify/callback`.
- Webhooks use HMAC verification before forwarding Shopify orders to the API.
- API and dashboard builds pass with `pnpm build`.

## Requirements To Verify In A Partner Account

- App install starts from Shopify-owned surfaces and immediately begins OAuth.
- The app redirects to the merchant UI after OAuth.
- The requested scopes are limited to the current feature set.
- App icon in the Partner Dashboard matches the app listing icon.
- Listing copy is accurate, English-only, and does not include unsupported claims or pricing outside the pricing section.
- A demo screencast covers onboarding, permission grant, connected dashboard, license activation or billing path, and uninstall behavior.
- Review credentials and testing instructions are complete.

## Listing Draft

Name: True Margin Tracker

Subtitle: Real product margin after every cost

Category: Store management / analytics

Supported language: English

Core value:

True Margin Tracker helps merchants see which products are profitable after product cost, shipping, payment fees, ad spend, refunds, and returns.

## Review Instructions Draft

1. Install the app on the provided Shopify development store.
2. Complete OAuth.
3. Open True Margin Tracker from Shopify admin.
4. Confirm the dashboard is empty until real store data is synced.
5. Create or sync an order with product cost fields.
6. Open Dashboard, Products, Orders, Costs, Plugin Setup, Settings, License, and Price Scout.
7. Activate a test license with the supplied license key.
8. Verify no page shows fake revenue or fake products.
