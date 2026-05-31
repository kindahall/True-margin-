import type { ShopifyConfig } from "./config.js";

export interface ShopifyTokenExchange {
  accessToken: string;
  scope: string;
}

export const webhookTopics = [
  "orders/create",
  "orders/updated",
  "orders/paid",
  "refunds/create",
  "products/create",
  "products/update",
  "app/uninstalled",
  "shop/update",
  "customers/data_request",
  "customers/redact",
  "shop/redact"
] as const;

export async function exchangeAuthorizationCode(shop: string, code: string, config: ShopifyConfig): Promise<ShopifyTokenExchange> {
  const body = new URLSearchParams({
    client_id: config.apiKey,
    client_secret: config.apiSecret,
    code
  });

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body,
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: unknown; scope?: unknown; error_description?: string; error?: string };
  if (!response.ok || typeof payload.access_token !== "string" || typeof payload.scope !== "string") {
    throw new Error(payload.error_description ?? payload.error ?? "Shopify token exchange failed.");
  }

  return {
    accessToken: payload.access_token,
    scope: payload.scope
  };
}

export function missingRequiredScopes(requiredScopes: string[], grantedScope: string) {
  const granted = new Set(grantedScope.split(",").map((scope) => scope.trim()).filter(Boolean));
  return requiredScopes.filter((scope) => !granted.has(scope));
}

export async function registerWebhookSubscriptions(shop: string, accessToken: string, config: ShopifyConfig) {
  const address = new URL("/api/shopify/webhooks", config.appUrl).toString();
  const results: Array<{ topic: string; ok: boolean; status: number }> = [];
  for (const topic of webhookTopics) {
    const response = await fetch(`https://${shop}/admin/api/${config.apiVersion}/webhooks.json`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-shopify-access-token": accessToken
      },
      body: JSON.stringify({
        webhook: {
          topic,
          address,
          format: "json"
        }
      }),
      signal: AbortSignal.timeout(10000)
    });
    results.push({ topic, ok: response.ok || response.status === 422, status: response.status });
  }
  return results;
}

export async function notifyTrueMarginInstall(shop: string, tenantId: string, config: ShopifyConfig) {
  if (!config.trueMarginApiUrl || !config.installSecret) return;
  const response = await fetch(new URL("/stores/connect/shopify/callback", config.trueMarginApiUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.installSecret}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ shop, tenantId }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? "True Margin Tracker API rejected the Shopify install.");
  }
}

export async function forwardShopifyWebhookToApi(payload: unknown, tenantId: string, config: ShopifyConfig) {
  if (!config.trueMarginApiUrl) return;
  await fetch(new URL("/webhooks/shopify", config.trueMarginApiUrl), {
    method: "POST",
    headers: {
      ...(config.installSecret ? { authorization: `Bearer ${config.installSecret}` } : {}),
      "content-type": "application/json"
    },
    body: JSON.stringify({ ...(payload && typeof payload === "object" ? payload : { payload }), tenantId }),
    signal: AbortSignal.timeout(10000)
  });
}
