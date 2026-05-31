import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopifyApp } from "../src/app.js";
import type { ShopifyConfig } from "../src/config.js";
import { buildInstallUrl, buildSignedState, normalizeShopDomain, signInstallParams, verifyInstallParams } from "../src/oauth.js";
import { verifyShopifyOAuthHmac, verifyShopifyWebhookHmac } from "../src/security.js";
import { ShopifyInstallationStore } from "../src/storage.js";

const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env.NODE_ENV;

function testConfig(storageFile = ".data/test-shopify-installations.json"): ShopifyConfig {
  return {
    apiKey: "key",
    apiSecret: "shpss_test",
    appUrl: "https://shopify-app.example.com",
    dashboardUrl: "https://app.example.com",
    trueMarginApiUrl: "https://api.example.com",
    installSecret: "install_secret",
    storageFile,
    scopes: ["read_orders", "read_products"],
    apiVersion: "2026-04"
  };
}

function shopifyOAuthHmac(query: Record<string, string>, secret: string) {
  const message = Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

describe("shopify app helpers", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv == null) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.restoreAllMocks();
  });

  it("normalizes and validates shop domains", () => {
    expect(normalizeShopDomain("merchant-store.myshopify.com")).toBe("merchant-store.myshopify.com");
    expect(() => normalizeShopDomain("https://merchant-store.myshopify.com")).toThrow();
  });

  it("builds install URLs with configured scopes", () => {
    const url = buildInstallUrl("merchant-store.myshopify.com", testConfig(), "state_123");

    expect(url).toContain("client_id=key");
    expect(url).toContain("scope=read_orders%2Cread_products");
    expect(url).toContain("state=state_123");
  });

  it("verifies signed install params and signed OAuth state", () => {
    const shop = "merchant-store.myshopify.com";
    const expires = String(Date.now() + 60_000);
    const signature = signInstallParams("tenant_123", shop, expires, "install_secret");
    const context = verifyInstallParams({ tenantId: "tenant_123", shop, expires, signature }, "install_secret");
    const state = buildSignedState(context, "install_secret", Date.now() + 60_000);

    expect(context).toEqual({ tenantId: "tenant_123", shop });
    expect(state).toContain(".");
  });

  it("verifies OAuth HMAC", () => {
    const secret = "shpss_test";
    const query = {
      code: "abc",
      shop: "merchant-store.myshopify.com",
      state: "state_123",
      timestamp: "1779490000"
    };
    const message = "code=abc&shop=merchant-store.myshopify.com&state=state_123&timestamp=1779490000";
    const hmac = crypto.createHmac("sha256", secret).update(message).digest("hex");

    expect(verifyShopifyOAuthHmac({ ...query, hmac }, secret)).toBe(true);
    expect(verifyShopifyOAuthHmac({ ...query, hmac: "bad" }, secret)).toBe(false);
  });

  it("verifies webhook HMAC", () => {
    const secret = "shpss_test";
    const body = JSON.stringify({ id: 1 });
    const hmac = crypto.createHmac("sha256", secret).update(body).digest("base64");

    expect(verifyShopifyWebhookHmac(body, hmac, secret)).toBe(true);
    expect(verifyShopifyWebhookHmac(body, "bad", secret)).toBe(false);
  });

  it("completes OAuth, stores an encrypted token, registers webhooks, and notifies the API", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmt-shopify-"));
    const storageFile = join(dir, "installations.json");
    try {
      const config = testConfig(storageFile);
      const state = buildSignedState({ shop: "merchant-store.myshopify.com", tenantId: "tenant_123" }, config.installSecret, Date.now() + 60_000);
      const query = {
        code: "auth_code_123",
        shop: "merchant-store.myshopify.com",
        state,
        timestamp: "1779490000"
      };
      const hmac = shopifyOAuthHmac(query, config.apiSecret);
      const calls: string[] = [];
      globalThis.fetch = vi.fn(async (input) => {
        calls.push(String(input));
        if (String(input).endsWith("/admin/oauth/access_token")) {
          return new Response(JSON.stringify({
            access_token: "shpat_live_token",
            scope: "read_orders,read_products"
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (String(input).includes("/webhooks.json")) {
          return new Response(JSON.stringify({ webhook: { id: 1 } }), { status: 201, headers: { "content-type": "application/json" } });
        }
        if (String(input) === "https://api.example.com/stores/connect/shopify/callback") {
          return new Response(JSON.stringify({ connected: true }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch;

      const app = createShopifyApp(config);
      const response = await app.inject({
        method: "GET",
        url: `/api/shopify/callback?${new URLSearchParams({ ...query, hmac }).toString()}`
      });
      const rawStorage = await readFile(storageFile, "utf8");

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://app.example.com/integrations?shopify=installed");
      expect(calls.filter((call) => call.includes("/webhooks.json"))).toHaveLength(11);
      expect(rawStorage).toContain("enc:v1:");
      expect(rawStorage).not.toContain("shpat_live_token");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires HTTPS and configured secrets in production", () => {
    process.env.NODE_ENV = "production";

    expect(() => createShopifyApp({
      ...testConfig(),
      apiSecret: "",
      appUrl: "http://shopify-app.example.com"
    })).toThrow("Shopify API key, API secret, and install secret are required in production.");
    expect(() => createShopifyApp({
      ...testConfig(),
      appUrl: "http://shopify-app.example.com"
    })).toThrow("SHOPIFY_APP_URL must use HTTPS in production.");
  });

  it("verifies Shopify webhooks with raw body and forwards order payloads to the API", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmt-shopify-"));
    const storageFile = join(dir, "installations.json");
    try {
      const config = testConfig(storageFile);
      const store = new ShopifyInstallationStore(storageFile, config.installSecret);
      await store.upsert({
        shop: "merchant-store.myshopify.com",
        tenantId: "tenant_123",
        accessToken: "shpat_live_token",
        scope: "read_orders,read_products",
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        webhookTopics: ["orders/create"]
      });
      const body = JSON.stringify({
        id: 1001,
        total_price: "49.00",
        line_items: [{ product_id: 10, sku: "SKU-10", quantity: 1, price: "49.00" }]
      });
      const hmac = crypto.createHmac("sha256", config.apiSecret).update(body).digest("base64");
      let forwardedBody = "";
      globalThis.fetch = vi.fn(async (_input, init) => {
        forwardedBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ accepted: true }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;

      const app = createShopifyApp(config);
      const response = await app.inject({
        method: "POST",
        url: "/api/shopify/webhooks",
        headers: {
          "content-type": "application/json",
          "x-shopify-hmac-sha256": hmac,
          "x-shopify-shop-domain": "merchant-store.myshopify.com",
          "x-shopify-topic": "orders/create"
        },
        payload: body
      });

      expect(response.statusCode).toBe(202);
      expect(JSON.parse(forwardedBody)).toMatchObject({
        id: 1001,
        tenantId: "tenant_123"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes stored installations when Shopify sends uninstall or shop redact webhooks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmt-shopify-"));
    const storageFile = join(dir, "installations.json");
    try {
      const config = testConfig(storageFile);
      const store = new ShopifyInstallationStore(storageFile, config.installSecret);
      await store.upsert({
        shop: "merchant-store.myshopify.com",
        tenantId: "tenant_123",
        accessToken: "shpat_live_token",
        scope: "read_orders,read_products",
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        webhookTopics: ["app/uninstalled"]
      });
      const body = JSON.stringify({ id: 1 });
      const hmac = crypto.createHmac("sha256", config.apiSecret).update(body).digest("base64");

      const app = createShopifyApp(config);
      const response = await app.inject({
        method: "POST",
        url: "/api/shopify/webhooks",
        headers: {
          "content-type": "application/json",
          "x-shopify-hmac-sha256": hmac,
          "x-shopify-shop-domain": "merchant-store.myshopify.com",
          "x-shopify-topic": "app/uninstalled"
        },
        payload: body
      });

      expect(response.statusCode).toBe(202);
      expect(await store.list()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
