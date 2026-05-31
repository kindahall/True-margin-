import { describe, expect, it } from "vitest";
import { ManualFeeProvider, PayPalFeeProvider, StripeFeeProvider } from "../src/index.js";

describe("payment fee providers", () => {
  it("estimates Stripe fees", () => {
    const fee = new StripeFeeProvider().estimateFee({
      id: "txn_1",
      gateway: "stripe",
      amountMinor: 10000,
      currency: "USD"
    });

    expect(fee.amountMinor).toBe(320);
    expect(fee.sourceType).toBe("estimated");
  });

  it("estimates PayPal fees", () => {
    const fee = new PayPalFeeProvider().estimateFee({
      id: "txn_2",
      gateway: "paypal",
      amountMinor: 10000,
      currency: "USD"
    });

    expect(fee.amountMinor).toBe(398);
  });

  it("supports manual gateway rules by country", () => {
    const provider = new ManualFeeProvider({
      gateway: "manual",
      percent: 1.5,
      fixedMinor: 10,
      countries: ["US"]
    });

    expect(
      provider.estimateFee({
        id: "txn_3",
        gateway: "manual",
        amountMinor: 5000,
        currency: "USD",
        country: "US"
      }).amountMinor
    ).toBe(85);
  });
});
