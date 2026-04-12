// Baseline affordability data for MVP.
// Sources: Czech Statistical Office (ČSÚ), Czech National Bank (CNB/ARAD)
//
// House price index: Prague new flats, base 2015=100.
//   Derived from ČSÚ/Eurostat ICBN series. Approximate for pre-2010 periods
//   where quarterly granularity is limited — ratios are calibrated against
//   average CZK/m² in Prague (2000≈17k, 2005≈32k, 2010≈50k, 2015≈60k).
//
// Wages: CZ average gross monthly wage, Q4 values (ČSÚ quarterly survey).
//   Q4 is used consistently because it is the highest quarter (includes bonuses)
//   and matches the 2020_q4 / 2025_q4 anchors already in the model.
//
// Mortgage rates: CNB average new-loan rate for residential property purchase,
//   December reading. Approximate for years with limited digital access.

export interface YearData {
  houseIndex: number;    // Prague new-flat price index (2015 = 100)
  income: number;        // CZ average gross monthly wage, CZK, Q4
  mortgageRate: number;  // annual new-loan mortgage rate, decimal (0.0219 = 2.19%)
}

// ── Raw data tables ───────────────────────────────────────────────────────────

const HOUSE_INDEX = {
  prague_new_flat: {
    // Backfilled from average price/m²: 2000≈17k, 2005≈32k, 2010≈50k, 2015≈60k
    "2000_q4":  28.3,
    "2005_q4":  53.3,
    "2010_q4":  83.3,
    "2015_q4": 100.0,
    "2020_q4": 172.3,
    "2025_q4": 264.7,
  },
} as const;

const INCOME_INDEX = {
  cz_avg_wage: {
    // ČSÚ quarterly gross wage survey, Q4 readings
    "2000_q4":  14500,
    "2005_q4":  20100,
    "2010_q4":  25803,
    "2015_q4":  27200,
    "2020_q4":  38525,
    "2025_q4":  52283,
  },
} as const;

const MORTGAGE_RATES = {
  cz_loans_house_purchase: {
    // CNB average new housing loan rate, December reading.
    // 2000 confirmed: 8.6% (Radio Prague International / CNB)
    // 2005 confirmed: ~3.64% in Oct 2005 (hyponamiru.cz historical) → 3.65% Dec est.
    // 2010 confirmed: ~4.42% in Oct 2010 (chytryhonza.cz historical) → 4.30% Dec est.
    // 2015: interpolated between 2014 CNB (2.56%) and 2020 CNB (2.19%), declining trend
    "2000_12": 0.0860,   //  8.6% — confirmed
    "2005_12": 0.0365,   //  3.65% — confirmed Oct, Dec estimate
    "2010_12": 0.0430,   //  4.30% — confirmed Oct, Dec estimate
    "2015_12": 0.0235,   //  2.35% — interpolated (2014=2.56%, 2020=2.19%)
    "2020_12": 0.0219,   //  2.19% — confirmed CNB
    "2026_03": 0.0455,   //  4.55% — confirmed CNB
  },
} as const;

// ── Current period (latest known data) ───────────────────────────────────────

export const CURRENT: YearData = {
  houseIndex:   HOUSE_INDEX.prague_new_flat["2025_q4"],
  income:       INCOME_INDEX.cz_avg_wage["2025_q4"],
  mortgageRate: MORTGAGE_RATES.cz_loans_house_purchase["2026_03"],
};

// ── Target year lookup ────────────────────────────────────────────────────────
//
// Only years with complete data are listed. Requesting any other year returns
// null so callers can render a graceful "no data" state.

const TARGET_YEARS: Readonly<Record<number, YearData>> = {
  2000: {
    houseIndex:   HOUSE_INDEX.prague_new_flat["2000_q4"],
    income:       INCOME_INDEX.cz_avg_wage["2000_q4"],
    mortgageRate: MORTGAGE_RATES.cz_loans_house_purchase["2000_12"],
  },
  2005: {
    houseIndex:   HOUSE_INDEX.prague_new_flat["2005_q4"],
    income:       INCOME_INDEX.cz_avg_wage["2005_q4"],
    mortgageRate: MORTGAGE_RATES.cz_loans_house_purchase["2005_12"],
  },
  2010: {
    houseIndex:   HOUSE_INDEX.prague_new_flat["2010_q4"],
    income:       INCOME_INDEX.cz_avg_wage["2010_q4"],
    mortgageRate: MORTGAGE_RATES.cz_loans_house_purchase["2010_12"],
  },
  2015: {
    houseIndex:   HOUSE_INDEX.prague_new_flat["2015_q4"],
    income:       INCOME_INDEX.cz_avg_wage["2015_q4"],
    mortgageRate: MORTGAGE_RATES.cz_loans_house_purchase["2015_12"],
  },
  2020: {
    houseIndex:   HOUSE_INDEX.prague_new_flat["2020_q4"],
    income:       INCOME_INDEX.cz_avg_wage["2020_q4"],
    mortgageRate: MORTGAGE_RATES.cz_loans_house_purchase["2020_12"],
  },
};

/** Returns data for the target year, or null if not available. */
export function getTargetYearData(year: number): YearData | null {
  return TARGET_YEARS[year] ?? null;
}

/** Years for which complete data exists. */
export function getAvailableYears(): number[] {
  return Object.keys(TARGET_YEARS).map(Number);
}
