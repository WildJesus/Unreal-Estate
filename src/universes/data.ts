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

export const DATA_VERSION = '2026-04-regional-v2';

// ── Regional price multipliers ────────────────────────────────────────────────
// Fallback only — used by getRegionalData() for any year not covered by
// REGIONAL_PRICE_INDICES (i.e. beyond 2026). For all years 2000–2026 the
// actual ČSÚ per-region index series is used instead.

export const REGIONAL_PRICE_MULTIPLIERS: Record<CzechRegion, number> = {
  praha:            1.15,
  stredocesky:      1.05,
  jihocesky:        0.95,
  plzensky:         1.00,
  karlovarsky:      0.95,
  ustecky:          1.30,  // large catch-up growth post-2015
  liberecky:        1.05,
  kralovehradecky:  1.05,
  pardubicky:       1.00,
  vysocina:         1.10,
  jihomoravsky:     1.05,
  olomoucky:        1.00,
  zlinsky:          1.00,
  moravskoslezsky:  1.10,  // strong post-2020 growth
};

// ── Per-region apartment price indices (2015 = 100) ───────────────────────────
//
// Sources (in priority order, chain-linked to 2015 = 100 base):
//   2015–2024  ČSÚ publication 014017-25 (icncr071525.xlsx) — ČÚZK realized
//              transaction prices, all 14 kraje, released July 2025.
//   2010–2014  ČSÚ "Ceny sledovaných druhů nemovitostí" 2009–2011 and
//              2012–2014 publications, chain-linked through 2015.
//   2005       Anchor: chain-linked ČÚZK series calibrated to 2015 = 100.
//   2000       Anchor: appraisal-price series (methodology break at 2005),
//              chain-linked using YoY rates from ČSÚ 2001–2003 / 2004–2006
//              publications (base 2000 = 100).
//   2001–2004  Linear interpolation between 2000 and 2005 anchors.
//   2006–2009  Linear interpolation between 2005 and 2010 anchors.
//   2025       Extrapolated: 2024 × (national_2025 / national_2024) = × 275/241.
//   2026       Extrapolated: 2025 × (national_2026 / national_2025) = × 285/275.
//
// Column order: Praha · Stč · Jč · Plz · Kar · Ust · Lib · Khr · Par · Vys · Jhm · Olo · Zli · Mvs

// Compact builder — positional args in the column order above.
function rpi(
  p: number, sc: number, jc: number, pl: number, ka: number, us: number,
  li: number, kh: number, pa: number, vy: number, jm: number, ol: number,
  zl: number, ms: number,
): Record<CzechRegion, number> {
  return {
    praha: p, stredocesky: sc, jihocesky: jc, plzensky: pl,
    karlovarsky: ka, ustecky: us, liberecky: li, kralovehradecky: kh,
    pardubicky: pa, vysocina: vy, jihomoravsky: jm, olomoucky: ol,
    zlinsky: zl, moravskoslezsky: ms,
  };
}

export const REGIONAL_PRICE_INDICES: Readonly<Record<number, Readonly<Record<CzechRegion, number>>>> = {
  // ── 2000 anchor (appraisal-series, chain-linked) ─────────────────────────────
  2000: rpi( 42.5,  36.9,  46.4,  40.0,  49.5,  68.3,  48.1,  37.3,  45.7,  40.2,  40.7,  51.3,  40.6,  39.5),
  // ── 2001–2004 interpolated ────────────────────────────────────────────────────
  2001: rpi( 48.4,  43.6,  51.5,  46.2,  56.0,  72.0,  54.5,  43.2,  49.8,  46.2,  44.9,  54.4,  46.0,  45.1),
  2002: rpi( 54.3,  50.3,  56.5,  52.4,  62.6,  75.7,  60.9,  49.1,  53.9,  52.2,  49.1,  57.6,  51.5,  50.7),
  2003: rpi( 60.1,  57.1,  61.6,  58.6,  69.1,  79.5,  67.3,  55.0,  58.1,  58.3,  53.4,  60.7,  56.9,  56.3),
  2004: rpi( 66.0,  63.8,  66.6,  64.8,  75.7,  83.2,  73.7,  60.9,  62.2,  64.3,  57.6,  63.9,  62.4,  61.9),
  // ── 2005 anchor (ČÚZK series, chain-linked to 2015 = 100) ────────────────────
  2005: rpi( 71.9,  70.5,  71.7,  71.0,  82.2,  86.9,  80.1,  66.8,  66.3,  70.3,  61.8,  67.0,  67.8,  67.5),
  // ── 2006–2009 interpolated ────────────────────────────────────────────────────
  2006: rpi( 76.5,  76.0,  76.2,  75.7,  86.5,  91.6,  85.3,  72.4,  71.9,  75.9,  68.0,  72.7,  74.0,  74.3),
  2007: rpi( 81.1,  81.6,  80.7,  80.4,  90.8,  96.3,  90.5,  77.9,  77.5,  81.5,  74.2,  78.3,  80.2,  81.1),
  2008: rpi( 85.6,  87.1,  85.1,  85.0,  95.1, 101.1,  95.8,  83.5,  83.1,  87.1,  80.3,  84.0,  86.3,  87.8),
  2009: rpi( 90.2,  92.7,  89.6,  89.7,  99.4, 105.8, 101.0,  89.0,  88.7,  92.7,  86.5,  89.6,  92.5,  94.6),
  // ── 2010–2014 (ČSÚ "Ceny sledovaných druhů nemovitostí", chain-linked) ────────
  2010: rpi( 94.8,  98.2,  94.1,  94.4, 103.7, 110.5, 106.2,  94.6,  94.3,  98.3,  92.7,  95.3,  98.7, 101.4),
  2011: rpi( 93.2,  97.3,  93.8,  94.5, 101.9, 117.8, 102.5,  98.6,  96.3,  98.7,  93.0,  94.6,  99.1, 102.5),
  2012: rpi( 92.5,  97.3,  92.8,  93.9, 101.0, 114.1, 100.8,  95.4,  94.4,  97.5,  92.4,  91.5,  96.2, 100.6),
  2013: rpi( 94.7,  97.7,  93.9,  92.7,  96.6, 103.3, 101.2,  96.1,  92.5,  96.8,  93.7,  92.8,  96.2,  97.2),
  2014: rpi( 95.7,  99.9,  95.0,  96.0,  99.1, 100.2, 100.8,  97.9,  94.2, 100.9,  97.4,  95.4,  97.2,  96.7),
  // ── 2015–2024 (ČSÚ pub. 014017-25, ČÚZK realized transaction prices, 2015=100) ─
  2015: rpi(100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0),
  2016: rpi(115.3, 107.5, 108.2, 114.4, 104.2, 106.9, 109.9, 109.8, 111.9, 111.6, 113.6, 116.2, 113.5, 109.2),
  2017: rpi(134.5, 125.0, 123.6, 132.4, 117.6, 125.9, 131.6, 129.2, 126.2, 130.5, 130.1, 128.9, 126.2, 128.3),
  2018: rpi(151.3, 141.9, 138.3, 144.2, 134.9, 144.9, 146.3, 144.4, 141.0, 147.0, 142.0, 146.7, 148.3, 139.0),
  2019: rpi(164.8, 156.6, 158.0, 155.7, 146.5, 169.6, 167.9, 153.1, 146.6, 159.1, 154.0, 155.9, 164.2, 148.8),
  2020: rpi(183.0, 180.7, 188.9, 171.0, 162.2, 208.0, 194.4, 180.0, 175.5, 184.8, 176.7, 177.7, 178.8, 173.8),
  2021: rpi(219.3, 220.1, 235.7, 211.8, 196.8, 276.8, 230.6, 225.3, 211.0, 228.6, 218.6, 214.2, 221.7, 227.9),
  2022: rpi(246.3, 258.0, 277.8, 255.4, 239.6, 344.0, 281.9, 269.4, 253.2, 273.0, 257.0, 254.8, 261.6, 274.6),
  2023: rpi(234.3, 243.7, 261.4, 237.0, 230.1, 321.5, 267.0, 259.8, 233.9, 266.8, 237.7, 236.0, 251.3, 253.9),
  2024: rpi(254.3, 253.8, 269.5, 248.2, 236.0, 334.2, 275.3, 266.9, 246.5, 278.0, 250.0, 245.3, 255.3, 266.9),
  // ── 2025–2026 extrapolated: regional_2024 × (national_t / national_2024) ──────
  2025: rpi(290.2, 289.6, 307.5, 283.3, 269.3, 381.5, 314.1, 304.5, 281.3, 317.2, 285.3, 279.9, 291.3, 304.5),
  2026: rpi(300.8, 300.1, 318.7, 293.6, 279.1, 395.4, 325.5, 315.6, 291.5, 328.8, 295.7, 290.1, 301.9, 315.6),
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
// Per-region price indices live in REGIONAL_PRICE_INDICES; getRegionalData()
// always reads from there. The `regions` field is used ONLY for actual per-region
// wage data (2025 entry, from ČSÚ March 2026 release).

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
    // priceIndex values mirror REGIONAL_PRICE_INDICES[2025] (extrapolated from 2024 actuals).
    // getRegionalData() uses REGIONAL_PRICE_INDICES for price; uses avgWage from here.
    regions: {
      praha:            { priceIndex: 290, avgWage: 62_723 },
      stredocesky:      { priceIndex: 290, avgWage: 49_539 },
      jihocesky:        { priceIndex: 308, avgWage: 44_200 },
      plzensky:         { priceIndex: 283, avgWage: 45_900 },
      karlovarsky:      { priceIndex: 269, avgWage: 42_049 },
      ustecky:          { priceIndex: 382, avgWage: 44_500 },
      liberecky:        { priceIndex: 314, avgWage: 44_800 },
      kralovehradecky:  { priceIndex: 305, avgWage: 45_231 },
      pardubicky:       { priceIndex: 281, avgWage: 44_200 },
      vysocina:         { priceIndex: 317, avgWage: 44_385 },
      jihomoravsky:     { priceIndex: 285, avgWage: 49_000 },
      olomoucky:        { priceIndex: 280, avgWage: 44_000 },
      zlinsky:          { priceIndex: 291, avgWage: 43_200 },
      moravskoslezsky:  { priceIndex: 305, avgWage: 44_800 },
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
 * Price index — resolution order:
 *   1. REGIONAL_PRICE_INDICES[year][region]  — actual ČSÚ ČÚZK data (2000–2026)
 *   2. national.priceIndex × REGIONAL_PRICE_MULTIPLIERS[region]  — fallback for
 *      future years beyond the lookup table
 *
 * Wage — resolution order:
 *   1. entry.regions[region].avgWage  — actual ČSÚ wage data (2025 only)
 *   2. national.avgWage × (REGIONAL_WAGES_2025[region] / NATIONAL_WAGE_2025)
 *      — derived from stable 2025 regional wage ratio
 *
 * Falls back to national data if year is not in dataset.
 */
export function getRegionalData(year: number, region: CzechRegion): YearRegionData {
  const entry = getYearData(year);
  if (!entry) {
    const fallback = year < 2000
      ? ECONOMIC_DATA[0]
      : ECONOMIC_DATA[ECONOMIC_DATA.length - 1];
    return fallback.national;
  }

  // Price index: use actual ČSÚ per-region data where available.
  const priceIndex =
    REGIONAL_PRICE_INDICES[year]?.[region]
    ?? entry.national.priceIndex * REGIONAL_PRICE_MULTIPLIERS[region];

  // Wage: use actual ČSÚ wage if available (2025 entry), otherwise derive.
  const wageRatio = REGIONAL_WAGES_2025[region] / NATIONAL_WAGE_2025;
  const avgWage   =
    entry.regions[region]?.avgWage
    ?? Math.round(entry.national.avgWage * wageRatio);

  return { priceIndex, avgWage };
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
