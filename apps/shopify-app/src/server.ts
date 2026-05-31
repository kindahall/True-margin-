import { createShopifyApp } from "./app.js";

const app = createShopifyApp();
const port = Number(process.env.SHOPIFY_APP_PORT ?? 4100);

await app.listen({ port, host: "0.0.0.0" });
app.log.info(`True Margin Tracker Shopify app listening on http://0.0.0.0:${port}`);
