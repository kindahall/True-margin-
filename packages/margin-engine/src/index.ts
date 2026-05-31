export * from "./types.js";

import type {
  BreakEvenInput,
  BreakEvenResult,
  CostAllocationInput,
  CostAllocationLine,
  CostAllocationResult,
  CostAllocationStrategy,
  CostComponent,
  LineMarginInput,
  LineMarginResult,
  OrderLevelCostInput,
  OrderMarginInput,
  OrderMarginResult,
  ProductMarginAggregateInput,
  ProductMarginAggregateResult,
  ProductMarginStatus
} from "./types.js";

const DEFAULT_WARNING_THRESHOLD_PERCENT = 10;

function minor(value: number | null | undefined): number {
  if (value == null) {
    return 0;
  }
  if (!Number.isFinite(value)) {
    throw new Error("Money amounts must be finite numbers");
  }
  return Math.round(value);
}

function ratioPercent(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function statusFor(marginMinor: number, marginPercent: number | null, threshold: number, missingCosts: string[]): ProductMarginStatus {
  if (missingCosts.length > 0) {
    return "unknown";
  }
  if (marginMinor < 0) {
    return "loss";
  }
  if (marginPercent != null && marginPercent < threshold) {
    return "warning";
  }
  return "profitable";
}

function cost(
  input: LineMarginInput,
  key: CostComponent["key"],
  label: string,
  amountMinor: number,
  fallbackSourceType: CostComponent["sourceType"] = "manual",
  fallbackSourceName = "Manual"
): CostComponent {
  const override = input.costSources?.[key] ?? {};
  return {
    key,
    label,
    amountMinor,
    sourceType: override.sourceType ?? fallbackSourceType,
    sourceName: override.sourceName ?? fallbackSourceName,
    confidenceScore: override.confidenceScore ?? (fallbackSourceType === "exact" ? 1 : 0.75),
    ...(override.appliedRuleId ? { appliedRuleId: override.appliedRuleId } : {})
  };
}

export function calculateBreakEvenAdSpend(input: BreakEvenInput): BreakEvenResult {
  const revenueNetMinor = minor(input.revenueNetMinor);
  const allCostsExceptAdsMinor = minor(input.allCostsExceptAdsMinor);
  const adSpendAllocatedMinor = minor(input.adSpendAllocatedMinor);
  const breakEvenCpaMinor = revenueNetMinor - allCostsExceptAdsMinor;

  return {
    breakEvenCpaMinor,
    breakEvenRoas: adSpendAllocatedMinor > 0 ? Number((revenueNetMinor / adSpendAllocatedMinor).toFixed(2)) : null,
    structurallyUnprofitableWithoutAds: breakEvenCpaMinor <= 0
  };
}

export function calculateLineMargin(input: LineMarginInput): LineMarginResult {
  if (input.quantity <= 0) {
    throw new Error("Line quantity must be greater than zero");
  }

  const missingCosts: string[] = [];
  if (input.cogsMinor == null) {
    missingCosts.push("cogs");
  }

  const productSalesMinor = minor(input.productSalesMinor);
  const shippingRevenueMinor = minor(input.shippingRevenueMinor);
  const discountMinor = minor(input.discountMinor);
  const refundsMinor = minor(input.refundsMinor);
  const taxMinor = input.includeTaxesInRevenue === true ? 0 : minor(input.taxMinor);
  const revenueNetMinor = productSalesMinor + shippingRevenueMinor - discountMinor - refundsMinor - taxMinor;

  const costs: CostComponent[] = [
    cost(input, "cogs", "Product cost", minor(input.cogsMinor), "manual", "Product COGS"),
    cost(input, "packaging", "Packaging", minor(input.packagingCostMinor), "rule", "Packaging rule"),
    cost(input, "fulfillment", "Fulfillment", minor(input.fulfillmentCostMinor), "rule", "Fulfillment rule"),
    cost(input, "shipping", "Shipping", minor(input.realShippingCostMinor), "exact", "Shipping integration"),
    cost(input, "payment_processing", "Payment processing", minor(input.paymentProcessingFeeMinor), "exact", "Payment gateway"),
    cost(input, "platform_transaction", "Platform transaction", minor(input.platformTransactionFeeMinor), "estimated", "Platform fee rule"),
    cost(input, "ad_spend", "Ad spend", minor(input.adSpendAllocatedMinor), "imported", "Ad spend import"),
    cost(input, "return_shipping", "Return shipping", minor(input.returnShippingCostMinor), "rule", "Return rule"),
    cost(input, "refund_fee_loss", "Refund fee loss", minor(input.refundFeeLossMinor), "estimated", "Gateway refund policy"),
    cost(input, "non_resellable_return_loss", "Non-resellable return loss", minor(input.nonResellableReturnLossMinor), "rule", "Return loss rule"),
    cost(input, "other", "Other variable costs", minor(input.otherVariableCostsMinor), "manual", "Manual cost")
  ];

  const variableCostsMinor = costs.reduce((total, component) => total + component.amountMinor, 0);
  const trueMarginMinor = revenueNetMinor - variableCostsMinor;
  const trueMarginPercent = ratioPercent(trueMarginMinor, revenueNetMinor);
  const allCostsExceptAdsMinor = variableCostsMinor - minor(input.adSpendAllocatedMinor);
  const breakEven = calculateBreakEvenAdSpend({
    revenueNetMinor,
    allCostsExceptAdsMinor,
    ...(input.adSpendAllocatedMinor == null ? {} : { adSpendAllocatedMinor: input.adSpendAllocatedMinor })
  });

  return {
    lineId: input.lineId,
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.variantId ? { variantId: input.variantId } : {}),
    ...(input.sku ? { sku: input.sku } : {}),
    currency: input.currency,
    revenueNetMinor,
    variableCostsMinor,
    trueMarginMinor,
    trueMarginPercent,
    breakEvenCpaMinor: breakEven.breakEvenCpaMinor,
    breakEvenRoas: breakEven.breakEvenRoas,
    status: statusFor(
      trueMarginMinor,
      trueMarginPercent,
      input.warningThresholdPercent ?? DEFAULT_WARNING_THRESHOLD_PERCENT,
      missingCosts
    ),
    missingCosts,
    costs
  };
}

function effectiveStrategy(strategy: CostAllocationStrategy | undefined, lines: CostAllocationLine[]): Exclude<CostAllocationStrategy, "auto"> {
  if (strategy && strategy !== "auto") {
    return strategy;
  }
  if (lines.some((line) => minor(line.weightGrams) > 0)) {
    return "weight";
  }
  if (lines.some((line) => minor(line.quantity) > 0)) {
    return "quantity";
  }
  return "revenue";
}

function basisFor(line: CostAllocationLine, strategy: Exclude<CostAllocationStrategy, "auto">): number {
  if (strategy === "weight") {
    return minor(line.weightGrams) * minor(line.quantity);
  }
  if (strategy === "quantity") {
    return minor(line.quantity);
  }
  return Math.max(0, minor(line.revenueMinor));
}

export function allocateOrderLevelCosts(input: CostAllocationInput): CostAllocationResult {
  if (input.lines.length === 0) {
    return { strategyUsed: "revenue", allocations: [] };
  }

  const totalCostMinor = minor(input.totalCostMinor);
  const strategyUsed = effectiveStrategy(input.strategy, input.lines);
  const bases = input.lines.map((line) => ({ line, basis: basisFor(line, strategyUsed) }));
  const totalBasis = bases.reduce((total, item) => total + item.basis, 0);
  const safeBases = totalBasis > 0 ? bases : input.lines.map((line) => ({ line, basis: 1 }));
  const safeTotalBasis = safeBases.reduce((total, item) => total + item.basis, 0);

  let allocated = 0;
  const allocations = safeBases.map((item, index) => {
    const amountMinor =
      index === safeBases.length - 1
        ? totalCostMinor - allocated
        : Math.floor((totalCostMinor * item.basis) / safeTotalBasis);
    allocated += amountMinor;
    return {
      lineId: item.line.lineId,
      amountMinor
    };
  });

  return { strategyUsed, allocations };
}

type LineCostAmountField =
  | "cogsMinor"
  | "packagingCostMinor"
  | "fulfillmentCostMinor"
  | "realShippingCostMinor"
  | "paymentProcessingFeeMinor"
  | "platformTransactionFeeMinor"
  | "adSpendAllocatedMinor"
  | "returnShippingCostMinor"
  | "refundFeeLossMinor"
  | "nonResellableReturnLossMinor"
  | "otherVariableCostsMinor";

function applyOrderLevelCosts(lines: LineMarginInput[], costs: OrderLevelCostInput[] | undefined): LineMarginInput[] {
  if (!costs || costs.length === 0) {
    return lines;
  }

  const enriched = lines.map((line) => ({ ...line }));
  for (const orderCost of costs) {
    const allocation = allocateOrderLevelCosts({
      totalCostMinor: orderCost.amountMinor,
      ...(orderCost.allocationStrategy == null ? {} : { strategy: orderCost.allocationStrategy }),
      lines: enriched.map((line) => ({
        lineId: line.lineId,
        quantity: line.quantity,
        revenueMinor: line.productSalesMinor + minor(line.shippingRevenueMinor) - minor(line.discountMinor)
      }))
    });

    for (const item of allocation.allocations) {
      const line = enriched.find((candidate) => candidate.lineId === item.lineId);
      if (!line) {
        continue;
      }
      const amountField = amountFieldFor(orderCost.key);
      const existing = minor(line[amountField]);
      line[amountField] = existing + item.amountMinor;
      line.costSources = {
        ...line.costSources,
        [orderCost.key]: {
          sourceType: orderCost.sourceType,
          sourceName: orderCost.sourceName,
          confidenceScore: orderCost.sourceType === "exact" ? 1 : 0.7
        }
      };
    }
  }
  return enriched;
}

function amountFieldFor(key: CostComponent["key"]): LineCostAmountField {
  const map: Record<CostComponent["key"], LineCostAmountField> = {
    cogs: "cogsMinor",
    packaging: "packagingCostMinor",
    fulfillment: "fulfillmentCostMinor",
    shipping: "realShippingCostMinor",
    payment_processing: "paymentProcessingFeeMinor",
    platform_transaction: "platformTransactionFeeMinor",
    ad_spend: "adSpendAllocatedMinor",
    return_shipping: "returnShippingCostMinor",
    refund_fee_loss: "refundFeeLossMinor",
    non_resellable_return_loss: "nonResellableReturnLossMinor",
    other: "otherVariableCostsMinor"
  };
  return map[key];
}

export function calculateOrderMargin(input: OrderMarginInput): OrderMarginResult {
  const lineInputs = applyOrderLevelCosts(input.lines, input.orderLevelCosts);
  const lines = lineInputs.map(calculateLineMargin);
  const revenueNetMinor = lines.reduce((total, line) => total + line.revenueNetMinor, 0);
  const variableCostsMinor = lines.reduce((total, line) => total + line.variableCostsMinor, 0);
  const trueMarginMinor = revenueNetMinor - variableCostsMinor;
  const trueMarginPercent = ratioPercent(trueMarginMinor, revenueNetMinor);
  const hasUnknown = lines.some((line) => line.status === "unknown");
  const status = hasUnknown
    ? "unknown"
    : statusFor(trueMarginMinor, trueMarginPercent, DEFAULT_WARNING_THRESHOLD_PERCENT, []);

  return {
    orderId: input.orderId,
    currency: input.currency,
    revenueNetMinor,
    variableCostsMinor,
    trueMarginMinor,
    trueMarginPercent,
    status,
    lines,
    unallocatedAdSpendMinor: 0
  };
}

export function aggregateProductMargins(input: ProductMarginAggregateInput): ProductMarginAggregateResult {
  const map = new Map<string, ProductMarginAggregateResult["products"][number]>();

  for (const line of input.lines) {
    const productId = line.productId ?? line.sku ?? "unknown";
    const current = map.get(productId) ?? {
      productId,
      ...(line.sku ? { sku: line.sku } : {}),
      currency: line.currency,
      revenueNetMinor: 0,
      variableCostsMinor: 0,
      trueMarginMinor: 0,
      trueMarginPercent: null,
      status: "profitable" as ProductMarginStatus,
      orderLineCount: 0,
      missingCosts: []
    };

    current.revenueNetMinor += line.revenueNetMinor;
    current.variableCostsMinor += line.variableCostsMinor;
    current.trueMarginMinor += line.trueMarginMinor;
    current.orderLineCount += 1;
    current.missingCosts = Array.from(new Set([...current.missingCosts, ...line.missingCosts]));
    current.trueMarginPercent = ratioPercent(current.trueMarginMinor, current.revenueNetMinor);
    current.status = statusFor(
      current.trueMarginMinor,
      current.trueMarginPercent,
      DEFAULT_WARNING_THRESHOLD_PERCENT,
      current.missingCosts
    );
    map.set(productId, current);
  }

  return {
    products: Array.from(map.values()).sort((a, b) => a.trueMarginMinor - b.trueMarginMinor)
  };
}
