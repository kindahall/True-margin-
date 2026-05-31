export interface ShopifyConfig {
  apiKey: string;
  apiSecret: string;
  appUrl: string;
  dashboardUrl: string;
  trueMarginApiUrl: string;
  installSecret: string;
  storageFile: string;
  scopes: string[];
  apiVersion: string;
}

export function shopifyConfigFromEnv(env = process.env): ShopifyConfig {
  return {
    apiKey: env.SHOPIFY_API_KEY ?? "",
    apiSecret: env.SHOPIFY_API_SECRET ?? "",
    appUrl: env.SHOPIFY_APP_URL ?? env.APP_URL ?? "http://localhost:4100",
    dashboardUrl: env.DASHBOARD_URL ?? env.APP_URL ?? "http://localhost:3000",
    trueMarginApiUrl: env.TMT_API_URL ?? "http://localhost:4001",
    installSecret: env.TMT_SHOPIFY_INSTALL_SECRET ?? "",
    storageFile: env.SHOPIFY_INSTALLATION_FILE ?? ".data/shopify-installations.json",
    scopes: (env.SHOPIFY_SCOPES ?? "read_orders,read_products,read_inventory").split(",").map((scope) => scope.trim()).filter(Boolean),
    apiVersion: env.SHOPIFY_API_VERSION ?? "2026-04"
  };
}
