import crypto from "node:crypto";
import type { ShopifyConfig } from "./config.js";

export interface SignedInstallContext {
  shop: string;
  tenantId: string;
}

export function normalizeShopDomain(shop: string): string {
  const trimmed = shop.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(trimmed)) {
    throw new Error("Invalid Shopify shop domain");
  }
  return trimmed;
}

function hmacHex(secret: string, payload: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function signInstallParams(tenantId: string, shop: string, expires: string, secret: string) {
  return hmacHex(secret, `${tenantId}:${shop}:${expires}`);
}

export function verifyInstallParams(query: { tenantId?: string; shop?: string; expires?: string; signature?: string }, secret: string): SignedInstallContext {
  if (!secret || !query.tenantId || !query.shop || !query.expires || !query.signature) {
    throw new Error("Invalid Shopify install signature");
  }
  const shop = normalizeShopDomain(query.shop);
  if (Date.now() > Number(query.expires)) {
    throw new Error("Shopify install link expired");
  }
  const expected = signInstallParams(query.tenantId, shop, query.expires, secret);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(query.signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw new Error("Invalid Shopify install signature");
  }
  return { shop, tenantId: query.tenantId };
}

export function buildSignedState(context: SignedInstallContext, secret: string, expiresAt = Date.now() + 10 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({ ...context, expiresAt })).toString("base64url");
  const signature = hmacHex(secret, payload);
  return `${payload}.${signature}`;
}

export function parseSignedState(state: string, secret: string): SignedInstallContext {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || !secret) {
    throw new Error("Invalid Shopify state");
  }
  const expected = hmacHex(secret, payload);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw new Error("Invalid Shopify state");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedInstallContext & { expiresAt?: number };
  if (!parsed.shop || !parsed.tenantId || !parsed.expiresAt || Date.now() > parsed.expiresAt) {
    throw new Error("Expired Shopify state");
  }
  return {
    shop: normalizeShopDomain(parsed.shop),
    tenantId: parsed.tenantId
  };
}

export function buildInstallUrl(shop: string, config: ShopifyConfig, state: string = crypto.randomUUID()): string {
  const normalizedShop = normalizeShopDomain(shop);
  const redirectUri = new URL("/api/shopify/callback", config.appUrl).toString();
  const url = new URL(`https://${normalizedShop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", config.apiKey);
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}
