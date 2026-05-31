import cors from "@fastify/cors";
import {
  BillingCheckoutSchema,
  BillingUpdateSchema,
  CostImportSchema,
  IntegrationValidationSchema,
  integrations,
  LicenseActivationSchema,
  ProductCostUpdateSchema,
  WorkspaceSettingsSchema
} from "@tmt/shared";
import { calculateLineMargin } from "@tmt/margin-engine";
import Fastify from "fastify";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { buildAlerts, overviewMetrics, summarizeProducts, type ProductSummary } from "./workspace.js";

const defaultBodyLimitBytes = 1024 * 1024;
const defaultRemoteResponseLimitBytes = 512 * 1024;

const PriceScoutRequestSchema = z.object({
  url: z.string().trim().url().max(2048)
});

const PriceScoutProviderMatchSchema = z.object({
  title: z.string().trim().max(240).optional(),
  url: z.string().trim().url(),
  priceMinor: z.number().int().nonnegative().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  imageUrl: z.string().trim().url().optional(),
  source: z.string().trim().max(80).optional()
});

const PriceScoutProviderResponseSchema = z.union([
  z.array(PriceScoutProviderMatchSchema),
  z.object({
    matches: z.array(PriceScoutProviderMatchSchema).default([])
  })
]);

const BillingPlanSchema = z.enum(["Starter", "Growth", "Pro"]);

const LicenseIssueSchema = z.object({
  plan: BillingPlanSchema,
  billingEmail: z.string().trim().email(),
  externalCustomerId: z.string().trim().max(160).optional(),
  externalOrderId: z.string().trim().max(160).optional()
});

const LicenseSaleWebhookSchema = LicenseIssueSchema.extend({
  externalOrderId: z.string().trim().min(1).max(160),
  provider: z.string().trim().max(80).optional()
});

const ShopifyInstallLinkSchema = z.object({
  shop: z.string().trim().min(1).max(120)
});

const AuthRegisterSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(120).optional(),
  workspaceName: z.string().trim().min(1).max(120).optional()
});

const AuthLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200)
});

const TeamMemberCreateSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["admin", "member"]).default("member")
});

const ApiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

const CostRulesSchema = z.object({
  shippingFallback: z.string().trim().max(40).optional(),
  returnShipping: z.string().trim().max(40).optional(),
  packagingCost: z.string().trim().max(40).optional(),
  taxMode: z.string().trim().max(40).optional(),
  importedRows: z.number().int().nonnegative().optional()
});

const PluginConnectionSchema = z.object({
  name: z.string().trim().max(120).optional(),
  connectionToken: z.string().trim().min(8).max(256).optional(),
  token: z.string().trim().min(8).max(256).optional(),
  signingSecret: z.string().trim().min(8).max(256).optional()
});

const supportedCsvHeaders = ["sku", "cogs", "packaging", "return"];
const defaultWorkspaceSettings: WorkspaceSettings = {
  storeName: "",
  currency: "",
  taxMode: "",
  language: "English",
  alertLoss: false,
  alertCosts: false,
  alertReturns: false,
  alertEmail: false
};

const defaultCostRules: CostRules = {
  shippingFallback: "",
  returnShipping: "",
  packagingCost: "",
  taxMode: "",
  importedRows: 0
};

const defaultBillingState: BillingRuntimeState = {
  plan: "Starter",
  billingEmail: "",
  licenseKey: "",
  licenseStatus: "Inactive",
  licenseId: ""
};

const planLimits: Record<BillingPlan, { connectedStores: number; monthlyOrders: number; apiAccess: boolean; teamAccess: boolean }> = {
  Starter: { connectedStores: 1, monthlyOrders: 1000, apiAccess: false, teamAccess: false },
  Growth: { connectedStores: 3, monthlyOrders: 10000, apiAccess: false, teamAccess: false },
  Pro: { connectedStores: 10, monthlyOrders: 50000, apiAccess: true, teamAccess: true }
};

interface RuntimeStore {
  id: string;
  name: string;
  platform: "shopify" | "woocommerce" | "wordpress";
  status: "connected";
  currency: "USD";
}

interface RuntimeOrder {
  id: string;
  sourceOrderId: string;
  channel: "Shopify" | "WooCommerce";
  customer: string;
  placedAt: string;
  productIds: string[];
  revenueMinor: number;
  trueMarginMinor: number;
  trueMarginPercent: number | null;
  status: "profitable" | "warning" | "loss" | "unknown";
}

interface RuntimeProductBase {
  id: string;
  title: string;
  sku: string;
  channel: "Shopify" | "WooCommerce" | "WordPress";
  image: string;
  unitsSold: number;
  revenueMinor: number;
  cogsMinor: number | null;
  adCostMinor: number;
  shippingCostMinor: number;
  feesMinor: number;
  returnsMinor: number;
  packagingMinor: number;
  currency: "USD";
  sourceUrl?: string;
}

type RuntimeCatalogProduct = ProductSummary & RuntimeProductBase;

interface PriceScoutProduct {
  url: string;
  host: string;
  title: string | null;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string | null;
  source: "json-ld" | "meta" | "html";
}

interface PriceScoutMarketMatch {
  title: string;
  url: string;
  host: string;
  priceMinor: number;
  currency: string;
  imageUrl: string | null;
  source: string;
}

interface PriceScoutMarketResult {
  status: "ready" | "not_configured" | "not_found" | "error";
  provider: string | null;
  matches: PriceScoutMarketMatch[];
  lowest: PriceScoutMarketMatch | null;
  error?: string;
}

interface WebhookCredential {
  platform: "woocommerce" | "wordpress";
  storeId: string;
  token: string;
  signingSecret?: string;
}

type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;
type CostRules = z.infer<typeof CostRulesSchema>;

interface BillingRuntimeState {
  plan: BillingPlan;
  billingEmail: string;
  licenseKey: string;
  licenseStatus: "Inactive" | "Active";
  licenseId: string;
}

interface RuntimeLicense {
  id: string;
  keyHash: string;
  plan: BillingPlan;
  billingEmail: string;
  status: "active" | "revoked";
  issuedAt: string;
  activatedAt?: string;
  lastActivatedAt?: string;
  externalCustomerId?: string;
  externalOrderId?: string;
}

interface RuntimeUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  role?: "owner" | "admin" | "member";
  createdAt: string;
}

interface RuntimeSession {
  id: string;
  tokenHash: string;
  userId: string;
  tenantId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt?: string;
}

interface RuntimeTenantAccount {
  id: string;
  name: string;
  createdAt: string;
}

interface RuntimeApiKey {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface TenantRuntimeStateFile {
  stores?: RuntimeStore[];
  orders?: RuntimeOrder[];
  products?: RuntimeCatalogProduct[];
  orderPayloads?: Array<{ orderId: string; channel: "Shopify" | "WooCommerce"; payload: unknown }>;
  webhookCredentials?: WebhookCredential[];
  workspaceSettings?: WorkspaceSettings;
  costRules?: CostRules;
  billing?: BillingRuntimeState;
  apiKeys?: RuntimeApiKey[];
}

interface RuntimeTenantRecord extends RuntimeTenantAccount {
  state?: TenantRuntimeStateFile;
}

interface RuntimeStateFile extends TenantRuntimeStateFile {
  licenses?: RuntimeLicense[];
  users?: RuntimeUser[];
  sessions?: RuntimeSession[];
  tenants?: RuntimeTenantRecord[];
}

interface TenantRuntimeState {
  stores: RuntimeStore[];
  orders: RuntimeOrder[];
  products: RuntimeCatalogProduct[];
  orderPayloads: Map<string, { channel: "Shopify" | "WooCommerce"; payload: unknown }>;
  webhookCredentials: WebhookCredential[];
  workspaceSettings: WorkspaceSettings;
  costRules: CostRules;
  billing: BillingRuntimeState;
  apiKeys: RuntimeApiKey[];
}

type PersistenceTarget =
  | { kind: "none" }
  | { kind: "file"; path: string }
  | { kind: "prisma"; tenantId: string; key: string };

type PrismaRuntimeClient = {
  runtimeState: {
    findUnique: (args: unknown) => Promise<{ value: unknown } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
};

let prismaClientPromise: Promise<PrismaRuntimeClient> | null = null;

function seedDataEnabled() {
  return process.env.TMT_ENABLE_SEED_DATA === "true";
}

function persistenceDisabled() {
  return process.env.TMT_DISABLE_PERSISTENCE === "true" || process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

function persistenceTarget(): PersistenceTarget {
  if (process.env.TMT_PERSISTENCE_DRIVER === "prisma") {
    return {
      kind: "prisma",
      tenantId: process.env.TMT_TENANT_ID?.trim() || "local",
      key: "runtime"
    };
  }

  const configuredPath = process.env.TMT_DATA_FILE?.trim();
  if (configuredPath) return { kind: "file", path: resolve(configuredPath) };
  if (persistenceDisabled()) return { kind: "none" };
  return { kind: "file", path: resolve(process.cwd(), ".data/true-margin-tracker-state.json") };
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

async function prismaRuntimeClient() {
  if (!prismaClientPromise) {
    prismaClientPromise = import("@prisma/client").then((clientModule) => {
      const moduleWithClient = clientModule as unknown as {
        PrismaClient?: new () => unknown;
        default?: { PrismaClient?: new () => unknown };
      };
      const PrismaClient = moduleWithClient.PrismaClient ?? moduleWithClient.default?.PrismaClient;
      if (!PrismaClient) {
        throw new Error("Prisma client is not generated. Run pnpm --filter @tmt/api db:generate.");
      }
      return new PrismaClient() as PrismaRuntimeClient;
    });
  }
  return prismaClientPromise;
}

async function readRuntimeState(target: PersistenceTarget): Promise<RuntimeStateFile> {
  if (target.kind === "none") return {};
  if (target.kind === "prisma") {
    const client = await prismaRuntimeClient();
    const record = await client.runtimeState.findUnique({
      where: {
        tenantId_key: {
          tenantId: target.tenantId,
          key: target.key
        }
      }
    });
    return record?.value && typeof record.value === "object" ? record.value as RuntimeStateFile : {};
  }

  try {
    const raw = await readFile(target.path, "utf8");
    const parsed = JSON.parse(raw) as RuntimeStateFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeRuntimeState(target: PersistenceTarget, state: RuntimeStateFile) {
  if (target.kind === "none") return;
  if (target.kind === "prisma") {
    const client = await prismaRuntimeClient();
    await client.runtimeState.upsert({
      where: {
        tenantId_key: {
          tenantId: target.tenantId,
          key: target.key
        }
      },
      create: {
        tenantId: target.tenantId,
        key: target.key,
        value: state
      },
      update: {
        value: state
      }
    });
    return;
  }

  await mkdir(dirname(target.path), { recursive: true });
  const tempPath = `${target.path}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
  await rename(tempPath, target.path);
}

function productionMode() {
  return process.env.NODE_ENV === "production";
}

function testRuntime() {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function isBlockedIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second] = octets as [number, number, number, number];
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) return isBlockedIp(normalized.slice("::ffff:".length));
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  return normalized.startsWith("2001:db8:");
}

function isBlockedIp(address: string) {
  const normalized = normalizeHostname(address);
  const type = isIP(normalized);
  if (type === 4) return isBlockedIpv4(normalized);
  if (type === 6) return isBlockedIpv6(normalized);
  return false;
}

function isBlockedHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (["localhost", "0.0.0.0"].includes(normalized) || normalized.endsWith(".local") || normalized.endsWith(".localhost")) return true;
  if (isIP(normalized)) return isBlockedIp(normalized);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return isBlockedIpv4(normalized);
  return false;
}

async function assertPublicHostname(hostname: string) {
  if (isBlockedHostname(hostname)) {
    throw new Error("Private or local URLs are not supported.");
  }
  if (testRuntime()) return;
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((record) => isBlockedIp(record.address))) {
    throw new Error("Private or local URLs are not supported.");
  }
}

function validatedHttpUrl(rawUrl: string, options: { blockPrivate?: boolean; requireHttpsInProduction?: boolean } = {}) {
  const parsedUrl = new URL(rawUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  if (options.requireHttpsInProduction && productionMode() && parsedUrl.protocol !== "https:") {
    throw new Error("HTTPS is required in production.");
  }
  if (options.blockPrivate && isBlockedHostname(parsedUrl.hostname)) {
    throw new Error("Private or local URLs are not supported.");
  }
  return parsedUrl;
}

function validatedProductUrl(rawUrl: string) {
  return validatedHttpUrl(rawUrl, { blockPrivate: true, requireHttpsInProduction: true });
}

function validatedPublicUrl(rawUrl: string) {
  return validatedHttpUrl(rawUrl, { blockPrivate: true, requireHttpsInProduction: true });
}

function normalizeShopifyShop(shop: string) {
  const normalized = shop.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
    throw new Error("Enter a myshopify.com domain.");
  }
  return normalized;
}

function shopifyInstallSecret() {
  return process.env.TMT_SHOPIFY_INSTALL_SECRET?.trim();
}

function shopifyAppUrl() {
  return process.env.SHOPIFY_APP_URL?.trim() || "http://localhost:4100";
}

function signedShopifyInstallParams(tenantId: string, shop: string) {
  const secret = shopifyInstallSecret();
  if (!secret) return {};
  const expires = String(Date.now() + 10 * 60 * 1000);
  const signature = createHmac("sha256", secret).update(`${tenantId}:${shop}:${expires}`).digest("hex");
  return { tenantId, expires, signature };
}

function integrationKey(name: string) {
  return name.toLowerCase().replaceAll(" ", "-");
}

function authHeaderForToken(token: string | undefined) {
  if (!token) return undefined;
  if (token.includes(":")) {
    return `Basic ${Buffer.from(token).toString("base64")}`;
  }
  return `Bearer ${token}`;
}

function headerText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function signedWebhookPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

type BillingPlan = "Starter" | "Growth" | "Pro";

function licenseKeyHash(licenseKey: string) {
  return createHash("sha256").update(licenseKey.trim().toUpperCase()).digest("hex");
}

function createLicenseKey() {
  const parts = [
    randomBytes(3).toString("hex"),
    randomBytes(3).toString("hex"),
    randomBytes(3).toString("hex"),
    randomBytes(3).toString("hex")
  ].map((part) => part.toUpperCase());
  return `TMT-${parts.join("-")}`;
}

function licenseIssuerToken() {
  return process.env.TMT_LICENSE_ISSUER_TOKEN?.trim();
}

function salesWebhookSecret() {
  return process.env.TMT_SALES_WEBHOOK_SECRET?.trim();
}

function licenseRequired() {
  return process.env.TMT_REQUIRE_LICENSE === "true" || (productionMode() && process.env.TMT_REQUIRE_LICENSE !== "false");
}

function authRequired() {
  return process.env.TMT_REQUIRE_AUTH === "true" || (productionMode() && process.env.TMT_REQUIRE_AUTH !== "false");
}

function validateProductionSecurityConfig() {
  if (!productionMode() || process.env.TMT_ALLOW_UNSAFE_PRODUCTION === "true") return;
  if (process.env.TMT_REQUIRE_AUTH === "false") {
    throw new Error("TMT_REQUIRE_AUTH=false is not allowed in production without TMT_ALLOW_UNSAFE_PRODUCTION=true.");
  }
  if (process.env.TMT_REQUIRE_LICENSE === "false") {
    throw new Error("TMT_REQUIRE_LICENSE=false is not allowed in production without TMT_ALLOW_UNSAFE_PRODUCTION=true.");
  }
}

function strictPluginWebhooks() {
  return authRequired() || productionMode();
}

function maskLicenseKey(licenseKey: string) {
  const trimmed = licenseKey.trim();
  if (!trimmed) return "";
  if (/^TMT-\.\.\.-[A-Z0-9]{4}$/i.test(trimmed)) return trimmed;
  return `TMT-...-${trimmed.slice(-4).toUpperCase()}`;
}

function publicBillingState(billing: BillingRuntimeState): BillingRuntimeState {
  return {
    ...billing,
    licenseKey: maskLicenseKey(billing.licenseKey)
  };
}

function passwordDigest(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${digest}`;
}

function verifyPasswordDigest(password: string, storedDigest: string) {
  const [scheme, salt, digest] = storedDigest.split(":");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const attempted = scryptSync(password, salt, 64).toString("hex");
  return constantTimeEqual(attempted, digest);
}

function sessionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function apiKeyHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createSessionToken() {
  return `tmt_${randomBytes(32).toString("hex")}`;
}

function createApiKey() {
  return `tmt_live_${randomBytes(24).toString("hex")}`;
}

function sessionExpiry() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

function isExpired(isoDate: string) {
  return Date.parse(isoDate) <= Date.now();
}

function envNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function secretEncryptionKey() {
  const rawKey = process.env.TMT_SECRET_ENCRYPTION_KEY?.trim() || process.env.APP_SECRET?.trim();
  return rawKey ? createHash("sha256").update(rawKey).digest() : null;
}

function encryptSecret(value: string | undefined) {
  if (!value) return value;
  if (value.startsWith("enc:v1:")) return value;
  const key = secretEncryptionKey();
  if (!key) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function decryptSecret(value: string | undefined) {
  if (!value || !value.startsWith("enc:v1:")) return value;
  const key = secretEncryptionKey();
  if (!key) return "";
  const [, version, iv, tag, ciphertext] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return "";
  }
}

const STRIPE_API_VERSION = "2026-02-25.clover";
const stripePriceEnvByPlan: Record<BillingPlan, string> = {
  Starter: "STRIPE_BILLING_PRICE_STARTER",
  Growth: "STRIPE_BILLING_PRICE_GROWTH",
  Pro: "STRIPE_BILLING_PRICE_PRO"
};

function configuredAppUrl() {
  return process.env.APP_URL?.trim() || "http://localhost:3000";
}

function configuredCorsOrigins() {
  const rawOrigins = [
    ...(process.env.TMT_CORS_ORIGINS?.split(",") ?? []),
    process.env.APP_URL,
    process.env.DASHBOARD_URL,
    process.env.SHOPIFY_APP_URL
  ];
  const origins = new Set<string>();
  for (const rawOrigin of rawOrigins) {
    const value = rawOrigin?.trim();
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      continue;
    }
  }
  return Array.from(origins);
}

function billingReturnUrl(kind: "success" | "cancel") {
  const envValue = kind === "success" ? process.env.STRIPE_CHECKOUT_SUCCESS_URL : process.env.STRIPE_CHECKOUT_CANCEL_URL;
  if (envValue?.trim()) return envValue.trim();

  const url = new URL("/billing", configuredAppUrl());
  url.searchParams.set("checkout", kind);
  if (kind === "success") {
    return `${url.toString()}&session_id={CHECKOUT_SESSION_ID}`;
  }
  return url.toString();
}

function externalCheckoutUrl(plan: BillingPlan, billingEmail: string) {
  const configuredCheckoutUrl = process.env.TMT_CHECKOUT_URL?.trim();
  if (!configuredCheckoutUrl) return null;

  const checkoutUrl = new URL(configuredCheckoutUrl);
  checkoutUrl.searchParams.set("plan", plan);
  checkoutUrl.searchParams.set("email", billingEmail);
  return checkoutUrl.toString();
}

function stripeBillingConfig(plan: BillingPlan) {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env[stripePriceEnvByPlan[plan]]?.trim();
  return secretKey && priceId ? { secretKey, priceId } : null;
}

function stripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim();
}

function priceSearchConfig() {
  const url = process.env.TMT_PRICE_SEARCH_URL?.trim();
  if (!url) return null;
  const providerUrl = validatedPublicUrl(url);
  return {
    url: providerUrl.toString(),
    provider: process.env.TMT_PRICE_SEARCH_PROVIDER?.trim() || providerUrl.hostname,
    token: process.env.TMT_PRICE_SEARCH_TOKEN?.trim(),
    timeoutMs: envNumber("TMT_PRICE_SEARCH_TIMEOUT_MS", 8000)
  };
}

function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string | undefined, secret: string) {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !signatures.length) return false;
  const toleranceSeconds = envNumber("STRIPE_WEBHOOK_TOLERANCE_SECONDS", 300);
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return signatures.some((signature) => constantTimeEqual(expected, signature));
}

function licenseDeliveryConfig() {
  const url = process.env.TMT_LICENSE_DELIVERY_URL?.trim();
  if (!url) return null;
  return {
    url,
    token: process.env.TMT_LICENSE_DELIVERY_TOKEN?.trim()
  };
}

async function deliverLicenseKey(payload: { licenseId: string; licenseKey: string; plan: BillingPlan; billingEmail: string; externalOrderId: string }) {
  const config = licenseDeliveryConfig();
  if (!config) {
    throw new Error("License delivery is not configured.");
  }
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json"
  };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  const response = await fetch(validatedPublicUrl(config.url), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    redirect: "manual",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const result = await readLimitedJson(response).catch(() => ({})) as { error?: string };
    throw new Error(result.error ?? "License delivery failed.");
  }
}

async function createStripeCheckoutSession(plan: BillingPlan, billingEmail: string) {
  const config = stripeBillingConfig(plan);
  if (!config) return null;

  const body = new URLSearchParams({
    mode: "subscription",
    customer_email: billingEmail,
    client_reference_id: billingEmail,
    success_url: billingReturnUrl("success"),
    cancel_url: billingReturnUrl("cancel"),
    "line_items[0][price]": config.priceId,
    "line_items[0][quantity]": "1",
    "metadata[plan]": plan,
    "metadata[billing_email]": billingEmail,
    "subscription_data[metadata][plan]": plan,
    "subscription_data[metadata][billing_email]": billingEmail
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION
    },
    body,
    signal: AbortSignal.timeout(10000)
  });
  const payload = await readLimitedJson(response).catch(() => ({})) as { url?: unknown; error?: { message?: string } };

  if (!response.ok || typeof payload.url !== "string") {
    throw new Error(payload.error?.message ?? "Stripe checkout could not be created.");
  }

  return payload.url;
}

const LicenseActivationResponseSchema = z.object({
  active: z.boolean(),
  plan: z.enum(["Starter", "Growth", "Pro"]).optional(),
  licenseId: z.string().trim().optional(),
  message: z.string().trim().optional()
});

class ExternalServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

class RequestBodyTooLargeError extends Error {
  statusCode = 413;

  constructor() {
    super("Request body too large.");
  }
}

async function readLimitedText(response: Response, limitBytes = envNumber("TMT_REMOTE_RESPONSE_LIMIT_BYTES", defaultRemoteResponseLimitBytes)) {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > limitBytes) {
      throw new Error("Remote response is too large.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > limitBytes) {
        await reader.cancel();
        throw new Error("Remote response is too large.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readLimitedJson(response: Response) {
  const text = await readLimitedText(response);
  return text ? JSON.parse(text) as unknown : null;
}

async function activateExternalLicense(licenseKey: string, billingEmail?: string) {
  const activationUrl = process.env.TMT_LICENSE_ACTIVATE_URL?.trim();
  if (!activationUrl) return null;

  const url = validatedPublicUrl(activationUrl);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json"
  };
  const activationToken = process.env.TMT_LICENSE_API_TOKEN?.trim();
  if (activationToken) {
    headers.authorization = `Bearer ${activationToken}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      licenseKey,
      ...(billingEmail ? { billingEmail } : {})
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(10000)
  });
  const payload = await readLimitedJson(response).catch(() => ({})) as unknown;
  const parsed = LicenseActivationResponseSchema.safeParse(payload);
  const message = parsed.success ? parsed.data.message : undefined;

  if (!response.ok) {
    const statusCode = response.status === 401 || response.status === 403 ? response.status : response.status === 404 ? 422 : 502;
    throw new ExternalServiceError(message ?? "License activation failed.", statusCode);
  }

  if (!parsed.success) {
    throw new ExternalServiceError("License server returned an invalid response.");
  }

  if (!parsed.data.active) {
    throw new ExternalServiceError(parsed.data.message ?? "License key is inactive.", 422);
  }

  return {
    active: true,
    plan: parsed.data.plan ?? "Starter",
    licenseId: parsed.data.licenseId ?? ""
  };
}

async function validateIntegrationConnection(name: string, endpoint: string, token: string | undefined) {
  if (name === "Shipping Rules") {
    return {
      ok: true,
      sourcePrecision: "rule",
      message: "Shipping rules are ready."
    };
  }

  const targetUrl = validatedPublicUrl(endpoint);
  await assertPublicHostname(targetUrl.hostname);

  if (name === "Shopify") {
    if (!token) throw new Error("Shopify Admin API access token is required.");
    if (!targetUrl.hostname.endsWith(".myshopify.com")) {
      throw new Error("Use the store myshopify.com domain for Shopify validation.");
    }
    const response = await fetch(`https://${targetUrl.hostname}/admin/api/2026-04/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": token,
        accept: "application/json"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8000)
    });
    return {
      ok: response.ok,
      sourcePrecision: "exact",
      message: response.ok ? "Shopify credentials validated." : "Shopify rejected the credentials."
    };
  }

  if (name === "WooCommerce") {
    const authorization = authHeaderForToken(token);
    if (!authorization) throw new Error("WooCommerce key and secret are required.");
    const statusUrl = new URL("/wp-json/wc/v3/system_status", targetUrl.origin);
    const response = await fetch(statusUrl, {
      headers: {
        authorization,
        accept: "application/json"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8000)
    });
    return {
      ok: response.ok,
      sourcePrecision: "exact",
      message: response.ok ? "WooCommerce credentials validated." : "WooCommerce rejected the credentials."
    };
  }

  if (name === "WordPress") {
    const statusUrl = new URL("/wp-json/", targetUrl.origin);
    const response = await fetch(statusUrl, {
      headers: {
        accept: "application/json"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8000)
    });
    return {
      ok: response.ok,
      sourcePrecision: "manual",
      message: response.ok ? "WordPress REST API is reachable." : "WordPress REST API could not be reached."
    };
  }

  if (name === "Stripe") {
    if (!token) throw new Error("Stripe secret key is required.");
    const response = await fetch("https://api.stripe.com/v1/account", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8000)
    });
    return {
      ok: response.ok,
      sourcePrecision: "exact",
      message: response.ok ? "Stripe credentials validated." : "Stripe rejected the credentials."
    };
  }

  if (name === "PayPal") {
    const authorization = authHeaderForToken(token);
    if (!authorization) throw new Error("PayPal client ID and secret are required.");
    const response = await fetch(new URL("/v1/oauth2/token", targetUrl.origin), {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: "grant_type=client_credentials",
      redirect: "manual",
      signal: AbortSignal.timeout(8000)
    });
    return {
      ok: response.ok,
      sourcePrecision: "exact",
      message: response.ok ? "PayPal credentials validated." : "PayPal rejected the credentials."
    };
  }

  return {
    ok: false,
    sourcePrecision: "manual",
    message: `${name} validation is not configured yet.`
  };
}

function parseCostImport(csv: string) {
  const rows = csv.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (!rows.length) {
    throw new Error("Paste at least one CSV row.");
  }

  const header = rows[0]?.split(",").map((cell) => cell.trim().toLowerCase());
  const hasHeader = header?.every((cell, index) => cell === supportedCsvHeaders[index]);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (!dataRows.length) {
    throw new Error("Add at least one product cost row.");
  }

  const parsedRows = dataRows.map((row, index) => {
    const [sku, cogs, packaging, returnCost] = row.split(",").map((cell) => cell.trim());
    if (!sku || !cogs) {
      throw new Error(`Row ${index + 1} needs SKU and COGS.`);
    }
    const cogsMinor = parsePriceMinor(cogs);
    if (cogsMinor == null) {
      throw new Error(`Row ${index + 1} has an invalid COGS value.`);
    }
    return {
      sku,
      cogsMinor,
      packagingCostMinor: parsePriceMinor(packaging ?? ""),
      returnCostMinor: parsePriceMinor(returnCost ?? "")
    };
  });

  return {
    importedRows: parsedRows.length,
    rows: parsedRows
  };
}

function recordFromUnknown(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function webhookOrderSummary(channel: "Shopify" | "WooCommerce", payload: unknown): RuntimeOrder | null {
  const record = recordFromUnknown(payload);
  if (!record) return null;

  const rawLines = asArray(record.lines ?? record.line_items);
  const lines = rawLines.map(recordFromUnknown).filter((line): line is Record<string, unknown> => Boolean(line));
  const sourceOrderId = cleanText(record.orderId ?? record.id ?? record.name) ?? `${channel.toLowerCase()}-${Date.now()}`;
  const placedAt = cleanText(record.created_at ?? record.date_created ?? record.date) ?? "Synced";
  const productIds = lines
    .map((line) => cleanText(line.productId ?? line.product_id ?? line.variantId ?? line.variationId))
    .filter((value): value is string => Boolean(value));
  const lineRevenueMinor = lines.reduce((sum, line) => sum + (parsePriceMinor(line.total ?? line.price) ?? 0), 0);
  const revenueMinor = parsePriceMinor(record.total ?? record.total_price) ?? lineRevenueMinor;
  const shippingMinor = parsePriceMinor(record.shippingTotal ?? record.total_shipping_price_set) ?? 0;
  const cogsMinor = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity ?? 1);
    const lineCogsMinor = parsePriceMinor(line.cogs) ?? 0;
    return sum + lineCogsMinor * (Number.isFinite(quantity) ? Math.max(1, quantity) : 1);
  }, 0);
  const trueMarginMinor = revenueMinor - shippingMinor - cogsMinor;
  const trueMarginPercent = revenueMinor > 0 && cogsMinor > 0 ? Number(((trueMarginMinor / revenueMinor) * 100).toFixed(2)) : null;
  const status = cogsMinor <= 0 ? "unknown" : trueMarginMinor < 0 ? "loss" : trueMarginPercent != null && trueMarginPercent < 15 ? "warning" : "profitable";

  return {
    id: `${channel.toLowerCase()}_${sourceOrderId}`,
    sourceOrderId,
    channel,
    customer: cleanText(record.customer) ?? "Synced order",
    placedAt,
    productIds,
    revenueMinor,
    trueMarginMinor,
    trueMarginPercent,
    status
  };
}

function runtimeProductId(channel: string, sourceId: string) {
  return `${channel}_${sourceId}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function runtimeProductWithMargin(product: RuntimeProductBase): RuntimeCatalogProduct {
  return {
    ...product,
    margin: calculateLineMargin({
      lineId: product.id,
      productId: product.id,
      sku: product.sku,
      quantity: Math.max(1, product.unitsSold),
      currency: product.currency,
      productSalesMinor: product.revenueMinor,
      cogsMinor: product.cogsMinor,
      packagingCostMinor: product.packagingMinor,
      realShippingCostMinor: product.shippingCostMinor,
      paymentProcessingFeeMinor: product.feesMinor,
      adSpendAllocatedMinor: product.adCostMinor,
      returnShippingCostMinor: product.returnsMinor,
      costSources: {
        cogs: { sourceType: "manual", sourceName: `${product.channel} product cost`, confidenceScore: product.cogsMinor == null ? 0 : 1 },
        shipping: { sourceType: "exact", sourceName: `${product.channel} order shipping`, confidenceScore: product.shippingCostMinor > 0 ? 1 : 0.5 },
        payment_processing: { sourceType: product.feesMinor > 0 ? "exact" : "estimated", sourceName: "Payment gateway", confidenceScore: product.feesMinor > 0 ? 1 : 0.5 },
        ad_spend: { sourceType: product.adCostMinor > 0 ? "imported" : "manual", sourceName: "Ad spend", confidenceScore: product.adCostMinor > 0 ? 0.82 : 0.4 },
        return_shipping: { sourceType: "rule", sourceName: "Return rule", confidenceScore: product.returnsMinor > 0 ? 0.75 : 0.5 }
      }
    })
  };
}

function mergeRuntimeProduct(products: RuntimeCatalogProduct[], product: RuntimeProductBase) {
  const existingIndex = products.findIndex((item) => item.id === product.id);
  if (existingIndex < 0) {
    products.unshift(runtimeProductWithMargin(product));
    return;
  }

  const existing = products[existingIndex]!;
  const merged: RuntimeProductBase = {
    ...existing,
    title: product.title || existing.title,
    sku: product.sku || existing.sku,
    unitsSold: existing.unitsSold + product.unitsSold,
    revenueMinor: existing.revenueMinor + product.revenueMinor,
    cogsMinor:
      existing.cogsMinor == null || product.cogsMinor == null
        ? existing.cogsMinor ?? product.cogsMinor
        : existing.cogsMinor + product.cogsMinor,
    adCostMinor: existing.adCostMinor + product.adCostMinor,
    shippingCostMinor: existing.shippingCostMinor + product.shippingCostMinor,
    feesMinor: existing.feesMinor + product.feesMinor,
    returnsMinor: existing.returnsMinor + product.returnsMinor,
    packagingMinor: existing.packagingMinor + product.packagingMinor,
    ...(existing.sourceUrl || product.sourceUrl ? { sourceUrl: product.sourceUrl ?? existing.sourceUrl } : {})
  };
  products[existingIndex] = runtimeProductWithMargin(merged);
}

function syncProductsFromOrderPayload(channel: "Shopify" | "WooCommerce", payload: unknown, products: RuntimeCatalogProduct[]) {
  const record = recordFromUnknown(payload);
  if (!record) return;

  const rawLines = asArray(record.lines ?? record.line_items);
  const lines = rawLines.map(recordFromUnknown).filter((line): line is Record<string, unknown> => Boolean(line));
  const shippingMinor = parsePriceMinor(record.shippingTotal ?? record.shipping_total ?? record.total_shipping_price_set) ?? 0;
  const lineProducts = lines.map((line) => {
    const quantityValue = Number(line.quantity ?? 1);
    const quantity = Number.isFinite(quantityValue) ? Math.max(1, Math.round(quantityValue)) : 1;
    const sourceId = cleanText(line.productId ?? line.product_id ?? line.variantId ?? line.variationId ?? line.id ?? line.sku);
    const sku = cleanText(line.sku) ?? sourceId ?? `${channel.toUpperCase()}-${Date.now()}`;
    const rawTotal = parsePriceMinor(line.total ?? line.total_price ?? line.line_price);
    const rawPrice = parsePriceMinor(line.price ?? line.unit_price);
    const revenueMinor = rawTotal ?? (rawPrice ?? 0) * quantity;
    const unitCogsMinor = parsePriceMinor(line.cogs ?? line.cost ?? line.costOfGoods);
    return {
      sourceId: sourceId ?? sku,
      title: cleanText(line.name ?? line.title ?? line.product_title) ?? sku,
      sku,
      quantity,
      revenueMinor,
      cogsMinor: unitCogsMinor == null ? null : unitCogsMinor * quantity,
      feesMinor: parsePriceMinor(line.fees ?? line.paymentFee ?? line.payment_fee) ?? 0,
      adCostMinor: parsePriceMinor(line.adCost ?? line.ad_cost ?? line.adSpend) ?? 0,
      returnsMinor: parsePriceMinor(line.returnCost ?? line.return_cost ?? line.returns) ?? 0,
      packagingMinor: parsePriceMinor(line.packagingCost ?? line.packaging_cost) ?? 0
    };
  }).filter((line) => line.revenueMinor > 0 || line.quantity > 0);

  const totalLineRevenue = lineProducts.reduce((sum, line) => sum + line.revenueMinor, 0);
  let allocatedShipping = 0;
  lineProducts.forEach((line, index) => {
    const shippingCostMinor = index === lineProducts.length - 1
      ? shippingMinor - allocatedShipping
      : totalLineRevenue > 0
        ? Math.floor((shippingMinor * line.revenueMinor) / totalLineRevenue)
        : Math.floor(shippingMinor / Math.max(1, lineProducts.length));
    allocatedShipping += shippingCostMinor;

    mergeRuntimeProduct(products, {
      id: runtimeProductId(channel, line.sourceId),
      title: line.title,
      sku: line.sku,
      channel,
      image: channel.toLowerCase(),
      unitsSold: line.quantity,
      revenueMinor: line.revenueMinor,
      cogsMinor: line.cogsMinor,
      adCostMinor: line.adCostMinor,
      shippingCostMinor: Math.max(0, shippingCostMinor),
      feesMinor: line.feesMinor,
      returnsMinor: line.returnsMinor,
      packagingMinor: line.packagingMinor,
      currency: "USD"
    });
  });
}

function productSourceId(productId: string) {
  return productId.replace(/^(shopify|woocommerce|wordpress)_/, "");
}

function rebuildRuntimeProducts(products: RuntimeCatalogProduct[], orderPayloads: Map<string, { channel: "Shopify" | "WooCommerce"; payload: unknown }>) {
  const catalogProducts = products.filter((product) => product.channel === "WordPress" && product.unitsSold === 0);
  products.splice(0, products.length, ...catalogProducts);
  for (const item of orderPayloads.values()) {
    syncProductsFromOrderPayload(item.channel, item.payload, products);
  }
}

function applyProductCostUpdate(product: RuntimeCatalogProduct, update: z.infer<typeof ProductCostUpdateSchema>) {
  return runtimeProductWithMargin({
    id: product.id,
    title: product.title,
    sku: product.sku,
    channel: product.channel,
    image: product.image,
    unitsSold: product.unitsSold,
    revenueMinor: product.revenueMinor,
    cogsMinor: update.cogsMinor === undefined ? product.cogsMinor : update.cogsMinor,
    adCostMinor: product.adCostMinor,
    shippingCostMinor: product.shippingCostMinor,
    feesMinor: product.feesMinor,
    returnsMinor: update.returnCostMinor ?? product.returnsMinor,
    packagingMinor: update.packagingCostMinor ?? product.packagingMinor,
    currency: product.currency,
    ...(product.sourceUrl ? { sourceUrl: product.sourceUrl } : {})
  });
}

function upsertRuntimeOrder(
  orders: RuntimeOrder[],
  orderPayloads: Map<string, { channel: "Shopify" | "WooCommerce"; payload: unknown }>,
  products: RuntimeCatalogProduct[],
  order: RuntimeOrder,
  channel: "Shopify" | "WooCommerce",
  payload: unknown
) {
  const existingIndex = orders.findIndex((item) => item.id === order.id);
  if (existingIndex >= 0) {
    orders[existingIndex] = order;
  } else {
    orders.unshift(order);
  }
  orderPayloads.set(order.id, { channel, payload });
  rebuildRuntimeProducts(products, orderPayloads);
}

function upsertWebhookCredential(credentials: WebhookCredential[], credential: WebhookCredential) {
  const existingIndex = credentials.findIndex((item) => item.platform === credential.platform && item.storeId === credential.storeId);
  if (existingIndex >= 0) {
    credentials[existingIndex] = credential;
  } else {
    credentials.push(credential);
  }
}

function catalogProductSummary(payload: unknown): RuntimeCatalogProduct | null {
  const record = recordFromUnknown(payload);
  if (!record) return null;

  const sourceId = cleanText(record.productId ?? record.id ?? record.url ?? record.title);
  const title = cleanText(record.title ?? record.name);
  if (!sourceId || !title) return null;

  const priceMinor = parsePriceMinor(record.price) ?? 0;
  const cogsMinor = parsePriceMinor(record.cogs);
  const packagingMinor = parsePriceMinor(record.packagingCost) ?? 0;
  const returnCostMinor = parsePriceMinor(record.averageReturnCost) ?? 0;
  const sku = cleanText(record.sku) ?? `WP-${sourceId}`;
  const id = runtimeProductId("wordpress", sourceId);
  const sourceUrl = cleanText(record.url);

  return runtimeProductWithMargin({
    id,
    title,
    sku,
    channel: "WordPress",
    image: "wordpress",
    unitsSold: 0,
    revenueMinor: priceMinor,
    cogsMinor,
    adCostMinor: 0,
    shippingCostMinor: 0,
    feesMinor: 0,
    returnsMinor: returnCostMinor,
    packagingMinor,
    currency: "USD",
    ...(sourceUrl ? { sourceUrl } : {})
  });
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function cleanText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? decodeHtml(value.replace(/\s+/g, " ")) : null;
}

function parsePriceMinor(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/[^\d,.-]/g, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return firstString(value[0]);
  if (value && typeof value === "object" && "url" in value) return firstString((value as { url?: unknown }).url);
  return null;
}

function findJsonLdProducts(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(findJsonLdProducts);

  const record = value as Record<string, unknown>;
  const typeValues = asArray(record["@type"]).map((item) => String(item).toLowerCase());
  const ownProducts = typeValues.includes("product") ? [record] : [];
  return [
    ...ownProducts,
    ...asArray(record["@graph"]).flatMap(findJsonLdProducts),
    ...asArray(record.itemListElement).flatMap(findJsonLdProducts)
  ];
}

function firstOffer(product: Record<string, unknown>) {
  const offers = asArray(product.offers);
  const offer = offers[0];
  return offer && typeof offer === "object" ? offer as Record<string, unknown> : null;
}

function metaContent(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }
  return null;
}

function titleContent(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? cleanText(match[1].replace(/<[^>]+>/g, "")) : null;
}

function elementText(html: string, tagName: string) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i");
  const match = html.match(pattern);
  return match?.[1] ? cleanText(match[1].replace(/<[^>]+>/g, "")) : null;
}

function firstImageSrc(html: string) {
  const imageMatch = html.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/i);
  return cleanText(imageMatch?.[1]);
}

function inferCurrency(value: string | null) {
  if (!value) return null;
  if (value.includes("€")) return "EUR";
  if (value.includes("£")) return "GBP";
  if (value.includes("$")) return "USD";
  return null;
}

function htmlPriceContent(html: string) {
  const itemPropMatch = html.match(/itemprop=["']price["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/content=["']([^"']+)["'][^>]+itemprop=["']price["']/i);
  if (itemPropMatch?.[1]) return cleanText(itemPropMatch[1]);

  const classPriceMatch = html.match(/class=["'][^"']*(?:price|amount|money)[^"']*["'][^>]*>([\s\S]{0,160}?)<\//i);
  if (classPriceMatch?.[1]) {
    const priceText = cleanText(classPriceMatch[1].replace(/<[^>]+>/g, " "));
    if (priceText) return priceText;
  }

  const loosePriceMatch = html.match(/(?:[$€£]\s?\d[\d\s,.]*|\d[\d\s,.]*\s?(?:USD|EUR|GBP|CAD|AUD))/i);
  return cleanText(loosePriceMatch?.[0]);
}

export function extractProductFromHtml(productUrl: URL, html: string) {
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1] ?? "");
      const product = findJsonLdProducts(parsed)[0];
      if (!product) continue;
      const offer = firstOffer(product);
      const title = cleanText(product.name);
      const image = firstString(product.image);
      const rawPrice = offer?.price ?? offer?.lowPrice ?? product.price;
      const currency = cleanText(offer?.priceCurrency ?? product.priceCurrency);

      if (title || rawPrice || image) {
        return {
          url: productUrl.toString(),
          host: productUrl.hostname.replace(/^www\./, ""),
          title,
          imageUrl: image ? new URL(image, productUrl).toString() : null,
          priceMinor: parsePriceMinor(rawPrice),
          currency,
          source: "json-ld" as const
        };
      }
    } catch {
      continue;
    }
  }

  const metaTitle = metaContent(html, ["og:title", "twitter:title"]) ?? titleContent(html);
  const metaImage = metaContent(html, ["og:image", "twitter:image"]);
  const metaPrice = metaContent(html, ["product:price:amount", "og:price:amount", "twitter:data1"]);
  const metaCurrency = metaContent(html, ["product:price:currency", "og:price:currency"]);
  const htmlTitle = elementText(html, "h1");
  const htmlImage = firstImageSrc(html);
  const htmlPrice = htmlPriceContent(html);
  const rawPrice = metaPrice ?? htmlPrice;
  const rawImage = metaImage ?? htmlImage;

  return {
    url: productUrl.toString(),
    host: productUrl.hostname.replace(/^www\./, ""),
    title: metaTitle ?? htmlTitle,
    imageUrl: rawImage ? new URL(rawImage, productUrl).toString() : null,
    priceMinor: parsePriceMinor(rawPrice),
    currency: metaCurrency ?? inferCurrency(rawPrice),
    source: metaTitle || metaImage || metaPrice ? "meta" as const : "html" as const
  };
}

function normalizedCurrency(value: string | null | undefined, fallback = "USD") {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : fallback;
}

function hostFromUrl(rawUrl: string) {
  return new URL(rawUrl).hostname.replace(/^www\./, "");
}

function currentScoutMatch(product: PriceScoutProduct): PriceScoutMarketMatch | null {
  if (product.priceMinor == null) return null;
  return {
    title: product.title ?? product.host,
    url: product.url,
    host: product.host,
    priceMinor: product.priceMinor,
    currency: normalizedCurrency(product.currency),
    imageUrl: product.imageUrl,
    source: "scanned"
  };
}

function normalizeMarketMatches(rawMatches: z.infer<typeof PriceScoutProviderMatchSchema>[], product: PriceScoutProduct) {
  const seen = new Set<string>();
  const fallbackCurrency = normalizedCurrency(product.currency);
  const matches: PriceScoutMarketMatch[] = [];

  for (const rawMatch of rawMatches) {
    let url: URL;
    try {
      url = validatedProductUrl(rawMatch.url);
    } catch {
      continue;
    }

    const canonicalUrl = url.toString();
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);

    const priceMinor = rawMatch.priceMinor ?? parsePriceMinor(rawMatch.price);
    if (priceMinor == null) continue;

    matches.push({
      title: cleanText(rawMatch.title) ?? hostFromUrl(canonicalUrl),
      url: canonicalUrl,
      host: hostFromUrl(canonicalUrl),
      priceMinor,
      currency: normalizedCurrency(rawMatch.currency, fallbackCurrency),
      imageUrl: cleanText(rawMatch.imageUrl),
      source: cleanText(rawMatch.source) ?? "provider"
    });
  }

  return matches.sort((a, b) => a.priceMinor - b.priceMinor || a.host.localeCompare(b.host));
}

async function fetchPriceScoutMarket(product: PriceScoutProduct): Promise<PriceScoutMarketResult> {
  let config: ReturnType<typeof priceSearchConfig>;
  try {
    config = priceSearchConfig();
  } catch {
    return {
      status: "error",
      provider: null,
      matches: [],
      lowest: currentScoutMatch(product),
      error: "Price search provider URL is invalid."
    };
  }

  if (!config) {
    return {
      status: "not_configured",
      provider: null,
      matches: [],
      lowest: currentScoutMatch(product)
    };
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json"
  };
  if (config.token) headers.authorization = `Bearer ${config.token}`;

  try {
    await assertPublicHostname(new URL(config.url).hostname);
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: product.title,
        url: product.url,
        host: product.host,
        priceMinor: product.priceMinor,
        currency: product.currency
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      return {
        status: "error",
        provider: config.provider,
        matches: [],
        lowest: currentScoutMatch(product),
        error: "Price search provider rejected the request."
      };
    }

    const payload = await readLimitedJson(response).catch(() => null) as unknown;
    const parsed = PriceScoutProviderResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        status: "error",
        provider: config.provider,
        matches: [],
        lowest: currentScoutMatch(product),
        error: "Price search provider returned an invalid response."
      };
    }

    const rawMatches = Array.isArray(parsed.data) ? parsed.data : parsed.data.matches;
    const matches = normalizeMarketMatches(rawMatches, product);
    const current = currentScoutMatch(product);
    const ranked = [...matches, ...(current ? [current] : [])].sort((a, b) => a.priceMinor - b.priceMinor || a.host.localeCompare(b.host));

    return {
      status: matches.length ? "ready" : "not_found",
      provider: config.provider,
      matches,
      lowest: ranked[0] ?? null
    };
  } catch {
    return {
      status: "error",
      provider: config.provider,
      matches: [],
      lowest: currentScoutMatch(product),
      error: "Price search provider could not be reached."
    };
  }
}

export function createApp() {
  validateProductionSecurityConfig();
  const bodyLimitBytes = envNumber("TMT_BODY_LIMIT_BYTES", defaultBodyLimitBytes);
  const app = Fastify({
    logger: false,
    bodyLimit: bodyLimitBytes
  });
  const runtimePersistence = persistenceTarget();
  const tenantAccounts: RuntimeTenantAccount[] = [];
  const tenantStates = new Map<string, TenantRuntimeState>();
  const runtimeUsers: RuntimeUser[] = [];
  const runtimeSessions: RuntimeSession[] = [];
  const runtimeLicenses: RuntimeLicense[] = [];
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

  function createTenantRuntimeState(state: TenantRuntimeStateFile = {}): TenantRuntimeState {
    const orderPayloads = new Map<string, { channel: "Shopify" | "WooCommerce"; payload: unknown }>();
    for (const item of safeArray<{ orderId: string; channel: "Shopify" | "WooCommerce"; payload: unknown }>(state.orderPayloads)) {
      if (item.orderId && item.channel && item.payload) {
        orderPayloads.set(item.orderId, { channel: item.channel, payload: item.payload });
      }
    }
    return {
      stores: safeArray<RuntimeStore>(state.stores),
      orders: safeArray<RuntimeOrder>(state.orders),
      products: safeArray<RuntimeCatalogProduct>(state.products),
      orderPayloads,
      webhookCredentials: safeArray<WebhookCredential>(state.webhookCredentials).map((credential) => ({
        ...credential,
        token: decryptSecret(credential.token) ?? "",
        ...(credential.signingSecret ? { signingSecret: decryptSecret(credential.signingSecret) ?? "" } : {})
      })),
      workspaceSettings: { ...defaultWorkspaceSettings, ...(state.workspaceSettings ?? {}) },
      costRules: { ...defaultCostRules, ...(state.costRules ?? {}) },
      billing: publicBillingState({ ...defaultBillingState, ...(state.billing ?? {}) }),
      apiKeys: safeArray<RuntimeApiKey>(state.apiKeys)
    };
  }

  function serializeTenantRuntimeState(state: TenantRuntimeState): TenantRuntimeStateFile {
    return {
      stores: state.stores,
      orders: state.orders,
      products: state.products,
      orderPayloads: Array.from(state.orderPayloads.entries()).map(([orderId, item]) => ({ orderId, ...item })),
      webhookCredentials: state.webhookCredentials.map((credential) => ({
        ...credential,
        token: encryptSecret(credential.token) ?? "",
        ...(credential.signingSecret ? { signingSecret: encryptSecret(credential.signingSecret) ?? "" } : {})
      })),
      workspaceSettings: state.workspaceSettings,
      costRules: state.costRules,
      billing: state.billing,
      apiKeys: state.apiKeys
    };
  }

  function hasLegacyTenantState(state: RuntimeStateFile) {
    return Boolean(
      state.stores?.length ||
      state.orders?.length ||
      state.products?.length ||
      state.orderPayloads?.length ||
      state.webhookCredentials?.length ||
      state.workspaceSettings ||
      state.costRules ||
      state.billing
    );
  }

  function ensureTenantState(tenantId: string, tenantName = "Local workspace") {
    if (!tenantAccounts.some((tenant) => tenant.id === tenantId)) {
      tenantAccounts.push({
        id: tenantId,
        name: tenantName,
        createdAt: new Date().toISOString()
      });
    }
    let state = tenantStates.get(tenantId);
    if (!state) {
      state = createTenantRuntimeState();
      tenantStates.set(tenantId, state);
    }
    return state;
  }

  const stateReady = readRuntimeState(runtimePersistence).then((state) => {
    tenantAccounts.splice(0, tenantAccounts.length);
    tenantStates.clear();
    for (const tenant of safeArray<RuntimeTenantRecord>(state.tenants)) {
      if (!tenant.id) continue;
      tenantAccounts.push({
        id: tenant.id,
        name: tenant.name || "Workspace",
        createdAt: tenant.createdAt || new Date().toISOString()
      });
      tenantStates.set(tenant.id, createTenantRuntimeState(tenant.state ?? {}));
    }
    if (hasLegacyTenantState(state) && !tenantStates.has("local")) {
      tenantAccounts.push({
        id: "local",
        name: state.workspaceSettings?.storeName || "Local workspace",
        createdAt: new Date().toISOString()
      });
      tenantStates.set("local", createTenantRuntimeState(state));
    }
    if (!tenantStates.size) {
      ensureTenantState("local");
    }
    runtimeUsers.splice(0, runtimeUsers.length, ...safeArray<RuntimeUser>(state.users).map((user) => ({
      ...user,
      email: normalizeEmail(user.email),
      role: user.role ?? "owner"
    })));
    runtimeSessions.splice(0, runtimeSessions.length, ...safeArray<RuntimeSession>(state.sessions).filter((session) => !isExpired(session.expiresAt)));
    runtimeLicenses.splice(0, runtimeLicenses.length, ...safeArray<RuntimeLicense>(state.licenses));
  });

  async function persistRuntimeState() {
    await stateReady;
    await writeRuntimeState(runtimePersistence, {
      tenants: tenantAccounts.map((tenant) => ({
        ...tenant,
        state: serializeTenantRuntimeState(ensureTenantState(tenant.id, tenant.name))
      })),
      users: runtimeUsers,
      sessions: runtimeSessions.filter((session) => !isExpired(session.expiresAt)),
      licenses: runtimeLicenses,
    });
  }

  function authContextFromHeader(authorization: string | string[] | undefined) {
    const authHeader = headerText(authorization);
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    if (!token) return null;
    const tokenHash = sessionTokenHash(token);
    const session = runtimeSessions.find((candidate) => candidate.tokenHash === tokenHash && !isExpired(candidate.expiresAt));
    if (!session) return null;
    const user = runtimeUsers.find((candidate) => candidate.id === session.userId && candidate.tenantId === session.tenantId);
    if (!user) return null;
    session.lastSeenAt = new Date().toISOString();
    return { session, user };
  }

  function apiKeyContextFromHeader(authorization: string | string[] | undefined) {
    const authHeader = headerText(authorization);
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    if (!token || !token.startsWith("tmt_live_")) return null;
    const keyHash = apiKeyHash(token);
    for (const tenant of tenantAccounts) {
      const tenantState = ensureTenantState(tenant.id, tenant.name);
      const apiKey = tenantState.apiKeys.find((candidate) => candidate.keyHash === keyHash);
      if (!apiKey) continue;
      const access = apiAccessStatus(tenantState);
      if (!access.allowed) return null;
      apiKey.lastUsedAt = new Date().toISOString();
      return { tenantId: tenant.id, apiKey };
    }
    return null;
  }

  function publicRoute(method: string, url: string) {
    if (method === "OPTIONS") return true;
    const path = url.split("?")[0] ?? url;
    return path === "/health" ||
      path.startsWith("/auth/") ||
      path === "/stores/connect/shopify/callback" ||
      path === "/billing/stripe/webhook" ||
      path === "/webhooks/shopify" ||
      path === "/webhooks/woocommerce" ||
      path === "/webhooks/wordpress" ||
      path === "/licenses/issue" ||
      path === "/licenses/sales/webhook" ||
      /^\/licenses\/[^/]+\/revoke$/.test(path);
  }

  function rateLimitPolicy(method: string, url: string) {
    if (process.env.TMT_RATE_LIMIT_DISABLED === "true" || method === "OPTIONS") return null;
    const path = url.split("?")[0] ?? url;
    const windowMs = envNumber("TMT_RATE_LIMIT_WINDOW_MS", 60_000);
    if (path === "/auth/login" || path === "/auth/register") {
      return { scope: "auth", limit: envNumber("TMT_AUTH_RATE_LIMIT", 20), windowMs };
    }
    if (path === "/billing/checkout" || path === "/billing/stripe/webhook" || path === "/license/activate" || path === "/licenses/issue" || path === "/licenses/sales/webhook" || /^\/licenses\/[^/]+\/revoke$/.test(path)) {
      return { scope: "billing", limit: envNumber("TMT_BILLING_RATE_LIMIT", 40), windowMs };
    }
    if (path === "/webhooks/shopify" || path === "/webhooks/woocommerce" || path === "/webhooks/wordpress") {
      return { scope: "webhook", limit: envNumber("TMT_WEBHOOK_RATE_LIMIT", 600), windowMs };
    }
    if (path === "/price-scout/analyze" || path === "/integrations/validate") {
      return { scope: "external", limit: envNumber("TMT_EXTERNAL_RATE_LIMIT", 60), windowMs };
    }
    return null;
  }

  function rateLimitExceeded(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    bucket.count += 1;
    return bucket.count > limit;
  }

  function requestTenantState(request: { tenantId?: string }) {
    return ensureTenantState(request.tenantId ?? "local");
  }

  function publicUser(user: RuntimeUser, tenant: RuntimeTenantAccount | undefined) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role ?? "owner",
      tenantId: user.tenantId,
      workspaceName: tenant?.name ?? "Workspace"
    };
  }

  function publicTeamMember(user: RuntimeUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role ?? "member",
      createdAt: user.createdAt
    };
  }

  function authenticatedUser(request: { userId?: string; tenantId?: string }) {
    if (!request.userId || !request.tenantId) return null;
    return runtimeUsers.find((user) => user.id === request.userId && user.tenantId === request.tenantId) ?? null;
  }

  function canManageTeam(request: { userId?: string; tenantId?: string }) {
    const user = authenticatedUser(request);
    return Boolean(user && ["owner", "admin"].includes(user.role ?? "owner"));
  }

  function teamAccessStatus(tenantState: TenantRuntimeState) {
    const entitlements = currentEntitlements(tenantState);
    const allowed = entitlements.limits.teamAccess && (!entitlements.licenseRequired || entitlements.active);
    return {
      allowed,
      entitlements,
      error: allowed ? "" : "Pro license required for team access."
    };
  }

  function apiAccessStatus(tenantState: TenantRuntimeState) {
    const entitlements = currentEntitlements(tenantState);
    const allowed = entitlements.limits.apiAccess && (!entitlements.licenseRequired || entitlements.active);
    return {
      allowed,
      entitlements,
      error: allowed ? "" : "Pro license required for API access."
    };
  }

  function configuredWebhookCredentials(platform: "woocommerce" | "wordpress", tenantState: TenantRuntimeState) {
    const sharedToken = process.env.TMT_WEBHOOK_TOKEN?.trim();
    const sharedSecret = process.env.TMT_WEBHOOK_SIGNING_SECRET?.trim();
    const platformPrefix = platform === "woocommerce" ? "TMT_WOOCOMMERCE" : "TMT_WORDPRESS";
    const platformToken = process.env[`${platformPrefix}_WEBHOOK_TOKEN`]?.trim();
    const platformSecret = process.env[`${platformPrefix}_WEBHOOK_SIGNING_SECRET`]?.trim();
    const envCredentials: WebhookCredential[] = [];
    if (sharedToken) {
      envCredentials.push({
        platform,
        storeId: "env-shared",
        token: sharedToken,
        ...(sharedSecret ? { signingSecret: sharedSecret } : {})
      });
    }
    if (platformToken) {
      envCredentials.push({
        platform,
        storeId: "env-platform",
        token: platformToken,
        ...(platformSecret ? { signingSecret: platformSecret } : {})
      });
    }
    return [
      ...tenantState.webhookCredentials.filter((credential) => credential.platform === platform),
      ...envCredentials
    ];
  }

  function verifyPluginWebhook(platform: "woocommerce" | "wordpress", request: { headers: Record<string, string | string[] | undefined>; body: unknown }) {
    const candidates = tenantAccounts.flatMap((tenant) => {
      const tenantState = ensureTenantState(tenant.id, tenant.name);
      return configuredWebhookCredentials(platform, tenantState).map((credential) => ({ credential, state: tenantState }));
    });
    if (!candidates.length) {
      return strictPluginWebhooks()
        ? { ok: false, error: "Plugin connection is not configured." }
        : { ok: true, state: ensureTenantState("local") };
    }

    const authHeader = headerText(request.headers.authorization);
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    const candidate = candidates.find((item) => constantTimeEqual(item.credential.token, token));
    if (!candidate) {
      return { ok: false, error: "Invalid plugin token." };
    }

    if (!candidate.credential.signingSecret) {
      return strictPluginWebhooks()
        ? { ok: false, error: "Plugin signature is not configured." }
        : { ok: true, state: candidate.state };
    }

    const signature = headerText(request.headers["x-tmt-signature"])?.trim();
    if (!signature) {
      return { ok: false, error: "Missing plugin signature." };
    }

    const rawRequest = request as unknown as { rawBody?: unknown };
    const rawBody = typeof rawRequest.rawBody === "string"
      ? rawRequest.rawBody
      : JSON.stringify(request.body ?? {});
    const expectedSignature = signedWebhookPayload(rawBody, candidate.credential.signingSecret);
    return constantTimeEqual(signature, expectedSignature)
      ? { ok: true, state: candidate.state }
      : { ok: false, error: "Invalid plugin signature." };
  }

  function activeLicense(tenantState: TenantRuntimeState) {
    return tenantState.billing.licenseStatus === "Active"
      ? runtimeLicenses.find((license) => license.id === tenantState.billing.licenseId && license.status === "active")
      : undefined;
  }

  function currentEntitlements(tenantState: TenantRuntimeState) {
    const plan = activeLicense(tenantState)?.plan ?? tenantState.billing.plan;
    const limits = planLimits[plan];
    return {
      plan,
      licenseRequired: licenseRequired(),
      active: Boolean(activeLicense(tenantState)),
      limits,
      usage: {
        connectedStores: tenantState.stores.length,
        orders: tenantState.orders.length
      }
    };
  }

  function canConnectStore(tenantState: TenantRuntimeState, platform: RuntimeStore["platform"]) {
    if (tenantState.stores.some((store) => store.platform === platform)) return { ok: true };
    const entitlements = currentEntitlements(tenantState);
    if (entitlements.licenseRequired && !entitlements.active) {
      return { ok: false, error: "Activate a license before connecting a store." };
    }
    if (tenantState.stores.length >= entitlements.limits.connectedStores) {
      return { ok: false, error: `${entitlements.plan} allows ${entitlements.limits.connectedStores} connected store${entitlements.limits.connectedStores === 1 ? "" : "s"}.` };
    }
    return { ok: true };
  }

  function createRuntimeLicense(plan: BillingPlan, billingEmail: string, externalOrderId?: string, externalCustomerId?: string) {
    if (externalOrderId) {
      const existing = runtimeLicenses.find((license) => license.externalOrderId === externalOrderId);
      if (existing) return { license: existing, licenseKey: "" };
    }
    const licenseKey = createLicenseKey();
    const license: RuntimeLicense = {
      id: `lic_${randomBytes(8).toString("hex")}`,
      keyHash: licenseKeyHash(licenseKey),
      plan,
      billingEmail: billingEmail.toLowerCase(),
      status: "active",
      issuedAt: new Date().toISOString(),
      ...(externalCustomerId ? { externalCustomerId } : {}),
      ...(externalOrderId ? { externalOrderId } : {})
    };
    return { license, licenseKey };
  }

  function verifyLicenseIssuer(request: { headers: Record<string, string | string[] | undefined> }) {
    const issuerToken = licenseIssuerToken();
    if (!issuerToken) {
      return { ok: false, statusCode: 503, error: "License issuing is not configured." };
    }
    const authHeader = headerText(request.headers.authorization);
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    if (!token || !constantTimeEqual(token, issuerToken)) {
      return { ok: false, statusCode: 401, error: "Invalid license issuer token." };
    }
    return { ok: true, statusCode: 200 };
  }

  app.setErrorHandler((error, _request, reply) => {
    const handledError = error as { statusCode?: unknown; message?: unknown };
    const statusCode = typeof handledError.statusCode === "number"
      ? handledError.statusCode
      : 500;
    const message = typeof handledError.message === "string" ? handledError.message : "Request failed.";
    if (statusCode === 413 || message === "Request body too large.") {
      return reply.code(413).send({ error: "Request body too large." });
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: message });
    }
    return reply.code(500).send({ error: "Internal server error." });
  });

  app.register(cors, {
    origin: productionMode() ? configuredCorsOrigins() : true
  });

  app.addHook("preParsing", async (request, _reply, payload) => {
    if (!payload) return payload;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of payload) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > bodyLimitBytes) {
        throw new RequestBodyTooLargeError();
      }
      chunks.push(buffer);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    (request as typeof request & { rawBody?: string }).rawBody = rawBody;
    return Readable.from([rawBody]);
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Cross-Origin-Resource-Policy", "same-site");
    reply.header("Cache-Control", "no-store");
    if (productionMode()) {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    await stateReady;
    const policy = rateLimitPolicy(request.method, request.url);
    if (policy && rateLimitExceeded(`${policy.scope}:${request.ip}`, policy.limit, policy.windowMs)) {
      return reply.code(429).send({ error: "Too many requests. Try again shortly." });
    }
    const context = authContextFromHeader(request.headers.authorization);
    if (context) {
      const requestWithAuth = request as typeof request & { userId?: string; tenantId?: string; sessionId?: string };
      requestWithAuth.userId = context.user.id;
      requestWithAuth.tenantId = context.user.tenantId;
      requestWithAuth.sessionId = context.session.id;
      return;
    }
    const apiKeyContext = apiKeyContextFromHeader(request.headers.authorization);
    if (apiKeyContext) {
      if (request.method !== "GET") {
        return reply.code(403).send({ error: "API keys are read-only." });
      }
      const requestWithApiKey = request as typeof request & { tenantId?: string; apiKeyId?: string };
      requestWithApiKey.tenantId = apiKeyContext.tenantId;
      requestWithApiKey.apiKeyId = apiKeyContext.apiKey.id;
      return;
    }
    if (authRequired() && !publicRoute(request.method, request.url)) {
      return reply.code(401).send({ error: "Sign in to continue." });
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "true-margin-tracker-api"
  }));

  app.post<{ Body: unknown }>("/auth/register", async (request, reply) => {
    const parsed = AuthRegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Enter a valid account.", issues: parsed.error.flatten() });
    }
    const email = normalizeEmail(parsed.data.email);
    if (runtimeUsers.some((user) => user.email === email)) {
      return reply.code(409).send({ error: "Account already exists." });
    }
    const now = new Date().toISOString();
    const tenant: RuntimeTenantAccount = {
      id: `tenant_${randomBytes(8).toString("hex")}`,
      name: parsed.data.workspaceName || "Main workspace",
      createdAt: now
    };
    tenantAccounts.push(tenant);
    ensureTenantState(tenant.id, tenant.name);
    const user: RuntimeUser = {
      id: `usr_${randomBytes(8).toString("hex")}`,
      tenantId: tenant.id,
      email,
      name: parsed.data.name || email.split("@")[0] || "Owner",
      passwordHash: passwordDigest(parsed.data.password),
      role: "owner",
      createdAt: now
    };
    runtimeUsers.push(user);
    const token = createSessionToken();
    const session: RuntimeSession = {
      id: `ses_${randomBytes(8).toString("hex")}`,
      tokenHash: sessionTokenHash(token),
      userId: user.id,
      tenantId: tenant.id,
      createdAt: now,
      expiresAt: sessionExpiry()
    };
    runtimeSessions.push(session);
    await persistRuntimeState();
    return reply.code(201).send({
      token,
      user: publicUser(user, tenant),
      tenant: { id: tenant.id, name: tenant.name }
    });
  });

  app.post<{ Body: unknown }>("/auth/login", async (request, reply) => {
    const parsed = AuthLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Enter your email and password." });
    }
    const email = normalizeEmail(parsed.data.email);
    const user = runtimeUsers.find((candidate) => candidate.email === email);
    if (!user || !verifyPasswordDigest(parsed.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: "Invalid email or password." });
    }
    const token = createSessionToken();
    const now = new Date().toISOString();
    const session: RuntimeSession = {
      id: `ses_${randomBytes(8).toString("hex")}`,
      tokenHash: sessionTokenHash(token),
      userId: user.id,
      tenantId: user.tenantId,
      createdAt: now,
      expiresAt: sessionExpiry()
    };
    runtimeSessions.push(session);
    await persistRuntimeState();
    return {
      token,
      user: publicUser(user, tenantAccounts.find((tenant) => tenant.id === user.tenantId))
    };
  });

  app.post("/auth/logout", async (request) => {
    const sessionId = (request as typeof request & { sessionId?: string }).sessionId;
    if (sessionId) {
      const index = runtimeSessions.findIndex((session) => session.id === sessionId);
      if (index >= 0) runtimeSessions.splice(index, 1);
      await persistRuntimeState();
    }
    return { loggedOut: true };
  });

  app.get("/team/members", async (request, reply) => {
    const requestWithAuth = request as typeof request & { userId?: string; tenantId?: string };
    if (!requestWithAuth.tenantId || !requestWithAuth.userId) {
      return reply.code(401).send({ error: "Sign in to manage team." });
    }
    const tenantState = requestTenantState(requestWithAuth);
    const access = teamAccessStatus(tenantState);
    return {
      allowed: access.allowed,
      plan: access.entitlements.plan,
      members: runtimeUsers.filter((user) => user.tenantId === requestWithAuth.tenantId).map(publicTeamMember),
      ...(access.error ? { error: access.error } : {})
    };
  });

  app.post<{ Body: unknown }>("/team/members", async (request, reply) => {
    const requestWithAuth = request as typeof request & { userId?: string; tenantId?: string };
    if (!requestWithAuth.tenantId || !requestWithAuth.userId) {
      return reply.code(401).send({ created: false, error: "Sign in to manage team." });
    }
    if (!canManageTeam(requestWithAuth)) {
      return reply.code(403).send({ created: false, error: "Admin access required." });
    }
    const tenantState = requestTenantState(requestWithAuth);
    const access = teamAccessStatus(tenantState);
    if (!access.allowed) {
      return reply.code(402).send({ created: false, error: access.error, plan: access.entitlements.plan });
    }
    const parsed = TeamMemberCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ created: false, error: "Enter a valid team member.", issues: parsed.error.flatten() });
    }
    const email = normalizeEmail(parsed.data.email);
    if (runtimeUsers.some((user) => user.tenantId === requestWithAuth.tenantId && user.email === email)) {
      return reply.code(409).send({ created: false, error: "Team member already exists." });
    }
    const user: RuntimeUser = {
      id: `usr_${randomBytes(8).toString("hex")}`,
      tenantId: requestWithAuth.tenantId,
      email,
      name: parsed.data.name || email.split("@")[0] || "Team member",
      passwordHash: passwordDigest(parsed.data.password),
      role: parsed.data.role,
      createdAt: new Date().toISOString()
    };
    runtimeUsers.push(user);
    await persistRuntimeState();
    return reply.code(201).send({
      created: true,
      member: publicTeamMember(user)
    });
  });

  app.delete<{ Params: { id: string } }>("/team/members/:id", async (request, reply) => {
    const requestWithAuth = request as typeof request & { userId?: string; tenantId?: string };
    if (!requestWithAuth.tenantId || !requestWithAuth.userId) {
      return reply.code(401).send({ deleted: false, error: "Sign in to manage team." });
    }
    if (!canManageTeam(requestWithAuth)) {
      return reply.code(403).send({ deleted: false, error: "Admin access required." });
    }
    if (request.params.id === requestWithAuth.userId) {
      return reply.code(409).send({ deleted: false, error: "You cannot remove your own account." });
    }
    const targetIndex = runtimeUsers.findIndex((user) => user.id === request.params.id && user.tenantId === requestWithAuth.tenantId);
    if (targetIndex < 0) {
      return reply.code(404).send({ deleted: false, error: "Team member not found." });
    }
    const [removed] = runtimeUsers.splice(targetIndex, 1);
    for (let index = runtimeSessions.length - 1; index >= 0; index -= 1) {
      if (runtimeSessions[index]?.userId === removed?.id) {
        runtimeSessions.splice(index, 1);
      }
    }
    await persistRuntimeState();
    return {
      deleted: true,
      memberId: request.params.id
    };
  });

  app.get("/api-keys", async (request, reply) => {
    const requestWithAuth = request as typeof request & { userId?: string; tenantId?: string };
    if (!requestWithAuth.tenantId || !requestWithAuth.userId) {
      return reply.code(401).send({ error: "Sign in to manage API keys." });
    }
    const tenantState = requestTenantState(requestWithAuth);
    const access = apiAccessStatus(tenantState);
    return {
      allowed: access.allowed,
      plan: access.entitlements.plan,
      keys: tenantState.apiKeys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt ?? null
      })),
      ...(access.error ? { error: access.error } : {})
    };
  });

  app.post<{ Body: unknown }>("/api-keys", async (request, reply) => {
    const requestWithAuth = request as typeof request & { userId?: string; tenantId?: string };
    if (!requestWithAuth.tenantId || !requestWithAuth.userId) {
      return reply.code(401).send({ created: false, error: "Sign in to manage API keys." });
    }
    if (!canManageTeam(requestWithAuth)) {
      return reply.code(403).send({ created: false, error: "Admin access required." });
    }
    const tenantState = requestTenantState(requestWithAuth);
    const access = apiAccessStatus(tenantState);
    if (!access.allowed) {
      return reply.code(402).send({ created: false, error: access.error, plan: access.entitlements.plan });
    }
    const parsed = ApiKeyCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ created: false, error: "Enter a valid API key name.", issues: parsed.error.flatten() });
    }
    const token = createApiKey();
    const apiKey: RuntimeApiKey = {
      id: `key_${randomBytes(8).toString("hex")}`,
      name: parsed.data.name,
      keyHash: apiKeyHash(token),
      prefix: token.slice(0, 14),
      createdAt: new Date().toISOString()
    };
    tenantState.apiKeys.unshift(apiKey);
    await persistRuntimeState();
    return reply.code(201).send({
      created: true,
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
        createdAt: apiKey.createdAt,
        lastUsedAt: null
      },
      token
    });
  });

  app.delete<{ Params: { id: string } }>("/api-keys/:id", async (request, reply) => {
    const requestWithAuth = request as typeof request & { userId?: string; tenantId?: string };
    if (!requestWithAuth.tenantId || !requestWithAuth.userId) {
      return reply.code(401).send({ deleted: false, error: "Sign in to manage API keys." });
    }
    if (!canManageTeam(requestWithAuth)) {
      return reply.code(403).send({ deleted: false, error: "Admin access required." });
    }
    const tenantState = requestTenantState(requestWithAuth);
    const index = tenantState.apiKeys.findIndex((key) => key.id === request.params.id);
    if (index < 0) {
      return reply.code(404).send({ deleted: false, error: "API key not found." });
    }
    tenantState.apiKeys.splice(index, 1);
    await persistRuntimeState();
    return {
      deleted: true,
      keyId: request.params.id
    };
  });

  app.get("/me", async (request) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const context = authContextFromHeader(request.headers.authorization);
    const entitlements = currentEntitlements(tenantState);
    if (context) {
      return {
        ...publicUser(context.user, tenantAccounts.find((tenant) => tenant.id === context.user.tenantId)),
        plan: entitlements.plan,
        licenseActive: entitlements.active
      };
    }
    return {
      id: "local",
      tenantId: "local",
      email: "",
      name: "Local",
      workspaceName: "Local workspace",
      plan: entitlements.plan,
      licenseActive: entitlements.active
    };
  });

  app.get("/stores", async (request) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    return {
      stores: seedDataEnabled()
        ? [
            {
              id: "store_shopify_main",
              name: "Seed Shopify Store",
              platform: "shopify",
              status: "connected",
              currency: "USD"
            },
            {
              id: "store_woocommerce_main",
              name: "Seed WooCommerce Store",
              platform: "woocommerce",
              status: "connected",
              currency: "USD"
            }
          ]
        : tenantState.stores
    };
  });

  app.delete<{ Params: { platform: string } }>("/stores/:platform", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const platform = request.params.platform.toLowerCase();
    if (!["shopify", "woocommerce", "wordpress"].includes(platform)) {
      return reply.code(400).send({ disconnected: false, error: "Unsupported store platform." });
    }

    const channel = platform === "shopify" ? "Shopify" : platform === "woocommerce" ? "WooCommerce" : "WordPress";
    for (let index = tenantState.stores.length - 1; index >= 0; index -= 1) {
      if (tenantState.stores[index]?.platform === platform) tenantState.stores.splice(index, 1);
    }
    for (let index = tenantState.webhookCredentials.length - 1; index >= 0; index -= 1) {
      if (tenantState.webhookCredentials[index]?.platform === platform) tenantState.webhookCredentials.splice(index, 1);
    }
    for (let index = tenantState.orders.length - 1; index >= 0; index -= 1) {
      const order = tenantState.orders[index];
      if (order?.channel === channel) {
        tenantState.orders.splice(index, 1);
        tenantState.orderPayloads.delete(order.id);
      }
    }
    for (let index = tenantState.products.length - 1; index >= 0; index -= 1) {
      if (tenantState.products[index]?.channel === channel) tenantState.products.splice(index, 1);
    }
    rebuildRuntimeProducts(tenantState.products, tenantState.orderPayloads);
    await persistRuntimeState();

    return {
      disconnected: true,
      platform
    };
  });

  app.get("/orders", async (request) => ({
    orders: requestTenantState(request as typeof request & { tenantId?: string }).orders
  }));

  app.post<{ Body: unknown }>("/stores/connect/woocommerce", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const parsed = PluginConnectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ connected: false, platform: "woocommerce", error: "Invalid WooCommerce connection settings.", issues: parsed.error.flatten() });
    }
    const storeId = "store_woocommerce_connected";
    const allowed = canConnectStore(tenantState, "woocommerce");
    if (!allowed.ok) {
      return reply.code(402).send({ connected: false, platform: "woocommerce", error: allowed.error });
    }
    const token = cleanText(parsed.data.connectionToken ?? parsed.data.token);
    const signingSecret = cleanText(parsed.data.signingSecret);
    if (strictPluginWebhooks() && (!token || !signingSecret)) {
      return reply.code(400).send({ connected: false, platform: "woocommerce", error: "Connection token and signing secret are required." });
    }
    if (!tenantState.stores.some((store) => store.id === storeId)) {
      tenantState.stores.push({
        id: storeId,
        name: cleanText(parsed.data.name) ?? "WooCommerce",
        platform: "woocommerce",
        status: "connected",
        currency: "USD"
      });
    }
    if (token) {
      upsertWebhookCredential(tenantState.webhookCredentials, {
        platform: "woocommerce",
        storeId,
        token,
        ...(signingSecret ? { signingSecret } : {})
      });
    }
    await persistRuntimeState();
    return {
      connected: true,
      platform: "woocommerce",
      storeId,
      message: "WooCommerce connection settings accepted"
    };
  });

  app.post<{ Body: unknown }>("/stores/connect/wordpress", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const parsed = PluginConnectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ connected: false, platform: "wordpress", mode: "catalog", error: "Invalid WordPress connection settings.", issues: parsed.error.flatten() });
    }
    const storeId = "store_wordpress_connected";
    const allowed = canConnectStore(tenantState, "wordpress");
    if (!allowed.ok) {
      return reply.code(402).send({ connected: false, platform: "wordpress", mode: "catalog", error: allowed.error });
    }
    const token = cleanText(parsed.data.connectionToken ?? parsed.data.token);
    const signingSecret = cleanText(parsed.data.signingSecret);
    if (strictPluginWebhooks() && (!token || !signingSecret)) {
      return reply.code(400).send({ connected: false, platform: "wordpress", mode: "catalog", error: "Connection token and signing secret are required." });
    }
    if (!tenantState.stores.some((store) => store.id === storeId)) {
      tenantState.stores.push({
        id: storeId,
        name: cleanText(parsed.data.name) ?? "WordPress",
        platform: "wordpress",
        status: "connected",
        currency: "USD"
      });
    }
    if (token) {
      upsertWebhookCredential(tenantState.webhookCredentials, {
        platform: "wordpress",
        storeId,
        token,
        ...(signingSecret ? { signingSecret } : {})
      });
    }
    await persistRuntimeState();
    return {
      connected: true,
      platform: "wordpress",
      storeId,
      mode: "catalog",
      message: "WordPress catalog settings accepted"
    };
  });

  app.post<{ Body: unknown }>("/stores/connect/shopify/install-link", async (request, reply) => {
    const parsed = ShopifyInstallLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Enter a Shopify store domain." });
    }

    let shop: string;
    try {
      shop = normalizeShopifyShop(parsed.data.shop);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Enter a myshopify.com domain." });
    }

    const tenantId = (request as typeof request & { tenantId?: string }).tenantId ?? "local";
    if (authRequired() && tenantId === "local") {
      return reply.code(401).send({ error: "Sign in to install Shopify." });
    }
    if (authRequired() && !shopifyInstallSecret()) {
      return reply.code(503).send({ error: "Shopify install signing is not configured." });
    }

    const installUrl = new URL("/api/shopify/install", shopifyAppUrl());
    installUrl.searchParams.set("shop", shop);
    const signedParams = signedShopifyInstallParams(tenantId, shop);
    for (const [key, value] of Object.entries(signedParams)) {
      installUrl.searchParams.set(key, value);
    }

    return {
      installUrl: installUrl.toString(),
      shop
    };
  });

  app.post<{ Body: unknown }>("/stores/connect/shopify/callback", async (request, reply) => {
    const body = recordFromUnknown(request.body);
    const requestTenantId = (request as typeof request & { tenantId?: string }).tenantId;
    const internalToken = shopifyInstallSecret();
    const authHeader = headerText(request.headers.authorization);
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    const internalTenantId = cleanText(body?.tenantId);
    if (!requestTenantId && authRequired()) {
      if (!internalToken || !bearer || !constantTimeEqual(bearer, internalToken) || !internalTenantId) {
        return reply.code(401).send({ connected: false, platform: "shopify", error: "Invalid Shopify install callback." });
      }
    }
    const tenantState = ensureTenantState(requestTenantId ?? internalTenantId ?? "local");
    const storeId = "store_shopify_connected";
    const allowed = canConnectStore(tenantState, "shopify");
    if (!allowed.ok) {
      return reply.code(402).send({ connected: false, platform: "shopify", error: allowed.error });
    }
    if (!tenantState.stores.some((store) => store.id === storeId)) {
      tenantState.stores.push({
        id: storeId,
        name: cleanText(body?.shop) ?? "Shopify",
        platform: "shopify",
        status: "connected",
        currency: "USD"
      });
    }
    await persistRuntimeState();
    return {
      connected: true,
      platform: "shopify",
      storeId,
      message: "Shopify OAuth callback accepted"
    };
  });

  app.get("/analytics/overview", async (request) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const products = seedDataEnabled() ? summarizeProducts() : tenantState.products;
    const metricProducts = products.filter((product) => product.unitsSold > 0);
    return {
      range: { from: "2026-05-01", to: "2026-05-31" },
      metrics: overviewMetrics(metricProducts),
      topProducts: products,
      alerts: buildAlerts(products)
    };
  });

  app.get("/products", async (request) => ({
    products: seedDataEnabled() ? summarizeProducts() : requestTenantState(request as typeof request & { tenantId?: string }).products
  }));

  app.delete<{ Params: { id: string } }>("/products/:id", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    if (seedDataEnabled()) {
      return reply.code(409).send({ deleted: false, error: "Seed products cannot be deleted." });
    }

    const productId = request.params.id;
    const sourceId = productSourceId(productId);
    const productIndex = tenantState.products.findIndex((product) => product.id === productId);
    const linkedOrderIds = tenantState.orders
      .filter((order) => order.productIds.includes(sourceId) || order.productIds.includes(productId))
      .map((order) => order.id);

    if (productIndex < 0 && linkedOrderIds.length === 0) {
      return reply.code(404).send({ deleted: false, error: "Product not found." });
    }

    for (const orderId of linkedOrderIds) {
      const orderIndex = tenantState.orders.findIndex((order) => order.id === orderId);
      if (orderIndex >= 0) tenantState.orders.splice(orderIndex, 1);
      tenantState.orderPayloads.delete(orderId);
    }
    if (productIndex >= 0) {
      tenantState.products.splice(productIndex, 1);
    }
    rebuildRuntimeProducts(tenantState.products, tenantState.orderPayloads);
    await persistRuntimeState();

    return {
      deleted: true,
      productId,
      deletedOrders: linkedOrderIds.length
    };
  });

  app.post<{ Body: unknown }>("/price-scout/analyze", async (request, reply) => {
    const parsed = PriceScoutRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Enter a valid product URL." });
    }

    let productUrl: URL;
    try {
      productUrl = validatedProductUrl(parsed.data.url);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Enter a valid product URL." });
    }

    try {
      await assertPublicHostname(productUrl.hostname);
      const response = await fetch(productUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "TrueMarginTracker/1.0 (+https://truemargintracker.app)"
        },
        redirect: "manual",
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        return reply.code(502).send({ error: "Product URL could not be read." });
      }

      const html = await readLimitedText(response);
      const product = extractProductFromHtml(productUrl, html);
      const market = await fetchPriceScoutMarket(product);
      return {
        product,
        market
      };
    } catch {
      return reply.code(502).send({ error: "Product URL could not be read." });
    }
  });

  app.get<{ Params: { id: string } }>("/products/:id/margin", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const product = (seedDataEnabled() ? summarizeProducts() : tenantState.products).find((candidate) => candidate.id === request.params.id);
    if (!product) {
      return reply.code(404).send({ error: "Product not found" });
    }

    return {
      product,
      margin: product.margin,
      breakEvenCpaMinor: product.margin.breakEvenCpaMinor
    };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/products/:id/costs", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const parsed = ProductCostUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid product cost payload",
        issues: parsed.error.flatten()
      });
    }

    const productIndex = tenantState.products.findIndex((product) => product.id === request.params.id);
    if (productIndex >= 0) {
      tenantState.products[productIndex] = applyProductCostUpdate(tenantState.products[productIndex]!, parsed.data);
      await persistRuntimeState();
    }

    return {
      productId: request.params.id,
      saved: true,
      costUpdate: parsed.data
    };
  });

  app.post<{ Body: unknown }>("/costs/import", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const parsed = CostImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Paste at least one CSV row." });
    }

    try {
      const imported = parseCostImport(parsed.data.csv);
      let appliedRows = 0;
      for (const row of imported.rows) {
        const productIndex = tenantState.products.findIndex((product) => product.sku.toLowerCase() === row.sku.toLowerCase());
        if (productIndex < 0) continue;
        tenantState.products[productIndex] = applyProductCostUpdate(tenantState.products[productIndex]!, {
          cogsMinor: row.cogsMinor,
          packagingCostMinor: row.packagingCostMinor ?? undefined,
          returnCostMinor: row.returnCostMinor ?? undefined
        });
        appliedRows += 1;
      }
      tenantState.costRules = { ...tenantState.costRules, importedRows: imported.importedRows };
      await persistRuntimeState();
      return {
        saved: true,
        ...imported,
        appliedRows
      };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid cost import." });
    }
  });

  app.get("/cost-rules", async (request) => ({
    rules: requestTenantState(request as typeof request & { tenantId?: string }).costRules
  }));

  app.post<{ Body: unknown }>("/cost-rules", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const parsed = CostRulesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid cost rules",
        issues: parsed.error.flatten()
      });
    }

    tenantState.costRules = { ...tenantState.costRules, ...parsed.data };
    await persistRuntimeState();

    return {
      saved: true,
      rules: tenantState.costRules
    };
  });

  app.get("/workspace/settings", async (request) => ({
    settings: requestTenantState(request as typeof request & { tenantId?: string }).workspaceSettings
  }));

  app.post<{ Body: unknown }>("/workspace/settings", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const parsed = WorkspaceSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid workspace settings",
        issues: parsed.error.flatten()
      });
    }

    tenantState.workspaceSettings = { ...tenantState.workspaceSettings, ...parsed.data };
    await persistRuntimeState();

    return {
      saved: true,
      settings: tenantState.workspaceSettings
    };
  });

  app.get("/billing", async (request) => ({
    billing: publicBillingState(requestTenantState(request as typeof request & { tenantId?: string }).billing)
  }));

  app.get("/license/status", async (request) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    return {
      billing: publicBillingState(tenantState.billing),
      entitlements: currentEntitlements(tenantState)
    };
  });

  app.post<{ Body: unknown }>("/billing", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const parsed = BillingUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid billing settings",
        issues: parsed.error.flatten()
      });
    }

    tenantState.billing = {
      ...tenantState.billing,
      plan: parsed.data.plan,
      billingEmail: parsed.data.billingEmail ?? ""
    };
    await persistRuntimeState();

    return {
      saved: true,
      billing: publicBillingState(tenantState.billing)
    };
  });

  app.post<{ Body: unknown }>("/licenses/issue", async (request, reply) => {
    const issuer = verifyLicenseIssuer(request);
    if (!issuer.ok) {
      return reply.code(issuer.statusCode).send({ issued: false, error: issuer.error });
    }

    const parsed = LicenseIssueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        issued: false,
        error: "Invalid license issue payload.",
        issues: parsed.error.flatten()
      });
    }

    const { license, licenseKey } = createRuntimeLicense(parsed.data.plan, parsed.data.billingEmail, parsed.data.externalOrderId, parsed.data.externalCustomerId);
    if (licenseKey) runtimeLicenses.unshift(license);
    await persistRuntimeState();

    return {
      issued: true,
      licenseId: license.id,
      licenseKey,
      plan: license.plan,
      billingEmail: license.billingEmail,
      limits: planLimits[license.plan]
    };
  });

  app.post<{ Body: unknown }>("/licenses/sales/webhook", async (request, reply) => {
    const secret = salesWebhookSecret();
    if (!secret) {
      return reply.code(503).send({ received: false, issued: false, error: "Sales webhook is not configured." });
    }

    const rawRequest = request as typeof request & { rawBody?: string };
    const rawBody = rawRequest.rawBody ?? JSON.stringify(request.body ?? {});
    const signature = headerText(request.headers["x-tmt-signature"])?.trim();
    if (!signature || !constantTimeEqual(signature, signedWebhookPayload(rawBody, secret))) {
      return reply.code(401).send({ received: false, issued: false, error: "Invalid sales webhook signature." });
    }

    const parsed = LicenseSaleWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        received: true,
        issued: false,
        error: "Invalid sales webhook payload.",
        issues: parsed.error.flatten()
      });
    }

    const existing = runtimeLicenses.find((license) => license.externalOrderId === parsed.data.externalOrderId);
    if (existing) {
      return {
        received: true,
        issued: true,
        duplicate: true,
        licenseId: existing.id,
        plan: existing.plan,
        billingEmail: existing.billingEmail
      };
    }

    const { license, licenseKey } = createRuntimeLicense(parsed.data.plan, parsed.data.billingEmail, parsed.data.externalOrderId, parsed.data.externalCustomerId);
    if (licenseDeliveryConfig()) {
      try {
        await deliverLicenseKey({
          licenseId: license.id,
          licenseKey,
          plan: license.plan,
          billingEmail: license.billingEmail,
          externalOrderId: parsed.data.externalOrderId
        });
      } catch (error) {
        return reply.code(503).send({
          received: true,
          issued: false,
          error: error instanceof Error ? error.message : "License delivery failed."
        });
      }
    }

    runtimeLicenses.unshift(license);
    await persistRuntimeState();

    return {
      received: true,
      issued: true,
      licenseId: license.id,
      licenseKey,
      plan: license.plan,
      billingEmail: license.billingEmail,
      provider: parsed.data.provider ?? "owner-site",
      delivered: Boolean(licenseDeliveryConfig())
    };
  });

  app.post<{ Params: { id: string } }>("/licenses/:id/revoke", async (request, reply) => {
    const issuer = verifyLicenseIssuer(request);
    if (!issuer.ok) {
      return reply.code(issuer.statusCode).send({ revoked: false, error: issuer.error });
    }

    const license = runtimeLicenses.find((candidate) => candidate.id === request.params.id);
    if (!license) {
      return reply.code(404).send({ revoked: false, error: "License not found." });
    }

    license.status = "revoked";
    for (const tenantState of tenantStates.values()) {
      if (tenantState.billing.licenseId === license.id) {
        tenantState.billing = {
          ...tenantState.billing,
          licenseStatus: "Inactive",
          licenseKey: "",
          licenseId: ""
        };
      }
    }
    await persistRuntimeState();

    return {
      revoked: true,
      licenseId: license.id
    };
  });

  app.post<{ Body: unknown }>("/license/activate", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const parsed = LicenseActivationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Enter a valid license key.",
        issues: parsed.error.flatten()
      });
    }

    let activation: Awaited<ReturnType<typeof activateExternalLicense>>;
    try {
      activation = await activateExternalLicense(parsed.data.licenseKey, parsed.data.billingEmail || undefined);
    } catch (error) {
      if (error instanceof ExternalServiceError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          active: false
        });
      }
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "License activation failed.",
        active: false
      });
    }

    if (!activation) {
      if (!runtimeLicenses.length && !licenseIssuerToken()) {
        return reply.code(503).send({
          error: "License activation is not configured.",
          configured: false,
          active: false
        });
      }
      const license = runtimeLicenses.find((candidate) => candidate.keyHash === licenseKeyHash(parsed.data.licenseKey));
      if (!license) {
        return reply.code(422).send({
          error: "License key not found.",
          configured: true,
          active: false
        });
      }
      if (license.status !== "active") {
        return reply.code(422).send({
          error: "License key is inactive.",
          configured: true,
          active: false
        });
      }
      const requestedEmail = parsed.data.billingEmail?.toLowerCase();
      if (requestedEmail && requestedEmail !== license.billingEmail) {
        return reply.code(422).send({
          error: "License email does not match.",
          configured: true,
          active: false
        });
      }
      const activatedAt = new Date().toISOString();
      license.activatedAt = license.activatedAt ?? activatedAt;
      license.lastActivatedAt = activatedAt;
      activation = {
        active: true,
        plan: license.plan,
        licenseId: license.id
      };
    } else {
      const existing = runtimeLicenses.find((candidate) => candidate.keyHash === licenseKeyHash(parsed.data.licenseKey));
      const activatedAt = new Date().toISOString();
      if (existing) {
        existing.status = "active";
        existing.plan = activation.plan;
        existing.billingEmail = (parsed.data.billingEmail || existing.billingEmail).toLowerCase();
        existing.activatedAt = existing.activatedAt ?? activatedAt;
        existing.lastActivatedAt = activatedAt;
      } else {
        runtimeLicenses.unshift({
          id: activation.licenseId || `lic_${randomBytes(8).toString("hex")}`,
          keyHash: licenseKeyHash(parsed.data.licenseKey),
          plan: activation.plan,
          billingEmail: (parsed.data.billingEmail || "").toLowerCase(),
          status: "active",
          issuedAt: activatedAt,
          activatedAt,
          lastActivatedAt: activatedAt
        });
      }
    }

    tenantState.billing = {
      ...tenantState.billing,
      billingEmail: parsed.data.billingEmail ?? tenantState.billing.billingEmail,
      licenseKey: maskLicenseKey(parsed.data.licenseKey),
      licenseStatus: activation.active ? "Active" : "Inactive",
      plan: activation.plan,
      licenseId: activation.licenseId
    };
    await persistRuntimeState();

    return activation;
  });

  app.post<{ Body: unknown }>("/billing/checkout", async (request, reply) => {
    const parsed = BillingCheckoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Enter a valid billing email.",
        issues: parsed.error.flatten()
      });
    }

    let stripeCheckoutUrl: string | null;
    try {
      stripeCheckoutUrl = await createStripeCheckoutSession(parsed.data.plan, parsed.data.billingEmail);
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Stripe checkout could not be created.",
        provider: "stripe"
      });
    }
    if (stripeCheckoutUrl) {
      return {
        provider: "stripe",
        checkoutUrl: stripeCheckoutUrl
      };
    }

    let checkoutUrl: string | null;
    try {
      checkoutUrl = externalCheckoutUrl(parsed.data.plan, parsed.data.billingEmail);
    } catch {
      return reply.code(500).send({
        error: "Checkout URL is invalid.",
        configured: false
      });
    }
    if (!checkoutUrl) {
      return reply.code(503).send({
        error: "Checkout is not configured.",
        configured: false
      });
    }

    return {
      provider: "external",
      checkoutUrl
    };
  });

  app.post<{ Body: unknown }>("/billing/stripe/webhook", async (request, reply) => {
    const secret = stripeWebhookSecret();
    if (!secret) {
      return reply.code(503).send({ received: false, error: "Stripe webhook is not configured." });
    }
    const rawRequest = request as typeof request & { rawBody?: string };
    const rawBody = rawRequest.rawBody ?? JSON.stringify(request.body ?? {});
    const signature = headerText(request.headers["stripe-signature"]);
    if (!verifyStripeWebhookSignature(rawBody, signature, secret)) {
      return reply.code(400).send({ received: false, error: "Invalid Stripe signature." });
    }

    const event = recordFromUnknown(request.body);
    const eventType = cleanText(event?.type);
    if (eventType !== "checkout.session.completed") {
      return { received: true, processed: false };
    }

    const data = recordFromUnknown(event?.data);
    const session = recordFromUnknown(data?.object);
    const metadata = recordFromUnknown(session?.metadata);
    const plan = BillingPlanSchema.safeParse(cleanText(metadata?.plan));
    const billingEmail = cleanText(metadata?.billing_email) ??
      cleanText(session?.customer_email) ??
      cleanText(recordFromUnknown(session?.customer_details)?.email);
    const externalOrderId = cleanText(session?.id) ?? cleanText(event?.id) ?? `stripe_${randomBytes(8).toString("hex")}`;
    const externalCustomerId = cleanText(session?.customer);

    if (!plan.success || !billingEmail) {
      return reply.code(422).send({ received: true, processed: false, error: "Stripe session is missing plan or billing email." });
    }

    const existing = runtimeLicenses.find((license) => license.externalOrderId === externalOrderId);
    if (existing) {
      return {
        received: true,
        processed: true,
        duplicate: true,
        licenseId: existing.id
      };
    }

    const { license, licenseKey } = createRuntimeLicense(plan.data, billingEmail, externalOrderId, externalCustomerId ?? undefined);
    try {
      await deliverLicenseKey({
        licenseId: license.id,
        licenseKey,
        plan: license.plan,
        billingEmail: license.billingEmail,
        externalOrderId
      });
    } catch (error) {
      return reply.code(503).send({
        received: true,
        processed: false,
        error: error instanceof Error ? error.message : "License delivery failed."
      });
    }
    runtimeLicenses.unshift(license);
    await persistRuntimeState();

    return {
      received: true,
      processed: true,
      licenseId: license.id,
      plan: license.plan,
      billingEmail: license.billingEmail
    };
  });

  app.get("/alerts/events", async (request) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    return {
      alerts: buildAlerts(seedDataEnabled() ? summarizeProducts() : tenantState.products)
    };
  });

  app.get("/integrations", async () => ({
    integrations
  }));

  app.post<{ Body: unknown }>("/integrations/validate", async (request, reply) => {
    const parsed = IntegrationValidationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: "Invalid integration settings",
        issues: parsed.error.flatten()
      });
    }

    try {
      const result = await validateIntegrationConnection(parsed.data.name, parsed.data.endpoint, parsed.data.token);
      return reply.code(result.ok ? 200 : 422).send({
        ...result,
        key: integrationKey(parsed.data.name)
      });
    } catch (error) {
      return reply.code(400).send({
        ok: false,
        error: error instanceof Error ? error.message : "Integration validation failed."
      });
    }
  });

  app.post("/stores/:id/sync-now", async (request) => ({
    storeId: (request.params as { id: string }).id,
    queued: true,
    jobType: "incremental_sync"
  }));

  app.delete<{ Params: { id: string } }>("/orders/:id", async (request, reply) => {
    const tenantState = requestTenantState(request as typeof request & { tenantId?: string });
    const orderIndex = tenantState.orders.findIndex((order) => order.id === request.params.id || order.sourceOrderId === request.params.id);
    if (orderIndex < 0) {
      return reply.code(404).send({ deleted: false, error: "Order not found." });
    }

    const [deletedOrder] = tenantState.orders.splice(orderIndex, 1);
    if (deletedOrder) {
      tenantState.orderPayloads.delete(deletedOrder.id);
    }
    rebuildRuntimeProducts(tenantState.products, tenantState.orderPayloads);
    await persistRuntimeState();

    return {
      deleted: true,
      orderId: deletedOrder?.id ?? request.params.id
    };
  });

  app.post<{ Body: unknown }>("/webhooks/shopify", async (request, reply) => {
    const body = recordFromUnknown(request.body);
    const requestTenantId = (request as typeof request & { tenantId?: string }).tenantId;
    const internalToken = shopifyInstallSecret();
    const authHeader = headerText(request.headers.authorization);
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    const internalTenantId = cleanText(body?.tenantId);
    if (!requestTenantId && authRequired()) {
      if (!internalToken || !bearer || !constantTimeEqual(bearer, internalToken) || !internalTenantId) {
        return reply.code(401).send({ accepted: false, error: "Invalid Shopify webhook relay." });
      }
    }
    const tenantState = ensureTenantState(requestTenantId ?? internalTenantId ?? "local");
    const order = webhookOrderSummary("Shopify", request.body);
    if (order) {
      upsertRuntimeOrder(tenantState.orders, tenantState.orderPayloads, tenantState.products, order, "Shopify", request.body);
      await persistRuntimeState();
    }
    return {
      accepted: true,
      queued: true,
      importedOrder: Boolean(order)
    };
  });

  app.post<{ Body: unknown }>("/webhooks/woocommerce", async (request, reply) => {
    const verification = verifyPluginWebhook("woocommerce", request);
    if (!verification.ok) {
      return reply.code(401).send({ accepted: false, error: verification.error });
    }
    const tenantState = verification.state ?? requestTenantState(request as typeof request & { tenantId?: string });
    const order = webhookOrderSummary("WooCommerce", request.body);
    if (order) {
      upsertRuntimeOrder(tenantState.orders, tenantState.orderPayloads, tenantState.products, order, "WooCommerce", request.body);
      await persistRuntimeState();
    }
    return {
      accepted: true,
      queued: true,
      importedOrder: Boolean(order)
    };
  });

  app.post<{ Body: unknown }>("/webhooks/wordpress", async (request, reply) => {
    const verification = verifyPluginWebhook("wordpress", request);
    if (!verification.ok) {
      return reply.code(401).send({ accepted: false, error: verification.error });
    }
    const tenantState = verification.state ?? requestTenantState(request as typeof request & { tenantId?: string });
    const product = catalogProductSummary(request.body);
    if (product) {
      const existingIndex = tenantState.products.findIndex((item) => item.id === product.id);
      if (existingIndex >= 0) {
        tenantState.products[existingIndex] = product;
      } else {
        tenantState.products.unshift(product);
      }
      await persistRuntimeState();
    }
    return {
      accepted: true,
      queued: true,
      importedProduct: Boolean(product),
      mode: "catalog"
    };
  });

  return app;
}
