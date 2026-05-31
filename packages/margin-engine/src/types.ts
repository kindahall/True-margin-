export type CurrencyCode = string;

export type CostSourceType = "exact" | "estimated" | "manual" | "imported" | "rule";

export type ProductMarginStatus = "profitable" | "warning" | "loss" | "unknown";

export interface CostComponent {
  key:
    | "cogs"
    | "packaging"
    | "fulfillment"
    | "shipping"
    | "payment_processing"
    | "platform_transaction"
    | "ad_spend"
    | "return_shipping"
    | "refund_fee_loss"
    | "non_resellable_return_loss"
    | "other";
  label: string;
  amountMinor: number;
  sourceType: CostSourceType;
  sourceName: string;
  confidenceScore: number;
  appliedRuleId?: string;
}

export interface LineMarginInput {
  lineId: string;
  productId?: string;
  variantId?: string;
  sku?: string;
  quantity: number;
  currency: CurrencyCode;
  productSalesMinor: number;
  shippingRevenueMinor?: number;
  discountMinor?: number;
  refundsMinor?: number;
  taxMinor?: number;
  includeTaxesInRevenue?: boolean;
  warningThresholdPercent?: number;
  cogsMinor?: number | null;
  packagingCostMinor?: number;
  fulfillmentCostMinor?: number;
  realShippingCostMinor?: number;
  paymentProcessingFeeMinor?: number;
  platformTransactionFeeMinor?: number;
  adSpendAllocatedMinor?: number;
  returnShippingCostMinor?: number;
  refundFeeLossMinor?: number;
  nonResellableReturnLossMinor?: number;
  otherVariableCostsMinor?: number;
  costSources?: Partial<Record<CostComponent["key"], Partial<CostComponent>>>;
}

export interface LineMarginResult {
  lineId: string;
  productId?: string;
  variantId?: string;
  sku?: string;
  currency: CurrencyCode;
  revenueNetMinor: number;
  variableCostsMinor: number;
  trueMarginMinor: number;
  trueMarginPercent: number | null;
  breakEvenCpaMinor: number;
  breakEvenRoas: number | null;
  status: ProductMarginStatus;
  missingCosts: string[];
  costs: CostComponent[];
}

export interface OrderMarginInput {
  orderId: string;
  currency: CurrencyCode;
  lines: LineMarginInput[];
  orderLevelCosts?: OrderLevelCostInput[];
}

export interface OrderLevelCostInput {
  key: CostComponent["key"];
  amountMinor: number;
  sourceType: CostSourceType;
  sourceName: string;
  allocationStrategy?: CostAllocationStrategy;
}

export interface OrderMarginResult {
  orderId: string;
  currency: CurrencyCode;
  revenueNetMinor: number;
  variableCostsMinor: number;
  trueMarginMinor: number;
  trueMarginPercent: number | null;
  status: ProductMarginStatus;
  lines: LineMarginResult[];
  unallocatedAdSpendMinor: number;
}

export type CostAllocationStrategy = "auto" | "weight" | "quantity" | "revenue";

export interface CostAllocationLine {
  lineId: string;
  quantity: number;
  revenueMinor: number;
  weightGrams?: number | null;
}

export interface CostAllocationInput {
  totalCostMinor: number;
  strategy?: CostAllocationStrategy;
  lines: CostAllocationLine[];
}

export interface CostAllocationResult {
  strategyUsed: Exclude<CostAllocationStrategy, "auto">;
  allocations: Array<{
    lineId: string;
    amountMinor: number;
  }>;
}

export interface ProductMarginAggregateInput {
  lines: LineMarginResult[];
}

export interface ProductMarginAggregateResult {
  products: Array<{
    productId: string;
    sku?: string;
    currency: CurrencyCode;
    revenueNetMinor: number;
    variableCostsMinor: number;
    trueMarginMinor: number;
    trueMarginPercent: number | null;
    status: ProductMarginStatus;
    orderLineCount: number;
    missingCosts: string[];
  }>;
}

export interface BreakEvenInput {
  revenueNetMinor: number;
  allCostsExceptAdsMinor: number;
  adSpendAllocatedMinor?: number;
}

export interface BreakEvenResult {
  breakEvenCpaMinor: number;
  breakEvenRoas: number | null;
  structurallyUnprofitableWithoutAds: boolean;
}
