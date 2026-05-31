import Fastify from "fastify";
import { Readable } from "node:stream";
import type { ShopifyConfig } from "./config.js";
import { shopifyConfigFromEnv } from "./config.js";
import { buildInstallUrl, buildSignedState, normalizeShopDomain, parseSignedState, verifyInstallParams } from "./oauth.js";
import { exchangeAuthorizationCode, forwardShopifyWebhookToApi, missingRequiredScopes, notifyTrueMarginInstall, registerWebhookSubscriptions } from "./shopify-api.js";
import { verifyShopifyOAuthHmac, verifyShopifyWebhookHmac } from "./security.js";
import { ShopifyInstallationStore } from "./storage.js";

const defaultBodyLimitBytes = 1024 * 1024;

function productionMode() {
  return process.env.NODE_ENV === "production";
}

function envNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function assertHttpsUrl(value: string, label: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS in production.`);
  }
}

function validateProductionConfig(config: ShopifyConfig) {
  if (!productionMode() || process.env.SHOPIFY_ALLOW_UNSAFE_PRODUCTION === "true") return;
  if (!config.apiKey || !config.apiSecret || !config.installSecret) {
    throw new Error("Shopify API key, API secret, and install secret are required in production.");
  }
  assertHttpsUrl(config.appUrl, "SHOPIFY_APP_URL");
  assertHttpsUrl(config.dashboardUrl, "DASHBOARD_URL");
  assertHttpsUrl(config.trueMarginApiUrl, "TMT_API_URL");
}

export function createShopifyApp(config: ShopifyConfig = shopifyConfigFromEnv()) {
  validateProductionConfig(config);
  const bodyLimitBytes = envNumber("SHOPIFY_BODY_LIMIT_BYTES", defaultBodyLimitBytes);
  const app = Fastify({ logger: false, bodyLimit: bodyLimitBytes });
  const installationStore = new ShopifyInstallationStore(config.storageFile, config.installSecret || config.apiSecret);

  app.setErrorHandler((error, _request, reply) => {
    const message = typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "Request failed.";
    if (message === "Request body too large.") {
      return reply.code(413).send({ error: "Request body too large." });
    }
    return reply.code(500).send({ error: "Internal server error." });
  });

  app.addHook("preParsing", async (request, _reply, payload) => {
    if (!payload) return payload;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of payload) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > bodyLimitBytes) {
        throw new Error("Request body too large.");
      }
      chunks.push(buffer);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    return Readable.from([rawBody]);
  });

  app.get("/api/shopify/install", async (request, reply) => {
    const query = request.query as { shop?: string; tenantId?: string; expires?: string; signature?: string };
    let context = { shop: "", tenantId: "local" };
    try {
      if (config.installSecret && query.tenantId) {
        context = verifyInstallParams(query, config.installSecret);
      } else if (config.installSecret && !query.tenantId) {
        context = { shop: normalizeShopDomain(query.shop ?? ""), tenantId: "local" };
      } else {
        context = { shop: normalizeShopDomain(query.shop ?? ""), tenantId: query.tenantId || "local" };
      }
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid Shopify install link" });
    }

    const state = config.installSecret ? buildSignedState(context, config.installSecret) : undefined;
    return reply.redirect(buildInstallUrl(context.shop, config, state));
  });

  app.get("/api/shopify/callback", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (!verifyShopifyOAuthHmac(query, config.apiSecret)) {
      return reply.code(401).send({ error: "Invalid Shopify HMAC" });
    }

    let shop: string;
    let tenantId = "local";
    try {
      shop = normalizeShopDomain(query.shop ?? "");
      if (config.installSecret) {
        const state = parseSignedState(query.state ?? "", config.installSecret);
        if (state.shop !== shop) throw new Error("Shopify state shop mismatch");
        tenantId = state.tenantId;
      }
    } catch (error) {
      return reply.code(401).send({ error: error instanceof Error ? error.message : "Invalid Shopify state" });
    }

    const code = query.code;
    if (!code) {
      return reply.code(400).send({ error: "Missing Shopify authorization code" });
    }

    try {
      const token = await exchangeAuthorizationCode(shop, code, config);
      const missingScopes = missingRequiredScopes(config.scopes, token.scope);
      if (missingScopes.length) {
        return reply.code(422).send({ error: "Missing Shopify access scopes", missingScopes });
      }
      const webhooks = await registerWebhookSubscriptions(shop, token.accessToken, config);
      await installationStore.upsert({
        shop,
        tenantId,
        accessToken: token.accessToken,
        scope: token.scope,
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        webhookTopics: webhooks.filter((item) => item.ok).map((item) => item.topic)
      });
      await notifyTrueMarginInstall(shop, tenantId, config);
      return reply.redirect(new URL("/integrations?shopify=installed", config.dashboardUrl).toString());
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Shopify install failed" });
    }
  });

  app.post("/api/shopify/webhooks", async (request, reply) => {
    const rawBody = (request as typeof request & { rawBody?: string }).rawBody ?? JSON.stringify(request.body ?? {});
    const hmac = request.headers["x-shopify-hmac-sha256"];
    if (!verifyShopifyWebhookHmac(rawBody, Array.isArray(hmac) ? hmac[0] : hmac, config.apiSecret)) {
      return reply.code(401).send({ error: "Invalid Shopify webhook HMAC" });
    }

    const shop = normalizeShopDomain(String(request.headers["x-shopify-shop-domain"] ?? ""));
    const topic = String(request.headers["x-shopify-topic"] ?? "");
    const installation = (await installationStore.list()).find((item) => item.shop === shop);
    if (topic === "app/uninstalled" || topic === "shop/redact") {
      await installationStore.delete(shop);
      return reply.code(202).send({ accepted: true, queued: true });
    }
    if (installation && topic.startsWith("orders/")) {
      await forwardShopifyWebhookToApi(request.body, installation.tenantId, config);
    }

    return reply.code(202).send({ accepted: true, queued: true });
  });

  return app;
}
