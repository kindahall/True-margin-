export interface ScoutCalculation {
  listedPriceMinor: number | null;
  totalCostMinor: number | null;
  floorMinor: number | null;
  marginMinor: number | null;
  marginPercent: number | null;
  targetMarginPercent: number | null;
  complete: boolean;
}

export function parseMoneyInput(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : null;
}

export function parsePercentInput(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 80) : null;
}

export function calculateScout(input: {
  listedPriceMinor: number | null;
  cogsMinor: number | null;
  shippingMinor: number | null;
  feesMinor: number | null;
  adCostMinor: number | null;
  targetMarginPercent: number | null;
}): ScoutCalculation {
  const complete = Object.values(input).every((value) => value != null);
  if (!complete || input.listedPriceMinor == null || input.cogsMinor == null || input.shippingMinor == null || input.feesMinor == null || input.adCostMinor == null || input.targetMarginPercent == null) {
    return {
      listedPriceMinor: input.listedPriceMinor,
      totalCostMinor: null,
      floorMinor: null,
      marginMinor: null,
      marginPercent: null,
      targetMarginPercent: input.targetMarginPercent,
      complete: false
    };
  }

  const totalCostMinor = input.cogsMinor + input.shippingMinor + input.feesMinor + input.adCostMinor;
  const floorMinor = Math.ceil(totalCostMinor / Math.max(0.2, 1 - input.targetMarginPercent / 100));
  const marginMinor = input.listedPriceMinor - totalCostMinor;
  const marginPercent = input.listedPriceMinor > 0 ? (marginMinor / input.listedPriceMinor) * 100 : null;

  return {
    listedPriceMinor: input.listedPriceMinor,
    totalCostMinor,
    floorMinor,
    marginMinor,
    marginPercent,
    targetMarginPercent: input.targetMarginPercent,
    complete: true
  };
}
