// Mortgage burden-ratio calculation model.
// Pure functions only — no DOM access, no side effects.
//
// Model overview:
//   1. Estimate historical price via price index ratio
//   2. Compute monthly annuity payment at historical & current rates
//   3. Compute household net income (dual earner × takeHomeRatio)
//   4. Derive mortgage burden ratio B = payment / netIncome
//   5. stressMultiplier = B_now / B_t  ("today is X× more burdensome")
//   6. affordablePrice  = P_now × (B_t / B_now)

import { type CzechRegion } from './location';
import {
  getRegionalData,
  getCurrentYearData,
  getYearData,
  getAvailableYears,
  MODEL_DEFAULTS,
} from './data';

// ── Core interface ────────────────────────────────────────────────────────────

export interface BurdenComparison {
  comparisonYear: number;

  // ── Current situation ──────────────────────────────────────────────────────
  currentPrice: number;               // the listed price (CZK)
  currentMonthlyPayment: number;      // monthly mortgage at current rate
  currentBurdenRatio: number;         // decimal, e.g. 0.55 = 55%
  currentHouseholdNetIncome: number;  // 2 × avgWage × takeHomeRatio

  // ── Historical situation ───────────────────────────────────────────────────
  historicalPrice: number;            // P_t = P_now × (idx_t / idx_now)
  historicalMonthlyPayment: number;   // monthly mortgage at historical rate
  historicalBurdenRatio: number;      // decimal
  historicalHouseholdNetIncome: number;

  // ── Comparison metrics ─────────────────────────────────────────────────────
  stressMultiplier: number;           // B_now / B_t, e.g. 1.68
  burdenEquivalentPrice: number;      // P_now × (B_t / B_now)

  // ── Rates used (for display) ───────────────────────────────────────────────
  currentRate: number;
  historicalRate: number;
}

// ── Annuity factor ────────────────────────────────────────────────────────────

/**
 * Monthly annuity payment factor: i / (1 − (1+i)^(−n))
 * where i = annualRate / 12 (monthly rate), n = loan term in months.
 *
 * Multiply by (principal × LTV) to get the monthly payment.
 *
 * @param annualRate - annual interest rate as decimal (e.g. 0.045 for 4.5%)
 * @param months - loan term in months (e.g. 360 for 30 years)
 */
export function annuityFactor(annualRate: number, months: number): number {
  const i = annualRate / 12;
  // Guard against zero rate (interest-free loan → equal instalments)
  if (i === 0) return 1 / months;
  return i / (1 - Math.pow(1 + i, -months));
}

// ── Core calculation ──────────────────────────────────────────────────────────

/**
 * Compute the full mortgage burden comparison for a listed price against a
 * historical year, using regional economic data where available.
 *
 * @param currentPrice  - the listed price in CZK
 * @param comparisonYear - year to compare against (must be in dataset)
 * @param region        - Czech region of the listing
 * @throws if comparisonYear is not in the dataset
 */
export function computeBurdenComparison(
  currentPrice: number,
  comparisonYear: number,
  region: CzechRegion,
): BurdenComparison {
  const nowEntry  = getCurrentYearData();
  const histEntry = getYearData(comparisonYear);
  if (!histEntry) throw new Error(`No data for year ${comparisonYear}`);

  const { downPaymentRatio, loanTermMonths, householdEarners, takeHomeRatio } = MODEL_DEFAULTS;
  const principal = 1 - downPaymentRatio;   // loan fraction of price

  // ── Regional data ──────────────────────────────────────────────────────────
  const nowRegional  = getRegionalData(nowEntry.year,   region);
  const histRegional = getRegionalData(comparisonYear,  region);

  // ── Step 1: Historical price estimate ─────────────────────────────────────
  // P_t = P_now × (priceIndex_t / priceIndex_now)
  const historicalPrice = Math.round(
    currentPrice * (histRegional.priceIndex / nowRegional.priceIndex),
  );

  // ── Step 2: Monthly mortgage payments ─────────────────────────────────────
  const nowFactor  = annuityFactor(nowEntry.mortgageRate,  loanTermMonths);
  const histFactor = annuityFactor(histEntry.mortgageRate, loanTermMonths);

  const currentMonthlyPayment  = Math.round(currentPrice   * principal * nowFactor);
  const historicalMonthlyPayment = Math.round(historicalPrice * principal * histFactor);

  // ── Step 3: Household net income ───────────────────────────────────────────
  // householdNetIncome = earners × avgWage × takeHomeRatio
  const currentHouseholdNetIncome  = Math.round(
    householdEarners * nowRegional.avgWage  * takeHomeRatio,
  );
  const historicalHouseholdNetIncome = Math.round(
    householdEarners * histRegional.avgWage * takeHomeRatio,
  );

  // ── Step 4: Burden ratios ─────────────────────────────────────────────────
  // B = monthlyPayment / householdNetIncome
  const currentBurdenRatio    = currentMonthlyPayment    / currentHouseholdNetIncome;
  const historicalBurdenRatio = historicalMonthlyPayment / historicalHouseholdNetIncome;

  // ── Step 5: Stress multiplier ─────────────────────────────────────────────
  // stressMultiplier = B_now / B_t — "today is X× more burdensome"
  const stressMultiplier = Math.round(
    (currentBurdenRatio / historicalBurdenRatio) * 100,
  ) / 100;

  // ── Step 6: Burden-equivalent price ──────────────────────────────────────
  // affordablePrice = P_now × (B_t / B_now)
  // "This flat would need to cost X for today's burden to match year t."
  const burdenEquivalentPrice = Math.round(
    currentPrice * (historicalBurdenRatio / currentBurdenRatio),
  );

  return {
    comparisonYear,
    currentPrice,
    currentMonthlyPayment,
    currentBurdenRatio,
    currentHouseholdNetIncome,
    historicalPrice,
    historicalMonthlyPayment,
    historicalBurdenRatio,
    historicalHouseholdNetIncome,
    stressMultiplier,
    burdenEquivalentPrice,
    currentRate:    nowEntry.mortgageRate,
    historicalRate: histEntry.mortgageRate,
  };
}

/**
 * Compute BurdenComparison for every year in the dataset.
 * Years with missing data are skipped silently.
 */
export function computeAllComparisons(
  currentPrice: number,
  region: CzechRegion,
): BurdenComparison[] {
  return getAvailableYears().flatMap((year) => {
    try {
      return [computeBurdenComparison(currentPrice, year, region)];
    } catch {
      return [];
    }
  });
}

// ── Format utilities ──────────────────────────────────────────────────────────

/**
 * Format a CZK amount with Czech space-separated thousands.
 * e.g. 12_500_000 → "12 500 000 Kč"
 */
export function formatCZK(amount: number): string {
  const rounded = Math.round(amount);
  // cs-CZ uses NBSP (U+00A0) as thousands separator — replace with regular space.
  return rounded.toLocaleString('cs-CZ').replace(/\u00a0/g, ' ') + ' Kč';
}

/**
 * Parse a Czech-formatted price string like "12 500 000 Kč" or "25 000 Kč/měs".
 * Handles sreality's anti-scraping measures (U+200B zero-width spaces).
 * Returns null if parsing fails.
 */
export function parseCzechPrice(text: string): number | null {
  const cleaned = text
    .replace(/\u200B/g, '')    // zero-width spaces (sreality obfuscation)
    .replace(/\u00A0/g, ' ')   // NBSP → regular space
    .replace(/\s/g, '')        // strip all whitespace (thousands separators)
    .replace(/Kč/g, '')
    .replace(/\/měs\.?/g, '')
    .trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

/**
 * Format a burden ratio as a percentage string.
 * e.g. 0.548 → "54.8%"
 */
export function formatBurdenPercent(ratio: number): string {
  return (ratio * 100).toFixed(1) + '%';
}

/**
 * Format a stress multiplier with the × symbol.
 * e.g. 1.68 → "1.68×"
 */
export function formatMultiplier(multiplier: number): string {
  return multiplier.toFixed(2) + '×';
}

