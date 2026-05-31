# UI Map

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Overview dashboard with real margin, revenue, ad cost, shipping, returns, fees, charts, top products, and alerts |
| `/price-scout` | Product URL scanner and margin floor calculator |
| `/products` | Product-level margin table with SKU, sales, COGS, ad cost, shipping, fees, returns, status, and filters |
| `/products/:id` | Product detail with cost breakdown, profitability trend, break-even CPA, recent orders, and quick insights |
| `/orders` | Order margin table and line-level margin details |
| `/costs` | COGS, shipping, packaging, returns, payment fee rules, and CSV import |
| `/alerts` | Non-profitable products, low margin products, rising costs, return risk, and suggested actions |
| `/integrations` | Shopify, WooCommerce, Stripe, PayPal, Meta Ads, TikTok Ads, Google Ads, shipping rules, and manual imports |
| `/settings` | Workspace defaults, currency, tax handling, language, and alert preferences |
| `/license` | Plan selection, owner-site purchase link, license activation, and account activity |

## Global Controls

- Search products, orders, alerts.
- Date range.
- Store selector.
- Notification menu.
- User/account menu.

## Required States

- Loading.
- Empty.
- Error/retry.
- No product revenue, margin, order, or alert data is shown until a store is connected.
- Exact, estimated, manual, imported, and rule-based cost source badges.
- Unknown status when COGS or critical costs are missing.
