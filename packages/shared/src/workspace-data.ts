export interface WorkspaceProduct {
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
}

export interface AlertEvent {
  id: string;
  productId: string;
  title: string;
  severity: "loss" | "warning" | "unknown";
  message: string;
  suggestedAction: string;
  updatedMinutesAgo: number;
}

export interface IntegrationStatus {
  key: string;
  name: string;
  status: "connected" | "needs_setup";
  type: "store" | "payment" | "ads" | "shipping";
  sourcePrecision: "exact" | "estimated" | "imported" | "manual" | "rule";
  lastSyncMinutesAgo?: number;
}

export const workspaceProducts: WorkspaceProduct[] = [
  {
    id: "wireless-headphones",
    title: "Wireless Bluetooth Headphones",
    sku: "WBH-1000-BLK",
    channel: "Shopify",
    image: "headphones",
    unitsSold: 532,
    revenueMinor: 1298210,
    cogsMinor: 487500,
    adCostMinor: 459123,
    shippingCostMinor: 123475,
    feesMinor: 111236,
    returnsMinor: 68912,
    packagingMinor: 42560,
    currency: "USD"
  },
  {
    id: "yoga-mat",
    title: "Yoga Mat",
    sku: "YM-200-BLU",
    channel: "Shopify",
    image: "mat",
    unitsSold: 318,
    revenueMinor: 745221,
    cogsMinor: 238500,
    adCostMinor: 125632,
    shippingCostMinor: 103520,
    feesMinor: 65325,
    returnsMinor: 27841,
    packagingMinor: 25440,
    currency: "USD"
  },
  {
    id: "steel-bottle",
    title: "Stainless Steel Water Bottle",
    sku: "SSB-750-SLV",
    channel: "Shopify",
    image: "bottle",
    unitsSold: 284,
    revenueMinor: 698545,
    cogsMinor: 214000,
    adCostMinor: 108745,
    shippingCostMinor: 90235,
    feesMinor: 59821,
    returnsMinor: 24543,
    packagingMinor: 22720,
    currency: "USD"
  },
  {
    id: "clear-phone-case",
    title: "Phone Case - Clear",
    sku: "CASE-CLR-14",
    channel: "WooCommerce",
    image: "case",
    unitsSold: 611,
    revenueMinor: 521134,
    cogsMinor: 184200,
    adCostMinor: 89214,
    shippingCostMinor: 70145,
    feesMinor: 44233,
    returnsMinor: 19328,
    packagingMinor: 36660,
    currency: "USD"
  },
  {
    id: "resistance-bands",
    title: "Resistance Bands Set",
    sku: "RBS-5PK",
    channel: "Shopify",
    image: "bands",
    unitsSold: 407,
    revenueMinor: 491222,
    cogsMinor: 140000,
    adCostMinor: 51212,
    shippingCostMinor: 67821,
    feesMinor: 42135,
    returnsMinor: 14123,
    packagingMinor: 32560,
    currency: "USD"
  },
  {
    id: "performance-hoodie",
    title: "Men's Performance Hoodie",
    sku: "HOOD-PERF-BLU",
    channel: "WooCommerce",
    image: "hoodie",
    unitsSold: 189,
    revenueMinor: 815432,
    cogsMinor: 441000,
    adCostMinor: 273488,
    shippingCostMinor: 125022,
    feesMinor: 104518,
    returnsMinor: 35641,
    packagingMinor: 18900,
    currency: "USD"
  },
  {
    id: "ceramic-mug",
    title: "Ceramic Coffee Mug",
    sku: "MUG-WHT-12",
    channel: "WooCommerce",
    image: "mug",
    unitsSold: 276,
    revenueMinor: 214875,
    cogsMinor: null,
    adCostMinor: 24532,
    shippingCostMinor: 41210,
    feesMinor: 19822,
    returnsMinor: 9241,
    packagingMinor: 22080,
    currency: "USD"
  }
];

export const integrations: IntegrationStatus[] = [
  { key: "shopify", name: "Shopify", status: "needs_setup", type: "store", sourcePrecision: "exact" },
  { key: "woocommerce", name: "WooCommerce", status: "needs_setup", type: "store", sourcePrecision: "exact" },
  { key: "wordpress", name: "WordPress", status: "needs_setup", type: "store", sourcePrecision: "manual" },
  { key: "stripe", name: "Stripe", status: "needs_setup", type: "payment", sourcePrecision: "exact" },
  { key: "paypal", name: "PayPal", status: "needs_setup", type: "payment", sourcePrecision: "estimated" },
  { key: "meta", name: "Meta Ads", status: "needs_setup", type: "ads", sourcePrecision: "imported" },
  { key: "tiktok", name: "TikTok Ads", status: "needs_setup", type: "ads", sourcePrecision: "imported" },
  { key: "google", name: "Google Ads", status: "needs_setup", type: "ads", sourcePrecision: "imported" },
  { key: "manual-shipping", name: "Shipping Rules", status: "needs_setup", type: "shipping", sourcePrecision: "rule" },
  { key: "manual-imports", name: "Manual Imports", status: "needs_setup", type: "ads", sourcePrecision: "manual" }
];
