# Margin Engine

The margin engine is a pure TypeScript package with no network dependencies.

## Functions

- `calculateLineMargin`
- `calculateOrderMargin`
- `aggregateProductMargins`
- `allocateOrderLevelCosts`
- `calculateBreakEvenAdSpend`

## Covered Costs

- COGS.
- Packaging.
- Fulfillment.
- Shipping.
- Payment fees.
- Platform fees.
- Ad spend.
- Return shipping.
- Refund fee loss.
- Non-resellable return loss.
- Other variable costs.

## Tests

The package covers profitable orders, ad-driven loss, partial returns, total refunds, exact Stripe fee labeling, estimated PayPal fees, weighted shipping allocation, pro-rata allocation, tax exclusion, and missing COGS.

```bash
pnpm --filter @tmt/margin-engine test
pnpm --filter @tmt/margin-engine lint
```
