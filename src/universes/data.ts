// Regional economic dataset for the burden-ratio affordability model.
// All values hardcoded — no external calls, no side effects.
//
// Sources:
//   National wages:       ČSÚ annual average gross monthly wage
//   Mortgage rates:       Fincentrum/Swiss Life Hypoindex + CNB new-business rates
//   National price index: ČSÚ realized price indices + Deloitte/Real Index (2015 = 100)
//   Regional wages 2025:  ČSÚ release March 2026
//   Regional price index: national index × per-region multiplier (MVP estimate)

import { type CzechRegion } from './location';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface YearRegionData {
  /** Apartment price index relative to 2015 = 100. Used to estimate historical price. */
  priceIndex: number;
  /** Average gross monthly wage in CZK for this region. */
  avgWage: number;
}

export interface YearData {
  year: number;
  /** Mortgage rate for new house-purchase loans, annual decimal (0.085 = 8.5%). */
  mortgageRate: number;
  /** National-level data — fallback when regional data is not available. */
  national: YearRegionData;
  /** Actual per-region data. Only 2025 is populated from ČSÚ; other years
   *  are computed on-demand by getRegionalData() using the 2025 wage ratio. */
  regions: Partial<Record<CzechRegion, YearRegionData>>;
}

// ── Model defaults ────────────────────────────────────────────────────────────

export const MODEL_DEFAULTS = {
  downPaymentRatio:  0.10,  // 10% down payment
  loanTermMonths:    360,   // 30-year mortgage
  householdEarners:  2,     // dual-income household
  takeHomeRatio:     0.77,  // rough gross-to-net for average CZ earner
} as const;

export const DATA_VERSION = '2026-04-mvp';

// ── Regional price multipliers ────────────────────────────────────────────────
// MVP estimate — to be replaced with ČSÚ per-kraj series when available.
// Reflects how much faster/slower each region's prices grew vs the national
// average over the 2015–2025 period.

export const REGIONAL_PRICE_MULTIPLIERS: Record<CzechRegion, number> = {
  praha:            1.15,  // Prague consistently outpaced national by ~15%
  stredocesky:      1.05,  // Středočeský slightly above national
  jihocesky:        0.92,  // estimated, no direct data provided
  plzensky:         1.00,  // approximately tracks national
  karlovarsky:      0.80,  // weakest market in CZ
  ustecky:          0.75,  // structurally depressed (Most, Chomutov)
  liberecky:        0.95,  // slightly below national
  kralovehradecky:  0.95,  // slightly below national
  pardubicky:       0.95,  // slightly below national
  vysocina:         0.90,  // below national
  jihomoravsky:     1.08,  // Brno metro strong growth
  olomoucky:        0.95,  // slightly below national
  zlinsky:          0.90,  // below national
  moravskoslezsky:  0.85,  // below national; Ostrava structural issues
};

// ── Regional wage anchor (2025 annual averages) ───────────────────────────────
// Source: ČSÚ release March 2026.
// Used to derive historical regional wages via:
//   regionalWage_t = nationalWage_t × (REGIONAL_WAGES_2025[region] / NATIONAL_WAGE_2025)
// This is a simplification — estimated: scaled from 2025 regional ratio.

const REGIONAL_WAGES_2025: Record<CzechRegion, number> = {
  praha:            62_723,  // ČSÚ annual avg 2025
  stredocesky:      49_539,
  jihocesky:        44_200,
  plzensky:         45_900,
  karlovarsky:      42_049,
  ustecky:          44_500,
  liberecky:        44_800,
  kralovehradecky:  45_231,
  pardubicky:       44_200,
  vysocina:         44_385,
  jihomoravsky:     49_000,
  olomoucky:        44_000,
  zlinsky:          43_200,
  moravskoslezsky:  44_800,
};

const NATIONAL_WAGE_2025 = 49_215;  // matches ECONOMIC_DATA[2025].national.avgWage

// ── Economic data (2000–2026) ─────────────────────────────────────────────────
// 27 entries, chronological. National price index base: 2015 = 100.
// Only the 2025 entry has `regions` populated from actual ČSÚ data.

export const ECONOMIC_DATA: YearData[] = [
  {
    year: 2000,
    mortgageRate: 0.0850,  // 8.50% — CNB, late-90s rates still high
    national: { priceIndex: 48,  avgWage: 13_219 },  // ČSÚ annual avg; estimated index
    regions: {},
  },
  {
    year: 2001,
    mortgageRate: 0.0690,  // 6.90% — Hypoindex era, rates falling fast
    national: { priceIndex: 50,  avgWage: 14_378 },  // ČSÚ annual avg; estimated index
    regions: {},
  },
  {
    year: 2002,
    mortgageRate: 0.0600,  // 6.00% — continued decline
    national: { priceIndex: 53,  avgWage: 15_524 },  // ČSÚ annual avg; estimated index
    regions: {},
  },
  {
    year: 2003,
    mortgageRate: 0.0550,  // 5.50% — Hypoindex launched Jan 2003 at 5.73%
    national: { priceIndex: 56,  avgWage: 16_430 },  // ČSÚ annual avg; estimated index
    regions: {},
  },
  {
    year: 2004,
    mortgageRate: 0.0480,  // 4.80% — rates falling toward 2005 minimum
    national: { priceIndex: 61,  avgWage: 17_466 },  // ČSÚ annual avg; EU accession effect
    regions: {},
  },
  {
    year: 2005,
    mortgageRate: 0.0370,  // 3.70% — historic minimum ~3.6% reached end of year
    national: { priceIndex: 68,  avgWage: 18_344 },  // ČSÚ annual avg; boom starting
    regions: {},
  },
  {
    year: 2006,
    mortgageRate: 0.0400,  // 4.00% — rates rising, EU entry boom
    national: { priceIndex: 80,  avgWage: 19_546 },  // ČSÚ annual avg; rapid growth
    regions: {},
  },
  {
    year: 2007,
    mortgageRate: 0.0460,  // 4.60% — pre-crisis peak building
    national: { priceIndex: 94,  avgWage: 20_957 },  // ČSÚ annual avg; near pre-crisis top
    regions: {},
  },
  {
    year: 2008,
    mortgageRate: 0.0560,  // 5.60% — peaked 5.82% in August
    national: { priceIndex: 100, avgWage: 22_592 },  // ČSÚ annual avg; crisis year price peak
    regions: {},
  },
  {
    year: 2009,
    mortgageRate: 0.0530,  // 5.30% — still elevated post-crisis
    national: { priceIndex: 95,  avgWage: 23_344 },  // ČSÚ annual avg; post-crisis decline
    regions: {},
  },
  {
    year: 2010,
    mortgageRate: 0.0450,  // 4.50% — fell below 5% in June (4.92%)
    national: { priceIndex: 93,  avgWage: 23_864 },  // ČSÚ annual avg; ~93 on 2015 basis
    regions: {},
  },
  {
    year: 2011,
    mortgageRate: 0.0390,  // 3.90% — continued decline
    national: { priceIndex: 92,  avgWage: 24_455 },  // ČSÚ annual avg; slight decline
    regions: {},
  },
  {
    year: 2012,
    mortgageRate: 0.0340,  // 3.40% — reached 3.17% in December
    national: { priceIndex: 91,  avgWage: 25_067 },  // ČSÚ annual avg; trough period
    regions: {},
  },
  {
    year: 2013,
    mortgageRate: 0.0300,  // 3.00% — low-rate era begins
    national: { priceIndex: 90,  avgWage: 25_035 },  // ČSÚ annual avg; near bottom
    regions: {},
  },
  {
    year: 2014,
    mortgageRate: 0.0270,  // 2.70% — continued decline
    national: { priceIndex: 95,  avgWage: 25_768 },  // ČSÚ annual avg; recovery begins
    regions: {},
  },
  {
    year: 2015,
    mortgageRate: 0.0250,  // 2.50% — very low
    national: { priceIndex: 100, avgWage: 26_591 },  // ČSÚ annual avg; base year by definition
    regions: {},
  },
  {
    year: 2016,
    mortgageRate: 0.0195,  // 1.95% — historic absolute minimum 1.77% in Nov/Dec
    national: { priceIndex: 110, avgWage: 27_764 },  // ČSÚ confirmed ~10% growth
    regions: {},
  },
  {
    year: 2017,
    mortgageRate: 0.0210,  // 2.10% — ČNB tightening begins
    national: { priceIndex: 129, avgWage: 29_638 },  // ČSÚ confirmed; Středočeský 125.8 on 2010 base
    regions: {},
  },
  {
    year: 2018,
    mortgageRate: 0.0260,  // 2.60% — rising steadily
    national: { priceIndex: 148, avgWage: 32_051 },  // ČSÚ confirmed rapid growth
    regions: {},
  },
  {
    year: 2019,
    mortgageRate: 0.0270,  // 2.70% — plateau
    national: { priceIndex: 162, avgWage: 34_578 },  // ČSÚ confirmed
    regions: {},
  },
  {
    year: 2020,
    mortgageRate: 0.0220,  // 2.20% — COVID rate cuts
    national: { priceIndex: 172, avgWage: 36_176 },  // ČSÚ confirmed
    regions: {},
  },
  {
    year: 2021,
    mortgageRate: 0.0210,  // 2.10% — lowest Jan 1.93%, then spiked at year-end
    national: { priceIndex: 208, avgWage: 38_277 },  // ČSÚ confirmed; massive pandemic-era surge
    regions: {},
  },
  {
    year: 2022,
    mortgageRate: 0.0560,  // 5.60% — massive rise, peaked ~6.3%
    national: { priceIndex: 233, avgWage: 40_317 },  // ČSÚ confirmed; peak before rate-shock
    regions: {},
  },
  {
    year: 2023,
    mortgageRate: 0.0600,  // 6.00% — peak; Hypoindex ~6.34%
    national: { priceIndex: 227, avgWage: 43_341 },  // ČSÚ confirmed; slight dip
    regions: {},
  },
  {
    year: 2024,
    mortgageRate: 0.0510,  // 5.10% — declining from peak
    national: { priceIndex: 241, avgWage: 46_165 },  // ČSÚ confirmed; +6% y/y realized prices
    regions: {},
  },
  {
    year: 2025,
    mortgageRate: 0.0455,  // 4.55% — gradual decline to ~4.5% by year-end
    national: { priceIndex: 275, avgWage: 49_215 },  // ČSÚ ~14% y/y Prague, ~12% national
    // Actual per-region wages from ČSÚ release March 2026.
    // Regional price indices = national × REGIONAL_PRICE_MULTIPLIERS (MVP estimate).
    regions: {
      praha:            { priceIndex: Math.round(275 * 1.15), avgWage: 62_723 },  // 316
      stredocesky:      { priceIndex: Math.round(275 * 1.05), avgWage: 49_539 },  // 289
      jihocesky:        { priceIndex: Math.round(275 * 0.92), avgWage: 44_200 },  // 253
      plzensky:         { priceIndex: Math.round(275 * 1.00), avgWage: 45_900 },  // 275
      karlovarsky:      { priceIndex: Math.round(275 * 0.80), avgWage: 42_049 },  // 220
      ustecky:          { priceIndex: Math.round(275 * 0.75), avgWage: 44_500 },  // 206
      liberecky:        { priceIndex: Math.round(275 * 0.95), avgWage: 44_800 },  // 261
      kralovehradecky:  { priceIndex: Math.round(275 * 0.95), avgWage: 45_231 },  // 261
      pardubicky:       { priceIndex: Math.round(275 * 0.95), avgWage: 44_200 },  // 261
      vysocina:         { priceIndex: Math.round(275 * 0.90), avgWage: 44_385 },  // 248
      jihomoravsky:     { priceIndex: Math.round(275 * 1.08), avgWage: 49_000 },  // 297
      olomoucky:        { priceIndex: Math.round(275 * 0.95), avgWage: 44_000 },  // 261
      zlinsky:          { priceIndex: Math.round(275 * 0.90), avgWage: 43_200 },  // 248
      moravskoslezsky:  { priceIndex: Math.round(275 * 0.85), avgWage: 44_800 },  // 234
    },
  },
  {
    year: 2026,
    mortgageRate: 0.0500,  // 5.00% — re-rising; geopolitical tensions; April 2026 at 5.18%
    national: { priceIndex: 285, avgWage: 51_000 },  // estimated from Q4 2025 trend
    regions: {},  // no 2026 regional data yet; getRegionalData() applies 2025 ratio
  },
];

// ── Helper functions ──────────────────────────────────────────────────────────

/** Year-keyed index for O(1) lookups. Built once at module load. */
const _byYear: ReadonlyMap<number, YearData> = new Map(
  ECONOMIC_DATA.map((d) => [d.year, d])
);

/** Get data for a specific year. Returns null if year not in dataset. */
export function getYearData(year: number): YearData | null {
  return _byYear.get(year) ?? null;
}

/** Get the "current" year data (latest entry in the dataset). */
export function getCurrentYearData(): YearData {
  return ECONOMIC_DATA[ECONOMIC_DATA.length - 1];
}

/**
 * Get regional data for a specific year and region.
 *
 * If the year entry has per-region data (only 2025), returns it directly.
 * Otherwise derives the regional data from national figures:
 *   - priceIndex = national × REGIONAL_PRICE_MULTIPLIERS[region]
 *   - avgWage    = national × (REGIONAL_WAGES_2025[region] / NATIONAL_WAGE_2025)
 *     (estimated: scaled from 2025 regional ratio)
 *
 * Falls back to national data if year is not in dataset.
 */
export function getRegionalData(year: number, region: CzechRegion): YearRegionData {
  const entry = getYearData(year);
  if (!entry) {
    // Year not in dataset — return national data for the closest available year.
    const fallback = year < 2000
      ? ECONOMIC_DATA[0]
      : ECONOMIC_DATA[ECONOMIC_DATA.length - 1];
    return fallback.national;
  }

  // Use actual per-region data if available (2025 entry).
  const regional = entry.regions[region];
  if (regional) return regional;

  // Derive from national using 2025 ratio.
  const wageRatio = REGIONAL_WAGES_2025[region] / NATIONAL_WAGE_2025;
  return {
    priceIndex: entry.national.priceIndex * REGIONAL_PRICE_MULTIPLIERS[region],
    avgWage:    Math.round(entry.national.avgWage * wageRatio),
  };
}

/**
 * Get the apartment price index for a specific region and year.
 * Applies the regional multiplier to the national index.
 * Shorthand for getRegionalData(year, region).priceIndex.
 */
export function getPriceIndex(year: number, region: CzechRegion): number {
  return getRegionalData(year, region).priceIndex;
}

/** List all years for which data is available (2000–2026). */
export function getAvailableYears(): number[] {
  return ECONOMIC_DATA.map((d) => d.year);
}
