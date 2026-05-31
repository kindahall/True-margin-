import { describe, expect, it } from "vitest";
import {
  aggregateProductMargins,
  allocateOrderLevelCosts,
  calculateBreakEvenAdSpend,
  calculateLineMargin,
  calculateOrderMargin
} from "../src/index.js";
import type { LineMarginInput } from "../src/types.js";

const baseLine: LineMarginInput = {
  lineId: "line_1",
  productId: "prod_1",
  sku: "WBH-1000-BLK",
  quantity: 1,
  currency: "USD",
  productSalesMinor: 5999,
  cogsMinor: 2250,
  packagingCostMinor: 80,
  realShippingCostMinor: 425,
  paymentProcessingFeeMinor: 204,
  platformTransactionFeeMinor: 90,
  adSpendAllocatedMinor: 540,
  returnShippingCostMinor: 0,
  refundFeeLossMinor: 0,
  nonResellableReturnLossMinor: 0
};

describe("calculateLineMargin", () => {
  it("calculates a profitable simple line", () => {
    const result = calculateLineMargin(baseLine);

    expect(result.revenueNetMinor).toBe(5999);
    expect(result.variableCostsMinor).toBe(3589);
    expect(result.trueMarginMinor).toBe(2410);
    expect(result.status).toBe("profitable");
  });

  it("marks a line as loss when advertising makes it unprofitable", () => {
    const result = calculateLineMargin({
      ...baseLine,
      adSpendAllocatedMinor: 3800
    });

    expect(result.trueMarginMinor).toBeLessThan(0);
    expect(result.status).toBe("loss");
  });

  it("handles partial returns and non-resellable loss", () => {
    const result = calculateLineMargin({
      ...baseLine,
      quantity: 2,
      productSalesMinor: 11998,
      refundsMinor: 5999,
      returnShippingCostMinor: 650,
      nonResellableReturnLossMinor: 675
    });

    expect(result.revenueNetMinor).toBe(5999);
    expect(result.variableCostsMinor).toBe(4914);
    expect(result.trueMarginMinor).toBe(1085);
  });

  it("handles total refund", () => {
    const result = calculateLineMargin({
      ...baseLine,
      refundsMinor: 5999,
      returnShippingCostMinor: 650,
      refundFeeLossMinor: 30
    });

    expect(result.revenueNetMinor).toBe(0);
    expect(result.trueMarginPercent).toBeNull();
    expect(result.status).toBe("loss");
  });

  it("tracks exact Stripe fees through cost sources", () => {
    const result = calculateLineMargin({
      ...baseLine,
      paymentProcessingFeeMinor: 204,
      costSources: {
        payment_processing: {
          sourceType: "exact",
          sourceName: "Stripe balance transaction",
          confidenceScore: 1
        }
      }
    });

    expect(result.costs.find((cost) => cost.key === "payment_processing")).toMatchObject({
      amountMinor: 204,
      sourceType: "exact",
      sourceName: "Stripe balance transaction"
    });
  });

  it("tracks estimated PayPal fees through cost sources", () => {
    const result = calculateLineMargin({
      ...baseLine,
      paymentProcessingFeeMinor: 258,
      costSources: {
        payment_processing: {
          sourceType: "estimated",
          sourceName: "PayPal estimate 3.49% + 49c",
          confidenceScore: 0.65
        }
      }
    });

    expect(result.costs.find((cost) => cost.key === "payment_processing")).toMatchObject({
      amountMinor: 258,
      sourceType: "estimated"
    });
  });

  it("excludes taxes by default", () => {
    const result = calculateLineMargin({
      ...baseLine,
      taxMinor: 1200
    });

    expect(result.revenueNetMinor).toBe(4799);
  });

  it("marks products with missing COGS as unknown", () => {
    const result = calculateLineMargin({
      ...baseLine,
      cogsMinor: null
    });

    expect(result.status).toBe("unknown");
    expect(result.missingCosts).toEqual(["cogs"]);
  });
});

describe("allocateOrderLevelCosts", () => {
  it("allocates shipping by weight when weights exist", () => {
    const result = allocateOrderLevelCosts({
      totalCostMinor: 1200,
      strategy: "auto",
      lines: [
        { lineId: "a", quantity: 1, revenueMinor: 5000, weightGrams: 1000 },
        { lineId: "b", quantity: 1, revenueMinor: 5000, weightGrams: 3000 }
      ]
    });

    expect(result.strategyUsed).toBe("weight");
    expect(result.allocations).toEqual([
      { lineId: "a", amountMinor: 300 },
      { lineId: "b", amountMinor: 900 }
    ]);
  });

  it("allocates discounts pro-rata by revenue", () => {
    const result = allocateOrderLevelCosts({
      totalCostMinor: 900,
      strategy: "revenue",
      lines: [
        { lineId: "a", quantity: 1, revenueMinor: 3000 },
        { lineId: "b", quantity: 1, revenueMinor: 6000 }
      ]
    });

    expect(result.allocations).toEqual([
      { lineId: "a", amountMinor: 300 },
      { lineId: "b", amountMinor: 600 }
    ]);
  });
});

describe("order and aggregate margins", () => {
  it("calculates order margin from lines and order-level costs", () => {
    const result = calculateOrderMargin({
      orderId: "order_1",
      currency: "USD",
      lines: [baseLine, { ...baseLine, lineId: "line_2", productId: "prod_2", sku: "YM-200-BLU" }],
      orderLevelCosts: [
        {
          key: "shipping",
          amountMinor: 500,
          sourceType: "exact",
          sourceName: "Carrier invoice",
          allocationStrategy: "quantity"
        }
      ]
    });

    expect(result.lines).toHaveLength(2);
    expect(result.variableCostsMinor).toBe(7678);
    expect(result.trueMarginMinor).toBe(4320);
  });

  it("aggregates margins by product and surfaces loss first", () => {
    const profitable = calculateLineMargin(baseLine);
    const loss = calculateLineMargin({
      ...baseLine,
      lineId: "line_loss",
      productId: "prod_loss",
      sku: "LOSS-1",
      adSpendAllocatedMinor: 5000
    });

    const result = aggregateProductMargins({ lines: [profitable, loss] });

    expect(result.products[0]?.productId).toBe("prod_loss");
    expect(result.products[0]?.status).toBe("loss");
    expect(result.products[1]?.status).toBe("profitable");
  });
});

describe("calculateBreakEvenAdSpend", () => {
  it("returns break-even CPA and structural profitability", () => {
    const result = calculateBreakEvenAdSpend({
      revenueNetMinor: 5999,
      allCostsExceptAdsMinor: 3049,
      adSpendAllocatedMinor: 540
    });

    expect(result.breakEvenCpaMinor).toBe(2950);
    expect(result.breakEvenRoas).toBe(11.11);
    expect(result.structurallyUnprofitableWithoutAds).toBe(false);
  });
});
