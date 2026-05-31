import { calculateLineMargin, type LineMarginResult } from "@tmt/margin-engine";
import { workspaceProducts, type AlertEvent, type WorkspaceProduct } from "@tmt/shared";

export interface ProductSummary extends WorkspaceProduct {
  margin: LineMarginResult;
}

export function summarizeProducts(): ProductSummary[] {
  return workspaceProducts.map((product) => ({
    ...product,
    margin: calculateLineMargin({
      lineId: product.id,
      productId: product.id,
      sku: product.sku,
      quantity: product.unitsSold,
      currency: product.currency,
      productSalesMinor: product.revenueMinor,
      cogsMinor: product.cogsMinor,
      packagingCostMinor: product.packagingMinor,
      realShippingCostMinor: product.shippingCostMinor,
      paymentProcessingFeeMinor: product.feesMinor,
      adSpendAllocatedMinor: product.adCostMinor,
      returnShippingCostMinor: product.returnsMinor,
      costSources: {
        shipping: { sourceType: "rule", sourceName: "Configured shipping rule", confidenceScore: 0.72 },
        ad_spend: { sourceType: "imported", sourceName: "Ad CSV import", confidenceScore: 0.82 },
        payment_processing: {
          sourceType: product.channel === "Shopify" ? "exact" : "estimated",
          sourceName: product.channel === "Shopify" ? "Stripe balance transaction" : "Gateway estimate",
          confidenceScore: product.channel === "Shopify" ? 1 : 0.68
        }
      }
    })
  }));
}

export function buildAlerts(products = summarizeProducts()): AlertEvent[] {
  return products
    .filter((product) => product.margin.status !== "profitable")
    .map((product, index) => ({
      id: `alert_${product.id}`,
      productId: product.id,
      title: product.title,
      severity: product.margin.status === "loss" ? "loss" : product.margin.status === "unknown" ? "unknown" : "warning",
      message:
        product.margin.status === "unknown"
          ? "Critical costs are missing, so this product cannot be trusted yet."
          : product.margin.status === "loss"
            ? "This product is losing money after all tracked costs."
            : "This product is profitable, but below the target margin threshold.",
      suggestedAction:
        product.margin.status === "unknown"
          ? "Add product cost and rerun margin calculation."
          : product.adCostMinor > product.margin.breakEvenCpaMinor
            ? "Review ad spend and lower target CPA."
            : "Review pricing, shipping, and return assumptions.",
      updatedMinutesAgo: 12 + index * 7
    }));
}

export function overviewMetrics(products = summarizeProducts()) {
  const totals = products.reduce(
    (acc, product) => {
      acc.revenueMinor += product.margin.revenueNetMinor;
      acc.realMarginMinor += product.margin.trueMarginMinor;
      acc.adCostMinor += product.adCostMinor;
      acc.shippingCostMinor += product.shippingCostMinor;
      acc.returnCostMinor += product.returnsMinor;
      acc.feesMinor += product.feesMinor;
      if (product.margin.status === "loss") {
        acc.unprofitableProducts += 1;
      }
      return acc;
    },
    {
      revenueMinor: 0,
      realMarginMinor: 0,
      adCostMinor: 0,
      shippingCostMinor: 0,
      returnCostMinor: 0,
      feesMinor: 0,
      unprofitableProducts: 0
    }
  );

  return {
    ...totals,
    averageMarginPercent: totals.revenueMinor > 0 ? Number(((totals.realMarginMinor / totals.revenueMinor) * 100).toFixed(2)) : null,
    currency: "USD" as const
  };
}
