// Pure calculation utilities — no DOM, no side effects.

export const DEFAULTS = {
  LTV: 0.8,
  TERM_MONTHS: 360,
} as const;

/**
 * Standard annuity payment factor.
 * monthly_payment = principal × factor(rate, term)
 */
export function mortgagePaymentFactor(rateAnnual: number, termMonths: number): number {
  const i = rateAnnual / 12;
  return i / (1 - Math.pow(1 + i, -termMonths));
}

/** Monthly mortgage payment given price, LTV, annual rate, and term. */
export function monthlyMortgagePayment(
  price: number,
  ltv: number,
  rateAnnual: number,
  termMonths: number
): number {
  const principal = price * ltv;
  return principal * mortgagePaymentFactor(rateAnnual, termMonths);
}

export interface AdjustedPriceParams {
  currentPrice: number;
  houseIndexTarget: number;
  houseIndexCurrent: number;
  incomeTarget: number;
  incomeCurrent: number;
  targetMortgageRate: number;
  currentMortgageRate: number;
  termMonths: number;
}

/**
 * Affordability-adjusted price for the target year.
 *
 * "What would this property need to cost today so that its affordability burden
 * matches the selected baseline year?"
 *
 * Formula:
 *   adjustedPrice = currentPrice
 *     × (houseIndexTarget / houseIndexCurrent)
 *     × (incomeCurrent / incomeTarget)
 *     × (mortgagePaymentFactor(targetRate, term) / mortgagePaymentFactor(currentRate, term))
 */
export function computeAdjustedPrice(params: AdjustedPriceParams): number {
  return (
    params.currentPrice *
    (params.houseIndexTarget / params.houseIndexCurrent) *
    (params.incomeCurrent / params.incomeTarget) *
    (mortgagePaymentFactor(params.targetMortgageRate, params.termMonths) /
      mortgagePaymentFactor(params.currentMortgageRate, params.termMonths))
  );
}

/** Percentage change from currentValue to adjustedValue. */
export function computePercentChange(adjustedValue: number, currentValue: number): number {
  return ((adjustedValue - currentValue) / currentValue) * 100;
}

/**
 * Format a CZK amount with Czech thousand separators.
 * e.g. 12500000 → "12 500 000 Kč"
 */
export function formatCZK(amount: number): string {
  const rounded = Math.round(amount);
  // cs-CZ locale uses NBSP (U+00A0) as thousands separator — replace with regular space
  return rounded.toLocaleString("cs-CZ").replace(/\u00a0/g, " ") + " Kč";
}

/**
 * Parse a Czech-formatted price string like "12 500 000 Kč" or "25 000 Kč/měs".
 * Returns null if parsing fails.
 */
export function parseCzechPrice(text: string): number | null {
  const cleaned = text
    .replace(/\u200B/g, "")     // zero-width spaces
    .replace(/\u00A0/g, " ")    // NBSP → space
    .replace(/\s/g, "")         // strip all whitespace (thousand separators)
    .replace(/Kč/g, "")
    .replace(/\/měs\.?/g, "")
    .trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}
