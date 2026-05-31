import { z } from "zod";

export const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/)
});

export const DateRangeSchema = z.object({
  from: z.string().date(),
  to: z.string().date()
});

export const StorePlatformSchema = z.enum(["shopify", "woocommerce", "wordpress"]);

export const IntegrationNameSchema = z.enum(["Shopify", "WooCommerce", "WordPress", "Stripe", "PayPal", "Meta Ads", "TikTok Ads", "Google Ads", "Shipping Rules", "Manual Imports"]);

export const ProductStatusSchema = z.enum(["profitable", "warning", "loss", "unknown"]);

export const CostSourceSchema = z.enum(["exact", "estimated", "manual", "imported", "rule"]);

export const ProductCostUpdateSchema = z.object({
  cogsMinor: z.number().int().nonnegative().nullable().optional(),
  packagingCostMinor: z.number().int().nonnegative().optional(),
  returnCostMinor: z.number().int().nonnegative().optional(),
  returnLossPercent: z.number().min(0).max(100).optional()
});

export const IntegrationValidationSchema = z.object({
  name: IntegrationNameSchema,
  endpoint: z.string().trim().min(1).max(2048),
  token: z.string().trim().max(4096).optional()
});

export const WorkspaceSettingsSchema = z.object({
  storeName: z.string().trim().max(120).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional().or(z.literal("")),
  taxMode: z.string().trim().max(40).optional(),
  language: z.literal("English").default("English"),
  alertLoss: z.boolean().default(false),
  alertCosts: z.boolean().default(false),
  alertReturns: z.boolean().default(false),
  alertEmail: z.boolean().default(false)
});

export const BillingUpdateSchema = z.object({
  plan: z.enum(["Starter", "Growth", "Pro"]),
  billingEmail: z.string().trim().email().optional().or(z.literal(""))
});

export const BillingCheckoutSchema = z.object({
  plan: z.enum(["Starter", "Growth", "Pro"]),
  billingEmail: z.string().trim().email()
});

export const LicenseActivationSchema = z.object({
  licenseKey: z.string().trim().min(8).max(120),
  billingEmail: z.string().trim().email().optional().or(z.literal(""))
});

export const CostImportSchema = z.object({
  csv: z.string().trim().min(1).max(100_000)
});

export const AdSpendCsvRowSchema = z.object({
  date: z.string().date(),
  platform: z.string().min(1),
  campaign: z.string().min(1),
  sku: z.string().optional(),
  productHandle: z.string().optional(),
  utmCampaign: z.string().optional(),
  spendMinor: z.number().int().nonnegative(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  clicks: z.number().int().nonnegative().optional(),
  purchases: z.number().int().nonnegative().optional()
});

export type ProductCostUpdate = z.infer<typeof ProductCostUpdateSchema>;
export type IntegrationValidation = z.infer<typeof IntegrationValidationSchema>;
export type BillingCheckout = z.infer<typeof BillingCheckoutSchema>;
export type LicenseActivation = z.infer<typeof LicenseActivationSchema>;
export type AdSpendCsvRow = z.infer<typeof AdSpendCsvRowSchema>;
