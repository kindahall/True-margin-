import { buildAlerts, overviewMetrics, summarizeProducts } from "./workspace.js";

const products = summarizeProducts();

console.log(
  JSON.stringify(
    {
      tenant: "tenant_local",
      stores: ["shopify", "woocommerce"],
      productCount: products.length,
      alertCount: buildAlerts(products).length,
      overview: overviewMetrics(products)
    },
    null,
    2
  )
);
