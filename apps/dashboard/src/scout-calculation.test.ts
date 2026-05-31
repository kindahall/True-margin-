import { describe, expect, it } from "vitest";
import { calculateScout, parseMoneyInput, parsePercentInput } from "./scout-calculation";

describe("Price Scout calculations", () => {
  it("parses money and percent inputs safely", () => {
    expect(parseMoneyInput("19.99")).toBe(1999);
    expect(parseMoneyInput("19,99")).toBe(1999);
    expect(parseMoneyInput("-4")).toBe(0);
    expect(parseMoneyInput("")).toBeNull();
    expect(parsePercentInput("25")).toBe(25);
    expect(parsePercentInput("120")).toBe(80);
    expect(parsePercentInput("bad")).toBeNull();
  });

  it("calculates margin and price floor only when all inputs are present", () => {
    expect(calculateScout({
      listedPriceMinor: 3000,
      cogsMinor: 1000,
      shippingMinor: null,
      feesMinor: 200,
      adCostMinor: 300,
      targetMarginPercent: 30
    })).toMatchObject({
      complete: false,
      totalCostMinor: null,
      marginPercent: null
    });

    expect(calculateScout({
      listedPriceMinor: 3000,
      cogsMinor: 1000,
      shippingMinor: 400,
      feesMinor: 200,
      adCostMinor: 300,
      targetMarginPercent: 30
    })).toMatchObject({
      complete: true,
      totalCostMinor: 1900,
      floorMinor: 2715,
      marginMinor: 1100,
      marginPercent: 36.666666666666664
    });
  });
});
