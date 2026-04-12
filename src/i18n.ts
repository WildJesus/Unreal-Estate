// i18n — Czech / English translations for all user-visible strings.
// Usage:
//   import { t, setLang, getLang, type Lang } from './i18n';
//   t('widgetBurden')                     // static → "Zatížení" or "Burden"
//   t('ppStep2Head', 2015)                // dynamic → "2. Zatížení v roce 2015"

export type Lang = 'cs' | 'en';

// Active language — updated by setLang(), read by t().
let currentLang: Lang = 'cs';

export function getLang(): Lang  { return currentLang; }
export function setLang(l: Lang) { currentLang = l; }

// ─── Translation maps ─────────────────────────────────────────────────────────

const T = {
  cs: {
    // ── Debug overlay ──────────────────────────────────────────────────────────
    dbgTitle:           'Ladič cen',
    dbgBadge:           'debug',
    dbgClose:           'Zavřít',
    dbgScanning:        'Prohledávám…',
    dbgNoPricesFound:   '0 nalezených cen',
    dbgNoPricesOnPage:  'Na této stránce nebyly nalezeny žádné ceny.',
    dbgZeroPrices:      '0 cen',
    dbgFooterWithLoc:   (n: number, region: string, source: string) =>
                          `${n} cen · ${region} [${source}]`,
    dbgFooterNoLoc:     (n: number) => `${n} cen · lokace neznámá`,
    dbgFooterLocated:   (n: number, located: number) =>
                          `${n} cen · ${located}/${n} lokalizováno`,
    dbgLocationUnknown: 'lokace neznámá',

    // ── Main overlay ───────────────────────────────────────────────────────────
    moMinimize:         'Minimalizovat',
    moClose:            'Zavřít',
    moExpand:           'Rozbalit',
    moYearSection:      'Porovnat s jiným rokem',
    moNoYearSelected:   'Žádný rok nevybrán',
    moYearPlaceholder:  'zadejte rok, např. 2013',
    moConfirmYear:      'Potvrdit rok (Enter)',
    moCitySection:      'Porovnat s jiným městem',
    moCitySelected:     'vybráno',
    moComparison:       'Porovnání',
    moSelectedYear:     'Vybraný rok',

    // ── Detail comparison panel ────────────────────────────────────────────────
    compNoPrice:        'Na této stránce nebyla detekována cena',
    compCantParse:      'Cenu nelze naparsovat',
    compMoreBurden:     (mult: string) => `${mult} náročnější`,
    compLessBurden:     (mult: string) => `${mult} méně náročné`,
    compBurdenNow:      'Zatížení dnes',
    compEquivPrice:     'Ekv. cena',
    compPaymentNow:     'Splátka dnes',
    compPaymentYear:    (year: number) => `Splátka ${year}`,
    compRegionEst:      '⚡ region odhadnut jako Praha',
    compNoData:         (year: number) => `Žádná data pro rok ${year}`,

    // ── Inline widget ──────────────────────────────────────────────────────────
    widgetBurden:       'Zatížení',
    widgetMortgage:     'Splátka',
    widgetPerMonth:     '/měs',
    widgetInfoTooltip:  'Jak jsme to vypočítali',
    widgetNoData:       'žádná data',

    // ── Info popup — static chrome ─────────────────────────────────────────────
    popupTitle:         'Jak jsme to vypočítali',
    popupClose:         'Zavřít',
    popupDataSummary:   'Zdrojová data ▸',

    // ── Info popup — walkthrough content ──────────────────────────────────────
    ppEstimatedRegion:  '⚡ Region nebyl rozpoznán — používáme data pro Prahu',
    ppHistLabel:        (year: number) => `→ ekvivalent ${year}:`,
    ppStep1Head:        '1. Dnešní zatížení hypotékou',
    ppStep1Payment:     (price: string, rate: string, payment: string) =>
                          `Splátka dnes: ${price}, 10% akontace, sazba ${rate}% → ${payment}/měs`,
    ppStep1Income:      (region: string, year: number, income: string) =>
                          `Čistý příjem domácnosti (${region}, ${year}): ~${income}/měs`,
    ppBurdenFormula:    'Zatížení',
    ppStep2Head:        (year: number) => `2. Zatížení v roce ${year}`,
    ppStep2Growth:      (region: string, year: number, pct: string, histPrice: string) =>
                          `Ceny v ${region} vzrostly od ${year} o ${pct}% → odhadovaná cena tehdy: ${histPrice}`,
    ppStep2Payment:     (histPrice: string, rate: string, payment: string) =>
                          `Splátka tehdy: ${histPrice}, 10% akontace, sazba ${rate}% → ${payment}/měs`,
    ppWidgetMortRef:    (arrow: string, pct: string) => `widget Splátka ${arrow}${pct}%`,
    ppStep2Income:      (region: string, year: number, income: string) =>
                          `Čistý příjem domácnosti (${region}, ${year}): ~${income}/měs`,
    ppWidgetBurdenRef:  (burden: string) => `widget Zatížení ${burden}`,
    ppStep3Head:        '3. Za kolik by musel být byt dnes, aby zatížení bylo stejné?',
    ppStep3Body:        (burden: string) =>
                          `Pro zatížení ${burden} při dnešních sazbách a příjmech:`,
    ppWidgetPriceRef:   (arrow: string, pct: string) => `widget ${arrow}${pct}%`,
    ppResult:           (mult: string, year: number) =>
                          `Dnes je bydlení ${mult} náročnější než v roce ${year}.`,
    ppWidgetLabel:      'Výsledek ve widgetu:',

    // ── Data sources table ────────────────────────────────────────────────────
    tableWageRow:       (region: string) => `Průměrná mzda (${region})`,
    tableRateRow:       'Hypoteční sazba',
    tablePriceIndexRow: 'Cenový index (2015=100)',
    tableSources:       (v: string) =>
                          `Mzdy: ČSÚ roční průměry · Sazby: Hypoindex/ČNB · Ceny: ČSÚ indexy realizovaných cen · ${v}`,

    // ── Extension popup labels ────────────────────────────────────────────────
    popupAutoTurnOn:     'Automaticky zapnout',
    popupLaunchOverlay:  'Spustit overlay',
    popupLaunchDebugger: 'Spustit debugger',
    popupNotOnSreality:  'Nejste na stránce sreality.cz.',
    popupLangLabel:      'Jazyk',
  },

  en: {
    // ── Debug overlay ──────────────────────────────────────────────────────────
    dbgTitle:           'Price Debugger',
    dbgBadge:           'debug',
    dbgClose:           'Close',
    dbgScanning:        'Scanning…',
    dbgNoPricesFound:   '0 prices found',
    dbgNoPricesOnPage:  'No prices found on this page.',
    dbgZeroPrices:      '0 prices',
    dbgFooterWithLoc:   (n: number, region: string, source: string) =>
                          `${n} price${n === 1 ? '' : 's'} · ${region} [${source}]`,
    dbgFooterNoLoc:     (n: number) =>
                          `${n} price${n === 1 ? '' : 's'} · location unknown`,
    dbgFooterLocated:   (n: number, located: number) =>
                          `${n} price${n === 1 ? '' : 's'} · ${located}/${n} located`,
    dbgLocationUnknown: 'location unknown',

    // ── Main overlay ───────────────────────────────────────────────────────────
    moMinimize:         'Minimize',
    moClose:            'Close',
    moExpand:           'Expand',
    moYearSection:      'Compare to a different year',
    moNoYearSelected:   'No year selected',
    moYearPlaceholder:  'type a year, e.g. 2013',
    moConfirmYear:      'Confirm year (Enter)',
    moCitySection:      'Compare to a different city',
    moCitySelected:     'selected',
    moComparison:       'Comparison',
    moSelectedYear:     'Selected year',

    // ── Detail comparison panel ────────────────────────────────────────────────
    compNoPrice:        'No price detected on this page',
    compCantParse:      'Could not parse price',
    compMoreBurden:     (mult: string) => `${mult} more burdensome`,
    compLessBurden:     (mult: string) => `${mult} less burdensome`,
    compBurdenNow:      'Burden now',
    compEquivPrice:     'Equiv. price',
    compPaymentNow:     'Payment now',
    compPaymentYear:    (year: number) => `Payment ${year}`,
    compRegionEst:      '⚡ region estimated as Praha',
    compNoData:         (year: number) => `No data available for ${year}`,

    // ── Inline widget ──────────────────────────────────────────────────────────
    widgetBurden:       'Burden',
    widgetMortgage:     'Mortgage',
    widgetPerMonth:     '/month',
    widgetInfoTooltip:  'How we calculated this',
    widgetNoData:       'no data',

    // ── Info popup — static chrome ─────────────────────────────────────────────
    popupTitle:         'How we calculated this',
    popupClose:         'Close',
    popupDataSummary:   'Data sources ▸',

    // ── Info popup — walkthrough content ──────────────────────────────────────
    ppEstimatedRegion:  '⚡ Region not detected — using Praha data',
    ppHistLabel:        (year: number) => `→ ${year} equivalent:`,
    ppStep1Head:        '1. Today\'s mortgage burden',
    ppStep1Payment:     (price: string, rate: string, payment: string) =>
                          `Payment today: ${price}, 10% down, rate ${rate}% → ${payment}/month`,
    ppStep1Income:      (region: string, year: number, income: string) =>
                          `Household net income (${region}, ${year}): ~${income}/month`,
    ppBurdenFormula:    'Burden',
    ppStep2Head:        (year: number) => `2. Burden in ${year}`,
    ppStep2Growth:      (region: string, year: number, pct: string, histPrice: string) =>
                          `Prices in ${region} grew ${pct}% since ${year} → estimated price back then: ${histPrice}`,
    ppStep2Payment:     (histPrice: string, rate: string, payment: string) =>
                          `Payment then: ${histPrice}, 10% down, rate ${rate}% → ${payment}/month`,
    ppWidgetMortRef:    (arrow: string, pct: string) => `widget Mortgage ${arrow}${pct}%`,
    ppStep2Income:      (region: string, year: number, income: string) =>
                          `Household net income (${region}, ${year}): ~${income}/month`,
    ppWidgetBurdenRef:  (burden: string) => `widget Burden ${burden}`,
    ppStep3Head:        '3. What price would match that burden today?',
    ppStep3Body:        (burden: string) =>
                          `For ${burden} burden at today\'s rates and income:`,
    ppWidgetPriceRef:   (arrow: string, pct: string) => `widget ${arrow}${pct}%`,
    ppResult:           (mult: string, year: number) =>
                          `Housing is ${mult} more burdensome today than in ${year}.`,
    ppWidgetLabel:      'Result in the widget:',

    // ── Data sources table ────────────────────────────────────────────────────
    tableWageRow:       (region: string) => `Average wage (${region})`,
    tableRateRow:       'Mortgage rate',
    tablePriceIndexRow: 'Price index (2015=100)',
    tableSources:       (v: string) =>
                          `Wages: ČSÚ annual averages · Rates: Hypoindex/ČNB · Prices: ČSÚ realized price indices · ${v}`,

    // ── Extension popup labels ────────────────────────────────────────────────
    popupAutoTurnOn:     'Auto turn on',
    popupLaunchOverlay:  'Launch overlay',
    popupLaunchDebugger: 'Launch debugger',
    popupNotOnSreality:  'Not on a sreality.cz page.',
    popupLangLabel:      'Language',
  },
} as const;

// ─── t() — translate a key, dispatching on static vs. function value ──────────

type Translations = typeof T.cs;
type Key = keyof Translations;

// Overload 1 — static string keys (no extra args needed)
type StaticKey = { [K in Key]: Translations[K] extends string ? K : never }[Key];
export function t(key: StaticKey): string;

// Overload 2 — function keys (passes args through to the translation function)
type FnKey = { [K in Key]: Translations[K] extends (...a: any[]) => string ? K : never }[Key];
export function t<K extends FnKey>(
  key: K,
  ...args: Parameters<Translations[K] extends (...a: any[]) => string ? Translations[K] : never>
): string;

// Implementation
export function t(key: Key, ...args: unknown[]): string {
  const val = T[currentLang][key] ?? T.cs[key];
  return typeof val === 'function' ? (val as (...a: unknown[]) => string)(...args) : val as string;
}
