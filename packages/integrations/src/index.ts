export interface PaymentTransaction {
  id: string;
  gateway: "stripe" | "paypal" | "shopify_payments" | "manual";
  amountMinor: number;
  currency: string;
  country?: string;
}

export interface FeeEstimate {
  transactionId: string;
  amountMinor: number;
  currency: string;
  sourceType: "exact" | "estimated" | "manual";
  sourceName: string;
}

export interface PaymentFeeRule {
  gateway: PaymentTransaction["gateway"];
  percent: number;
  fixedMinor: number;
  refundFeeKept?: boolean;
  countries?: string[];
}

export interface PaymentFeeProvider {
  estimateFee(transaction: PaymentTransaction): FeeEstimate;
  fetchExactFee?(transactionExternalId: string): Promise<FeeEstimate | null>;
}

export function estimateFeeFromRule(transaction: PaymentTransaction, rule: PaymentFeeRule): FeeEstimate {
  if (rule.gateway !== transaction.gateway) {
    throw new Error("Payment fee rule gateway does not match transaction gateway");
  }
  if (rule.countries && transaction.country && !rule.countries.includes(transaction.country)) {
    throw new Error("Payment fee rule does not apply to transaction country");
  }

  return {
    transactionId: transaction.id,
    amountMinor: Math.round(transaction.amountMinor * (rule.percent / 100)) + rule.fixedMinor,
    currency: transaction.currency,
    sourceType: "estimated",
    sourceName: `${transaction.gateway} ${rule.percent}% + ${rule.fixedMinor} minor units`
  };
}

export class StripeFeeProvider implements PaymentFeeProvider {
  estimateFee(transaction: PaymentTransaction): FeeEstimate {
    return estimateFeeFromRule(transaction, {
      gateway: "stripe",
      percent: 2.9,
      fixedMinor: 30
    });
  }
}

export class PayPalFeeProvider implements PaymentFeeProvider {
  estimateFee(transaction: PaymentTransaction): FeeEstimate {
    return estimateFeeFromRule(transaction, {
      gateway: "paypal",
      percent: 3.49,
      fixedMinor: 49
    });
  }
}

export class ManualFeeProvider implements PaymentFeeProvider {
  constructor(private readonly rule: PaymentFeeRule) {}

  estimateFee(transaction: PaymentTransaction): FeeEstimate {
    return estimateFeeFromRule(transaction, this.rule);
  }
}
