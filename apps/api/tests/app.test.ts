import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, extractProductFromHtml } from "../src/app.js";

const originalFetch = globalThis.fetch;
const checkoutEnvKeys = [
  "APP_URL",
  "TMT_CHECKOUT_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_BILLING_PRICE_STARTER",
  "STRIPE_BILLING_PRICE_GROWTH",
  "STRIPE_BILLING_PRICE_PRO",
  "STRIPE_CHECKOUT_SUCCESS_URL",
  "STRIPE_CHECKOUT_CANCEL_URL",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_TOLERANCE_SECONDS",
  "TMT_LICENSE_ACTIVATE_URL",
  "TMT_LICENSE_API_TOKEN",
  "TMT_LICENSE_DELIVERY_URL",
  "TMT_LICENSE_DELIVERY_TOKEN",
  "TMT_LICENSE_ISSUER_TOKEN",
  "TMT_SALES_WEBHOOK_SECRET",
  "TMT_REQUIRE_AUTH",
  "TMT_REQUIRE_LICENSE",
  "TMT_SECRET_ENCRYPTION_KEY",
  "TMT_RATE_LIMIT_DISABLED",
  "TMT_RATE_LIMIT_WINDOW_MS",
  "TMT_AUTH_RATE_LIMIT",
  "TMT_BILLING_RATE_LIMIT",
  "TMT_WEBHOOK_RATE_LIMIT",
  "TMT_EXTERNAL_RATE_LIMIT",
  "TMT_BODY_LIMIT_BYTES",
  "TMT_REMOTE_RESPONSE_LIMIT_BYTES",
  "TMT_CORS_ORIGINS",
  "TMT_ALLOW_UNSAFE_PRODUCTION",
  "DASHBOARD_URL",
  "SHOPIFY_APP_URL",
  "TMT_SHOPIFY_INSTALL_SECRET",
  "TMT_DATA_FILE",
  "TMT_PERSISTENCE_DRIVER",
  "TMT_TENANT_ID",
  "TMT_DISABLE_PERSISTENCE",
  "TMT_WEBHOOK_TOKEN",
  "TMT_WEBHOOK_SIGNING_SECRET",
  "TMT_WOOCOMMERCE_WEBHOOK_TOKEN",
  "TMT_WOOCOMMERCE_WEBHOOK_SIGNING_SECRET",
  "TMT_WORDPRESS_WEBHOOK_TOKEN",
  "TMT_WORDPRESS_WEBHOOK_SIGNING_SECRET",
  "TMT_PRICE_SEARCH_URL",
  "TMT_PRICE_SEARCH_PROVIDER",
  "TMT_PRICE_SEARCH_TOKEN",
  "TMT_PRICE_SEARCH_TIMEOUT_MS"
] as const;
const originalCheckoutEnv = Object.fromEntries(checkoutEnvKeys.map((key) => [key, process.env[key]])) as Partial<Record<typeof checkoutEnvKeys[number], string>>;
const originalNodeEnv = process.env.NODE_ENV;

function restoreCheckoutEnv() {
  for (const key of checkoutEnvKeys) {
    if (originalCheckoutEnv[key] == null) {
      delete process.env[key];
    } else {
      process.env[key] = originalCheckoutEnv[key];
    }
  }
}

function clearCheckoutEnv() {
  for (const key of checkoutEnvKeys) {
    delete process.env[key];
  }
}

describe("api", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreCheckoutEnv();
    if (originalNodeEnv == null) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.restoreAllMocks();
  });

  it("serves health checks", async () => {
    const app = createApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
  });

  it("returns an empty overview until a store is connected", async () => {
    const app = createApp();
    const response = await app.inject({ method: "GET", url: "/analytics/overview" });
    const payload = response.json();

    expect(response.statusCode).toBe(200);
    expect(payload.metrics.currency).toBe("USD");
    expect(payload.metrics.revenueMinor).toBe(0);
    expect(payload.topProducts).toEqual([]);
    expect(payload.alerts).toEqual([]);
  });

  it("validates cost update payloads", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/products/wireless-headphones/costs",
      payload: {
        cogsMinor: -10
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("parses cost CSV imports", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/costs/import",
      payload: {
        csv: "sku,cogs,packaging,return\nABC-1,12.50,1.20,2.00"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      saved: true,
      importedRows: 1
    });
  });

  it("stores incoming WooCommerce order webhooks for the orders page", async () => {
    const app = createApp();
    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/woocommerce",
      payload: {
        event: "order_updated",
        orderId: 1234,
        total: "59.00",
        shippingTotal: "5.00",
        lines: [
          {
            productId: "prod_1",
            sku: "ABC-1",
            quantity: 2,
            total: "59.00",
            cogs: "12.00"
          }
        ]
      }
    });
    const orders = await app.inject({ method: "GET", url: "/orders" });

    expect(webhook.statusCode).toBe(200);
    expect(webhook.json()).toMatchObject({ accepted: true, importedOrder: true });
    expect(orders.json().orders).toHaveLength(1);
    expect(orders.json().orders[0]).toMatchObject({
      sourceOrderId: "1234",
      channel: "WooCommerce",
      revenueMinor: 5900,
      trueMarginMinor: 3000,
      status: "profitable"
    });
  });

  it("keeps repeated order webhooks idempotent", async () => {
    const app = createApp();
    const payload = {
      id: 1234,
      total: "59.00",
      shippingTotal: "5.00",
      lines: [
        {
          productId: "prod_1",
          sku: "ABC-1",
          name: "Desk Lamp",
          quantity: 1,
          total: "59.00",
          cogs: "24.00"
        }
      ]
    };

    await app.inject({ method: "POST", url: "/webhooks/woocommerce", payload });
    await app.inject({ method: "POST", url: "/webhooks/woocommerce", payload });
    const orders = await app.inject({ method: "GET", url: "/orders" });
    const products = await app.inject({ method: "GET", url: "/products" });

    expect(orders.json().orders).toHaveLength(1);
    expect(products.json().products).toHaveLength(1);
    expect(products.json().products[0]).toMatchObject({
      sku: "ABC-1",
      unitsSold: 1,
      revenueMinor: 5900
    });
  });

  it("requires an account when production auth is enabled", async () => {
    clearCheckoutEnv();
    process.env.TMT_REQUIRE_AUTH = "true";
    const app = createApp();

    const blocked = await app.inject({ method: "GET", url: "/products" });
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "owner@example.com",
        password: "secure-password",
        name: "Store Owner",
        workspaceName: "Owner Store"
      }
    });
    const token = registered.json().token as string;
    const products = await app.inject({
      method: "GET",
      url: "/products",
      headers: { authorization: `Bearer ${token}` }
    });
    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(blocked.statusCode).toBe(401);
    expect(registered.statusCode).toBe(201);
    expect(products.statusCode).toBe(200);
    expect(products.json().products).toEqual([]);
    expect(me.json()).toMatchObject({
      email: "owner@example.com",
      workspaceName: "Owner Store",
      tenantId: expect.stringMatching(/^tenant_/)
    });
  });

  it("fails closed for auth and license gates in production by default", async () => {
    clearCheckoutEnv();
    process.env.NODE_ENV = "production";
    const app = createApp();

    const blocked = await app.inject({ method: "GET", url: "/products" });
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "prod-owner@example.com",
        password: "secure-password",
        workspaceName: "Production Store"
      }
    });
    const token = registered.json().token as string;
    const store = await app.inject({
      method: "POST",
      url: "/stores/connect/woocommerce",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Production Woo",
        connectionToken: "prod_token_123",
        signingSecret: "prod_secret_123"
      }
    });

    expect(blocked.statusCode).toBe(401);
    expect(registered.statusCode).toBe(201);
    expect(store.statusCode).toBe(402);
    expect(store.json().error).toBe("Activate a license before connecting a store.");
  });

  it("isolates client workspaces and routes plugin webhooks by connection token", async () => {
    clearCheckoutEnv();
    process.env.TMT_REQUIRE_AUTH = "true";
    const app = createApp();
    const accountA = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "a@example.com",
        password: "secure-password",
        workspaceName: "Store A"
      }
    });
    const accountB = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "b@example.com",
        password: "secure-password",
        workspaceName: "Store B"
      }
    });
    const tokenA = accountA.json().token as string;
    const tokenB = accountB.json().token as string;

    await app.inject({
      method: "POST",
      url: "/stores/connect/woocommerce",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Store A Woo",
        connectionToken: "woo_token_a",
        signingSecret: "woo_secret_a"
      }
    });
    const payload = {
      id: 2468,
      total: "40.00",
      lines: [{ productId: "prod_a", sku: "A-1", name: "Tenant Product", quantity: 1, total: "40.00", cogs: "11.00" }]
    };
    const rawPayload = JSON.stringify(payload);
    const signature = createHmac("sha256", "woo_secret_a").update(rawPayload).digest("hex");
    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/woocommerce",
      headers: {
        authorization: "Bearer woo_token_a",
        "x-tmt-signature": signature,
        "content-type": "application/json"
      },
      payload: rawPayload
    });
    const productsA = await app.inject({
      method: "GET",
      url: "/products",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const productsB = await app.inject({
      method: "GET",
      url: "/products",
      headers: { authorization: `Bearer ${tokenB}` }
    });

    expect(webhook.statusCode).toBe(200);
    expect(productsA.json().products).toHaveLength(1);
    expect(productsA.json().products[0]).toMatchObject({ sku: "A-1", title: "Tenant Product" });
    expect(productsB.json().products).toEqual([]);
  });

  it("rate limits repeated account attempts", async () => {
    clearCheckoutEnv();
    process.env.TMT_AUTH_RATE_LIMIT = "2";
    process.env.TMT_RATE_LIMIT_WINDOW_MS = "60000";
    const app = createApp();
    const payload = {
      email: "missing@example.com",
      password: "wrong-password"
    };

    const first = await app.inject({ method: "POST", url: "/auth/login", payload });
    const second = await app.inject({ method: "POST", url: "/auth/login", payload });
    const third = await app.inject({ method: "POST", url: "/auth/login", payload });

    expect(first.statusCode).toBe(401);
    expect(second.statusCode).toBe(401);
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ error: "Too many requests. Try again shortly." });
  });

  it("creates signed Shopify install links and accepts internal install callbacks", async () => {
    clearCheckoutEnv();
    process.env.TMT_REQUIRE_AUTH = "true";
    process.env.SHOPIFY_APP_URL = "https://shopify-app.example.com";
    process.env.TMT_SHOPIFY_INSTALL_SECRET = "install_secret_123";
    const app = createApp();
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "shopify-owner@example.com",
        password: "secure-password",
        workspaceName: "Shopify Workspace"
      }
    });
    const token = registered.json().token as string;
    const tenantId = registered.json().user.tenantId as string;
    const link = await app.inject({
      method: "POST",
      url: "/stores/connect/shopify/install-link",
      headers: { authorization: `Bearer ${token}` },
      payload: { shop: "merchant-store.myshopify.com" }
    });
    const installUrl = new URL(link.json().installUrl as string);
    const callback = await app.inject({
      method: "POST",
      url: "/stores/connect/shopify/callback",
      headers: { authorization: "Bearer install_secret_123" },
      payload: {
        tenantId,
        shop: "merchant-store.myshopify.com"
      }
    });
    const stores = await app.inject({
      method: "GET",
      url: "/stores",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(link.statusCode).toBe(200);
    expect(installUrl.origin).toBe("https://shopify-app.example.com");
    expect(installUrl.searchParams.get("tenantId")).toBe(tenantId);
    expect(installUrl.searchParams.get("signature")).toBeTruthy();
    expect(callback.statusCode).toBe(200);
    expect(stores.json().stores).toMatchObject([{ platform: "shopify", name: "merchant-store.myshopify.com" }]);
  });

  it("gates team members behind an active Pro license", async () => {
    clearCheckoutEnv();
    process.env.TMT_REQUIRE_AUTH = "true";
    process.env.TMT_REQUIRE_LICENSE = "true";
    process.env.TMT_LICENSE_ISSUER_TOKEN = "issuer_secret_123";
    const app = createApp();
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "owner-team@example.com",
        password: "secure-password",
        name: "Owner",
        workspaceName: "Team Store"
      }
    });
    const ownerToken = registered.json().token as string;
    const blockedTeam = await app.inject({
      method: "POST",
      url: "/team/members",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        email: "member@example.com",
        password: "secure-password",
        role: "member"
      }
    });
    const issued = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: { authorization: "Bearer issuer_secret_123" },
      payload: {
        plan: "Pro",
        billingEmail: "buyer@example.com"
      }
    });
    await app.inject({
      method: "POST",
      url: "/license/activate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        licenseKey: issued.json().licenseKey,
        billingEmail: "buyer@example.com"
      }
    });
    const createdTeam = await app.inject({
      method: "POST",
      url: "/team/members",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Member",
        email: "member@example.com",
        password: "secure-password",
        role: "member"
      }
    });
    const memberLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "member@example.com",
        password: "secure-password"
      }
    });
    const team = await app.inject({
      method: "GET",
      url: "/team/members",
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    const removed = await app.inject({
      method: "DELETE",
      url: `/team/members/${createdTeam.json().member.id}`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });

    expect(blockedTeam.statusCode).toBe(402);
    expect(blockedTeam.json()).toMatchObject({ created: false, error: "Pro license required for team access." });
    expect(createdTeam.statusCode).toBe(201);
    expect(createdTeam.json().member).toMatchObject({ email: "member@example.com", role: "member" });
    expect(memberLogin.statusCode).toBe(200);
    expect(memberLogin.json().user).toMatchObject({ email: "member@example.com", role: "member" });
    expect(team.json()).toMatchObject({ allowed: true, plan: "Pro" });
    expect(team.json().members).toHaveLength(2);
    expect(removed.statusCode).toBe(200);
  });

  it("gates API keys behind Pro and keeps generated keys read-only", async () => {
    clearCheckoutEnv();
    process.env.TMT_REQUIRE_AUTH = "true";
    process.env.TMT_REQUIRE_LICENSE = "true";
    process.env.TMT_LICENSE_ISSUER_TOKEN = "issuer_secret_123";
    const app = createApp();
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "api-owner@example.com",
        password: "secure-password",
        name: "API Owner",
        workspaceName: "API Store"
      }
    });
    const ownerToken = registered.json().token as string;
    const blocked = await app.inject({
      method: "POST",
      url: "/api-keys",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Reporting" }
    });
    const issued = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: { authorization: "Bearer issuer_secret_123" },
      payload: {
        plan: "Pro",
        billingEmail: "buyer@example.com"
      }
    });
    await app.inject({
      method: "POST",
      url: "/license/activate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        licenseKey: issued.json().licenseKey,
        billingEmail: "buyer@example.com"
      }
    });
    const created = await app.inject({
      method: "POST",
      url: "/api-keys",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Reporting" }
    });
    const apiToken = created.json().token as string;
    const products = await app.inject({
      method: "GET",
      url: "/products",
      headers: { authorization: `Bearer ${apiToken}` }
    });
    const writeAttempt = await app.inject({
      method: "DELETE",
      url: "/stores/woocommerce",
      headers: { authorization: `Bearer ${apiToken}` }
    });
    const keys = await app.inject({
      method: "GET",
      url: "/api-keys",
      headers: { authorization: `Bearer ${ownerToken}` }
    });

    expect(blocked.statusCode).toBe(402);
    expect(blocked.json()).toMatchObject({ created: false, error: "Pro license required for API access." });
    expect(created.statusCode).toBe(201);
    expect(apiToken).toMatch(/^tmt_live_/);
    expect(products.statusCode).toBe(200);
    expect(writeAttempt.statusCode).toBe(403);
    expect(keys.json().keys[0]).toMatchObject({ name: "Reporting", prefix: apiToken.slice(0, 14) });
    expect(JSON.stringify(keys.json())).not.toContain(apiToken);
  });

  it("requires saved plugin token and signature for protected WooCommerce webhooks", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/stores/connect/woocommerce",
      payload: {
        name: "Protected Woo",
        connectionToken: "plugin_token_123",
        signingSecret: "plugin_secret_123"
      }
    });
    const payload = {
      id: 987,
      total: "29.00",
      lines: [{ productId: "prod_987", sku: "SEC-1", quantity: 1, total: "29.00", cogs: "9.00" }]
    };
    const rawPayload = JSON.stringify(payload);
    const signature = createHmac("sha256", "plugin_secret_123").update(rawPayload).digest("hex");

    const unsigned = await app.inject({ method: "POST", url: "/webhooks/woocommerce", payload });
    const signed = await app.inject({
      method: "POST",
      url: "/webhooks/woocommerce",
      headers: {
        authorization: "Bearer plugin_token_123",
        "x-tmt-signature": signature,
        "content-type": "application/json"
      },
      payload: rawPayload
    });

    expect(unsigned.statusCode).toBe(401);
    expect(signed.statusCode).toBe(200);
    expect(signed.json()).toMatchObject({ accepted: true, importedOrder: true });
  });

  it("requires plugin signing secrets when auth is required", async () => {
    clearCheckoutEnv();
    process.env.TMT_REQUIRE_AUTH = "true";
    const app = createApp();
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "plugin-owner@example.com",
        password: "secure-password",
        workspaceName: "Plugin Store"
      }
    });
    const token = registered.json().token as string;
    const response = await app.inject({
      method: "POST",
      url: "/stores/connect/woocommerce",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Unsigned Woo",
        connectionToken: "plugin_token_456"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      connected: false,
      error: "Connection token and signing secret are required."
    });
  });

  it("disconnects a store and clears its protected webhook credentials", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/stores/connect/woocommerce",
      payload: {
        name: "Protected Woo",
        connectionToken: "plugin_token_123",
        signingSecret: "plugin_secret_123"
      }
    });
    const disconnected = await app.inject({ method: "DELETE", url: "/stores/woocommerce" });
    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/woocommerce",
      payload: {
        id: 321,
        total: "19.00",
        lines: [{ productId: "prod_321", sku: "OPEN-1", quantity: 1, total: "19.00", cogs: "7.00" }]
      }
    });
    const stores = await app.inject({ method: "GET", url: "/stores" });

    expect(disconnected.statusCode).toBe(200);
    expect(disconnected.json()).toMatchObject({ disconnected: true, platform: "woocommerce" });
    expect(stores.json().stores).toEqual([]);
    expect(webhook.statusCode).toBe(200);
  });

  it("allows merchants to delete imported orders and their derived products", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/webhooks/woocommerce",
      payload: {
        id: 1234,
        total: "59.00",
        shippingTotal: "5.00",
        lines: [
          {
            productId: "prod_1",
            sku: "ABC-1",
            name: "Desk Lamp",
            quantity: 1,
            total: "59.00",
            cogs: "24.00"
          }
        ]
      }
    });
    const productsBefore = await app.inject({ method: "GET", url: "/products" });
    const deleted = await app.inject({ method: "DELETE", url: "/orders/woocommerce_1234" });
    const orders = await app.inject({ method: "GET", url: "/orders" });
    const products = await app.inject({ method: "GET", url: "/products" });

    expect(productsBefore.json().products).toHaveLength(1);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ deleted: true });
    expect(orders.json().orders).toEqual([]);
    expect(products.json().products).toEqual([]);
  });

  it("applies imported cost rows to matching synced products", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/webhooks/woocommerce",
      payload: {
        id: 444,
        total: "50.00",
        lines: [
          {
            productId: "prod_cost",
            sku: "COST-1",
            name: "Costed Product",
            quantity: 1,
            total: "50.00"
          }
        ]
      }
    });
    const before = await app.inject({ method: "GET", url: "/products" });
    const imported = await app.inject({
      method: "POST",
      url: "/costs/import",
      payload: {
        csv: "sku,cogs,packaging,return\nCOST-1,18.00,1.50,2.00"
      }
    });
    const after = await app.inject({ method: "GET", url: "/products" });

    expect(before.json().products[0].margin.status).toBe("unknown");
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ importedRows: 1, appliedRows: 1 });
    expect(after.json().products[0]).toMatchObject({
      sku: "COST-1",
      cogsMinor: 1800,
      packagingMinor: 150,
      returnsMinor: 200
    });
    expect(after.json().products[0].margin.status).toBe("profitable");
  });

  it("accepts WordPress catalog mode without creating fake orders", async () => {
    const app = createApp();
    const connection = await app.inject({
      method: "POST",
      url: "/stores/connect/wordpress",
      payload: {
        name: "Editorial Shop",
        siteUrl: "https://merchant.test",
        mode: "catalog"
      }
    });
    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/wordpress",
      payload: {
        event: "catalog_product_saved",
        productId: 42,
        title: "Landing Page Product",
        url: "https://merchant.test/landing-product",
        sku: "WP-42",
        price: "79.00",
        cogs: "31.00",
        packagingCost: "2.50",
        averageReturnCost: "0"
      }
    });
    const overview = await app.inject({ method: "GET", url: "/analytics/overview" });
    const orders = await app.inject({ method: "GET", url: "/orders" });

    expect(connection.statusCode).toBe(200);
    expect(connection.json()).toMatchObject({ connected: true, platform: "wordpress", mode: "catalog" });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.json()).toMatchObject({ accepted: true, importedProduct: true, mode: "catalog" });
    expect(orders.json().orders).toEqual([]);
    expect(overview.json().metrics.revenueMinor).toBe(0);
    expect(overview.json().topProducts[0]).toMatchObject({
      title: "Landing Page Product",
      channel: "WordPress",
      sku: "WP-42",
      unitsSold: 0
    });
  });

  it("allows merchants to delete WordPress catalog products", async () => {
    const app = createApp();
    await app.inject({
      method: "POST",
      url: "/webhooks/wordpress",
      payload: {
        productId: 42,
        title: "Landing Page Product",
        url: "https://merchant.test/landing-product",
        sku: "WP-42",
        price: "79.00",
        cogs: "31.00"
      }
    });
    const deleted = await app.inject({ method: "DELETE", url: "/products/wordpress_42" });
    const products = await app.inject({ method: "GET", url: "/products" });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ deleted: true, productId: "wordpress_42" });
    expect(products.json().products).toEqual([]);
  });

  it("validates local shipping-rule integrations without marking unsupported providers ready", async () => {
    const app = createApp();
    const shipping = await app.inject({
      method: "POST",
      url: "/integrations/validate",
      payload: { name: "Shipping Rules", endpoint: "manual" }
    });
    const ads = await app.inject({
      method: "POST",
      url: "/integrations/validate",
      payload: { name: "Google Ads", endpoint: "https://ads.google.com", token: "token" }
    });

    expect(shipping.statusCode).toBe(200);
    expect(shipping.json()).toMatchObject({ ok: true });
    expect(ads.statusCode).toBe(422);
    expect(ads.json()).toMatchObject({ ok: false });
  });

  it("rejects private network integration validation endpoints", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/integrations/validate",
      payload: {
        name: "WooCommerce",
        endpoint: "http://169.254.169.254/latest/meta-data",
        token: "consumer:secret"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: "Private or local URLs are not supported."
    });
  });

  it("rejects request bodies over the configured API limit", async () => {
    clearCheckoutEnv();
    process.env.TMT_BODY_LIMIT_BYTES = "32";
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/costs/import",
      payload: {
        csv: "sku,cogs,packaging,return\nABC-1,12.50,1.20,2.00"
      }
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: "Request body too large." });
  });

  it("keeps billing checkout honest when checkout is not configured", async () => {
    clearCheckoutEnv();
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: {
        plan: "Growth",
        billingEmail: "buyer@example.com"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: "Checkout is not configured.",
      configured: false
    });
  });

  it("creates a configured external checkout URL without changing the plan locally", async () => {
    clearCheckoutEnv();
    process.env.TMT_CHECKOUT_URL = "https://checkout.example.com/start";
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: {
        plan: "Pro",
        billingEmail: "buyer@example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "external",
      checkoutUrl: "https://checkout.example.com/start?plan=Pro&email=buyer%40example.com"
    });
  });

  it("creates a Stripe subscription checkout session when Stripe is configured", async () => {
    clearCheckoutEnv();
    process.env.APP_URL = "https://app.truemargintracker.test";
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_BILLING_PRICE_GROWTH = "price_growth_123";
    globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://api.stripe.com/v1/checkout/sessions");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer sk_test_123",
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": "2026-02-25.clover"
      });

      const body = init?.body as URLSearchParams;
      expect(body.get("mode")).toBe("subscription");
      expect(body.get("customer_email")).toBe("buyer@example.com");
      expect(body.get("line_items[0][price]")).toBe("price_growth_123");
      expect(body.get("line_items[0][quantity]")).toBe("1");
      expect(body.get("success_url")).toBe("https://app.truemargintracker.test/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}");
      expect(body.get("cancel_url")).toBe("https://app.truemargintracker.test/billing?checkout=cancel");
      expect(body.get("metadata[plan]")).toBe("Growth");

      return new Response(JSON.stringify({
        id: "cs_test_123",
        url: "https://checkout.stripe.com/c/pay/cs_test_123"
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      payload: {
        plan: "Growth",
        billingEmail: "buyer@example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "stripe",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123"
    });
  });

  it("verifies Stripe checkout webhooks and delivers issued licenses", async () => {
    clearCheckoutEnv();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
    process.env.TMT_LICENSE_DELIVERY_URL = "https://merchant.example.com/licenses/deliver";
    process.env.TMT_LICENSE_DELIVERY_TOKEN = "delivery_secret";
    let deliveredPayload: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://merchant.example.com/licenses/deliver");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer delivery_secret",
        "content-type": "application/json"
      });
      deliveredPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;
    const app = createApp();
    const event = {
      id: "evt_123",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_live_123",
          customer: "cus_123",
          customer_email: "buyer@example.com",
          metadata: {
            plan: "Pro",
            billing_email: "buyer@example.com"
          }
        }
      }
    };
    const rawBody = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", "whsec_test_123").update(`${timestamp}.${rawBody}`).digest("hex");
    const response = await app.inject({
      method: "POST",
      url: "/billing/stripe/webhook",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}`
      },
      payload: rawBody
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      received: true,
      processed: true,
      plan: "Pro",
      billingEmail: "buyer@example.com"
    });
    expect(deliveredPayload).toMatchObject({
      plan: "Pro",
      billingEmail: "buyer@example.com",
      externalOrderId: "cs_live_123"
    });
    expect(String(deliveredPayload?.licenseKey)).toMatch(/^TMT-/);
  });

  it("rejects unsigned Stripe webhooks", async () => {
    clearCheckoutEnv();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/billing/stripe/webhook",
      payload: {
        id: "evt_123",
        type: "checkout.session.completed"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ received: false, error: "Invalid Stripe signature." });
  });

  it("keeps license activation honest when no license server is configured", async () => {
    clearCheckoutEnv();
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/license/activate",
      payload: {
        licenseKey: "TMT-LIVE-1234",
        billingEmail: "buyer@example.com"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: "License activation is not configured.",
      configured: false,
      active: false
    });
  });

  it("activates a configured external license without local plan guessing", async () => {
    clearCheckoutEnv();
    process.env.TMT_LICENSE_ACTIVATE_URL = "https://licenses.example.com/activate";
    process.env.TMT_LICENSE_API_TOKEN = "license_secret_123";
    globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://licenses.example.com/activate");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        "content-type": "application/json",
        authorization: "Bearer license_secret_123"
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        licenseKey: "TMT-LIVE-1234",
        billingEmail: "buyer@example.com"
      });

      return new Response(JSON.stringify({
        active: true,
        plan: "Growth",
        licenseId: "lic_123"
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/license/activate",
      payload: {
        licenseKey: "TMT-LIVE-1234",
        billingEmail: "buyer@example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      active: true,
      plan: "Growth",
      licenseId: "lic_123"
    });
  });

  it("issues and activates a local license for owner-site sales", async () => {
    clearCheckoutEnv();
    process.env.TMT_LICENSE_ISSUER_TOKEN = "issuer_secret_123";
    const app = createApp();
    const unauthorized = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      payload: {
        plan: "Growth",
        billingEmail: "buyer@example.com"
      }
    });
    const issued = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: { authorization: "Bearer issuer_secret_123" },
      payload: {
        plan: "Growth",
        billingEmail: "buyer@example.com",
        externalOrderId: "order_123"
      }
    });
    const licenseKey = issued.json().licenseKey as string;
    const activated = await app.inject({
      method: "POST",
      url: "/license/activate",
      payload: {
        licenseKey,
        billingEmail: "buyer@example.com"
      }
    });
    const status = await app.inject({ method: "GET", url: "/license/status" });

    expect(unauthorized.statusCode).toBe(401);
    expect(issued.statusCode).toBe(200);
    expect(issued.json()).toMatchObject({
      issued: true,
      plan: "Growth",
      billingEmail: "buyer@example.com"
    });
    expect(licenseKey).toMatch(/^TMT-/);
    expect(activated.statusCode).toBe(200);
    expect(activated.json()).toMatchObject({
      active: true,
      plan: "Growth",
      licenseId: issued.json().licenseId
    });
    expect(status.json().entitlements).toMatchObject({
      active: true,
      plan: "Growth",
      limits: { connectedStores: 3, monthlyOrders: 10000 }
    });
    expect(status.json().billing.licenseKey).toMatch(/^TMT-\.\.\.-[A-Z0-9]{4}$/);
    expect(status.json().billing.licenseKey).not.toBe(licenseKey);
  });

  it("issues a license from a signed owner-site sales webhook", async () => {
    clearCheckoutEnv();
    process.env.TMT_REQUIRE_AUTH = "true";
    process.env.TMT_SALES_WEBHOOK_SECRET = "sales_secret_123";
    const app = createApp();
    const payload = JSON.stringify({
      plan: "Pro",
      billingEmail: "buyer@example.com",
      externalOrderId: "order_webhook_123",
      externalCustomerId: "customer_123",
      provider: "owner-site"
    });
    const signature = createHmac("sha256", "sales_secret_123").update(payload).digest("hex");

    const rejected = await app.inject({
      method: "POST",
      url: "/licenses/sales/webhook",
      headers: {
        "content-type": "application/json",
        "x-tmt-signature": "bad"
      },
      payload
    });
    const issued = await app.inject({
      method: "POST",
      url: "/licenses/sales/webhook",
      headers: {
        "content-type": "application/json",
        "x-tmt-signature": signature
      },
      payload
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/licenses/sales/webhook",
      headers: {
        "content-type": "application/json",
        "x-tmt-signature": signature
      },
      payload
    });

    expect(rejected.statusCode).toBe(401);
    expect(issued.statusCode).toBe(200);
    expect(issued.json()).toMatchObject({
      received: true,
      issued: true,
      plan: "Pro",
      billingEmail: "buyer@example.com",
      provider: "owner-site",
      delivered: false
    });
    expect(issued.json().licenseKey).toMatch(/^TMT-/);
    expect(duplicate.json()).toMatchObject({
      received: true,
      issued: true,
      duplicate: true,
      licenseId: issued.json().licenseId
    });
  });

  it("revokes issued licenses and deactivates matching billing state", async () => {
    clearCheckoutEnv();
    process.env.TMT_LICENSE_ISSUER_TOKEN = "issuer_secret_123";
    const app = createApp();
    const issued = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: { authorization: "Bearer issuer_secret_123" },
      payload: {
        plan: "Starter",
        billingEmail: "buyer@example.com"
      }
    });
    await app.inject({
      method: "POST",
      url: "/license/activate",
      payload: {
        licenseKey: issued.json().licenseKey,
        billingEmail: "buyer@example.com"
      }
    });
    const revoked = await app.inject({
      method: "POST",
      url: `/licenses/${issued.json().licenseId}/revoke`,
      headers: { authorization: "Bearer issuer_secret_123" }
    });
    const status = await app.inject({ method: "GET", url: "/license/status" });

    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ revoked: true, licenseId: issued.json().licenseId });
    expect(status.json().billing).toMatchObject({ licenseStatus: "Inactive", licenseId: "" });
  });

  it("enforces store limits when production licensing is required", async () => {
    clearCheckoutEnv();
    process.env.TMT_LICENSE_ISSUER_TOKEN = "issuer_secret_123";
    process.env.TMT_REQUIRE_LICENSE = "true";
    const app = createApp();
    const blocked = await app.inject({
      method: "POST",
      url: "/stores/connect/woocommerce",
      payload: { name: "Blocked Woo" }
    });
    const issued = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: { authorization: "Bearer issuer_secret_123" },
      payload: {
        plan: "Starter",
        billingEmail: "buyer@example.com"
      }
    });
    await app.inject({
      method: "POST",
      url: "/license/activate",
      payload: {
        licenseKey: issued.json().licenseKey,
        billingEmail: "buyer@example.com"
      }
    });
    const firstStore = await app.inject({
      method: "POST",
      url: "/stores/connect/woocommerce",
      payload: { name: "Starter Woo" }
    });
    const secondStore = await app.inject({
      method: "POST",
      url: "/stores/connect/wordpress",
      payload: { name: "Starter WordPress" }
    });

    expect(blocked.statusCode).toBe(402);
    expect(firstStore.statusCode).toBe(200);
    expect(firstStore.json()).toMatchObject({ connected: true });
    expect(secondStore.statusCode).toBe(402);
    expect(secondStore.json().error).toContain("Starter allows 1 connected store");
  });

  it("stores workspace settings and billing state on the API", async () => {
    const app = createApp();
    const settings = await app.inject({
      method: "POST",
      url: "/workspace/settings",
      payload: {
        storeName: "Main Store",
        currency: "USD",
        taxMode: "excluded",
        language: "English",
        alertLoss: true,
        alertCosts: true,
        alertReturns: false,
        alertEmail: true
      }
    });
    const billing = await app.inject({
      method: "POST",
      url: "/billing",
      payload: {
        plan: "Growth",
        billingEmail: "buyer@example.com"
      }
    });
    const savedSettings = await app.inject({ method: "GET", url: "/workspace/settings" });
    const savedBilling = await app.inject({ method: "GET", url: "/billing" });

    expect(settings.statusCode).toBe(200);
    expect(billing.statusCode).toBe(200);
    expect(savedSettings.json().settings).toMatchObject({ storeName: "Main Store", alertEmail: true });
    expect(savedBilling.json().billing).toMatchObject({ plan: "Growth", billingEmail: "buyer@example.com" });
  });

  it("persists synced catalog products to the configured state file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmt-state-"));
    process.env.TMT_DATA_FILE = join(dir, "state.json");
    try {
      const firstApp = createApp();
      await firstApp.inject({
        method: "POST",
        url: "/webhooks/wordpress",
        payload: {
          productId: 55,
          title: "Persisted Product",
          sku: "WP-55",
          price: "79.00",
          cogs: "31.00"
        }
      });

      const secondApp = createApp();
      const products = await secondApp.inject({ method: "GET", url: "/products" });

      expect(products.json().products).toHaveLength(1);
      expect(products.json().products[0]).toMatchObject({
        id: "wordpress_55",
        title: "Persisted Product"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("encrypts persisted plugin credentials while keeping webhooks usable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmt-state-"));
    process.env.TMT_DATA_FILE = join(dir, "state.json");
    process.env.TMT_SECRET_ENCRYPTION_KEY = "test-encryption-key";
    try {
      const firstApp = createApp();
      await firstApp.inject({
        method: "POST",
        url: "/stores/connect/woocommerce",
        payload: {
          name: "Encrypted Woo",
          connectionToken: "plugin_token_plain",
          signingSecret: "plugin_secret_plain"
        }
      });
      const rawState = await readFile(process.env.TMT_DATA_FILE, "utf8");
      expect(rawState).toContain("enc:v1:");
      expect(rawState).not.toContain("plugin_token_plain");
      expect(rawState).not.toContain("plugin_secret_plain");

      const payload = {
        id: 909,
        total: "25.00",
        lines: [{ productId: "prod_secure", sku: "SECURE-1", name: "Secure Product", quantity: 1, total: "25.00", cogs: "9.00" }]
      };
      const rawPayload = JSON.stringify(payload);
      const signature = createHmac("sha256", "plugin_secret_plain").update(rawPayload).digest("hex");
      const secondApp = createApp();
      const webhook = await secondApp.inject({
        method: "POST",
        url: "/webhooks/woocommerce",
        headers: {
          authorization: "Bearer plugin_token_plain",
          "x-tmt-signature": signature,
          "content-type": "application/json"
        },
        payload: rawPayload
      });

      expect(webhook.statusCode).toBe(200);
      expect(webhook.json()).toMatchObject({ accepted: true, importedOrder: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("extracts product data from JSON-LD without seeded competitors", () => {
    const product = extractProductFromHtml(new URL("https://merchant.test/products/linen-shirt"), `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Linen Shirt",
              "image": "https://cdn.merchant.test/shirt.jpg",
              "offers": { "@type": "Offer", "price": "48.90", "priceCurrency": "USD" }
            }
          </script>
        </head>
      </html>
    `);

    expect(product).toEqual({
      url: "https://merchant.test/products/linen-shirt",
      host: "merchant.test",
      title: "Linen Shirt",
      imageUrl: "https://cdn.merchant.test/shirt.jpg",
      priceMinor: 4890,
      currency: "USD",
      source: "json-ld"
    });
  });

  it("extracts product data from product HTML without JSON-LD", () => {
    const product = extractProductFromHtml(new URL("https://merchant.test/products/book"), `
      <html>
        <body>
          <article>
            <h1>A Light in the Attic</h1>
            <img src="/media/book.jpg" alt="">
            <p class="price_color">£51.77</p>
          </article>
        </body>
      </html>
    `);

    expect(product).toMatchObject({
      host: "merchant.test",
      title: "A Light in the Attic",
      imageUrl: "https://merchant.test/media/book.jpg",
      priceMinor: 5177,
      currency: "GBP",
      source: "html"
    });
  });

  it("scans a product URL through the API", async () => {
    globalThis.fetch = vi.fn(async () => new Response(`
      <meta property="og:title" content="Ceramic Cup">
      <meta property="product:price:amount" content="19.50">
      <meta property="product:price:currency" content="USD">
    `, { status: 200 })) as typeof fetch;

    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/price-scout/analyze",
      payload: { url: "https://shop.test/products/cup" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().product).toMatchObject({
      host: "shop.test",
      title: "Ceramic Cup",
      priceMinor: 1950,
      currency: "USD",
      source: "meta"
    });
    expect(response.json().market).toMatchObject({
      status: "not_configured",
      matches: []
    });
  });

  it("adds market prices when a real price search provider is configured", async () => {
    process.env.TMT_PRICE_SEARCH_URL = "https://prices.example.com/search";
    process.env.TMT_PRICE_SEARCH_PROVIDER = "Price API";
    process.env.TMT_PRICE_SEARCH_TOKEN = "search_secret";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://shop.test/products/cup") {
        return new Response(`
          <meta property="og:title" content="Ceramic Cup">
          <meta property="product:price:amount" content="19.50">
          <meta property="product:price:currency" content="USD">
        `, { status: 200 });
      }

      expect(url).toBe("https://prices.example.com/search");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer search_secret");
      return Response.json({
        matches: [
          { title: "Ceramic Cup Blue", url: "https://market.test/cup-blue", price: "18.25", currency: "USD", source: "merchant" },
          { title: "Ceramic Cup Outlet", url: "https://outlet.test/cup", priceMinor: 1599, currency: "USD", source: "merchant" },
          { title: "Private result", url: "http://localhost/cup", priceMinor: 100, currency: "USD" }
        ]
      });
    }) as typeof fetch;
    globalThis.fetch = fetchMock;

    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/price-scout/analyze",
      payload: { url: "https://shop.test/products/cup" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().market).toMatchObject({
      status: "ready",
      provider: "Price API",
      lowest: {
        title: "Ceramic Cup Outlet",
        host: "outlet.test",
        priceMinor: 1599
      },
      matches: [
        { host: "outlet.test", priceMinor: 1599 },
        { host: "market.test", priceMinor: 1825 }
      ]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects local product URLs", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/price-scout/analyze",
      payload: { url: "http://localhost/products/cup" }
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects oversized product URL responses", async () => {
    clearCheckoutEnv();
    process.env.TMT_REMOTE_RESPONSE_LIMIT_BYTES = "24";
    globalThis.fetch = vi.fn(async () => new Response("<html>" + "x".repeat(128) + "</html>", { status: 200 })) as typeof fetch;
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/price-scout/analyze",
      payload: { url: "https://shop.test/products/huge" }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: "Product URL could not be read." });
  });
});
